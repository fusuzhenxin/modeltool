"""One admin execution per station, backed by independently measured child jobs."""
import json

from .core import ident, now


def grouped(spec):
    return bool(spec.get("models") or spec.get("kinds"))


def targets(spec):
    return [dict(spec, model=model, kind=kind, models=None, kinds=None,
                 count=spec.get("candy_count", spec.get("count", 10)) if kind == "site_candy" else spec.get("count", 10))
            for model in spec.get("models") or [spec["model"]]
            for kind in spec.get("kinds") or [spec["kind"]]]


def enqueue_group(db, spec, actor, schedule_id, con, selected=None):
    con.execute("SAVEPOINT enqueue_execution")
    try:
        result = _enqueue_group(db, spec, actor, schedule_id, con, selected)
    except BaseException:
        con.execute("ROLLBACK TO enqueue_execution")
        raise
    finally:
        con.execute("RELEASE enqueue_execution")
    return result


def _enqueue_group(db, spec, actor, schedule_id, con, selected=None):
    from .worker import enqueue, validate_run
    children = selected if selected is not None else targets(spec)
    if not children or len(children) > 100:
        raise ValueError("每站请选择 1–100 个模型与测试组合")
    # Validate the complete station plan before enqueuing any work.
    for child in children:
        validate_run(db, child, con)
    if schedule_id and con.execute("SELECT 1 FROM jobs WHERE schedule_id=? AND status IN ('queued','running')", (schedule_id,)).fetchone():
        raise ValueError("此计划已有排队或运行中的执行记录")
    key, created = ident(), now()
    snapshot = {field: spec[field] for field in ("station_id", "model", "kind", "models", "kinds", "name", "difficulty", "count", "candy_count", "pelican_mode", "publish_mode", "version") if field in spec}
    jobs = []
    for index, child in enumerate(children):
        job_id = enqueue(db, child, actor, schedule_id, con)
        config = json.loads(con.execute("SELECT config FROM jobs WHERE id=?", (job_id,)).fetchone()[0])
        config.update(execution_id=key, execution_index=index)
        con.execute("UPDATE jobs SET config=?,created=? WHERE id=?", (json.dumps(config), created + index * .000001, job_id))
        jobs.append(job_id)
    db.save("executions", key, {"station_id": spec["station_id"], "schedule_id": schedule_id,
            "name": spec.get("name") or "组合检测", "actor": actor, "created": created,
            "snapshot": snapshot, "job_ids": jobs}, con)
    db.audit(actor, "execution_created", key, con)
    return key


def describe(db, key, con, details=False):
    saved = db.get("executions", key, con)
    if not saved:
        return None
    rows = [dict(r) for r in con.execute("SELECT * FROM jobs WHERE json_extract(config,'$.execution_id')=? ORDER BY json_extract(config,'$.execution_index')", (key,))]
    counts = {s: sum(r["status"] == s for r in rows) for s in ("queued", "running", "done", "failed", "cancelled", "interrupted")}
    status = "running" if counts["running"] else "queued" if counts["queued"] else "done" if counts["done"] == len(rows) else "partial" if counts["done"] else "failed" if counts["failed"] else "interrupted" if counts["interrupted"] else "cancelled"
    usage = dict(con.execute("SELECT count(*) AS calls,coalesce(sum(tokens),0) AS tokens FROM usage WHERE job_id IN (SELECT id FROM jobs WHERE json_extract(config,'$.execution_id')=?)", (key,)).fetchone())
    snap = saved["snapshot"]
    result = {"id": key, "grouped": True, "station_id": saved["station_id"], "schedule_id": saved["schedule_id"],
              "name": saved["name"], "model": rows[0]["model"], "models": list(dict.fromkeys(r["model"] for r in rows)),
              "kind": snap["kind"], "kinds": list(dict.fromkeys(json.loads(r["config"])["kind"] for r in rows)), "created": saved["created"],
              "status": status, "total": len(rows), "finished": len(rows) - counts["queued"] - counts["running"],
              "completed": counts["done"], "failed": counts["failed"] + counts["interrupted"], "counts": counts,
              "usage": usage, "cancel": any(r["cancel"] for r in rows), "scores": [], "actor": saved["actor"]}
    if details:
        result["snapshot"] = snap
        result["children"] = []
        for row in rows:
            config = json.loads(row["config"])
            report = db.get("reports", row["report_id"], con) if row["report_id"] else None
            result["children"].append({"id": row["id"], "model": row["model"], "kind": config["kind"], "status": row["status"],
                "started": row["started"], "ended": row["ended"], "error": row["error"], "report_id": row["report_id"],
                "report_status": report.get("status") if report else None,
                "score": report["result"].get("score") if report else None,
                "ability": report["result"].get("ability") if report else None,
                "key_name": saved.get("matched_keys", {}).get(row["id"], "待匹配"),
                "exclusion": db.get("job_exclusions", row["id"], con),
                "request_count": report["result"].get("request_count") if report else None})
    return result


def action(db, key, operation, actor, con):
    saved = db.get("executions", key, con)
    if not saved:
        raise ValueError("执行记录不存在")
    rows = [dict(r) for r in con.execute("SELECT * FROM jobs WHERE json_extract(config,'$.execution_id')=?", (key,))]
    if operation == "publish":
        if any(r["status"] in ("queued", "running") for r in rows):
            raise ValueError("请等待本次执行结束后再统一公开")
        site = db.get("stations", saved["station_id"], con)
        if not site or not site.get("visible"):
            raise ValueError("中转站未公开，请先公开站点")
        reports = [db.get("reports", r["report_id"], con) | {"id": r["report_id"]} for r in rows if r["report_id"]]
        from .report_corrections import billing_evidence
        if any(report.get("excluded_reason") == "billing" or billing_evidence(report["result"]) for report in reports):
            raise ValueError("包含无效扣费记录，请先逐项核查")
        if not reports:
            raise ValueError("没有可公开的已完成报告")
        for report in reports:
            report.update(status="published", reviewed_by=actor, reviewed_at=now())
            report_id = report.pop("id")
            db.save("reports", report_id, report, con)
            db.audit(actor, "report_published", report_id, con)
        return None
    if operation == "cancel":
        if not any(r["status"] in ("queued", "running") for r in rows):
            raise ValueError("这次执行已经结束")
        con.execute("UPDATE jobs SET cancel=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,ended=CASE WHEN status='queued' THEN ? ELSE ended END WHERE json_extract(config,'$.execution_id')=? AND status IN ('queued','running')", (now(), key))
        db.audit(actor, "execution_cancelled", key, con)
        return None
    if operation == "retry":
        if any(r["status"] in ("queued", "running") for r in rows):
            raise ValueError("请等待本次执行结束后再重试")
        selected = [{**saved["snapshot"], **{k:v for k,v in json.loads(r["config"]).items() if k not in ("execution_id","execution_index")}, "model": r["model"], "models": None, "kinds": None}
                    for r in rows if r["status"] in ("failed", "cancelled", "interrupted")]
        if not selected:
            raise ValueError("没有需要重试的失败或未完成项目")
        return enqueue_group(db, saved["snapshot"], actor, None, con, selected)
    raise ValueError("不支持此组合执行操作")
