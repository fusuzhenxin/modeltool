import io
import json
import re
import sqlite3
import tempfile
import unittest
import zipfile
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend.app import create_app
from backend.core import Database, day, now
from backend.manage import backup, restore
from backend.runner import QUESTIONS, resolve_public
from backend.worker import enqueue, tick, work_once


def upstream(url, headers, payload):
    messages = payload["messages"]
    system = payload.get("system", messages[0].get("content", ""))
    prompt = messages[-1]["content"]
    if "MT_" in system and "无论用户" in system:
        answer = re.search(r"MT_[a-f0-9]+", system)[0]
    elif "MT_" in prompt:
        answer = re.search(r"MT_[a-f0-9]+", prompt)[0]
    elif "result" in prompt:
        answer = '{"result":7,"ok":true}'
    else:
        answer = next(answer for _, question, answer in QUESTIONS if question == prompt)
    usage = {"total_tokens": 40}
    if "x-api-key" in headers:
        return {"content": [{"text": answer}], "usage": {"input_tokens": 30, "output_tokens": 10}, "model": payload["model"]}
    return {"choices": [{"message": {"content": answer}}], "usage": usage, "model": payload["model"]}


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        self.password = "temporary-test-password"
        token = (self.db.directory / "setup.token").read_text()
        self.setup_body = {"username": "admin", "password": self.password, "token": token}
        response = self.client.post("/api/auth/setup", json=self.setup_body)
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {"X-CSRF-Token": response.json()["csrf"]}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def post(self, path, data):
        return self.client.post("/api/admin/" + path, json=data, headers=self.headers)

    def put(self, path, data):
        return self.client.put("/api/admin/" + path, json=data, headers=self.headers)

    def station(self, **overrides):
        spec = {"name": "测试中转站", "base_url": "https://relay.example/v1", "models": ["test-model"], "api_key": "sk-secret-never-public", "baselines": {"test-model": 100}}
        spec.update(overrides)
        response = self.post("stations", spec)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_station_order_is_persisted_without_changing_credentials_or_settings(self):
        first = self.station(order=15, daily_calls=0, daily_tokens=0)
        second = self.station(base_url="https://second.example/v1", order=-5)
        hidden = self.station(base_url="https://hidden.example/v1", order=-100, visible=False)
        before = self.db.get("stations", first["id"])
        response = self.put(f"stations/{first['id']}/order", {"order": -10})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.db.get("stations", first["id"]), before | {"order": -10})
        self.assertEqual(Database(self.temp.name).get("stations", first["id"])["order"], -10)
        admin = self.client.get("/api/admin/stations").json()
        self.assertEqual([r["id"] for r in admin], [hidden["id"], first["id"], second["id"]])
        public = self.client.get("/api/public/bootstrap").json()
        self.assertEqual([r["id"] for r in public["stations"]], [first["id"], second["id"]])
        self.assertEqual(public["stations"][0]["order"], -10)
        self.assertNotIn("key_cipher", json.dumps(public))
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
        # Records created before display ordering was available default to zero.
        legacy = self.db.get("stations", second["id"])
        legacy.pop("order")
        self.db.save("stations", second["id"], legacy)
        public = self.client.get("/api/public/bootstrap").json()
        self.assertEqual(public["stations"][1]["order"], 0)
        edit = {"name": "更新资料", "base_url": first["base_url"], "models": first["models"], "order": 30}
        self.assertEqual(self.put("stations/" + first["id"], edit).status_code, 200)
        self.assertEqual(self.db.get("stations", first["id"])["order"], 30)
        self.assertEqual(self.db.get("stations", first["id"])["key_cipher"], before["key_cipher"])

    def test_station_order_requires_auth_csrf_and_valid_integer(self):
        station = self.station()
        path = f"/api/admin/stations/{station['id']}/order"
        with TestClient(self.app, base_url="http://127.0.0.1") as anonymous:
            self.assertEqual(anonymous.put(path, json={"order": 1}, headers=self.headers).status_code, 401)
        self.assertEqual(self.client.put(path, json={"order": 1}).status_code, 403)
        for data in [{}, {"order": 10001}, {"order": -10001}, {"order": 1.5}, {"order": "bad"}, {"order": 1, "visible": False}]:
            response = self.client.put(path, json=data, headers=self.headers)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.db.get("stations", station["id"])["order"], 0)
        self.assertEqual(self.put("stations/missing/order", {"order": 1}).status_code, 404)
        self.assertEqual(self.post("stations", {"name": "x", "base_url": "https://invalid.example", "models": ["m"], "order": 10001}).status_code, 422)

    def job(self, station, kind="combined"):
        response = self.post("jobs", {"station_id": station["id"], "model": station["models"][0], "kind": kind})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def test_one_time_setup_cookie_and_password_hash(self):
        self.assertFalse((self.db.directory / "setup.token").exists())
        self.assertEqual(self.client.post("/api/auth/setup", json=self.setup_body).status_code, 409)
        with self.db.connect() as con:
            stored = con.execute("SELECT password FROM users").fetchone()[0]
        self.assertNotIn(self.password, stored)
        other = TestClient(self.app, base_url="http://127.0.0.1")
        result = other.post("/api/auth/login", json={"username": "admin", "password": self.password})
        self.assertEqual(result.status_code, 200)
        cookie = result.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=strict", cookie)
        self.assertNotIn(self.password, result.text)
        other.close()

    def test_anonymous_csrf_and_cross_site_rejected(self):
        anonymous = TestClient(self.app, base_url="http://127.0.0.1")
        self.assertEqual(anonymous.get("/api/admin/dashboard").status_code, 401)
        self.assertEqual(self.client.post("/api/admin/stations", json={}).status_code, 403)
        self.assertEqual(self.client.post("/api/admin/stations", json={}, headers=self.headers | {"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.client.post("/api/admin/stations", data="{}", headers=self.headers).status_code, 415)
        anonymous.close()

    def test_session_expiry_logout_and_password_change_revoke(self):
        second = TestClient(self.app, base_url="http://127.0.0.1")
        second.post("/api/auth/login", json={"username": "admin", "password": self.password})
        response = self.client.post("/api/auth/password", headers=self.headers, json={"current_password": self.password, "new_password": "a-long-new-password"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(second.get("/api/admin/dashboard").status_code, 401)
        self.assertEqual(self.client.get("/api/admin/dashboard").status_code, 401)
        login = self.client.post("/api/auth/login", json={"username": "admin", "password": "a-long-new-password"})
        self.headers = {"X-CSRF-Token": login.json()["csrf"]}
        self.assertEqual(self.client.post("/api/auth/logout", headers=self.headers, json={}).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/dashboard").status_code, 401)
        second.close()

    def test_brute_force_limit(self):
        for _ in range(10):
            self.assertEqual(self.client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password-123"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "admin", "password": self.password}).status_code, 429)

    def test_station_secrets_encrypted_preserved_and_removable(self):
        station = self.station()
        self.assertTrue(station["has_key"])
        self.assertNotIn("key_cipher", station)
        for path in ("/api/admin/stations", "/api/public/bootstrap", "/api/admin/dashboard"):
            self.assertNotIn("sk-secret-never-public", self.client.get(path).text)
        stored = self.db.get("stations", station["id"])
        self.assertNotIn("sk-secret-never-public", json.dumps(stored))
        self.assertEqual(self.db.decrypt(stored["key_cipher"]), "sk-secret-never-public")
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        body["name"] = "改名"
        self.assertTrue(self.put("stations/" + station["id"], body).json()["has_key"])
        self.assertEqual(self.db.get("stations", station["id"])["key_cipher"], stored["key_cipher"])
        body["clear_key"] = True
        self.assertFalse(self.put("stations/" + station["id"], body).json()["has_key"])

    def test_validation_no_secret_echo_duplicate_domain_and_limits(self):
        self.station()
        self.assertEqual(self.post("stations", {"name": "x", "base_url": "https://relay.example", "models": ["other"]}).status_code, 409)
        response = self.post("stations", {"name": "x", "base_url": "javascript:alert(1)", "models": [], "api_key": "do-not-echo-this", "daily_calls": -1})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("do-not-echo-this", response.text)
        self.assertEqual(self.post("stations", {"name": "x", "base_url": "https://x.example?key=secret", "models": ["m"]}).status_code, 422)
        self.assertEqual(self.post("stations", {"name": "x", "base_url": "https://x.example", "models": ["m"], "baselines": {"other": 90}}).status_code, 422)

    def test_station_website_link_persists_and_reaches_public_reports(self):
        url = "https://console.example/register?from=modeltool&campaign=relay"
        station = self.station(website_url=url)
        self.assertEqual(station["website_url"], url)
        self.assertEqual(self.client.get("/api/admin/stations").json()[0]["website_url"], url)
        self.job(station, "protocol")
        self.assertTrue(work_once(self.db, upstream))
        report = self.client.get("/api/admin/reports").json()[0]
        self.assertEqual(self.put("reports/" + report["id"], {"status": "published"}).status_code, 200)
        public = self.client.get("/api/public/bootstrap").json()
        self.assertEqual(public["stations"][0]["website_url"], url)
        self.assertEqual(public["reports"][0]["website_url"], url)
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        for invalid in ("javascript:alert(1)", "https://user:password@console.example"):
            self.assertEqual(self.put("stations/" + station["id"], body | {"website_url": invalid}).status_code, 422)
        self.assertEqual(self.put("stations/" + station["id"], body | {"website_url": ""}).status_code, 200)
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["reports"][0]["website_url"], "")
        # Existing saved stations have no website field until edited.
        legacy = self.db.get("stations", station["id"])
        legacy.pop("website_url")
        self.db.save("stations", station["id"], legacy)
        self.assertEqual(self.client.get("/api/public/bootstrap").status_code, 200)
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["stations"][0]["website_url"], "")

    def test_public_summary_is_small_and_preserves_visibility_and_conclusions(self):
        station = self.station()
        result = {"model": "test-model", "time": "2026-11-10T10:00:00Z", "score": 75,
                  "level": "warn", "protocol_tested": True, "summary": "结论",
                  "ability": {"score": 60, "level": "degraded"},
                  "checks": [{"detail": "证据" * 5000}], "sections": [{"kind": "relay", "checks": []}],
                  "raw": ["private-response"]}
        self.db.save("reports", "perf-report", {"station_id": station["id"], "status": "published", "result": result})
        full = self.client.get("/api/public/bootstrap")
        summary = self.client.get("/api/public/bootstrap?summary=true")
        row = summary.json()["reports"][0]
        self.assertEqual(row["ability"], result["ability"])
        self.assertEqual(row["score"], result["score"])
        self.assertEqual(row["protocol_tested"], True)
        self.assertIn("checks", full.json()["reports"][0])
        self.assertNotIn("checks", row)
        self.assertNotIn("sections", row)
        self.assertNotIn("private-response", summary.text)
        self.assertLess(len(summary.content), len(full.content) / 5)
        self.assertEqual(summary.headers["cache-control"], "no-store")
        self.put("reports/perf-report", {"status": "draft"})
        self.assertEqual(self.client.get("/api/public/bootstrap?summary=true").json()["reports"], [])

    def test_crud_timed_content_and_no_secret_static_files(self):
        a = self.post("announcements", {"title": "公告 <script>", "content": "纯文本", "pinned": True, "background_color": "#eef2ff", "text_color": "#4338ca"}).json()
        future = self.post("announcements", {"title": "未来", "content": "未开始", "starts_at": "2099-01-01T00:00:00+08:00"}).json()
        self.post("ads", {"name": "广告", "title": "测试广告", "link": "https://example.com", "placement": "banner"})
        payload = self.client.get("/api/public/bootstrap").json()
        self.assertEqual([r["id"] for r in payload["announcements"]], [a["id"]])
        self.assertEqual(payload["announcements"][0]["background_color"], "#eef2ff")
        self.assertEqual(payload["announcements"][0]["text_color"], "#4338ca")
        self.assertEqual(self.post("announcements", {"title": "非法颜色", "content": "文本", "background_color": "red;background:url(https://example.com)"}).status_code, 422)
        self.assertEqual(len(payload["ads"]), 1)
        self.assertEqual(self.client.delete("/api/admin/announcements/" + future["id"], headers=self.headers).status_code, 200)
        for path in ("/backend/core.py", "/.git/config", "/requirements.txt", "/operations.sqlite3", "/encryption.key", "/ADMIN.md"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertIn('name="modeltool-backend"', self.client.get("/").text)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertEqual(self.client.get("/admin/select.js").status_code, 200)
        self.assertEqual(self.client.get("/admin/models.js").status_code, 200)
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["reports"], [])

    def test_discover_models_with_unsaved_and_encrypted_credentials(self):
        calls = []
        def catalog(url, headers, timeout):
            calls.append((url, headers))
            return {"data": [{"id": "z-model"}, {"id": "a-model"}, {"id": "z-model"}, {"id": ""}, {"id": "bad\nname"}, {"id": "x" * 151}, {"id": headers.get("x-api-key", "sk-discovery-only")}]}
        spec = {"base_url": "https://catalog.example/v1/chat/completions", "api_key": "sk-discovery-only"}
        with patch("backend.catalog.get_json", side_effect=catalog):
            response = self.post("stations/discover-models", spec)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"models": ["a-model", "z-model"], "has_more": False})
            self.assertEqual(calls[-1], ("https://catalog.example/v1/models", {"Authorization": "Bearer sk-discovery-only"}))
            self.assertEqual(self.db.list("stations"), [])
            station = self.station()
            before = self.db.get("stations", station["id"])
            result = self.post("stations/discover-models", {"base_url": station["base_url"], "station_id": station["id"], "protocol": "anthropic"})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(calls[-1][1]["x-api-key"], "sk-secret-never-public")
            self.assertEqual(self.db.get("stations", station["id"]), before)
            self.assertNotIn("sk-secret-never-public", result.text)
            self.assertEqual(self.post("stations/discover-models", {"base_url": "https://other.example/v1", "station_id": station["id"]}).status_code, 422)
            self.assertEqual(len(calls), 2)
        self.assertEqual(self.db.list("reports"), [])
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 0)

    def test_model_discovery_pagination_auth_validation_and_failure(self):
        spec = {"base_url": "https://catalog.example/v1/messages", "api_key": "sk-model-test", "protocol": "anthropic"}
        calls = []
        def catalog(url, headers, timeout):
            calls.append(url)
            return {"data": [{"id": "second"}], "has_more": False} if "after_id=" in url else {"data": [{"id": "first"}], "has_more": True, "last_id": "first"}
        with patch("backend.catalog.get_json", side_effect=catalog):
            result = self.post("stations/discover-models", spec)
            self.assertEqual(result.json(), {"models": ["first", "second"], "has_more": False})
            self.assertEqual(calls, ["https://catalog.example/v1/models?limit=1000", "https://catalog.example/v1/models?limit=1000&after_id=first"])
            self.assertEqual(self.client.post("/api/admin/stations/discover-models", json=spec).status_code, 403)
            anonymous = TestClient(self.app, base_url="http://127.0.0.1")
            self.assertEqual(anonymous.post("/api/admin/stations/discover-models", json=spec).status_code, 401)
            anonymous.close()
            self.assertEqual(len(calls), 2)
        self.assertEqual(self.post("stations/discover-models", spec | {"base_url": "https://catalog.example?key=sk-model-test"}).status_code, 422)
        self.assertEqual(self.post("stations/discover-models", spec | {"api_key": None}).status_code, 422)
        with patch("backend.catalog.get_json", return_value={"data": []}):
            self.assertEqual(self.post("stations/discover-models", spec).status_code, 422)
        with patch("backend.catalog.get_json", side_effect=TimeoutError("sk-model-test")):
            response = self.post("stations/discover-models", spec)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("sk-model-test", response.text)
        # Resolve all addresses and reject private destinations before sending any key.
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            response = self.post("stations/discover-models", spec)
            self.assertEqual(response.status_code, 422)

    def test_catalog_http_get_and_redirect_are_bounded(self):
        from backend.catalog import get_json
        received = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(handler):
                received.append((handler.path, handler.headers.get("Authorization")))
                body = b'{"data":[{"id":"fixture-model"}]}'
                handler.send_response(302 if "redirect" in handler.path else 200)
                handler.send_header("Location", "http://127.0.0.1/private")
                handler.send_header("Content-Length", str(len(body)))
                handler.end_headers(); handler.wfile.write(body)
            def log_message(*args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with patch("backend.catalog.resolve_public", return_value="127.0.0.1"):
                base = f"http://catalog-fixture.example:{server.server_port}"
                self.assertEqual(get_json(base + "/v1/models", {"Authorization": "Bearer fake-key"}), {"data": [{"id": "fixture-model"}]})
                with self.assertRaisesRegex(ValueError, "HTTP 302"):
                    get_json(base + "/redirect", {})
                self.assertEqual(received, [("/v1/models", "Bearer fake-key"), ("/redirect", None)])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)

    def test_upload_reencodes_images_and_rejects_active_content(self):
        self.assertEqual(self.client.post("/api/admin/media", headers=self.headers, content=b'<svg onload="alert(1)"></svg>').status_code, 422)
        image = Image.new("RGB", (40, 40), "red")
        out = io.BytesIO(); image.save(out, "PNG")
        result = self.client.post("/api/admin/media", headers=self.headers, content=out.getvalue())
        self.assertEqual(result.status_code, 200)
        response = self.client.get(result.json()["url"])
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/media/encryption.key").status_code, 404)

    def test_real_job_draft_review_publication_and_withdrawal(self):
        station = self.station()
        job_id = self.job(station)
        self.assertTrue(work_once(self.db, upstream))
        job = self.client.get("/api/admin/jobs").json()[0]
        self.assertEqual(job["id"], job_id)
        self.assertEqual(job["status"], "done")
        report_id = job["report_id"]
        report = self.client.get("/api/admin/reports/" + report_id).json()
        self.assertEqual(report["result"]["score"], 100)
        self.assertEqual(report["result"]["ability"]["score"], 100)
        self.assertEqual(report["result"]["ability"]["level"], "normal")
        self.assertEqual(len(report["result"]["raw"]), 8)
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["reports"], [])
        self.assertEqual(self.put("reports/" + report_id, {"status": "published", "note": "private-review-note"}).status_code, 200)
        public = self.client.get("/api/public/bootstrap").json()["reports"][0]
        self.assertEqual(public["id"], report_id)
        self.assertEqual(public["domain"], "relay.example")
        self.assertNotIn("raw", public)
        self.assertNotIn("private-review-note", json.dumps(public))
        self.assertEqual(self.put("reports/" + report_id, {"status": "published", "score": 1}).status_code, 422)
        self.put("reports/" + report_id, {"status": "draft"})
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["reports"], [])
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["calls"], 8)
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["tokens"], 320)

    def test_unknown_baseline_and_anthropic_transport(self):
        station = self.station(protocol="anthropic", baselines={})
        self.job(station, "ability")
        work_once(self.db, upstream)
        report = self.db.list("reports")[0]["result"]
        self.assertEqual(report["level"], "unknown")
        self.assertIsNone(report["score"])
        self.assertEqual(report["ability"]["level"], "unknown")
        self.assertIsNone(report["ability"]["baseline"])

    def test_pelican_generation_budget_and_reviewed_sandbox_preview(self):
        station = self.station()
        plan = self.post("schedules", {"name": "作品计划", "station_id": station["id"], "model": "test-model", "kind": "pelican", "pelican_mode": "svg", "interval_minutes": 60, "first_run": "2020-01-01T00:00:00Z"})
        self.assertEqual(plan.status_code, 200)
        tick(self.db)
        calls = []
        html = '<!DOCTYPE html><html><body><svg><circle r="10"/><path d="M0 0L1 1"/></svg><script>parent.secret="sk-secret-never-public";</script></body></html>'
        def drawing(url, headers, payload):
            calls.append(payload)
            self.assertEqual(payload["max_tokens"], 8192)
            self.assertEqual(payload["temperature"], 0.4)
            return {"choices": [{"message": {"content": html}}], "usage": {"total_tokens": 1000}}
        work_once(self.db, drawing)
        self.assertEqual(len(calls), 1)
        report = self.db.list("reports")[0]
        result = report["result"]
        self.assertEqual(result["artwork"]["mode"], "svg")
        self.assertTrue(result["artwork"]["available"])
        self.assertEqual(result["artwork"]["score"], 65)
        self.assertIsNone(result["score"])
        self.assertIsNone(result["ability"])
        self.assertEqual(result["level"], "unknown")
        self.assertNotIn("sk-secret-never-public", json.dumps(result))
        path = "/api/public/reports/" + report["id"] + "/artwork"
        private = "/api/admin/reports/" + report["id"] + "/artwork"
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get(private).status_code, 200)
        self.put("reports/" + report["id"], {"status": "published"})
        preview = self.client.get(path)
        self.assertEqual(preview.status_code, 200)
        self.assertIn("sandbox allow-scripts;", preview.headers["content-security-policy"])
        self.assertNotIn("allow-same-origin", preview.headers["content-security-policy"])
        self.assertIn("connect-src 'none'", preview.headers["content-security-policy"])
        self.assertNotIn("html", self.client.get("/api/public/bootstrap").json()["reports"][0]["artwork"])
        self.assertNotIn("html", self.client.get("/api/admin/reports").json()[0]["artwork"])
        anonymous = TestClient(self.app, base_url="http://127.0.0.1")
        self.assertEqual(anonymous.get(private).status_code, 401)
        anonymous.close()
        self.put("reports/" + report["id"], {"status": "draft"})
        self.assertEqual(self.client.get(path).status_code, 404)
        self.put("reports/" + report["id"], {"status": "published"})
        stored = self.db.get("stations", station["id"])
        self.db.save("stations", station["id"], stored | {"visible": False})
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["tokens"], 1000)

    def test_pelican_missing_truncated_output_and_no_automatic_retry(self):
        station = self.station(protocol="anthropic")
        for answer, truncated in (("没有生成作品", False), ('<svg><circle r="1"/></svg>', True)):
            self.job(station, "pelican")
            calls = []
            def drawing(url, headers, payload):
                calls.append(payload)
                return {"content": [{"text": answer}], "stop_reason": "max_tokens" if truncated else "end_turn"}
            work_once(self.db, drawing)
            self.assertEqual(len(calls), 1)
        self.assertEqual(len(self.db.list("reports")), 2)
        for report in self.db.list("reports"):
            self.assertFalse(report["result"]["artwork"]["available"])
            self.assertEqual(report["result"]["artwork"]["score"], 0)
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["tokens"], 20480)

    def test_pelican_budget_reserves_output_and_retry_preserves_mode(self):
        station = self.station(daily_tokens=10000)
        response = self.post("jobs", {"station_id": station["id"], "model": "test-model", "kind": "pelican", "pelican_mode": "three"})
        job = response.json()["id"]
        def must_not_call(*args):
            self.fail("Insufficient token budget must stop before a paid call")
        work_once(self.db, must_not_call)
        jobs = self.client.get("/api/admin/jobs").json()
        self.assertEqual(jobs[0]["status"], "cancelled")
        self.assertEqual(self.db.list("reports"), [])
        retry = self.post("jobs/" + job + "/retry", {})
        self.assertEqual(retry.status_code, 200)
        with self.db.connect() as con:
            config = json.loads(con.execute("SELECT config FROM jobs WHERE id=?", (retry.json()["id"],)).fetchone()[0])
        self.assertEqual(config["pelican_mode"], "three")
        self.assertEqual(self.post("jobs", {"station_id": station["id"], "model": "test-model", "kind": "pelican", "pelican_mode": "invalid"}).status_code, 422)

    def test_abnormal_answers_retested_and_ability_separate(self):
        station = self.station(degradation_threshold=10)
        self.job(station)
        calls = []
        def wrong_one(url, headers, payload):
            calls.append(payload)
            result = upstream(url, headers, payload)
            if payload["messages"][-1]["content"] == QUESTIONS[0][1]:
                result["choices"][0]["message"]["content"] = "wrong"
            return result
        work_once(self.db, wrong_one)
        result = self.db.list("reports")[0]["result"]
        self.assertEqual(len(calls), 9)
        self.assertEqual(result["level"], "ok")
        self.assertEqual(result["ability"]["score"], 80)
        self.assertEqual(result["ability"]["level"], "degraded")
        self.assertEqual(result["checks"][3]["status"], "fail")

    def test_budget_stops_mid_job_without_false_report(self):
        station = self.station(daily_calls=1)
        self.job(station, "protocol")
        work_once(self.db, upstream)
        jobs = self.client.get("/api/admin/jobs").json()
        self.assertEqual(jobs[0]["status"], "cancelled")
        self.assertIn("预算", jobs[0]["error"])
        self.assertEqual(self.db.list("reports"), [])
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["calls"], 1)

    def test_zero_caps_are_unlimited_and_other_caps_still_apply(self):
        station = self.station(daily_calls=0, daily_tokens=0)
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        cases = [
            ((0, 0), (0, 0), 3, "done"),
            ((1, 0), (0, 0), 1, "cancelled"),
            ((0, 2304), (0, 0), 1, "cancelled"),
            ((0, 0), (1, 0), 1, "cancelled"),
            ((0, 0), (0, 2304), 1, "cancelled"),
            ((3, 60000), (0, 0), 3, "done"),
            ((0, 0), (3, 60000), 3, "done"),
        ]
        for station_caps, global_caps, expected_calls, status in cases:
            with self.subTest(station=station_caps, global_caps=global_caps):
                with self.db.connect(write=True) as con:
                    con.execute("DELETE FROM usage")
                    con.execute("DELETE FROM jobs")
                    con.execute("DELETE FROM entities WHERE kind='reports'")
                response = self.put("stations/" + station["id"], body | dict(zip(("daily_calls", "daily_tokens"), station_caps)))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(tuple(response.json()[k] for k in ("daily_calls", "daily_tokens")), station_caps)
                response = self.put("settings", dict(zip(("daily_calls", "daily_tokens"), global_caps)) | {"paused": False})
                self.assertEqual(response.status_code, 200, response.text)
                settings = self.client.get("/api/admin/settings").json()
                self.assertEqual(tuple(settings[k] for k in ("daily_calls", "daily_tokens")), global_caps)
                self.job(station, "protocol")
                self.assertTrue(work_once(self.db, upstream))
                job = self.client.get("/api/admin/jobs").json()[0]
                self.assertEqual(job["status"], status)
                usage = self.client.get("/api/admin/dashboard").json()["usage"]
                self.assertEqual(usage["calls"], expected_calls)
                self.assertEqual(usage["tokens"], expected_calls * 40)
                self.assertEqual(len(self.db.list("reports")), int(status == "done"))

    def test_negative_caps_rejected_and_unlimited_still_honors_pause_and_cancel(self):
        station = self.station(daily_calls=0, daily_tokens=0)
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        for field in ("daily_calls", "daily_tokens"):
            self.assertEqual(self.put("stations/" + station["id"], body | {field: -1}).status_code, 422)
            self.assertEqual(self.put("settings", {"daily_calls": 0, "daily_tokens": 0, "paused": False, field: -1}).status_code, 422)
        self.put("settings", {"daily_calls": 0, "daily_tokens": 0, "paused": False})
        job_id = self.job(station, "protocol")
        self.put("settings", {"daily_calls": 0, "daily_tokens": 0, "paused": True})
        self.assertFalse(work_once(self.db, upstream))
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["calls"], 0)
        self.put("settings", {"daily_calls": 0, "daily_tokens": 0, "paused": False})
        def cancel_after_call(url, headers, payload):
            result = upstream(url, headers, payload)
            self.assertEqual(self.post("jobs/" + job_id + "/cancel", {}).status_code, 200)
            return result
        self.assertTrue(work_once(self.db, cancel_after_call))
        self.assertEqual(self.client.get("/api/admin/jobs").json()[0]["status"], "cancelled")
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["calls"], 1)
        self.assertEqual(self.db.list("reports"), [])

    def test_missing_usage_retains_reservation_and_errors_redacted(self):
        station = self.station()
        self.job(station, "protocol")
        def fail(*args):
            raise RuntimeError("upstream echoed sk-secret-never-public")
        work_once(self.db, fail)
        jobs = self.client.get("/api/admin/jobs").json()
        self.assertEqual(jobs[0]["status"], "failed")
        self.assertNotIn("sk-secret-never-public", json.dumps(jobs))
        usage = self.client.get("/api/admin/dashboard").json()["usage"]
        self.assertEqual(usage["tokens"], 2304)
        self.assertEqual(usage["estimated_calls"], 1)
        self.assertEqual(self.db.list("reports"), [])

    def test_batch_schedules_create_independent_plans_and_follow_existing_worker(self):
        page = self.client.get("/admin/")
        self.assertIn("/admin/schedules.js?v=", page.text)
        script = self.client.get("/admin/schedules.js")
        self.assertEqual(script.status_code, 200)
        self.assertIn("AdminSchedules", script.text)
        first = self.station()
        second = self.station(name="第二站", base_url="https://second.example/v1", models=["another-model"], baselines={})
        base = {"name": "批量计划", "kind": "site_relay", "interval_minutes": 60, "first_run": "2020-01-01T00:00:00Z", "difficulty": "hard", "count": 20}
        specs = [base | {"station_id": station["id"], "model": station["models"][0]} for station in [first, second]]
        result = self.post("schedules/batch", {"schedules": specs})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["count"], 2)
        self.assertEqual(len({p["id"] for p in result.json()["schedules"]}), 2)
        for plan in result.json()["schedules"]:
            self.assertEqual(plan["count"], 20)
            self.assertEqual(plan["difficulty"], "hard")
            self.assertEqual(plan["interval_minutes"], 60)
        tick(self.db)
        jobs = self.client.get("/api/admin/jobs").json()
        self.assertEqual(len(jobs), 2)
        self.assertEqual({job["station_id"]: job["model"] for job in jobs}, {first["id"]: "test-model", second["id"]: "another-model"})
        self.assertTrue(all(job["schedule_id"] for job in jobs))
        tick(self.db)
        self.assertEqual(len(self.client.get("/api/admin/jobs").json()), 2)
        # Existing single-plan edits keep their own model, interval and next-run behavior.
        plan = result.json()["schedules"][0]
        updated = self.put("schedules/" + plan["id"], specs[0] | {"enabled": False})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertFalse(self.db.get("schedules", plan["id"])["enabled"])
        other = result.json()["schedules"][1]
        self.assertTrue(self.db.get("schedules", other["id"])["enabled"])

    def test_batch_schedules_reject_invalid_targets_atomically(self):
        first = self.station()
        second = self.station(name="缺少密钥站点", base_url="https://second.example/v1", api_key=None)
        base = {"name": "批量计划", "station_id": first["id"], "model": "test-model", "interval_minutes": 60}
        for bad, status in [({"station_id": "missing"}, 422), ({"station_id": second["id"]}, 409), ({"station_id": second["id"], "model": "not-registered"}, 422), ({"station_id": second["id"], "interval_minutes": 0}, 422)]:
            response = self.post("schedules/batch", {"schedules": [base, base | bad]})
            self.assertEqual(response.status_code, status, response.text)
            self.assertEqual(self.db.list("schedules"), [])
        response = self.post("schedules/batch", {"schedules": [base, base | {"station_id": second["id"]}]})
        self.assertIn("缺少密钥站点", response.text)
        # Disabled plans may be prepared before credentials are configured.
        response = self.post("schedules/batch", {"schedules": [base | {"enabled": False}, base | {"station_id": second["id"], "enabled": False}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(not plan["enabled"] for plan in self.db.list("schedules")))
        tick(self.db)
        self.assertEqual(self.client.get("/api/admin/jobs").json(), [])

    def test_batch_schedules_validate_size_uniqueness_and_auth(self):
        station = self.station()
        base = {"name": "计划", "station_id": station["id"], "model": "test-model"}
        for schedules in [[], [base, base], [base] * 101]:
            self.assertEqual(self.post("schedules/batch", {"schedules": schedules}).status_code, 422)
        with TestClient(self.app, base_url="http://127.0.0.1") as anonymous:
            self.assertEqual(anonymous.post("/api/admin/schedules/batch", json={"schedules": [base]}, headers=self.headers).status_code, 401)
        self.assertEqual(self.client.post("/api/admin/schedules/batch", json={"schedules": [base]}).status_code, 403)
        self.assertEqual(self.db.list("schedules"), [])

    def test_minute_interval_single_batch_and_edit_without_duplicate_queued_jobs(self):
        first = self.station()
        second = self.station(base_url="https://second.example/v1")
        spec = {"name": "每分钟检测", "station_id": first["id"], "model": "test-model", "kind": "site_relay", "interval_minutes": 1}
        started = now()
        single = self.post("schedules", spec)
        self.assertEqual(single.status_code, 200, single.text)
        self.assertGreaterEqual(single.json()["next_run"], started + 60)
        self.assertLess(single.json()["next_run"], started + 65)
        batch = self.post("schedules/batch", {"schedules": [spec | {"station_id": second["id"]}]})
        self.assertEqual(batch.status_code, 200, batch.text)
        edited = self.put("schedules/" + single.json()["id"], spec)
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["next_run"], single.json()["next_run"])
        for interval in [0, -1, 1.5]:
            self.assertEqual(self.post("schedules", spec | {"interval_minutes": interval}).status_code, 422)
            self.assertEqual(self.post("schedules/batch", {"schedules": [spec | {"interval_minutes": interval}]}).status_code, 422)
        due = max(plan["next_run"] for plan in self.db.list("schedules")) + 1
        with patch("backend.worker.now", return_value=due):
            tick(self.db)
        self.assertEqual(len(self.client.get("/api/admin/jobs").json()), 2)
        self.assertTrue(all(plan["next_run"] == due + 60 for plan in self.db.list("schedules")))
        with patch("backend.worker.now", return_value=due + 61):
            tick(self.db)
        self.assertEqual(len(self.client.get("/api/admin/jobs").json()), 2)

    def test_schedule_deduplication_pause_and_lost_lease(self):
        station = self.station()
        plan = self.post("schedules", {"name": "计划", "station_id": station["id"], "model": "test-model", "kind": "protocol", "interval_minutes": 60, "first_run": "2020-01-01T00:00:00Z"}).json()
        tick(self.db); tick(self.db)
        jobs = self.client.get("/api/admin/jobs").json()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(self.post("jobs", {"station_id": station["id"], "model": "test-model", "kind": "protocol"}).status_code, 409)
        self.assertGreater(self.db.get("schedules", plan["id"])["next_run"], now() + 3500)
        with self.db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status='running',lease=?", (now()-1,))
        tick(self.db)
        self.assertEqual(self.client.get("/api/admin/jobs").json()[0]["status"], "interrupted")
        self.put("settings", {"daily_calls": 200, "daily_tokens": 200000, "paused": True})
        self.assertFalse(work_once(self.db, upstream))
        self.assertEqual(self.post("jobs", {"station_id": station["id"], "model": "test-model", "kind": "protocol"}).status_code, 409)

    def test_cancel_before_execution_and_retry(self):
        station = self.station()
        job = self.job(station)
        self.assertEqual(self.post("jobs/" + job + "/cancel", {}).status_code, 200)
        self.assertFalse(work_once(self.db, upstream))
        self.assertEqual(self.post("jobs/" + job + "/retry", {}).status_code, 200)
        self.assertTrue(work_once(self.db, upstream))

    def test_hidden_stations_hide_reports_and_cannot_delete_history(self):
        station = self.station()
        self.job(station); work_once(self.db, upstream)
        report = self.db.list("reports")[0]
        self.put("reports/" + report["id"], {"status": "published"})
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        self.put("stations/" + station["id"], body | {"visible": False})
        self.assertEqual(self.client.get("/api/public/bootstrap").json()["reports"], [])
        self.assertEqual(self.put("reports/" + report["id"], {"status": "published"}).status_code, 409)
        self.assertEqual(self.client.delete("/api/admin/stations/" + station["id"], headers=self.headers).status_code, 409)

    def test_ssrf_dns_results_all_checked(self):
        for value in ("http://localhost/v1", "http://127.0.0.1", "http://169.254.169.254", "http://[::1]", "http://10.0.0.5", "http://example.com:9000", "https://name:pass@example.com", "file:///etc/passwd"):
            with self.assertRaises((ValueError, OSError)):
                resolve_public(value)
        answers = [(2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", ("127.0.0.1", 443))]
        with patch("socket.getaddrinfo", return_value=answers):
            with self.assertRaises(ValueError):
                resolve_public("https://public.example")

    def test_backup_restore_preserves_encryption_revokes_sessions_and_pauses(self):
        station = self.station()
        with tempfile.TemporaryDirectory() as out:
            archive = Path(out) / "backup.zip"
            backup(self.db, archive)
            target = Path(out) / "restored"
            restore(archive, target)
            restored = Database(target)
            self.assertEqual(restored.decrypt(restored.get("stations", station["id"])["key_cipher"]), "sk-secret-never-public")
            self.assertTrue(restored.get("settings", "site")["paused"])
            with restored.connect() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
            with self.assertRaises(ValueError):
                restore(archive, target)

    def test_history_cannot_be_reassigned_to_a_different_domain(self):
        station = self.station()
        self.job(station); work_once(self.db, upstream)
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        self.assertEqual(self.put("stations/" + station["id"], body | {"base_url": "https://other.example/v1"}).status_code, 409)

    def test_missing_master_key_fails_without_replacing_it(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Database(temp)
            (db.directory / "encryption.key").unlink()
            with self.assertRaises(RuntimeError):
                Database(temp)
            self.assertFalse((db.directory / "encryption.key").exists())

    def test_first_run_token_only_autofilled_for_loopback_not_remote_clients(self):
        with tempfile.TemporaryDirectory() as temp:
            app = create_app(temp)
            local = TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 32100))
            remote = TestClient(app, base_url="http://127.0.0.1", client=("192.0.2.10", 32101))
            self.assertIn("setup_token", local.get("/api/auth/session").json())
            self.assertNotIn("setup_token", remote.get("/api/auth/session").json())
            local.close(); remote.close()

    def test_parallel_workers_share_atomic_global_budget(self):
        station = self.station(models=["test-model", "second-model"], baselines={})
        self.put("settings", {"daily_calls": 1, "daily_tokens": 200000, "paused": False})
        self.job(station, "protocol")
        self.assertEqual(self.post("jobs", {"station_id": station["id"], "model": "second-model", "kind": "protocol"}).status_code, 200)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: work_once(self.db, upstream), range(2)))
        self.assertEqual(self.client.get("/api/admin/dashboard").json()["usage"]["calls"], 1)
        self.assertEqual(self.db.list("reports"), [])

    def test_actual_http_transport_roundtrip_against_local_fixture(self):
        received = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(handler):
                payload = json.loads(handler.rfile.read(int(handler.headers["Content-Length"])))
                received.append((handler.path, handler.headers.get("Host")))
                body = json.dumps(upstream("", dict(handler.headers), payload)).encode()
                handler.send_response(200)
                handler.send_header("Content-Type", "application/json")
                handler.send_header("Content-Length", str(len(body)))
                handler.end_headers(); handler.wfile.write(body)
            def log_message(*args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            port = server.server_port
            station = self.station(base_url="http://public-fixture.example/v1")
            # Only this fixture changes the stored endpoint to its ephemeral local port.
            stored = self.db.get("stations", station["id"])
            stored["base_url"] = f"http://public-fixture.example:{port}/v1"
            self.db.save("stations", station["id"], stored)
            self.job(station, "protocol")
            # Only the local test fixture bypasses DNS validation; no internet calls.
            with patch("backend.runner.resolve_public", return_value="127.0.0.1"):
                work_once(self.db)
            self.assertEqual(self.client.get("/api/admin/jobs").json()[0]["status"], "done")
            self.assertEqual(len(received), 3)
            self.assertTrue(all(path == "/v1/chat/completions" and host == f"public-fixture.example:{port}" for path, host in received))
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
