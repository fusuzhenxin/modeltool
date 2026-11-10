"""Exercise the actual site engines with fake API replies, never a paid upstream."""
import json
import re
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend.app import create_app
from backend.core import day
from backend.site_tests import bridge, catalog, post_exchange
from backend.worker import work_once

ROOT = Path(__file__).resolve().parents[1]


def load_questions():
    source = "const fs=require('node:fs'),vm=require('node:vm');const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('js/data.js','utf8'),ctx);process.stdout.write(vm.runInContext('JSON.stringify(DATA.bank)',ctx))"
    return json.loads(subprocess.check_output(["node", "-e", source], cwd=ROOT, encoding="utf-8"))


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions = load_questions()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        result = self.client.post("/api/auth/setup", json={"username": "admin", "password": "temporary-test-password", "token": token})
        self.headers = {"X-CSRF-Token": result.json()["csrf"]}
        self.station = self.post("stations", {"name": "本站题组测试", "base_url": "https://site-fixture.example/v1", "api_key": "sk-site-secret", "models": ["fixture-model"], "daily_calls": 1000, "daily_tokens": 1000000}).json()
        self.client.put("/api/admin/settings", headers=self.headers, json={"daily_calls": 1000, "daily_tokens": 1000000, "paused": False})
        self.calls = []

    def tearDown(self):
        self.client.close(); self.temp.cleanup()

    def post(self, path, body):
        return self.client.post("/api/admin/" + path, headers=self.headers, json=body)

    def fake(self, url, headers, payload):
        self.calls.append(payload)
        messages = payload["messages"]
        user = messages[-1]["content"]
        system = payload.get("system", "") or (messages[0]["content"] if messages[0]["role"] == "system" else "")
        answer = "OK"
        if isinstance(user, list):
            answer = "红"
        elif "选项：" in user:
            q = next(q for q in self.questions if q["stem"] in user)
            correct = q["options"][q["answer"]]
            answer = next(letter for letter, text in re.findall(r"^([A-D])\. (.*)$", user, re.M) if text == correct)
        elif "1 到 355" in user:
            answer = ", ".join(str((i * 73 + len(self.calls) * 41) % 355 + 1) for i in range(330))
        elif "HTML" in user or "SVG" in user or "Three.js" in user:
            answer = '<html><body><svg><circle/><path/></svg><script>requestAnimationFrame(draw)</script></body></html>'
        elif "苹果" in system:
            answer = "苹果"
        elif "暗号是什么" in user:
            answer = "青鸟"
        elif "从 1 到 200" in user:
            answer = "1,2,3,4,5"
        message = {"content": answer}
        if payload.get("tools"):
            message["tool_calls"] = [{"type": "function", "function": {"name": "get_code", "arguments": '{"id":"42"}'}}]
        data = {"id": "chatcmpl-fixture", "object": "chat.completion", "model": payload["model"], "choices": [{"message": message, "finish_reason": "length" if "从 1 到 200" in str(user) else "stop"}], "usage": {"prompt_tokens": 30, "completion_tokens": 10, "total_tokens": 40, "prompt_tokens_details": {"cached_tokens": 5}}}
        if payload.get("stream"):
            return {"status": 200, "json": None, "text": 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', "headers": {"content-type": "text/event-stream"}, "elapsedMs": 1, "error": ""}
        return data

    def run_test(self, kind, transport=None, **kwargs):
        result = self.post("jobs", {"station_id": self.station["id"], "model": "fixture-model", "kind": kind, "count": 3, "candy_count": 3, **kwargs})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(work_once(self.db, transport or self.fake))
        job = next(j for j in self.client.get("/api/admin/jobs").json() if j["id"] == result.json()["id"])
        self.assertEqual(job["status"], "done", job)
        return dict(self.db.get("reports", job["report_id"]), id=job["report_id"])

    def test_catalog_covers_every_site_entry(self):
        options = self.client.get("/api/admin/test-options").json()
        self.assertEqual(len(options), 10)
        self.assertEqual({o["id"] for o in options}, {"site_basic", "site_ability", "site_logic", "site_code", "site_qa", "site_candy", "site_relay", "site_trace", "site_pelican", "site_all"})
        for option in options:
            self.assertTrue(option["description"])
            self.assertNotIn(option["id"], ("combined", "protocol", "ability"))
        self.assertEqual(self.post("jobs", {"station_id": self.station["id"], "model": "fixture-model", "kind": "site_missing"}).status_code, 422)

    def test_all_single_choices_use_original_questions_and_grading(self):
        for kind in ("site_ability", "site_logic", "site_code", "site_qa", "site_candy"):
            with self.subTest(kind=kind):
                before = len(self.calls)
                report = self.run_test(kind)["result"]
                section = report["sections"][0]
                self.assertEqual(section["kind"], kind.removeprefix("site_"))
                self.assertEqual(section["score"], 100)
                self.assertEqual(len(self.calls) - before, 3)
                self.assertEqual(report["ability"]["score"], 100)
                self.assertFalse(report["protocol_tested"])
                self.assertEqual(report["level"], "unknown")
                for item in section["items"]:
                    self.assertTrue(item["correct"])
                    self.assertTrue(any(q["id"] == item["qid"] and q["stem"] == item["stem"] for q in self.questions))
                self.assertEqual(self.calls[-1]["temperature"], 0)
                self.assertEqual(self.calls[-1]["max_tokens"], 256)

    def test_basic_runs_four_modules_with_actual_hard_question_count(self):
        report = self.run_test("site_basic", difficulty="hard", count=30)["result"]
        self.assertEqual([s["kind"] for s in report["sections"]], ["ability", "logic", "code", "qa"])
        self.assertEqual([s["count"] for s in report["sections"]], [8, 5, 7, 2])
        self.assertEqual(report["request_count"], 22)
        self.assertEqual(report["ability"]["questions"], 22)
        self.assertEqual(report["ability"]["score"], 100)

    def test_relay_is_original_fourteen_checks_with_real_payload_parameters(self):
        report = self.run_test("site_relay")["result"]
        self.assertEqual(len(report["checks"]), 14)
        self.assertEqual(report["request_count"], 10)
        self.assertEqual(report["score"], 100)
        self.assertEqual(report["level"], "ok")
        self.assertIsNone(report["ability"])
        self.assertTrue(any(p.get("stream") for p in self.calls))
        self.assertTrue(any(p.get("tools") for p in self.calls))
        self.assertTrue(any(p.get("reasoning_effort") == "low" for p in self.calls))
        self.assertTrue(any(isinstance(p["messages"][-1]["content"], list) for p in self.calls))
        self.assertTrue(all(c["status"] == "pass" for c in report["checks"]))
        limit = report["sections"][0]["outputControl"]
        self.assertEqual(limit["version"], 2)
        self.assertEqual(limit["attempts"][0]["parameter"], "max_completion_tokens")
        self.assertEqual(limit["attempts"][0]["cap"], 32)

    def test_output_limit_fallback_and_confirmed_overrun_only_affect_this_check(self):
        def overflow(url, headers, payload):
            if "max_completion_tokens" in payload:
                self.calls.append(payload)
                return {"status": 400, "json": {"error": {"param": "max_completion_tokens", "message": "Unsupported parameter: max_completion_tokens"}}, "text": "", "headers": {}}
            data = self.fake(url, headers, payload)
            if "从 1 到 200" in str(payload["messages"]):
                data["usage"]["completion_tokens"] = payload["max_tokens"] + 100
                data["usage"]["total_tokens"] = 30 + data["usage"]["completion_tokens"]
                data["choices"][0]["finish_reason"] = "stop"
            return data
        result = self.run_test("site_relay", transport=overflow)["result"]
        self.assertEqual(result["request_count"], 12)
        check = next(c for c in result["checks"] if c["name"].endswith("输出控制"))
        self.assertEqual(check["status"], "fail")
        self.assertIn("两次返回用量均超出", check["detail"])
        self.assertIn("max_tokens=64", check["detail"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["level"], "ok")
        self.assertTrue(all(c["status"] == "pass" for c in result["checks"] if c != check))
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 12)

    def test_output_limit_budget_reserves_the_requested_new_parameter(self):
        self.post("jobs", {"station_id": self.station["id"], "model": "fixture-model", "kind": "site_relay"})
        def no_usage(url, headers, payload):
            data = self.fake(url, headers, payload)
            if "max_completion_tokens" in payload:
                data["usage"] = None
            return data
        self.assertTrue(work_once(self.db, no_usage))
        with self.db.connect() as con:
            usage = con.execute("SELECT tokens FROM usage WHERE actual=0").fetchall()
        self.assertIn(2080, [r[0] for r in usage])

    def test_fingerprint_uses_existing_bank_and_bare_numeric_challenges(self):
        report = self.run_test("site_trace")["result"]
        trace = report["sections"][0]
        self.assertEqual(trace["used_outputs"], 3)
        self.assertEqual(report["request_count"], 3)
        self.assertGreater(len(trace["results"]), 2)
        self.assertFalse(trace["known"])
        self.assertIsNone(report["ability"])
        for payload in self.calls:
            self.assertNotIn("temperature", payload)
            self.assertEqual(payload["max_tokens"], 8192)
            self.assertEqual(len(payload["messages"]), 1)
            self.assertIn("禁止调用或借助任何工具", payload["messages"][0]["content"])

    def test_site_pelican_supports_all_three_original_prompts(self):
        for mode in ("svg", "html2d", "three"):
            report = self.run_test("site_pelican", pelican_mode=mode)["result"]
            self.assertEqual(report["artwork"]["mode"], mode)
            self.assertTrue(report["artwork"]["available"])
            self.assertFalse(report["protocol_tested"])
            self.assertIsNone(report["ability"])
            self.assertEqual(self.calls[-1]["max_tokens"], 8192)
            self.assertEqual(self.calls[-1]["temperature"], .4)

    def test_anthropic_uses_original_messages_shape_and_grading(self):
        station = self.db.get("stations", self.station["id"])
        station["protocol"] = "anthropic"
        self.db.save("stations", self.station["id"], station)
        def anthropic(url, headers, payload):
            self.assertTrue(url.endswith("/v1/messages"))
            self.assertEqual(headers["x-api-key"], "sk-site-secret")
            self.assertNotIn("Authorization", headers)
            self.assertIn("system", payload)
            self.assertEqual(payload["messages"][0]["role"], "user")
            data = self.fake(url, headers, payload)
            return {"content": [{"type": "text", "text": data["choices"][0]["message"]["content"]}], "usage": {"input_tokens": 30, "output_tokens": 10}}
        result = self.run_test("site_ability", transport=anthropic)["result"]
        self.assertEqual(result["ability"]["score"], 100)
        self.assertEqual(result["request_count"], 3)

    def test_missing_usage_keeps_reservation_and_echoed_credentials_are_removed(self):
        def echo(url, headers, payload):
            data = self.fake(url, headers, payload)
            data["usage"] = None
            data["debug"] = {"echo": headers["Authorization"]}
            return data
        result = self.run_test("site_ability", transport=echo)["result"]
        self.assertEqual(result["ability"]["score"], 100)
        self.assertNotIn("sk-site-secret", json.dumps(result))
        with self.db.connect() as con:
            usage = con.execute("SELECT SUM(tokens),SUM(actual) FROM usage").fetchone()
        self.assertEqual(tuple(usage), (3 * 2304, 0))

    def test_actual_http_preserves_sse_and_stops_redirects_and_auth_errors(self):
        received, response_status = [], [200]
        fake = self.fake
        class Handler(BaseHTTPRequestHandler):
            def do_POST(handler):
                payload = json.loads(handler.rfile.read(int(handler.headers["Content-Length"])))
                received.append((handler.path, handler.headers.get("Host")))
                data = fake("", dict(handler.headers), payload)
                body = (data["text"] if payload.get("stream") else json.dumps(data)).encode()
                handler.send_response(response_status[0])
                handler.send_header("Content-Type", "text/event-stream" if payload.get("stream") else "application/json")
                handler.send_header("X-Request-Id", "fixture-request")
                handler.send_header("Location", "http://should-never-be-followed.invalid/")
                handler.send_header("Content-Length", str(len(body)))
                handler.end_headers(); handler.wfile.write(body)
            def log_message(*args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            station = self.db.get("stations", self.station["id"])
            station["base_url"] = f"http://site-fixture.example:{server.server_port}/v1"
            self.db.save("stations", self.station["id"], station)
            job = self.post("jobs", {"station_id": self.station["id"], "model": "fixture-model", "kind": "site_relay"}).json()
            with patch("backend.site_tests.resolve_public", return_value="127.0.0.1"):
                self.assertTrue(work_once(self.db))
                stored = next(j for j in self.client.get("/api/admin/jobs").json() if j["id"] == job["id"])
                self.assertEqual(stored["status"], "done", stored)
                report = self.db.get("reports", stored["report_id"])["result"]
                self.assertEqual(report["score"], 100)
                stream = next(row["response"] for row in report["raw"] if row["payload"].get("stream"))
                self.assertIn("data: [DONE]", stream["text"])
                self.assertEqual(stream["headers"]["x-request-id"], "fixture-request")
                self.assertNotIn("location", stream["headers"])
                self.assertEqual(len(received), 10)
                self.assertTrue(all(path == "/v1/chat/completions" and host == f"site-fixture.example:{server.server_port}" for path, host in received))
                for status in (302, 401):
                    response_status[0] = status
                    from backend.runner import RunStopped
                    with self.assertRaises(RunStopped):
                        post_exchange(station["base_url"] + "/chat/completions", {}, {"model": "fixture-model", "messages": [{"role": "user", "content": "hello"}], "max_tokens": 256})
                self.assertEqual(len(received), 12)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)

    def test_http_errors_and_cancellation_stop_without_a_passing_report(self):
        spec = {"station_id": self.station["id"], "model": "fixture-model", "kind": "site_relay"}
        self.post("jobs", spec)
        work_once(self.db, lambda *_: {"status": 401, "text": "sk-site-secret", "json": None})
        self.assertEqual(self.db.list("reports"), [])
        self.assertNotIn("sk-site-secret", self.client.get("/api/admin/jobs").text)
        self.post("jobs", spec)
        count = 0
        def cancel(url, headers, payload):
            nonlocal count
            count += 1
            with self.db.connect(write=True) as con:
                con.execute("UPDATE jobs SET cancel=1 WHERE status='running'")
            return self.fake(url, headers, payload)
        work_once(self.db, cancel)
        self.assertEqual(count, 1)
        self.assertEqual(self.db.list("reports"), [])

    def test_all_tests_persist_reviewed_independent_results_without_public_raw_html(self):
        row = self.run_test("site_all")
        result = row["result"]
        self.assertEqual([s["kind"] for s in result["sections"]], ["ability", "logic", "code", "qa", "candy", "relay", "trace", "pelican"])
        self.assertEqual(result["request_count"], 29)
        self.assertTrue(result["artwork"]["available"])
        self.assertEqual(self.client.get(f"/api/public/reports/{row['id']}/artwork").status_code, 404)
        self.client.put(f"/api/admin/reports/{row['id']}", headers=self.headers, json={"status": "published"})
        public = self.client.get("/api/public/bootstrap").json()["reports"][0]
        self.assertNotIn("raw", public)
        self.assertNotIn('"html"', json.dumps(public))
        self.assertNotIn('"reply"', json.dumps(public))
        self.assertEqual(len(public["sections"]), 8)
        self.assertEqual(self.client.get(f"/api/public/reports/{row['id']}/artwork").status_code, 200)
        self.assertIn("全部测试", self.client.get("/api/admin/reports").text)

    def test_scheduled_site_configuration_and_budget_stop_do_not_fall_back(self):
        plan = self.post("schedules", {"name": "原版指纹", "station_id": self.station["id"], "model": "fixture-model", "kind": "site_trace", "difficulty": "hard", "count": 5, "pelican_mode": "svg", "interval_minutes": 60, "first_run": "2020-01-01T00:00:00Z"})
        self.assertEqual(plan.status_code, 200, plan.text)
        self.client.put("/api/admin/settings", headers=self.headers, json={"daily_calls": 1000, "daily_tokens": 10000, "paused": False})
        self.assertTrue(work_once(self.db, self.fake))
        self.assertEqual(self.calls, [])
        job = self.client.get("/api/admin/jobs").json()[0]
        self.assertEqual(job["status"], "cancelled")
        self.assertEqual(self.db.list("reports"), [])
        retry = self.post("jobs/" + job["id"] + "/retry", {})
        self.assertEqual(retry.status_code, 200)
        with self.db.connect() as con:
            config = json.loads(con.execute("SELECT config FROM jobs WHERE id=?", (retry.json()["id"],)).fetchone()[0])
        self.assertEqual(config["kind"], "site_trace")
        self.assertEqual(config["difficulty"], "hard")
        self.assertEqual(config["count"], 5)


if __name__ == "__main__":
    unittest.main()
