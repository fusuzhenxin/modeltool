"""Withdraw invalid historical reports; retain original measurements for audit."""
import argparse
import json

from .core import Database
from .request_errors import MESSAGES, error_issue, stream_error


def billing_evidence(result):
    """Inspect transport errors, never generated answers or low scores."""
    for request in result.get("raw", []):
        if not isinstance(request, dict):
            continue
        response = request.get("response")
        if not isinstance(response, dict):
            continue
        status = response.get("status", 200)
        if type(status) is not int:
            continue
        issue = error_issue(status, response.get("json") or response.get("text"))
        if issue and issue.code == "billing":
            return True
        issue = stream_error(response.get("text", ""))
        if issue and issue.code == "billing":
            return True
    return False


def repair_billing_reports(db, apply=False):
    """An explicit operator action; dry run by default and idempotent."""
    affected = []
    with db.connect(write=apply) as con:
        ids = [r[0] for r in con.execute("SELECT id FROM entities WHERE kind='reports'")]
        for key in ids:
            row = db.get("reports", key, con)
            if row.get("excluded_reason") == "billing" or not billing_evidence(row.get("result", {})):
                continue
            affected.append(key)
            if not apply:
                continue
            # Withdraw rather than replacing the original measured values with invented scores.
            row.update(status="rejected", excluded_reason="billing")
            row["note"] = (row.get("note", "") + "\n历史报告纠正：" + MESSAGES["billing"] + "；已撤回质量结论，原始测量仅保留供审核。" ).strip()
            db.save("reports", key, row, con)
            con.execute("""UPDATE jobs SET status='cancelled',error=? WHERE id=?
                AND report_id=? AND station_id=? AND model=? AND status IN ('done','failed','cancelled')""",
                (MESSAGES["billing"], row.get("job_id"), key, row.get("station_id"), row.get("result", {}).get("model")))
            db.audit("report-correction", "billing_report_withdrawn", key, con)
    return affected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Withdraw historical reports with explicit account-balance errors")
    parser.add_argument("--data-dir")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    affected = repair_billing_reports(Database(args.data_dir), args.apply)
    print(json.dumps({"applied": args.apply, "affected_reports": len(affected)}))
