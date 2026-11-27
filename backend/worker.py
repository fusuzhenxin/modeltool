import argparse
import json
import signal
import time
import threading
from contextlib import contextmanager

from .core import Database, ident, now
from .runner import RunStopped, run_suite
from .request_errors import RequestIssue, safe_exception
from .station_keys import eligible, select_for_job


def renew_lease(db, job_id):
    with db.connect(write=True) as con:
        con.execute("UPDATE jobs SET lease=? WHERE id=? AND status='running'", (now() + 180, job_id))
        con.execute("INSERT INTO worker VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat", (now(),))


@contextmanager
def keep_worker_alive(db, job_id):
    stopped = threading.Event()
    def pulse():
        while not stopped.wait(20):
            renew_lease(db, job_id)
    thread = threading.Thread(target=pulse, name="worker-heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join()


def validate_run(db, spec, con):
    from .executions import grouped, targets
    if grouped(spec):
        station = None
        for child in targets(spec):
            station = validate_run(db, child, con)
        return station
    if spec.get("publish_mode", "review") not in ("review", "auto"):
        raise ValueError("请选择完成后待审核或直接公开")
    if spec["kind"].startswith("site_"):
        from .site_tests import catalog
        if not any(option["id"] == spec["kind"] for option in catalog()):
            raise ValueError("请选择网站现有的检测项目")
    station = db.get("stations", spec["station_id"], con)
    if not station or not station["enabled"]:
        raise ValueError("中转站不存在或已暂停检测")
    if spec["model"] not in station["models"]:
        raise ValueError("请选择站点已登记的模型")
    if not eligible(station, spec["model"]):
        raise ValueError("请先为该模型配置可用的检测专用密钥")
    if db.get("settings", "site", con)["paused"]:
        raise ValueError("所有检测已暂停，请先到设置中恢复")
    return station


def enqueue(db, spec, actor, schedule_id=None, con=None):
    if con is None:
        with db.connect(write=True) as conn:
            return enqueue(db, spec, actor, schedule_id, conn)
    from .executions import grouped, enqueue_group
    if grouped(spec):
        return enqueue_group(db, spec, actor, schedule_id, con)
    validate_run(db, spec, con)
    key = ident()
    config = {"kind": spec["kind"]}
    if spec["kind"].startswith("site_"):
        config.update({k: spec.get(k, default) for k, default in (("difficulty", "medium"), ("count", 10), ("candy_count", 20), ("pelican_mode", "html2d"))})
    if spec["kind"] == "pelican":
        config["pelican_mode"] = spec.get("pelican_mode", "html2d")
    active = con.execute("SELECT schedule_id,config FROM jobs WHERE station_id=? AND model=? AND status IN ('queued','running')", (spec["station_id"], spec["model"])).fetchall()
    if any({k: v for k, v in json.loads(row["config"]).items() if k not in ("publish_mode", "output_token_limit", "execution_id", "execution_index")} == config
           or schedule_id and row["schedule_id"] == schedule_id and not json.loads(row["config"]).get("execution_id") for row in active):
        raise ValueError("该站点模型已有排队或运行中的相同检测任务")
    output_limit = db.get("settings", "site", con).get("output_token_limit")
    if spec["kind"].startswith("site_") and spec["kind"] != "site_relay" and output_limit is not None:
        config["output_token_limit"] = output_limit
    # Snapshot the publication choice; later plan edits cannot change queued work.
    config["publish_mode"] = spec.get("publish_mode", "review")
    con.execute("INSERT INTO jobs(id,station_id,schedule_id,model,config,status,created) VALUES(?,?,?,?,?,'queued',?)", (key, spec["station_id"], schedule_id, spec["model"], json.dumps(config), now()))
    db.audit(actor, "enqueue", key, con)
    return key


def tick(db):
    with db.connect(write=True) as con:
        con.execute("INSERT INTO worker VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat", (now(),))
        # Expired work never silently bills another test; an explicit retry creates a fresh job.
        con.execute("UPDATE jobs SET status='interrupted',ended=?,error='检测进程意外停止，请检查后手动重试' WHERE status='running' AND lease<?", (now(), now()))
        if db.get("settings", "site", con)["paused"]:
            return
        for schedule in db.list("schedules", con):
            if not schedule["enabled"] or schedule.get("next_run") is None or schedule["next_run"] > now():
                continue
            try:
                enqueue(db, schedule, "scheduler", schedule["id"], con)
                schedule["last_error"] = ""
                if schedule.get("schedule_mode") == "once":
                    schedule.update(enabled=False, next_run=None, completed_at=now())
            except ValueError as exc:
                schedule["last_error"] = str(exc)
            mode = schedule.get("schedule_mode", "interval")
            if mode == "once" and schedule["enabled"]:
                # Retain a due one-off plan when a matching task is still active.
                schedule["next_run"] = now() + 60
            elif mode == "daily":
                from .scheduling import next_daily
                schedule["next_run"] = next_daily(schedule["daily_time"], now())
            elif mode == "interval":
                # Missed intervals are skipped, never replayed as a burst.
                schedule["next_run"] = now() + schedule["interval_minutes"] * 60
            db.save("schedules", schedule["id"], schedule, con)


def work_once(db, transport=None):
    tick(db)
    with db.connect(write=True) as con:
        if db.get("settings", "site", con)["paused"]:
            return False
        job = con.execute("""SELECT * FROM jobs AS pending WHERE status='queued' AND NOT EXISTS
            (SELECT 1 FROM jobs AS active WHERE active.status='running'
             AND active.station_id=pending.station_id AND active.model=pending.model)
            AND NOT EXISTS (SELECT 1 FROM jobs AS earlier WHERE
                json_extract(pending.config,'$.execution_id') IS NOT NULL
                AND json_extract(earlier.config,'$.execution_id')=json_extract(pending.config,'$.execution_id')
                AND json_extract(earlier.config,'$.execution_index')<json_extract(pending.config,'$.execution_index')
                AND earlier.status IN ('queued','running'))
            ORDER BY created LIMIT 1""").fetchone()
        if not job:
            return False
        job = dict(job)
        con.execute("UPDATE jobs SET status='running',started=?,lease=?,attempts=attempts+1 WHERE id=?", (now(), now() + 180, job["id"]))
        station = db.get("stations", job["station_id"], con)
        if station and station["enabled"] and job["model"] in station["models"]:
            station = select_for_job(db, station | {"id": job["station_id"]}, job["model"], con)
            execution_id = json.loads(job["config"]).get("execution_id")
            if execution_id:
                from .station_keys import entries
                execution = db.get("executions", execution_id, con)
                if execution:
                    selected = next((key for key in entries(station) if key["id"] == station.get("_selected_key")), {})
                    execution.setdefault("matched_keys", {})[job["id"]] = selected.get("name", "检测 Key")
                    db.save("executions", execution_id, execution, con)
    try:
        if not station or not station["enabled"]:
            raise RunStopped("站点已停用或删除")
        if job["model"] not in station["models"] or not eligible(station, job["model"]):
            raise RunStopped("站点模型或检测密钥已变更，请检查后重新创建任务")
        with keep_worker_alive(db, job["id"]):
            result = run_suite(db, job, dict(station, id=job["station_id"]), **({"transport": transport} if transport else {}))
        with db.connect(write=True) as con:
            current = con.execute("SELECT cancel,status FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if current["cancel"] or current["status"] != "running" or db.get("settings", "site", con)["paused"]:
                raise RunStopped("任务已取消或暂停")
            report_id = ident()
            current_station = db.get("stations", job["station_id"], con)
            automatic = json.loads(job["config"]).get("publish_mode", "review") == "auto"
            published = automatic and current_station and current_station.get("visible")
            report = {"station_id": job["station_id"], "job_id": job["id"], "status": "published" if published else "draft", "note": "", "demo": False, "created": now(), "result": result}
            if published:
                report.update(reviewed_by="worker:auto", reviewed_at=now(), publication_source="auto")
            db.save("reports", report_id, report, con)
            con.execute("UPDATE jobs SET status='done',ended=?,report_id=? WHERE id=?", (now(), report_id, job["id"]))
            db.audit("worker", "report_created", report_id, con)
            if published:
                db.audit("worker:auto", "report_published", report_id, con)
    except Exception as exc:
        if isinstance(exc, RunStopped):
            status, message = "cancelled", str(exc)
        else:
            message = safe_exception(exc)
            status = "cancelled" if isinstance(exc, RequestIssue) and exc.code == "billing" else "failed"
        with db.connect(write=True) as con:
            con.execute("UPDATE jobs SET status=?,ended=?,error=? WHERE id=?", (status, now(), message, job["id"]))
            db.audit("worker", status, job["id"], con)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir")
    args = parser.parse_args()
    db = Database(args.data_dir)
    stopped = False
    def stop(*_):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("ModelTool 检测任务进程已启动；按 Ctrl+C 停止。", flush=True)
    while not stopped:
        if not work_once(db):
            time.sleep(2)


if __name__ == "__main__":
    main()
