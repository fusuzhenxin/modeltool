import json
import unittest
from datetime import datetime
from unittest.mock import patch

import test_bulk as fixtures
from backend.core import Database, now
from backend.scheduling import next_daily
from backend.worker import tick, work_once


class SchedulingTests(unittest.TestCase):
    setUp = fixtures.BulkTests.setUp
    tearDown = fixtures.BulkTests.tearDown
    post = fixtures.BulkTests.post
    station = fixtures.BulkTests.station
    bulk = fixtures.BulkTests.bulk

    def plan(self, site=None, **changes):
        spec = {"name": "时间计划", "station_id": site or self.station(), "model": "m1", "kind": "site_candy",
                "enabled": True, "count": 3, "difficulty": "hard"} | changes
        response = self.post("schedules", spec)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def jobs(self):
        with self.db.connect() as con:
            return [dict(row) for row in con.execute("SELECT * FROM jobs ORDER BY created")]

    def test_once_fires_only_once_and_survives_restart(self):
        target = "2099-11-19T18:00:00+08:00"
        due = datetime.fromisoformat(target).timestamp()
        plan = self.plan(schedule_mode="once", first_run=target, interval_minutes=0, daily_time="ignored")
        self.assertEqual(plan["next_run"], due)
        with patch("backend.worker.now", return_value=due - 1):
            tick(self.db)
        self.assertEqual(self.jobs(), [])
        with patch("backend.worker.now", return_value=due):
            tick(self.db)
        stored = self.db.get("schedules", plan["id"])
        self.assertFalse(stored["enabled"])
        self.assertIsNone(stored["next_run"])
        self.assertEqual(stored["completed_at"], due)
        self.db = Database(self.temp.name)
        with patch("backend.worker.now", return_value=due + 86400):
            tick(self.db)
        self.assertEqual(len(self.jobs()), 1)

    def test_daily_uses_beijing_time_and_skips_missed_days(self):
        before = datetime.fromisoformat("2030-01-01T23:59:00+08:00").timestamp()
        self.assertEqual(next_daily("00:05", before), datetime.fromisoformat("2030-01-02T00:05:00+08:00").timestamp())
        with patch("backend.scheduling.now", return_value=before):
            plan = self.plan(schedule_mode="daily", daily_time="00:05", first_run="not-a-date", interval_minutes=0)
        due = plan["next_run"]
        self.assertIsNone(plan["first_run"])
        with patch("backend.worker.now", return_value=due):
            tick(self.db)
        next_run = self.db.get("schedules", plan["id"])["next_run"]
        self.assertEqual(next_run, due + 86400)
        with self.db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status='done'")
        with patch("backend.worker.now", return_value=due + 3 * 86400 + 600):
            tick(self.db)
        self.assertEqual(len(self.jobs()), 2)
        self.assertEqual(self.db.get("schedules", plan["id"])["next_run"], due + 4 * 86400)

    def test_due_once_retained_while_global_pause_or_matching_task_blocks(self):
        plan = self.plan(schedule_mode="once", first_run="2099-01-01T00:00:00Z")
        due = plan["next_run"]
        self.bulk("schedules", "run", [plan["id"]])
        with patch("backend.worker.now", return_value=due):
            tick(self.db)
        stored = self.db.get("schedules", plan["id"])
        self.assertTrue(stored["enabled"])
        self.assertEqual(stored["next_run"], due + 60)
        self.assertIn("相同检测", stored["last_error"])
        with self.db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status='done'")
            settings = self.db.get("settings", "site", con)
            self.db.save("settings", "site", settings | {"paused": True}, con)
        with patch("backend.worker.now", return_value=due + 120):
            tick(self.db)
        self.assertTrue(self.db.get("schedules", plan["id"])["enabled"])
        self.db.save("settings", "site", settings)
        with patch("backend.worker.now", return_value=due + 180):
            tick(self.db)
        self.assertFalse(self.db.get("schedules", plan["id"])["enabled"])
        self.assertEqual(len(self.jobs()), 2)

    def test_manual_batch_preserves_all_plan_fields_and_uses_saved_parameters(self):
        site = self.station()
        plans = [self.plan(site, kind=kind, enabled=False, schedule_mode="once", first_run="2099-01-01T00:00:00Z")
                 for kind in ("site_candy", "site_pelican", "site_relay")]
        before = {plan["id"]: self.db.get("schedules", plan["id"]) for plan in plans}
        result = self.bulk("schedules", "run", [plan["id"] for plan in plans] + ["missing"])
        self.assertEqual(result["count"], 3)
        self.assertEqual(len(result["created_ids"]), 3)
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual({job["schedule_id"] for job in self.jobs()}, set(before))
        for job in self.jobs():
            config = json.loads(job["config"])
            self.assertEqual(config["count"], 3)
            self.assertEqual(config["difficulty"], "hard")
            self.assertEqual(self.db.get("schedules", job["schedule_id"]), before[job["schedule_id"]])
        duplicate = self.bulk("schedules", "run", list(before))
        self.assertEqual(duplicate["count"], 0)
        self.assertEqual(len(self.jobs()), 3)

    def test_same_model_projects_wait_for_running_job_but_other_sites_can_run(self):
        site = self.station()
        a = self.plan(site, kind="site_candy", enabled=False)
        b = self.plan(site, kind="site_relay", enabled=False)
        ids = self.bulk("schedules", "run", [a["id"], b["id"]])["created_ids"]
        with self.db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status='running',lease=? WHERE id=?", (now() + 180, ids[0]))
        self.assertFalse(work_once(self.db))
        other = self.plan(enabled=False)
        other_id = self.bulk("schedules", "run", [other["id"]])["created_ids"][0]
        with patch("backend.worker.run_suite", return_value={"model": "m1", "score": 100}):
            self.assertTrue(work_once(self.db))
        states = {job["id"]: job["status"] for job in self.jobs()}
        self.assertEqual(states[ids[1]], "queued")
        self.assertEqual(states[other_id], "done")

    def test_bulk_switches_modes_and_only_active_timing_takes_effect(self):
        plan = self.plan(enabled=False)
        key = plan["id"]
        self.bulk("schedules", "edit", [key], changes={"schedule_mode": "daily", "daily_time": "19:30"})
        daily = self.db.get("schedules", key)
        self.assertEqual(daily["schedule_mode"], "daily")
        self.assertEqual(datetime.fromtimestamp(daily["next_run"]).minute, 30)
        target = "2099-11-19T20:15:00+08:00"
        self.bulk("schedules", "edit", [key], changes={"schedule_mode": "once", "next_run": target})
        once = self.db.get("schedules", key)
        self.assertEqual(once["next_run"], datetime.fromisoformat(target).timestamp())
        self.assertEqual(once["daily_time"], "")
        self.bulk("schedules", "edit", [key], changes={"schedule_mode": "interval", "interval_minutes": 15})
        interval = self.db.get("schedules", key)
        self.assertIsNone(interval["first_run"])
        self.assertAlmostEqual(interval["next_run"], now() + 900, delta=5)

    def test_invalid_timing_rejected_and_legacy_interval_preserved(self):
        site = self.station()
        base = {"name": "验证", "station_id": site, "model": "m1", "kind": "site_candy"}
        for changes in ({"schedule_mode": "once"}, {"schedule_mode": "once", "first_run": "2020-01-01T00:00:00Z"},
                        {"schedule_mode": "once", "first_run": "2099-01-01T00:00"}, {"schedule_mode": "daily"},
                        {"schedule_mode": "daily", "daily_time": "24:00"}, {"schedule_mode": "invalid"}):
            self.assertEqual(self.post("schedules", base | changes).status_code, 422, changes)
        plan = self.plan(site, interval_minutes=60)
        stored = self.db.get("schedules", plan["id"])
        stored.pop("schedule_mode"); stored.pop("daily_time")
        self.db.save("schedules", plan["id"], stored)
        with patch("backend.worker.now", return_value=stored["next_run"] + 1):
            tick(self.db)
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.db.get("schedules", plan["id"])["next_run"], stored["next_run"] + 3601)

    def test_switching_or_reenabling_expired_once_requires_future_date(self):
        plan = self.plan(schedule_mode="once", first_run="2099-01-01T00:00:00Z")
        with patch("backend.worker.now", return_value=plan["next_run"]):
            tick(self.db)
        expired = self.db.get("schedules", plan["id"])
        expired["first_run"] = "2020-01-01T00:00:00+00:00"
        self.db.save("schedules", plan["id"], expired)
        result = self.bulk("schedules", "enable", [plan["id"]])
        self.assertEqual(result["count"], 0)
        self.assertFalse(self.db.get("schedules", plan["id"])["enabled"])


if __name__ == "__main__":
    unittest.main()
