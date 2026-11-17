import json
import tempfile
import unittest

from backend.core import Database
from backend.report_corrections import billing_evidence, repair_billing_reports
from backend.site_tests import report_from_site
from backend.request_errors import RequestIssue, MESSAGES
from backend.stability import outcome


class BillingCorrectionTests(unittest.TestCase):
    def test_transport_evidence_not_normal_answer_or_unexplained_zero(self):
        def result(status, body):
            return {"raw": [{"response": {"status": status, "json": body}}]}
        self.assertTrue(billing_evidence(result(402, {})))
        self.assertTrue(billing_evidence(result(429, {"error": {"code": "insufficient_quota"}})))
        self.assertFalse(billing_evidence(result(200, {"choices": [{"message": {"content": "余额不足"}}]})))
        self.assertFalse(billing_evidence({"score": 0, "checks": [{"detail": "余额不足"}]}))
        self.assertFalse(billing_evidence(result(503, {"error": "Unavailable"})))

    def test_withdrawal_is_explicit_idempotent_and_preserves_audit_data(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Database(temp)
            result = {"model": "m", "score": 0, "level": "bad", "raw": [{"response": {"status": 402, "text": "private upstream"}}]}
            row = {"status": "published", "station_id": "s", "job_id": "j", "result": result}
            db.save("reports", "r", row)
            db.save("reports", "valid", {**row, "job_id": "other", "result": {"score": 0}})
            with db.connect(write=True) as con:
                con.execute("INSERT INTO jobs(id,station_id,model,config,status,created,started,ended,report_id) VALUES('j','s','m','{}','done',1,1,2,'r')")
            self.assertEqual(repair_billing_reports(db), ["r"])
            self.assertEqual(db.get("reports", "r")["status"], "published")
            self.assertEqual(repair_billing_reports(db, True), ["r"])
            corrected = db.get("reports", "r")
            self.assertEqual(corrected["status"], "rejected")
            self.assertEqual(corrected["result"], result)
            self.assertEqual(corrected["excluded_reason"], "billing")
            self.assertEqual([r["id"] for r in db.report_rows(published=True)], ["valid"])
            with db.connect() as con:
                job = dict(con.execute("SELECT * FROM jobs WHERE id='j'").fetchone())
                self.assertEqual(con.execute("SELECT count(*) FROM audit WHERE action='billing_report_withdrawn'").fetchone()[0], 1)
            self.assertEqual(outcome(job), "billing")
            self.assertEqual(job["error"], MESSAGES["billing"])
            self.assertEqual(repair_billing_reports(db, True), [])

    def test_final_report_guard_rejects_bridge_billing_results(self):
        with self.assertRaises(RequestIssue) as caught:
            report_from_site({"raw": [{"response": {"status": 402}}]}, {}, "m")
        self.assertEqual(caught.exception.code, "billing")
