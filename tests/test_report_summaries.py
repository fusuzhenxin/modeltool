import json
import tempfile
import unittest

from backend.core import Database
from backend.report_quality import normalize_report
from backend.report_summaries import SUMMARY_PATHS


class ReportSummariesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Database(self.temp.name)
        self.trace = {"kind": "trace", "claimed": "m", "known": True, "prediction": "m",
                      "probability": .95, "results": [{}, {"probability": .03}], "used_outputs": 3,
                      "method": "automatic", "raw": "private-trace-answer"}
        self.report = {"station_id": "s", "status": "published", "created": 1234, "job_id": "job",
            "result": {"kind": "site_all", "model": "m", "level": "warn", "protocol_tested": True,
                       "score": 0, "ability": {"score": 0, "level": "degraded"},
                       "conditions": "conditions-v1", "checks": [{"status": "pass"}, {"status": "fail"}, {"status": "warn"}],
                       "sections": [self.trace, {"kind": "relay", "level": "warn"}],
                       "artwork": {"html": "private-code" * 10000, "score": 70},
                       "raw": "private-response" * 10000, "findings": ["finding"], "retest": "retest"}}

    def tearDown(self):
        self.temp.cleanup()

    def test_projection_preserves_conclusions_and_never_loads_heavy_reports(self):
        self.db.save("reports", "r", self.report)
        with self.db.connect() as con:
            row = dict(con.execute("SELECT * FROM report_summaries WHERE id='r'").fetchone())
        self.assertLess(len(row["data"]), 2000)
        self.assertNotIn("private-", row["data"] + row["trace_summary"])
        self.assertEqual((row["passed"], row["attention"], row["conditions"]), (1, 2, "conditions-v1"))
        summary = list(self.db.report_rows(summary=True))[0]
        self.assertEqual(summary["result"]["identity"]["status"], "consistent")
        self.assertEqual(summary["result"]["ability"]["score"], 0)
        # The former JSON projection and the new read model produce equal summaries.
        with self.db.connect() as con:
            paths = ",".join("?" for _ in SUMMARY_PATHS)
            expected = json.loads(con.execute("SELECT json_remove(data," + paths + ") FROM entities WHERE id='r'", SUMMARY_PATHS).fetchone()[0])
        expected["result"] = normalize_report(expected["result"], json.loads(row["trace_summary"]))
        self.assertEqual(summary, expected | {"id": "r"})
        with self.db.connect() as con:
            self.assertEqual(json.loads(con.execute("SELECT data FROM entities WHERE id='r'").fetchone()[0]), self.report)

    def test_review_update_rollback_and_delete_are_synchronous_across_instances(self):
        self.db.save("reports", "r", self.report)
        other = Database(self.temp.name)
        self.assertEqual(len(list(other.report_rows(summary=True, published=True))), 1)
        self.db.save("reports", "r", self.report | {"status": "draft"})
        self.assertEqual(list(other.report_rows(summary=True, published=True)), [])
        with self.assertRaises(RuntimeError):
            with self.db.connect(write=True) as con:
                self.db.save("reports", "r", self.report, con)
                self.assertEqual(con.execute("SELECT json_extract(data,'$.status') FROM report_summaries WHERE id='r'").fetchone()[0], "published")
                raise RuntimeError("rollback")
        self.assertEqual(list(other.report_rows(summary=True, published=True)), [])
        with self.db.connect(write=True) as con:
            con.execute("DELETE FROM entities WHERE kind='reports' AND id='r'")
        self.assertEqual(list(other.report_rows(summary=True)), [])

    def test_fingerprint_engine_and_rejection_survive_lightweight_projection(self):
        for extra in ({"engine": "modeltrace-v6", "decision": "reject", "accepted_model": None},
                      {"engine": "one-token", "reference_only": True, "coverage": "sample"}):
            self.report["result"]["sections"][0] = self.trace | extra
            self.db.save("reports", "r", self.report)
            summary = list(self.db.report_rows(summary=True))[0]
            self.assertEqual(summary["result"]["identity"]["status"], "inconclusive")

    def test_legacy_triggers_are_upgraded_before_new_fingerprint_reports(self):
        with self.db.connect(write=True) as con:
            for event in ("insert", "update"):
                con.execute("DROP TRIGGER report_summaries_" + event)
            con.execute("CREATE TRIGGER report_summaries_insert AFTER INSERT ON entities BEGIN SELECT 1; END")
            con.execute("CREATE TRIGGER report_summaries_update AFTER UPDATE ON entities BEGIN SELECT 1; END")
        upgraded = Database(self.temp.name)
        self.report["result"]["sections"][0] = self.trace | {"engine": "modeltrace-v6", "decision": "reject"}
        upgraded.save("reports", "r", self.report)
        self.assertEqual(list(upgraded.report_rows(summary=True))[0]["result"]["identity"]["status"], "inconclusive")

    def test_existing_database_backfill_preserves_originals_and_is_repeatable(self):
        with self.db.connect(write=True) as con:
            for event in ("insert", "update", "delete"):
                con.execute("DROP TRIGGER report_summaries_" + event)
            con.execute("DROP TABLE report_summaries")
            self.db.save("reports", "legacy", self.report, con)
        rebuilt = Database(self.temp.name)
        self.assertEqual(len(list(rebuilt.report_rows(summary=True, published=True))), 1)
        self.assertEqual(rebuilt.get("reports", "legacy"), self.report)
        restarted = Database(self.temp.name)
        self.assertEqual(len(list(restarted.report_rows(summary=True))), 1)

    def test_raw_sql_writes_refresh_summary_and_exclusion_immediately(self):
        self.db.save("reports", "r", self.report)
        with self.db.connect(write=True) as con:
            con.execute("UPDATE entities SET data=json_set(data,'$.excluded_reason','billing') WHERE kind='reports' AND id='r'")
        self.assertEqual(list(self.db.report_rows(summary=True, published=True)), [])
