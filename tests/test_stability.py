import json
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import TZ
from backend.stability import configuration, outcome, snapshot
from backend.worker import work_once


AT = datetime(2026, 11, 15, 23, 50, tzinfo=TZ).timestamp()


class StabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        self.serial = 0
        self.site("a")

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def site(self, sid, **changes):
        self.db.save("stations", sid, {"id": sid, "name": sid, "domain": sid + ".example",
                     "visible": True, "enabled": True, "models": ["m"],
                     "key_cipher": "private-key-must-not-leak", **changes})

    def job(self, sid="a", status="done", error="", started=None, ended=None, model="m", cfg=None, **changes):
        self.serial += 1
        started = AT - 600 + self.serial if started is None else started
        row = {"id": str(self.serial), "station_id": sid, "model": model,
               "config": json.dumps(cfg or {"kind": "site_relay"}), "status": status, "error": error,
               "created": started, "started": started, "ended": started + 1 if ended is None else ended,
               "cancel": 0, **changes}
        with self.db.connect(write=True) as con:
            names = list(row)
            con.execute("INSERT INTO jobs(" + ",".join(names) + ") VALUES(" + ",".join("?" * len(names)) + ")", list(row.values()))
        return row

    def stats(self, **kwargs):
        return snapshot(self.db, at=AT, **kwargs)["stations"][0]

    def report(self, level="ok", ability=None, sid="a", model="m", status="published", at=None, **changes):
        self.serial += 1
        key = "public-report-" + str(self.serial)
        result = {"kind": "site_relay", "model": model, "protocol_tested": True,
                  "level": level, "ability": ability,
                  "raw": "private-answer-must-not-leak", "artwork": {"html": "private-html"}}
        result.update(changes.pop("result", {}))
        self.db.save("reports", key, {"station_id": sid, "created": AT - 30 if at is None else at,
                                     "status": status, "demo": False, "result": result, **changes})
        return key

    def series(self, sid, failed=()):
        for day in range(7):
            for hour in (2, 10, 21):
                started = datetime(2026, 11, 9 + day, hour, tzinfo=TZ).timestamp()
                failure = (day, hour) in failed
                self.job(sid, status="cancelled" if failure else "done",
                         error="接口返回 HTTP 502，任务已停止" if failure else "", started=started)

    def test_empty_and_hidden_never_make_up_uptime(self):
        self.site("hidden", visible=False)
        self.job("hidden")
        data = snapshot(self.db, at=AT)
        self.assertEqual(len(data["stations"]), 1)
        row = data["stations"][0]
        self.assertEqual(row["samples"], 0)
        self.assertIsNone(row["rate"])
        self.assertIsNone(row["rank"])
        self.assertTrue(all(p["rate"] is None for p in row["periods"].values()))

    def test_legacy_http_cancellations_count_but_local_and_unknown_do_not(self):
        self.job()
        for code in (429, 500, 502, 599):
            self.job(status="cancelled", error=f"接口返回 HTTP {code}，任务已停止")
        self.job(status="failed", error="接口请求超时，任务已停止")
        for code in (400, 401, 403, 404):
            self.job(status="failed", error=f"接口返回 HTTP {code}")
        for message in ("已达到当日调用次数或 Token 预算；次日可重新运行", "本站检测进程已停止，请检查后重试", "任务已取消或暂停"):
            self.job(status="cancelled", error=message)
        self.job(status="interrupted")
        self.job(status="cancelled", error="接口返回 HTTP 502", cancel=1)
        self.job(status="failed", error="检测请求失败，请检查地址、网络或密钥；上游错误正文未保存")
        self.job(status="running", ended=0)
        row = self.stats()
        self.assertEqual((row["completed"], row["failed"], row["samples"]), (1, 5, 6))
        self.assertEqual(row["rate"], 16.7)
        self.assertEqual(row["excluded"], {"configuration": 4, "local": 5, "unknown": 1, "billing": 0})
        self.assertEqual(row["pending"], 1)

    def test_beijing_boundaries_and_future_or_incomplete_records(self):
        for hour, minute in ((0, 0), (5, 59), (6, 0), (17, 59), (18, 0), (23, 0)):
            self.job(started=datetime(2026, 11, 9, hour, minute, tzinfo=TZ).timestamp())
        self.job(started=datetime(2026, 11, 8, 23, 59, tzinfo=TZ).timestamp())
        self.job(started=AT + 100)
        self.job(started=AT - 10, ended=AT + 10)
        self.job(started=AT - 20, ended=AT - 21)
        self.job(status="queued", started=None, ended=0, created=AT - 30)
        row = self.stats()
        self.assertEqual(row["samples"], 6)
        self.assertEqual([row["periods"][p]["samples"] for p in ("day", "evening", "night")], [2, 2, 2])
        self.assertEqual(row["days"]["2026-11-09"]["samples"], 6)
        self.assertEqual(row["excluded"]["unknown"], 2)
        self.assertEqual(row["pending"], 1)

    def test_rank_requires_coverage_recency_and_enough_samples(self):
        self.site("b"); self.site("c"); self.site("small"); self.site("old")
        self.series("a")
        self.series("b", failed=((1, 21), (2, 21)))
        self.series("c")
        self.job("small")
        for i in range(30):
            self.job("old", started=AT - 2 * 86400 - i)
        rows = {r["station"]["id"]: r for r in snapshot(self.db, at=AT)["stations"]}
        self.assertEqual([rows[s]["rank"] for s in ("a", "b", "c")], [1, 3, 1])
        self.assertEqual(rows["b"]["periods"]["evening"]["rate"], 71.4)
        self.assertEqual(rows["b"]["recoveries"], 2)
        self.assertFalse(rows["small"]["eligible"])
        self.assertFalse(rows["old"]["eligible"])
        self.assertIn("最近 24 小时无有效样本", rows["old"]["ineligible_reasons"])

    def test_streak_and_observed_recovery_ignore_excluded_samples(self):
        self.job(status="failed", error="接口返回 HTTP 502")
        self.job(status="cancelled", error="预算已用尽")
        self.job(status="cancelled", error="接口返回 HTTP 429")
        self.assertEqual(self.stats()["failure_streak"], 2)
        self.job()
        row = self.stats()
        self.assertEqual((row["failure_streak"], row["recoveries"]), (0, 1))

    def test_configuration_and_model_cohorts_cannot_be_mixed(self):
        a = {"kind": "site_candy", "count": 10, "difficulty": "medium"}
        b = dict(a, count=20)
        self.job(cfg=a); self.job(cfg=a); self.job(cfg=b); self.job(cfg=a, model="other")
        first = snapshot(self.db, at=AT)
        self.assertEqual(first["selected_model"], "m")
        self.assertEqual(first["stations"][0]["samples"], 2)
        self.assertEqual(len(first["tests"]), 2)
        chosen = snapshot(self.db, model="m", test=configuration(json.dumps(b))[0], at=AT)
        self.assertEqual(chosen["stations"][0]["samples"], 1)
        self.assertEqual(snapshot(self.db, model="other", at=AT)["stations"][0]["samples"], 1)
        self.assertEqual(configuration('{"kind":"site_relay","count":8}'), configuration('{"kind":"site_relay","count":20}'))
        self.assertNotEqual(configuration('{"kind":"site_pelican","pelican_mode":"svg"}'), configuration('{"kind":"site_pelican"}'))
        for raw in ('{}', 'null', '[]', 'invalid', '{"kind":"bad"}', '{"kind":"site_candy","count":true}'):
            self.assertIsNone(configuration(raw))

    def test_public_endpoint_is_read_only_bounded_and_never_loads_full_reports(self):
        self.site("a", logo="/media/0123456789abcdef01234567.webp")
        self.site("secret", visible=False, name="private-station", models=["private-model"])
        self.job("secret", model="private-model")
        self.job()
        original_list = self.db.list
        def list_only_stations(kind, *args, **kwargs):
            self.assertEqual(kind, "stations")
            return original_list(kind, *args, **kwargs)
        with patch("backend.stability.now", return_value=AT), patch.object(self.db, "list", side_effect=list_only_stations):
            response = self.client.get("/api/public/stability")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stations"][0]["station"]["logo"], "/media/0123456789abcdef01234567.webp")
        self.assertEqual(response.headers["cache-control"], "no-store")
        for value in ("private-station", "private-model", "private-key", "key_cipher", '"error"', '"config"', '"report_id"'):
            self.assertNotIn(value, response.text)
        self.assertEqual(self.client.get("/api/public/stability", params={"model": "x" * 151}).status_code, 422)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM jobs").fetchone()[0], 2)
            self.assertEqual(con.execute("SELECT count(*) FROM usage").fetchone()[0], 0)

    def test_quality_only_uses_public_non_demo_same_model_reports_in_window(self):
        self.job()
        good = self.report()
        ability = self.report(ability={"level": "degraded", "score": 30},
                              result={"kind": "site_candy", "protocol_tested": False})
        self.report("bad", model="other")
        self.report("bad", status="draft")
        self.report("bad", demo=True)
        self.report("bad", at=AT - 8 * 86400)
        self.report("bad", at=AT + 1)
        self.site("hidden", visible=False)
        self.report("bad", sid="hidden")
        q = self.stats()["quality"]
        self.assertEqual((q["protocol"]["status"], q["protocol"]["reports"], q["protocol"]["flagged"]), ("ok", 1, 0))
        self.assertEqual(q["protocol"]["evidence"]["id"], good)
        self.assertEqual((q["ability"]["status"], q["ability"]["reports"], q["ability"]["flagged"]), ("degraded", 1, 1))
        self.assertEqual(q["ability"]["evidence"]["id"], ability)
        with patch("backend.stability.now", return_value=AT):
            response = self.client.get("/api/public/stability")
        for secret in ("private-answer", "private-html", '"raw"', '"result"', '"_job"', '"_report"'):
            self.assertNotIn(secret, response.text)
        self.assertLess(len(response.content), 12000)

    def test_quality_keeps_worst_signal_and_updates_when_report_is_unpublished(self):
        bad = self.report("bad", at=AT - 50)
        self.report("warn", at=AT - 40)
        self.report("ok", at=AT - 20)
        self.report("unknown", at=AT - 10)
        q = self.stats()["quality"]["protocol"]
        self.assertEqual((q["status"], q["reports"], q["flagged"], q["inconclusive"]), ("bad", 4, 2, 1))
        self.assertEqual(q["evidence"], {"id": bad, "at": AT - 50})
        self.assertEqual(q["latest_at"], AT - 10)
        self.db.save("reports", bad, {**self.db.get("reports", bad), "status": "draft"})
        q = self.stats()["quality"]["protocol"]
        self.assertEqual((q["status"], q["reports"], q["flagged"]), ("warn", 3, 1))

    def test_unmeasured_and_inconclusive_quality_are_not_normal(self):
        self.job()
        self.report("bad", result={"kind": "site_pelican", "protocol_tested": False})
        self.assertEqual(self.stats()["quality"]["protocol"]["status"], "untested")
        self.assertEqual(self.stats()["quality"]["ability"]["status"], "untested")
        self.report("unknown", ability={"level": "unknown"})
        self.report("ok")
        quality = self.stats()["quality"]
        self.assertEqual(quality["protocol"]["status"], "inconclusive")
        self.assertEqual(quality["ability"]["status"], "inconclusive")
        self.assertEqual(quality["protocol"]["flagged"], 0)

    def test_quality_configuration_scope_does_not_change_availability_statistics(self):
        cfg = {"kind": "site_candy", "count": 10}
        self.job()
        self.job(cfg=cfg, status="cancelled", error="账户余额不足或额度已用尽，检测已跳过；不计入稳定性失败")
        self.report("warn", ability={"level": "normal", "score": 90})
        relay = self.stats(test=configuration('{"kind":"site_relay"}')[0])
        candy = self.stats(test=configuration(json.dumps(cfg))[0])
        self.assertEqual(relay["quality"], candy["quality"])
        self.assertEqual((relay["samples"], relay["failed"], relay["rate"]), (1, 0, 100))
        self.assertEqual((candy["samples"], candy["failed"], candy["excluded"]["billing"]), (0, 0, 1))

    def test_published_scores_join_exact_job_without_leaking_private_ids_or_drafts(self):
        a = self.job(started=AT - 100, ended=AT - 90)
        b = self.job(started=AT - 80, ended=AT - 70)
        c = self.job(status="failed", error="接口返回 HTTP 502", started=AT - 60, ended=AT - 50)
        key = self.report(job_id=a["id"], result={"score": 85, "ability": {"level": "normal", "score": 92},
                          "checks": [{"status": "pass", "detail": "private-answer"}, {"status": "warn"}]})
        self.report(status="draft", job_id=b["id"], result={"score": 99})
        self.report(job_id=c["id"], result={"score": 100})
        events = self.stats()["history"]
        self.assertEqual(events[0]["duration_ms"], 10000)
        self.assertEqual(events[0]["report"]["id"], key)
        self.assertEqual((events[0]["report"]["protocol"], events[0]["report"]["ability"]), (85, 92))
        self.assertEqual((events[0]["report"]["passed"], events[0]["report"]["attention"]), (1, 1))
        self.assertNotIn("report", events[1])
        self.assertNotIn("report", events[2])
        for event in events:
            self.assertNotIn("_job", event)
            self.assertNotIn("_report", event)
        self.assertNotIn("private-answer", json.dumps(events))

    def test_scores_compare_like_conditions_and_keep_zero_and_missing_distinct(self):
        self.report(at=AT - 40, result={"score": 80, "conditions": "same"})
        self.report(at=AT - 30, result={"score": 0, "conditions": "same"})
        self.report(at=AT - 20, result={"score": 90, "conditions": "other"})
        self.report(at=AT - 10, result={"score": True, "ability": {"level": "normal", "score": 101}})
        q = self.stats()["quality"]
        groups = q["protocol"]["scores"]
        self.assertEqual(len(groups), 2)
        self.assertEqual((groups[0]["min"], groups[0]["max"], groups[0]["latest"], groups[0]["delta"], groups[0]["count"]), (0, 80, 0, -80, 2))
        self.assertIsNone(groups[1]["delta"])
        self.assertEqual(q["ability"]["scores"], [])
        self.assertIsNone(q["records"][-1]["protocol"])
        self.assertIsNone(q["records"][-1]["ability"])

    def test_report_records_and_score_points_are_bounded_without_truncating_totals(self):
        for i in range(36):
            self.report(at=AT - 100 + i, result={"score": i})
        q = self.stats()["quality"]
        self.assertEqual(len(q["records"]), 32)
        group = q["protocol"]["scores"][0]
        self.assertEqual((group["count"], group["first"], group["latest"], group["delta"]), (36, 0, 35, 35))
        self.assertEqual(len(group["points"]), 16)

    def test_worker_keeps_timeout_distinct_from_generic_internal_errors(self):
        self.job(status="queued", ended=0, lease=AT + 30)
        with patch("backend.worker.run_suite", side_effect=TimeoutError()):
            self.assertTrue(work_once(self.db))
        with self.db.connect() as con:
            job = dict(con.execute("SELECT * FROM jobs").fetchone())
        self.assertEqual(job["error"], "接口请求超时，任务已停止")
        self.assertEqual(outcome(job), "upstream")

    def test_calendar_preserves_unknowns_instead_of_painting_everything_green(self):
        start = datetime(2026, 11, 15, 21, tzinfo=TZ).timestamp()
        self.job(started=start)
        self.job(status="failed", error="接口返回 HTTP 503", started=start + 2)
        self.job(status="failed", error="历史错误原因不明", started=start + 4)
        self.job(status="cancelled", error="接口返回 HTTP 403", started=start + 6)
        self.job(status="cancelled", error="预算已用尽", started=start + 8)
        row = self.stats()
        self.assertEqual(row["calendar"]["2026-11-15"]["evening"],
                         {"completed": 1, "failed": 1, "unknown": 1, "configuration": 1})
        self.assertEqual(row["failure_types"], {"http_503": 1})
        self.assertEqual(row["samples"], 2)
        self.assertEqual(len(row["history"]), 4)
        self.assertEqual(row["timing"]["samples"], 1)

    def test_task_duration_summary_does_not_mix_failures_or_small_sample_claims(self):
        for i, seconds in enumerate((10, 10, 10, 10, 50)):
            self.job(started=AT - 1000 + i * 60, ended=AT - 1000 + i * 60 + seconds)
        self.job(status="failed", error="接口返回 HTTP 502", started=AT - 500, ended=AT - 100)
        timing = self.stats()["timing"]
        self.assertEqual((timing["samples"], timing["median_ms"], timing["max_ms"], timing["slow_count"]), (5, 10000, 50000, 1))
        self.assertNotIn("_timings", self.stats())
        self.site("small")
        self.job("small", started=AT - 100, ended=AT - 1)
        small = next(r for r in snapshot(self.db, at=AT)["stations"] if r["station"]["id"] == "small")
        self.assertIsNone(small["timing"]["slow_count"])

    def test_account_quota_does_not_change_denominator_streak_or_timing(self):
        from backend.request_errors import MESSAGES
        self.job(status="failed", error="接口返回 HTTP 502")
        self.job(status="cancelled", error=MESSAGES["billing"])
        self.job(status="failed", error="接口返回 HTTP 429，insufficient quota")
        row = self.stats()
        self.assertEqual((row["samples"], row["failed"], row["failure_streak"]), (1, 1, 1))
        self.assertEqual(row["excluded"]["billing"], 2)
        self.assertEqual(row["diagnostic_types"]["billing"], 2)
        self.assertNotIn("billing", row["failure_types"])
        self.assertEqual(row["timing"]["samples"], 0)
        self.assertEqual(row["history"][-1]["cause"], "billing")
        self.job()
        row = self.stats()
        self.assertEqual((row["samples"], row["recoveries"], row["failure_streak"]), (2, 1, 0))
        self.assertEqual(row["rate"], 50)

    def test_network_parse_and_internal_errors_have_distinct_safe_reasons(self):
        from backend.request_errors import MESSAGES
        for code in ("dns", "connection", "tls", "invalid_json", "invalid_response", "empty_response"):
            self.job(status="failed", error=MESSAGES[code])
        self.job(status="failed", error=MESSAGES["internal"])
        row = self.stats()
        self.assertEqual(row["failed"], 6)
        self.assertEqual(row["excluded"]["local"], 1)
        self.assertEqual(row["excluded"]["unknown"], 0)
        self.assertEqual(row["history"][-1]["cause"], "internal")

    def test_worker_records_safe_categories_without_exception_text_or_keys(self):
        import socket
        from backend.request_errors import MESSAGES, RequestIssue
        for exc, code in ((socket.gaierror("private-host-secret"), "dns"),
                          (ConnectionResetError("private-key"), "connection"),
                          (ValueError("private-key"), "internal"),
                          (RequestIssue("billing"), "billing")):
            job = self.job(status="queued", ended=0, lease=AT + 30)
            with patch("backend.worker.run_suite", side_effect=exc):
                self.assertTrue(work_once(self.db))
            with self.db.connect() as con:
                saved = dict(con.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone())
            self.assertEqual(saved["error"], MESSAGES[code])
            self.assertNotIn("private", saved["error"])
            self.assertEqual(outcome(saved), "billing" if code == "billing" else "local" if code == "internal" else "upstream")

    def test_recent_history_is_bounded_but_failure_totals_are_not(self):
        for i in range(20):
            self.job(status="failed", error="接口返回 HTTP 502", started=AT - 200 + i * 2)
        recovery = self.job(started=AT - 10)
        row = self.stats()
        self.assertEqual(len(row["history"]), 16)
        self.assertEqual(row["max_failure_streak"], 20)
        self.assertEqual(row["failure_types"], {"http_502": 20})
        self.assertEqual(row["last_recovery"], recovery["ended"])
        self.assertEqual(row["failure_streak"], 0)
        self.assertEqual(sum(c["day"]["failed"] + c["evening"]["failed"] + c["night"]["failed"] for c in row["calendar"].values()), 20)


if __name__ == "__main__":
    unittest.main()
