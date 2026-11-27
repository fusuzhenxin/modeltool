import json
import unittest

import test_multi_model_schedules as fixtures
from backend.core import Database
from backend.worker import tick, work_once


class GroupedExecutionTests(unittest.TestCase):
    setUp = fixtures.MultiModelScheduleTests.setUp
    tearDown = fixtures.MultiModelScheduleTests.tearDown
    post = fixtures.MultiModelScheduleTests.post
    station = fixtures.MultiModelScheduleTests.station

    def spec(self, sid, **changes):
        return {"station_id": sid, "model": "gpt-test", "models": ["gpt-test", "claude-test"],
                "kind": "site_candy", "kinds": ["site_candy", "site_logic"], "count": 1, "candy_count": 1, **changes}

    @staticmethod
    def upstream(url, headers, payload):
        return {"choices": [{"message": {"content": "A"}}], "content": [{"type": "text", "text": "A"}], "usage": {"total_tokens": 20}}

    def detail(self, key):
        response = self.client.get("/api/admin/jobs/" + key)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_one_plan_and_one_execution_per_station_then_sequential_model_key_tests(self):
        sid = self.station()
        result = self.post("schedules", self.spec(sid, name="同站组合", first_run="2020-01-01T00:00:00Z"))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(len(self.db.list("schedules")), 1)
        tick(self.db)
        listed = self.client.get("/api/admin/jobs").json()
        self.assertEqual(len(listed), 1)
        key = listed[0]["id"]
        self.assertEqual(listed[0]["total"], 4)
        expected = [(m,k) for m in ["gpt-test","claude-test"] for k in ["site_candy","site_logic"]]
        self.assertEqual([(c["model"],c["kind"]) for c in self.detail(key)["children"]], expected)
        seen = []
        def transport(url, headers, payload):
            seen.append((payload["model"], url, headers))
            return self.upstream(url, headers, payload)
        for index in range(4):
            self.assertTrue(work_once(self.db, transport))
            run = self.detail(key)
            self.assertEqual(run["completed"], index + 1)
        self.assertEqual(run["status"], "done")
        self.assertEqual(len(self.db.list("reports")), 4)
        self.assertEqual(len(self.client.get("/api/admin/jobs").json()), 1)
        self.assertEqual([x[0] for x in seen], ["gpt-test","gpt-test","claude-test","claude-test"])
        self.assertTrue(all(c["key_name"] in ("GPT","Claude") for c in run["children"]))
        self.assertIn("Authorization", seen[0][2]); self.assertIn("x-api-key", seen[2][2])
        self.assertEqual(run["usage"]["calls"], 4)
        self.assertEqual(run["usage"]["tokens"], 80)
        self.assertNotIn("sk-fixture", json.dumps(run))
        response = self.post("jobs/" + key + "/publish", {})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(r["status"] == "published" for r in self.db.list("reports")))

    def test_multistation_grouped_batch_is_atomic_and_station_separated(self):
        ids = [self.station(), self.station("second")]
        specs = [self.spec(sid) for sid in ids]
        bad = self.post("jobs/batch", {"runs": [specs[0], self.spec(ids[1], models=["missing"])]})
        self.assertEqual(bad.status_code, 409, bad.text)
        self.assertEqual(self.db.list("executions"), [])
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0], 0)
        result = self.post("jobs/batch", {"runs": specs})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["count"], 2)
        self.assertEqual({r["station_id"] for r in self.client.get("/api/admin/jobs").json()}, set(ids))

    def test_cancellation_and_retry_only_rerun_unfinished_children(self):
        sid = self.station()
        key = self.post("jobs", self.spec(sid)).json()["id"]
        self.assertTrue(work_once(self.db, self.upstream))
        original = self.detail(key)["children"][0]["report_id"]
        self.assertEqual(self.post("jobs/" + key + "/cancel", {}).status_code, 200)
        run = self.detail(key)
        self.assertEqual(run["completed"], 1)
        self.assertEqual(run["counts"]["cancelled"], 3)
        new_key = self.post("jobs/" + key + "/retry", {}).json()["id"]
        self.assertEqual(self.detail(new_key)["total"], 3)
        self.assertEqual(self.detail(key)["children"][0]["report_id"], original)
        for _ in range(3):
            self.assertTrue(work_once(self.db, self.upstream))
        self.assertEqual(len(self.db.list("reports")), 4)

    def test_failed_child_does_not_hide_other_results_and_group_duplicates_leave_no_orphans(self):
        sid = self.station()
        key = self.post("jobs", self.spec(sid)).json()["id"]
        duplicate = self.post("jobs", self.spec(sid))
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(len(self.db.list("executions")), 1)
        self.assertTrue(work_once(self.db, lambda *_: {"status":401,"text":"unauthorized","json":None}))
        for _ in range(3):
            self.assertTrue(work_once(self.db, self.upstream))
        run = self.detail(key)
        self.assertEqual(run["status"], "partial")
        self.assertEqual(run["failed"], 1)
        self.assertEqual(run["completed"], 3)
        new_key = self.post("jobs/" + key + "/retry", {}).json()["id"]
        self.assertEqual(self.detail(new_key)["total"], 1)

    def test_snapshot_and_pending_children_survive_restart_and_plan_edits(self):
        sid = self.station()
        plan = self.post("schedules", self.spec(sid,name="组合",first_run="2020-01-01T00:00:00Z")).json()
        tick(self.db)
        key = self.client.get("/api/admin/jobs").json()[0]["id"]
        changed = self.post("jobs", self.spec(sid, kinds=["site_qa"]))
        self.assertEqual(changed.status_code, 200, changed.text)
        updated = self.client.put("/api/admin/schedules/" + plan["id"], headers=self.headers,
                                  json=self.spec(sid,name="组合新版",kinds=["site_qa"]))
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["version"], 2)
        Database(self.temp.name)
        self.assertEqual(self.detail(key)["snapshot"]["kinds"], ["site_candy","site_logic"])

    def test_redundant_test_selection_is_rejected(self):
        sid = self.station()
        for kinds in ([], ["site_all","site_candy"], ["site_basic","site_logic"], ["site_candy","site_candy"]):
            self.assertEqual(self.post("jobs", self.spec(sid,kinds=kinds)).status_code,422)

    def test_new_admin_script_is_served_by_the_static_allowlist(self):
        response = self.client.get("/admin/executions.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("AdminExecutions", response.text)


if __name__ == "__main__":
    unittest.main()
