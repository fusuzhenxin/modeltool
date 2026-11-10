import argparse
import json
import signal
import time

from .core import Database, ident, now
from .runner import RunStopped, run_suite


def validate_run(db, spec, con):
    if spec["kind"].startswith("site_"):
        from .site_tests import catalog
        if not any(option["id"] == spec["kind"] for option in catalog()):
            raise ValueError("请选择网站现有的检测项目")
    station = db.get("stations", spec["station_id"], con)
    if not station or not station["enabled"]:
        raise ValueError("中转站不存在或已暂停检测")
    if spec["model"] not in station["models"]:
        raise ValueError("请选择站点已登记的模型")
    if not station.get("key_cipher"):
        raise ValueError("请先为站点配置检测专用密钥")
    if db.get("settings", "site", con)["paused"]:
        raise ValueError("所有检测已暂停，请先到设置中恢复")
    return station


def enqueue(db, spec, actor, schedule_id=None, con=None):
    if con is None:
        with db.connect(write=True) as conn:
            return enqueue(db, spec, actor, schedule_id, conn)
    validate_run(db, spec, con)
    duplicate = con.execute("SELECT 1 FROM jobs WHERE station_id=? AND model=? AND status IN ('queued','running')", (spec["station_id"], spec["model"])).fetchone()
    if duplicate:
        raise ValueError("该站点模型已有排队或运行中的任务")
    key = ident()
    config = {"kind": spec["kind"]}
    if spec["kind"].startswith("site_"):
        config.update({k: spec.get(k, default) for k, default in (("difficulty", "medium"), ("count", 10), ("candy_count", 20), ("pelican_mode", "html2d"))})
    if spec["kind"] == "pelican":
        config["pelican_mode"] = spec.get("pelican_mode", "html2d")
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
            if not schedule["enabled"] or schedule["next_run"] > now():
                continue
            try:
                enqueue(db, schedule, "scheduler", schedule["id"], con)
                schedule["last_error"] = ""
            except ValueError as exc:
                schedule["last_error"] = str(exc)
            # Missed intervals are skipped, never replayed as a burst.
            schedule["next_run"] = now() + schedule["interval_minutes"] * 60
            db.save("schedules", schedule["id"], schedule, con)


def work_once(db, transport=None):
    tick(db)
    with db.connect(write=True) as con:
        if db.get("settings", "site", con)["paused"]:
            return False
        job = con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if not job:
            return False
        job = dict(job)
        con.execute("UPDATE jobs SET status='running',started=?,lease=?,attempts=attempts+1 WHERE id=?", (now(), now() + 180, job["id"]))
        station = db.get("stations", job["station_id"], con)
    try:
        if not station or not station["enabled"]:
            raise RunStopped("站点已停用或删除")
        if job["model"] not in station["models"] or not station.get("key_cipher"):
            raise RunStopped("站点模型或检测密钥已变更，请检查后重新创建任务")
        result = run_suite(db, job, dict(station, id=job["station_id"]), **({"transport": transport} if transport else {}))
        with db.connect(write=True) as con:
            current = con.execute("SELECT cancel,status FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if current["cancel"] or current["status"] != "running" or db.get("settings", "site", con)["paused"]:
                raise RunStopped("任务已取消或暂停")
            report_id = ident()
            db.save("reports", report_id, {"station_id": job["station_id"], "job_id": job["id"], "status": "draft", "note": "", "demo": False, "created": now(), "result": result}, con)
            con.execute("UPDATE jobs SET status='done',ended=?,report_id=? WHERE id=?", (now(), report_id, job["id"]))
            db.audit("worker", "report_created", report_id, con)
    except Exception as exc:
        if isinstance(exc, RunStopped):
            status, message = "cancelled", str(exc)
        elif isinstance(exc, ValueError) and (str(exc).startswith("接口") or str(exc).startswith("定时检测") or str(exc).startswith("检测")):
            status, message = "failed", str(exc)
        else:
            status, message = "failed", "检测请求失败，请检查地址、网络或密钥；上游错误正文未保存"
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
