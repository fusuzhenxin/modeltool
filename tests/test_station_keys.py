import json
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import Database
from backend.runner import QUESTIONS
from backend.worker import work_once


class StationKeysTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        response = self.client.post("/api/auth/setup", json={"username": "admin", "password": "temporary-test-password", "token": token})
        self.headers = {"X-CSRF-Token": response.json()["csrf"]}
        self.body = {"name": "多 Key 测试", "base_url": "https://multi.example/v1", "models": ["gpt-test", "claude-test"],
                     "daily_calls": 1000, "daily_tokens": 1000000}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def post(self, path, body):
        return self.client.post("/api/admin/" + path, headers=self.headers, json=body)

    def put(self, path, body):
        return self.client.put("/api/admin/" + path, headers=self.headers, json=body)

    def station(self, keys):
        response = self.post("stations", self.body | {"api_keys": keys})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def edit(self, station, **changes):
        body = {k: v for k, v in station.items() if k not in ("id", "domain", "has_key")}
        return self.put("stations/" + station["id"], body | changes)

    def run_job(self, station, model="gpt-test", kind="ability", transport=None):
        self.put("settings", {"daily_calls": 1000, "daily_tokens": 1000000, "paused": False})
        response = self.post("jobs", {"station_id": station["id"], "model": model, "kind": kind, "count": 2})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(work_once(self.db, transport or self.fake))
        job = next(j for j in self.client.get("/api/admin/jobs").json() if j["id"] == response.json()["id"])
        self.assertEqual(job["status"], "done", job)
        return job

    @staticmethod
    def fake(url, headers, payload):
        prompt = payload["messages"][-1]["content"]
        answer = next((answer for _, question, answer in QUESTIONS if question == prompt), "A")
        return {"model": payload["model"], "content": [{"text": answer}],
                "choices": [{"message": {"content": answer}, "finish_reason": "stop"}], "usage": {"total_tokens": 40}}

    def test_crud_encryption_preservation_replacement_and_public_privacy(self):
        station = self.station([{"name": "主用", "api_key": "sk-private-one"}, {"name": "备用", "api_key": "sk-private-two"}])
        self.assertTrue(station["has_key"])
        before = self.db.get("stations", station["id"])
        for path in ("/api/admin/stations", "/api/public/bootstrap", "/api/admin/dashboard"):
            text = self.client.get(path).text
            for secret in ("sk-private-one", "sk-private-two", "cipher", "key_cursors"):
                self.assertNotIn(secret, text)
        self.assertNotIn("api_keys", self.client.get("/api/public/bootstrap").text)
        self.assertNotIn("sk-private", json.dumps(before))
        self.assertEqual([self.db.decrypt(key["cipher"]) for key in before["key_pool"]], ["sk-private-one", "sk-private-two"])
        self.assertEqual(self.edit(station, name="改名").status_code, 200)
        self.assertEqual(self.db.get("stations", station["id"])["key_pool"], before["key_pool"])
        keys = station["api_keys"]
        keys[1]["api_key"] = "sk-private-new"
        result = self.edit(station, api_keys=keys).json()
        self.assertEqual(result["api_keys"][1]["id"], keys[1]["id"])
        result = self.edit(result, api_keys=[result["api_keys"][1]]).json()
        self.assertEqual(len(result["api_keys"]), 1)
        self.assertFalse(self.edit(result, api_keys=[]).json()["has_key"])

    def test_legacy_key_migrates_without_reentering_secret(self):
        old = self.post("stations", self.body | {"api_key": "sk-legacy"}).json()
        migrated = self.edit(old, api_keys=[{"id": "legacy", "name": "原有 Key"}, {"name": "新增", "api_key": "sk-added"}])
        self.assertEqual(migrated.status_code, 200, migrated.text)
        stored = self.db.get("stations", old["id"])
        self.assertEqual([self.db.decrypt(key["cipher"]) for key in stored["key_pool"]], ["sk-legacy", "sk-added"])
        # Older clients that omit key fields must preserve the pool.
        self.assertEqual(self.put("stations/" + old["id"], self.body).status_code, 200)
        self.assertEqual(self.db.get("stations", old["id"])["key_pool"], stored["key_pool"])
        self.assertFalse(self.put("stations/" + old["id"], self.body | {"clear_key": True}).json()["has_key"])

    def test_task_rotation_is_pinned_and_persists_after_restart(self):
        station = self.station([{"name": "A", "api_key": "sk-first"}, {"name": "B", "api_key": "sk-second"}])
        all_keys = []
        def upstream(url, headers, payload):
            all_keys.append(headers["Authorization"])
            return self.fake(url, headers, payload)
        for expected in ("sk-first", "sk-second", "sk-first"):
            all_keys.clear()
            self.run_job(station, transport=upstream)
            self.assertEqual(len(all_keys), 5)
            self.assertEqual(set(all_keys), {"Bearer " + expected})
            self.db = Database(self.temp.name)

    def test_model_bindings_take_priority_and_rotate_independently(self):
        station = self.station([{"name": "通用", "api_key": "sk-general"},
                                {"name": "GPT A", "api_key": "sk-gpt-a", "models": ["gpt-test"]},
                                {"name": "GPT B", "api_key": "sk-gpt-b", "models": ["gpt-test"]},
                                {"name": "停用", "api_key": "sk-disabled", "enabled": False}])
        seen = []
        def upstream(url, headers, payload):
            seen.append(headers["Authorization"])
            return self.fake(url, headers, payload)
        for model, expected in (("gpt-test", "sk-gpt-a"), ("claude-test", "sk-general"), ("gpt-test", "sk-gpt-b")):
            seen.clear()
            self.run_job(station, model=model, transport=upstream)
            self.assertEqual(set(seen), {"Bearer " + expected})

    def test_real_site_engine_and_both_protocols_use_routed_key(self):
        station = self.station([{"name": "GPT", "api_key": "sk-gpt", "models": ["gpt-test"]},
                                {"name": "Claude", "api_key": "sk-claude", "models": ["claude-test"]}])
        for protocol, model, expected in (("openai", "gpt-test", "sk-gpt"), ("anthropic", "claude-test", "sk-claude")):
            station = self.edit(station, protocol=protocol).json()
            seen = []
            def upstream(url, headers, payload):
                seen.append(headers.get("x-api-key") or headers["Authorization"].removeprefix("Bearer "))
                return self.fake(url, headers, payload)
            self.run_job(station, model=model, kind="site_ability", transport=upstream)
            self.assertTrue(seen)
            self.assertEqual(set(seen), {expected})

    def test_same_station_routes_each_model_to_its_key_protocol_and_endpoint(self):
        station = self.station([
            {"name": "GPT", "api_key": "sk-gpt", "models": ["gpt-test"], "model_scope": "bound"},
            {"name": "Claude", "api_key": "sk-claude", "models": ["claude-test"], "model_scope": "bound",
             "protocol": "anthropic", "base_url": "https://claude.example/v1"},
        ])
        for kind in ("ability", "site_candy"):
            for model, expected_url, secret in (("gpt-test", "https://multi.example/v1/chat/completions", "sk-gpt"),
                                                 ("claude-test", "https://claude.example/v1/messages", "sk-claude")):
                calls = []
                def upstream(url, headers, payload):
                    calls.append((url, headers))
                    self.assertEqual(payload["model"], model)
                    self.assertEqual("system" in payload, model == "claude-test")
                    return self.fake(url, headers, payload)
                self.run_job(station, model=model, kind=kind, transport=upstream)
                self.assertTrue(calls)
                self.assertEqual({url for url, _ in calls}, {expected_url})
                for _, headers in calls:
                    self.assertEqual(headers.get("x-api-key") or headers.get("Authorization"), secret if model == "claude-test" else "Bearer " + secret)
        saved = self.db.get("stations", station["id"])
        self.assertEqual(saved["base_url"], self.body["base_url"])
        self.assertEqual(saved["protocol"], "openai")

    def test_bound_empty_key_never_becomes_a_general_fallback(self):
        station = self.station([{"api_key": "sk-unassigned", "model_scope": "bound"},
                                {"api_key": "sk-gpt", "models": ["gpt-test"], "model_scope": "bound"}])
        self.assertEqual(self.post("jobs", {"station_id": station["id"], "model": "claude-test", "kind": "site_candy"}).status_code, 409)
        seen = []
        def upstream(url, headers, payload):
            seen.append(headers["Authorization"])
            return self.fake(url, headers, payload)
        self.run_job(station, kind="site_candy", transport=upstream)
        self.assertEqual(set(seen), {"Bearer sk-gpt"})

    def test_discovery_uses_each_keys_saved_address_and_protocol_without_overwriting_bindings(self):
        station = self.station([{"api_key": "sk-gpt", "models": ["gpt-test"], "model_scope": "bound"},
                                {"api_key": "sk-claude", "protocol": "anthropic", "base_url": "https://claude.example/v1",
                                 "models": ["claude-test"], "model_scope": "bound"}])
        before = self.db.get("stations", station["id"])
        spec = {"station_id": station["id"], "key_id": station["api_keys"][1]["id"],
                "base_url": "https://claude.example/v1", "protocol": "anthropic"}
        with patch("backend.catalog.get_json", return_value={"data": [{"id": "claude-new"}]}) as upstream:
            response = self.post("stations/discover-models", spec)
            self.assertEqual(response.json()["models"], ["claude-new"])
            self.assertEqual(upstream.call_args.args[0], "https://claude.example/v1/models?limit=1000")
            self.assertEqual(upstream.call_args.args[1]["x-api-key"], "sk-claude")
            self.assertEqual(self.post("stations/discover-models", spec | {"base_url": station["base_url"]}).status_code, 422)
            self.assertEqual(upstream.call_count, 1)
        self.assertEqual(self.db.get("stations", station["id"]), before)

    def test_key_connection_changed_during_job_stops_before_next_request(self):
        station = self.station([{"api_key": "sk-gpt", "models": ["gpt-test"], "model_scope": "bound"}])
        calls = []
        def upstream(url, headers, payload):
            calls.append(url)
            keys = station["api_keys"]
            keys[0]["protocol"] = "anthropic"
            self.assertEqual(self.edit(station, api_keys=keys).status_code, 200)
            return self.fake(url, headers, payload)
        response = self.post("jobs", {"station_id": station["id"], "model": "gpt-test", "kind": "site_candy", "count": 3})
        self.assertEqual(response.status_code, 200)
        work_once(self.db, upstream)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.client.get("/api/admin/jobs").json()[0]["status"], "cancelled")

    def test_discovery_selects_stored_or_unsaved_key_without_modifying_station(self):
        station = self.station([{"name": "A", "api_key": "sk-one"}, {"name": "B", "api_key": "sk-two"}])
        before = self.db.get("stations", station["id"])
        spec = {"station_id": station["id"], "base_url": station["base_url"], "key_id": station["api_keys"][1]["id"]}
        with patch("backend.catalog.get_json", return_value={"data": [{"id": "gpt-test"}]}) as upstream:
            self.assertEqual(self.post("stations/discover-models", spec).status_code, 200)
            self.assertEqual(upstream.call_args.args[1]["Authorization"], "Bearer sk-two")
            self.assertEqual(self.post("stations/discover-models", spec | {"api_key": "sk-unsaved"}).status_code, 200)
            self.assertEqual(upstream.call_args.args[1]["Authorization"], "Bearer sk-unsaved")
            self.assertEqual(self.post("stations/discover-models", spec | {"key_id": "missing"}).status_code, 422)
            self.assertEqual(upstream.call_count, 2)
        self.assertEqual(self.db.get("stations", station["id"]), before)
        self.assertEqual(self.client.get("/admin/keys.js").status_code, 200)

    def test_invalid_entries_are_atomic_and_do_not_echo_secrets(self):
        station = self.station([{"api_key": "sk-original"}])
        before = self.db.get("stations", station["id"])
        for keys in ([{"name": "no-secret"}], [{"id": "foreign", "api_key": "sk-sensitive"}],
                     [station["api_keys"][0], station["api_keys"][0]],
                     [{"api_key": "sk-sensitive", "models": ["unknown"]}],
                     [{"api_key": "sk-sensitive\ninvalid"}], [{"api_key": "sk-sensitive"}] * 21,
                     [{"api_key": "sk-sensitive"}, {"api_key": "sk-sensitive"}]):
            response = self.edit(station, api_keys=keys)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertNotIn("sk-sensitive", response.text)
            self.assertEqual(self.db.get("stations", station["id"]), before)

    def test_echoed_used_and_unused_keys_are_scrubbed_from_both_engines(self):
        secrets = ["sk-output-private-a", "sk-output-private-b"]
        station = self.station([{"api_key": secret} for secret in secrets])
        def upstream(url, headers, payload):
            text = " ".join(secrets)
            return {"model": text, "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
                    "usage": {"total_tokens": 40}}
        for kind in ("ability", "site_ability"):
            job = self.run_job(station, kind=kind, transport=upstream)
            report = json.dumps(self.db.get("reports", job["report_id"]), ensure_ascii=False)
            for secret in secrets:
                self.assertNotIn(secret, report)
            self.assertIn("[已移除密钥]", report)

    def test_missing_or_disabled_model_key_blocks_jobs_and_enabled_schedules(self):
        station = self.station([{"api_key": "sk-only-gpt", "models": ["gpt-test"]}])
        spec = {"station_id": station["id"], "model": "claude-test", "kind": "ability"}
        self.assertEqual(self.post("jobs", spec).status_code, 409)
        self.assertEqual(self.post("schedules", spec | {"name": "缺少 Key", "enabled": True}).status_code, 409)
        self.assertEqual(self.post("schedules", spec | {"name": "暂停计划", "enabled": False}).status_code, 200)
        station["api_keys"][0]["enabled"] = False
        saved = self.edit(station).json()
        self.assertFalse(saved["has_key"])
        self.assertEqual(self.post("jobs", spec | {"model": "gpt-test"}).status_code, 409)

    def test_key_removed_during_job_stops_before_next_billable_request(self):
        station = self.station([{"api_key": "sk-removable"}, {"api_key": "sk-spare"}])
        calls = []
        def upstream(url, headers, payload):
            calls.append(headers)
            self.edit(station, api_keys=[station["api_keys"][1]])
            return self.fake(url, headers, payload)
        self.put("settings", {"daily_calls": 1000, "daily_tokens": 1000000, "paused": False})
        response = self.post("jobs", {"station_id": station["id"], "model": "gpt-test", "kind": "ability"})
        self.assertEqual(response.status_code, 200)
        work_once(self.db, upstream)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.client.get("/api/admin/jobs").json()[0]["status"], "cancelled")
        self.assertEqual(self.db.list("reports"), [])


if __name__ == "__main__":
    unittest.main()
