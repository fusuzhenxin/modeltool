import json
import tempfile
import unittest

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import ident, now
from backend.worker import enqueue


class BulkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        setup = self.client.post("/api/auth/setup", json={"username": "admin", "password": "temporary-bulk-password", "token": token})
        self.assertEqual(setup.status_code, 200, setup.text)
        self.headers = {"X-CSRF-Token": setup.json()["csrf"]}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def post(self, path, data):
        return self.client.post("/api/admin/" + path, json=data, headers=self.headers)

    def station(self, **overrides):
        data = {"name": "测试站", "base_url": f"https://{ident()}.example/v1", "models": ["m1", "m2"], "api_key": "fake-test-key", "daily_calls": 0, "order": -5}
        data.update(overrides)
        response = self.post("stations", data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def report(self, station_id, **overrides):
        key = ident()
        data = {"station_id": station_id, "status": "draft", "note": "旧审核备注", "created": now(), "result": {"model": "m1", "score": 78, "level": "warn", "time": "2026-11-10 16:00", "raw": {"reply": "original measurement"}, "checks": [{"pass": False, "name": "输出控制"}]}}
        self.db.save("reports", key, data | overrides)
        return key

    def bulk(self, kind, action, ids, **extra):
        response = self.post("bulk/" + kind, {"action": action, "ids": ids, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_auth_bounds_whitelist_and_no_measurement_override(self):
        body = {"ids": ["x"], "action": "published"}
        with TestClient(self.app, base_url="http://127.0.0.1") as guest:
            self.assertEqual(guest.post("/api/admin/bulk/reports", json=body).status_code, 401)
        self.assertEqual(self.client.post("/api/admin/bulk/reports", json=body).status_code, 403)
        for data in [body | {"ids": []}, body | {"ids": [str(i) for i in range(101)]}, body | {"ids": ["x", "x"]}, body | {"ids": [""]}, body | {"result": {"score": 100}}, body | {"api_key": "overwrite"}]:
            self.assertEqual(self.post("bulk/reports", data).status_code, 422)
        self.assertEqual(self.post("bulk/users", body).status_code, 422)
        self.assertEqual(self.post("bulk/reports", body | {"action": "delete"}).status_code, 422)
        self.assertEqual(self.post("bulk/stations", {"ids": ["x"], "action": "show", "note": "wrong module"}).status_code, 422)

    def test_publish_mixed_reports_keeps_results_notes_and_explains_skips(self):
        site, hidden = self.station(), self.station(visible=False)
        first, second = self.report(site), self.report(site)
        blocked, published = self.report(hidden), self.report(site, status="published")
        before = self.db.get("reports", first)
        result = self.bulk("reports", "published", [first, second, blocked, published, "missing"])
        self.assertEqual(result["updated"], [first, second])
        self.assertEqual(len(result["skipped"]), 3)
        after = self.db.get("reports", first)
        self.assertEqual(after["result"], before["result"])
        self.assertEqual(after["note"], before["note"])
        self.assertEqual(after["reviewed_by"], "admin")
        self.assertEqual(self.db.get("reports", blocked)["status"], "draft")
        public = self.client.get("/api/public/bootstrap").json()
        self.assertEqual({r["id"] for r in public["reports"]}, {first, second, published})
        self.assertNotIn("original measurement", json.dumps(public))
        self.bulk("reports", "draft", [first, second], note="统一撤回核对")
        self.assertEqual(self.db.get("reports", first)["note"], "统一撤回核对")
        self.assertEqual(self.db.get("reports", first)["result"], before["result"])
        self.bulk("reports", "rejected", [second])
        self.assertEqual({r["id"] for r in self.client.get("/api/public/bootstrap").json()["reports"]}, {published})
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM audit WHERE action='report_published'").fetchone()[0], 2)

    def test_station_visibility_detection_and_delete_preserve_credentials(self):
        site, empty = self.station(), self.station()
        self.report(site, status="published")
        before = self.db.get("stations", site)
        self.bulk("stations", "hide", [site])
        self.assertEqual(self.db.get("stations", site), before | {"visible": False})
        self.assertFalse(self.client.get("/api/public/bootstrap").json()["reports"])
        self.bulk("stations", "disable", [site])
        self.bulk("stations", "show", [site])
        self.assertEqual(self.db.get("stations", site), before | {"enabled": False})
        self.bulk("stations", "enable", [site])
        result = self.bulk("stations", "delete", [site, empty])
        self.assertEqual(result["updated"], [empty])
        self.assertEqual(result["skipped"][0]["id"], site)
        self.assertEqual(self.db.get("stations", site), before)
        self.assertIsNone(self.db.get("stations", empty))

    def plan(self, site):
        response = self.post("schedules", {"name": "周期计划", "station_id": site, "model": "m1", "kind": "site_relay", "enabled": False, "interval_minutes": 1})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def test_bulk_edit_schedule_model_interval_and_time(self):
        first, unsupported = self.station(), self.station(models=["m1"])
        a, b = self.plan(first), self.plan(unsupported)
        before = self.db.get("schedules", a)
        target = "2099-11-13T20:30:00+08:00"
        result = self.bulk("schedules", "edit", [a, b, "missing"], changes={"model": "m2", "interval_minutes": 720, "next_run": target})
        self.assertEqual(result["updated"], [a])
        self.assertEqual(len(result["skipped"]), 2)
        after = self.db.get("schedules", a)
        self.assertEqual(after["model"], "m2")
        self.assertEqual(after["interval_minutes"], 720)
        from datetime import datetime
        self.assertEqual(after["next_run"], datetime.fromisoformat(target).timestamp())
        for field in ["enabled", "kind", "count", "name", "station_id"]:
            self.assertEqual(after[field], before[field])
        self.assertEqual(self.db.get("schedules", b)["model"], "m1")
        self.bulk("schedules", "edit", [a], changes={"model": "m1"})
        self.assertEqual(self.db.get("schedules", a)["next_run"], after["next_run"])
        self.bulk("schedules", "edit", [a], changes={"interval_minutes": 60})
        self.assertAlmostEqual(self.db.get("schedules", a)["next_run"], now() + 3600, delta=5)

    def test_schedule_edit_rejects_empty_invalid_and_unrelated_changes(self):
        key = self.plan(self.station())
        for changes in [{}, {"model": None}, {"model": " "}, {"interval_minutes": 0}, {"interval_minutes": 1.5}, {"next_run": "2099-01-01T00:00"}, {"next_run": "2000-01-01T00:00Z"}, {"enabled": True}]:
            self.assertEqual(self.post("bulk/schedules", {"ids": [key], "action": "edit", "changes": changes}).status_code, 422)
        self.assertEqual(self.post("bulk/schedules", {"ids": [key], "action": "edit"}).status_code, 422)
        self.assertEqual(self.post("bulk/schedules", {"ids": [key], "action": "disable", "changes": {"model": "m2"}}).status_code, 422)

    def test_enable_plans_skips_unusable_stations_and_pause_keeps_queued_jobs(self):
        valid, paused, keyless = self.station(), self.station(enabled=False), self.station(api_key=None)
        plans = [self.plan(site) for site in [valid, paused, keyless]]
        result = self.bulk("schedules", "enable", plans)
        self.assertEqual(result["updated"], [plans[0]])
        self.assertEqual(len(result["skipped"]), 2)
        plan = self.db.get("schedules", plans[0])
        self.assertTrue(plan["enabled"])
        self.assertGreater(plan["next_run"], now())
        self.assertEqual(plan["interval_minutes"], 1)
        job = enqueue(self.db, {"station_id": valid, "model": "m1", "kind": "site_relay"}, "test")
        self.bulk("schedules", "disable", plans)
        self.bulk("schedules", "delete", plans)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()[0], "queued")
            self.assertFalse(self.db.list("schedules", con))

    def test_delete_station_skips_active_jobs_and_linked_plans(self):
        active, planned = self.station(), self.station()
        enqueue(self.db, {"station_id": active, "model": "m1", "kind": "site_relay"}, "test")
        self.plan(planned)
        result = self.bulk("stations", "delete", [active, planned])
        self.assertEqual(result["count"], 0)
        self.assertEqual(len(result["skipped"]), 2)

    def test_job_cancel_and_retry_only_eligible_keeps_original_configuration(self):
        sites = [self.station() for _ in range(4)]
        jobs = [enqueue(self.db, {"station_id": site, "model": "m1", "kind": "site_pelican", "pelican_mode": "three", "count": 3, "difficulty": "hard"}, "test") for site in sites]
        with self.db.connect(write=True) as con:
            for key, status in zip(jobs[1:], ["running", "done", "failed"]):
                con.execute("UPDATE jobs SET status=? WHERE id=?", (status, key))
            old = dict(con.execute("SELECT * FROM jobs WHERE id=?", (jobs[3],)).fetchone())
        cancelled = self.bulk("jobs", "cancel", jobs)
        self.assertEqual(cancelled["updated"], jobs[:2])
        with self.db.connect() as con:
            rows = {r["id"]: dict(r) for r in con.execute("SELECT * FROM jobs")}
        self.assertEqual(rows[jobs[0]]["status"], "cancelled")
        self.assertIsNotNone(rows[jobs[0]]["ended"])
        self.assertEqual(rows[jobs[1]]["status"], "running")
        self.assertEqual(rows[jobs[1]]["cancel"], 1)
        result = self.bulk("jobs", "retry", jobs)
        self.assertEqual(result["updated"], [jobs[0], jobs[3]])
        self.assertEqual(len(result["created_ids"]), 2)
        with self.db.connect() as con:
            self.assertEqual(dict(con.execute("SELECT * FROM jobs WHERE id=?", (jobs[3],)).fetchone()), old)
            retry = dict(con.execute("SELECT * FROM jobs WHERE id=?", (result["created_ids"][1],)).fetchone())
        self.assertEqual(retry["config"], old["config"])
        duplicate = self.bulk("jobs", "retry", [jobs[3]])
        self.assertEqual(duplicate["count"], 0)
        self.assertIn("已有排队", duplicate["skipped"][0]["reason"])

    def test_timed_content_status_and_pins_preserve_content_and_timing(self):
        announcement = self.post("announcements", {"title": "通知", "content": "原始正文", "enabled": False, "starts_at": "2030-01-01T10:00:00+08:00", "order": -9, "background_color": "#ffaaaa"}).json()["id"]
        ad = self.post("ads", {"name": "广告配置", "title": "标题", "link": "https://ad.example", "enabled": False}).json()["id"]
        old = self.db.get("announcements", announcement)
        self.bulk("announcements", "enable", [announcement])
        self.bulk("announcements", "pin", [announcement])
        self.assertEqual(self.db.get("announcements", announcement), old | {"enabled": True, "pinned": True})
        self.bulk("announcements", "unpin", [announcement])
        self.bulk("announcements", "disable", [announcement])
        self.assertEqual(self.db.get("announcements", announcement), old)
        self.bulk("ads", "enable", [ad])
        self.assertTrue(self.db.get("ads", ad)["enabled"])
        self.bulk("ads", "disable", [ad])
        self.bulk("ads", "delete", [ad])
        self.bulk("announcements", "delete", [announcement])
        self.assertIsNone(self.db.get("ads", ad))
        self.assertIsNone(self.db.get("announcements", announcement))

    def test_proposal_moderation_preserves_votes_comments_and_existing_notes(self):
        key = ident()
        data = {"name": "用户提案", "website_url": "https://proposal.example", "models": [], "tests": [], "description": "需求", "author": "访客", "status": "collecting", "visible": True, "pinned": False, "admin_note": "原有说明", "report_id": ""}
        with self.db.connect(write=True) as con:
            con.execute("INSERT INTO proposals VALUES(?,?,?,?,?)", (key, "proposal.example", json.dumps(data), now(), now()))
            con.execute("INSERT INTO proposal_votes VALUES(?,?,?)", (key, "visitor", now()))
            con.execute("INSERT INTO proposal_comments VALUES(?,?,?,?,?,?,?)", ("c1", key, "访客", "原有讨论", 0, 1, now()))
        for action in ["scheduled", "testing", "completed", "deferred", "collecting", "hide", "pin", "unpin", "show"]:
            self.assertEqual(self.bulk("proposals", action, [key])["count"], 1)
        with self.db.connect() as con:
            self.assertEqual(json.loads(con.execute("SELECT data FROM proposals WHERE id=?", (key,)).fetchone()[0]), data)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM proposal_votes").fetchone()[0], 1)
            self.assertEqual(con.execute("SELECT content FROM proposal_comments").fetchone()[0], "原有讨论")
            self.assertEqual(con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)

    def test_batch_manual_jobs_atomic_and_preserve_model_test_parameters(self):
        first, second = self.station(), self.station()
        run = {"station_id": first, "model": "m2", "kind": "site_all", "count": 3, "candy_count": 5, "pelican_mode": "svg", "difficulty": "hard"}
        self.assertEqual(self.post("jobs/batch", {"runs": [run, run]}).status_code, 422)
        self.assertEqual(self.post("jobs/batch", {"runs": []}).status_code, 422)
        self.assertEqual(self.post("jobs/batch", {"runs": [run, run | {"station_id": "missing"}]}).status_code, 409)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM audit WHERE action='enqueue'").fetchone()[0], 0)
        result = self.post("jobs/batch", {"runs": [run, run | {"station_id": second, "model": "m1"}]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["count"], 2)
        with self.db.connect() as con:
            rows = [dict(row) for row in con.execute("SELECT * FROM jobs ORDER BY created")]
            self.assertEqual([r["model"] for r in rows], ["m2", "m1"])
            self.assertEqual(json.loads(rows[0]["config"]), {k: run[k] for k in ["kind", "count", "candy_count", "pelican_mode", "difficulty"]})
            self.assertTrue(all(row["status"] == "queued" for row in rows))
            self.assertEqual(con.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 0)

    def test_bulk_assets_are_served(self):
        self.assertIn("/admin/bulk.js?v=20261113-schedule-edit", self.client.get("/admin/").text)
        self.assertEqual(self.client.get("/admin/bulk.js").status_code, 200)

    def test_job_list_scores_match_linked_reports_without_raw_measurements(self):
        site = self.station()
        fixtures = [
            ("site_relay", {"score": 0}, [{"label": "中转站", "value": 0}]),
            ("site_basic", {"score": None, "ability": {"score": 82.5}}, [{"label": "能力", "value": 82.5}]),
            ("site_candy", {"score": None, "ability": {"score": 60}}, [{"label": "糖果", "value": 60}]),
            ("site_all", {"score": 100, "ability": {"score": 90}, "artwork": {"score": 70, "html": "private artwork"}}, [{"label": "中转站", "value": 100}, {"label": "能力", "value": 90}, {"label": "作品结构", "value": 70}]),
            ("site_trace", {"score": None}, []),
        ]
        expected = {}
        for kind, scores, summary in fixtures:
            report = self.report(site)
            original = self.db.get("reports", report)
            self.db.save("reports", report, original | {"result": original["result"] | scores})
            job = enqueue(self.db, {"station_id": site, "model": "m1", "kind": kind}, "test")
            with self.db.connect(write=True) as con:
                con.execute("UPDATE jobs SET status='done',report_id=? WHERE id=?", (report, job))
            expected[job] = summary
        waiting = enqueue(self.db, {"station_id": site, "model": "m2", "kind": "site_relay"}, "test")
        expected[waiting] = []
        response = self.client.get("/api/admin/jobs")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({r["id"]: r["scores"] for r in response.json()}, expected)
        for secret in ["original measurement", "private artwork", "checks", "key_cipher", "config"]:
            self.assertNotIn(secret, response.text)
        recent = self.client.get("/api/admin/dashboard").json()["recent_jobs"]
        self.assertEqual({r["id"]: r["scores"] for r in recent}, expected)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 0)
