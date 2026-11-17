"""Read-only job observations. Sampled completion is not continuous uptime."""
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timedelta
from statistics import median

from .core import TZ, now
from .request_errors import saved_diagnostic

KINDS = {
    "site_basic": "基础能力组合", "site_ability": "能力测试", "site_logic": "逻辑测试",
    "site_code": "代码测试", "site_qa": "问答测试", "site_candy": "糖果测试",
    "site_relay": "中转站测试", "site_trace": "指纹测试", "site_pelican": "鹈鹕骑车",
    "site_all": "全部测试", "protocol": "旧版协议测试", "ability": "旧版能力测试",
    "combined": "旧版组合测试", "pelican": "旧版鹈鹕骑车",
}
PERIODS = ("day", "evening", "night")
MIN_SAMPLES, MIN_DAYS, MIN_PERIOD = 20, 3, 3


def configuration(raw):
    """Compare equivalent settings; ignore fields irrelevant to the test."""
    try:
        cfg = json.loads(raw)
        kind = cfg["kind"]
        if kind not in KINDS:
            return None
        normalized = {"kind": kind}
        label = KINDS[kind]
        if kind in ("site_basic", "site_ability", "site_logic", "site_code", "site_qa", "site_candy", "site_all"):
            difficulty, count = cfg.get("difficulty", "medium"), cfg.get("count", 10)
            if difficulty not in ("easy", "medium", "hard") or type(count) is not int or not 1 <= count <= 30:
                return None
            normalized.update(difficulty=difficulty, count=count)
            label += " · " + {"easy": "简单", "medium": "中等", "hard": "困难"}[difficulty] + f" · {count} 题/项"
        if kind == "site_all":
            count = cfg.get("candy_count", 20)
            if type(count) is not int or not 1 <= count <= 30:
                return None
            normalized["candy_count"] = count
            label += f" · 糖果 {count} 题"
        if kind in ("site_pelican", "site_all", "pelican"):
            mode = cfg.get("pelican_mode", "html2d")
            if mode not in ("svg", "html2d", "three"):
                return None
            normalized["pelican_mode"] = mode
            label += " · " + {"svg": "经典 SVG", "html2d": "2D 动画 HTML", "three": "3D 动画 HTML"}[mode]
        key = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()[:16]
        return key, label
    except (ValueError, KeyError, TypeError):
        return None


def outcome(job):
    """Legacy cancelled jobs include HTTP failures; use only known safe errors."""
    status, error = job["status"], job["error"] or ""
    if status in ("queued", "running"):
        return "pending"
    if job["cancel"] or status == "interrupted":
        return "local"
    if not job["started"] or not job["ended"] or job["ended"] < job["started"]:
        return "unknown"
    if status == "done":
        return "completed"
    if status not in ("failed", "cancelled"):
        return "unknown"
    diagnostic = saved_diagnostic(error)
    if diagnostic == "billing":
        return "billing"
    if diagnostic == "internal":
        return "local"
    if diagnostic in ("timeout", "dns", "connection", "tls", "invalid_json", "invalid_response", "empty_response"):
        return "upstream"
    if diagnostic in ("auth", "model", "parameters", "response_limit"):
        return "configuration"
    match = re.match(r"^接口返回 HTTP ([0-9]{3})(?:[，, ]|$)", error)
    if match:
        code = int(match[1])
        return "upstream" if code == 429 or 500 <= code <= 599 else "configuration"
    if error == "接口请求超时，任务已停止":
        return "upstream"
    if any(s in error for s in ("预算", "已暂停", "已取消", "已停止，或", "已停用", "密钥已变更", "本站检测", "检测进程")):
        return "local"
    if any(s in error for s in ("没有配置检测专用密钥", "检测请求参数不合法", "接口地址", "不允许访问")):
        return "configuration"
    return "unknown"


def bucket():
    return {"completed": 0, "failed": 0, "samples": 0, "rate": None}


def add(target, success):
    target["completed" if success else "failed"] += 1
    target["samples"] += 1
    target["rate"] = round(100 * target["completed"] / target["samples"], 1)


def station_stats(site, dates):
    return {"station": {k: site.get(k, "") for k in ("id", "name", "domain", "logo")},
            **bucket(), "excluded": {"local": 0, "configuration": 0, "unknown": 0, "billing": 0}, "pending": 0,
            "periods": {k: bucket() for k in PERIODS}, "days": {k: bucket() for k in dates},
            "failure_streak": 0, "recoveries": 0, "last_success": None, "last_failure": None,
            "last_sample": None, "last_outcome": None, "last_recovery": None,
            "max_failure_streak": 0, "failure_types": {}, "diagnostic_types": {}, "history": [], "_timings": [],
            "calendar": {d: {p: {"completed": 0, "failed": 0, "unknown": 0, "configuration": 0}
                                for p in PERIODS} for d in dates}}


def failure_kind(job):
    """Public codes only; never return an upstream error body."""
    return saved_diagnostic(job["error"] or "") or "unrecorded"


def record_observation(stats, job, value):
    started, ended = job["started"], job["ended"]
    if not started or not ended or ended < started:
        return
    observed = datetime.fromtimestamp(started, TZ)
    period = "day" if 6 <= observed.hour < 18 else "evening" if observed.hour >= 18 else "night"
    cause = "completed" if value == "completed" else saved_diagnostic(job["error"] or "") or ("unrecorded" if value == "unknown" else value)
    if value not in ("completed", "pending") and cause != "local":
        stats["diagnostic_types"][cause] = stats["diagnostic_types"].get(cause, 0) + 1
    if value in ("completed", "upstream", "unknown", "configuration", "billing") or cause == "internal":
        key = "failed" if value == "upstream" else value
        cell = stats["calendar"][observed.strftime("%Y-%m-%d")][period]
        cell[key] = cell.get(key, 0) + 1
        event = {"at": started, "ended": ended, "outcome": key,
                 "cause": cause, "duration_ms": round((ended - started) * 1000),
                 "test": KINDS.get(json.loads(job["config"]).get("kind"), "检测"),
                 "_job": job["id"], "_report": job["report_id"]}
        stats["history"].append(event)
        # Keep every failure in totals and calendar, but bound the public recent history.
        stats["history"] = stats["history"][-16:]
    if value == "upstream":
        cause = failure_kind(job)
        stats["failure_types"][cause] = stats["failure_types"].get(cause, 0) + 1
    elif value == "completed":
        stats["_timings"].append({"at": started, "ms": round((ended - started) * 1000)})


def timing_summary(stats):
    points = stats.pop("_timings")
    values = [p["ms"] for p in points]
    typical = median(values) if values else None
    return {"samples": len(values), "median_ms": typical, "min_ms": min(values) if values else None,
            "max_ms": max(values) if values else None, "points": points[-16:],
            "slow_count": sum(v > 2 * typical for v in values) if len(values) >= 5 and typical else None}


def quality_bucket():
    return {"status": "untested", "reports": 0, "flagged": 0, "inconclusive": 0,
            "latest_at": None, "evidence": None, "scores": []}


def score(value):
    return value if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100 else None


def add_score(target, value, report, cohort, label):
    if value is None:
        return
    group = next((g for g in target["scores"] if g["cohort"] == cohort), None)
    if group is None:
        group = {"cohort": cohort, "label": label, "count": 0, "min": value, "max": value,
                 "first": value, "latest": value, "delta": None, "points": []}
        target["scores"].append(group)
    group["count"] += 1
    group["min"], group["max"] = min(group["min"], value), max(group["max"], value)
    group["latest"] = value
    group["delta"] = round(value - group["first"], 1) if group["count"] >= 2 else None
    group["points"] = (group["points"] + [{"at": report["at"], "score": value, "id": report["id"]}])[-16:]


def add_quality(target, level, at, report, weights, flagged):
    # Keep the strongest published signal, including inconclusive tests, plus its source.
    level = level if level in weights else "inconclusive"
    target["reports"] += 1
    target["flagged"] += level in flagged
    target["inconclusive"] += level == "inconclusive"
    target["latest_at"] = max(target["latest_at"] or 0, at)
    priority = {"untested": -1, "inconclusive": 1, **weights}
    if (priority[level], at) >= (priority[target["status"]], (target["evidence"] or {}).get("at", 0)):
        target["status"] = level
        target["evidence"] = {"id": report, "at": at}


def published_quality(db, sites, model, start, end):
    """Project scalar conclusions only; never load raw answers, HTML or draft reports."""
    result = {}
    query = """SELECT e.id, json_extract(e.data,'$.station_id') AS station,
        json_extract(e.data,'$.created') AS at, json_extract(e.data,'$.job_id') AS job,
        json_extract(e.data,'$.result.kind') AS test_kind, j.config AS job_config,
        json_extract(e.data,'$.result.protocol_tested') AS protocol_tested,
        json_extract(e.data,'$.result.level') AS protocol_level,
        CASE WHEN json_type(e.data,'$.result.score') IN ('integer','real') THEN json_extract(e.data,'$.result.score') END AS protocol_score,
        json_type(e.data,'$.result.ability') AS ability_type,
        json_extract(e.data,'$.result.ability.level') AS ability_level,
        CASE WHEN json_type(e.data,'$.result.ability.score') IN ('integer','real') THEN json_extract(e.data,'$.result.ability.score') END AS ability_score,
        CASE WHEN json_type(e.data,'$.result.artwork.score') IN ('integer','real') THEN json_extract(e.data,'$.result.artwork.score') END AS artwork_score,
        json_extract(e.data,'$.result.suite') AS suite,
        json_extract(e.data,'$.result.conditions') AS conditions,
        (SELECT count(*) FROM json_each(e.data,'$.result.checks') c WHERE json_extract(c.value,'$.status')='pass') AS passed,
        (SELECT count(*) FROM json_each(e.data,'$.result.checks') c WHERE json_extract(c.value,'$.status') IN ('fail','warn')) AS attention
        FROM entities e LEFT JOIN jobs j ON j.id=json_extract(e.data,'$.job_id')
            AND j.station_id=json_extract(e.data,'$.station_id') AND j.model=json_extract(e.data,'$.result.model')
        WHERE e.kind='reports' AND json_extract(e.data,'$.status')='published'
        AND COALESCE(json_extract(e.data,'$.demo'),0)=0
        AND json_extract(e.data,'$.result.model')=?
        AND json_extract(e.data,'$.created')>=? AND json_extract(e.data,'$.created')<=?
        ORDER BY json_extract(e.data,'$.created'),e.id"""
    with db.connect() as con:
        for report in con.execute(query, (model, start, end)):
            sid = report["station"]
            if sid not in sites:
                continue
            quality = result.setdefault(sid, {"protocol": quality_bucket(), "ability": quality_bucket(), "records": []})
            # Legacy reports predate protocol_tested; an explicit false always wins.
            tested = report["protocol_tested"] == 1 or (
                report["protocol_tested"] is None and report["protocol_level"] in ("ok", "warn", "bad")
                and report["test_kind"] not in ("pelican", "site_pelican"))
            if tested:
                add_quality(quality["protocol"], report["protocol_level"], report["at"], report["id"],
                            {"ok": 0, "warn": 2, "bad": 3}, {"warn", "bad"})
            if report["ability_type"] == "object":
                add_quality(quality["ability"], report["ability_level"], report["at"], report["id"],
                            {"normal": 0, "degraded": 2}, {"degraded"})
            config = configuration(report["job_config"] or "{}")
            # Never compare scores across different suites, conditions or selected tests.
            cohort = hashlib.sha256(json.dumps([report["test_kind"], report["suite"], report["conditions"],
                                               config[0] if config else None]).encode()).hexdigest()[:16]
            label = config[1] if config else KINDS.get(report["test_kind"], "旧版检测")
            record = {"id": report["id"], "at": report["at"], "test": label,
                      "protocol": score(report["protocol_score"]) if tested else None,
                      "ability": score(report["ability_score"]) if report["ability_type"] == "object" else None,
                      "artwork": score(report["artwork_score"]), "passed": report["passed"], "attention": report["attention"],
                      "_job": report["job"]}
            quality["records"] = (quality["records"] + [record])[-32:]
            for kind in ("protocol", "ability"):
                add_score(quality[kind], record[kind], record, cohort, label)
    return result


def snapshot(db, model="", test="", at=None):
    at = now() if at is None else at
    end = datetime.fromtimestamp(at, TZ)
    start = end.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6)
    dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    sites = {s["id"]: s for s in db.list("stations") if s.get("visible")}
    groups, tests, options, counts = {}, {}, set(), Counter()
    with db.connect() as con:
        rows = con.execute("SELECT id,report_id,station_id,model,config,status,started,ended,created,error,cancel FROM jobs WHERE COALESCE(started,created)>=? AND COALESCE(started,created)<=? ORDER BY COALESCE(started,created),id", (start.timestamp(), at))
        for job in rows:
            sid, cfg = job["station_id"], configuration(job["config"])
            if sid not in sites or not cfg:
                continue
            key, label = cfg
            tests[key] = label
            options.add((job["model"], key))
            group_key = (job["model"], key, sid)
            if group_key not in groups:
                groups[group_key] = station_stats(sites[sid], dates)
            stats = groups[group_key]
            value = outcome(job) if not job["ended"] or job["ended"] <= at else "unknown"
            if not job["ended"] or job["ended"] <= at:
                record_observation(stats, job, value)
            if value == "pending":
                stats["pending"] += 1
                continue
            if value not in ("completed", "upstream"):
                stats["excluded"][value] += 1
                continue
            success = value == "completed"
            observed = datetime.fromtimestamp(job["started"], TZ)
            period = "day" if 6 <= observed.hour < 18 else "evening" if observed.hour >= 18 else "night"
            add(stats, success)
            add(stats["periods"][period], success)
            add(stats["days"][observed.strftime("%Y-%m-%d")], success)
            if success and stats["last_outcome"] == "failed":
                stats["recoveries"] += 1
                stats["last_recovery"] = job["ended"]
            stats["failure_streak"] = 0 if success else stats["failure_streak"] + 1
            stats["max_failure_streak"] = max(stats["max_failure_streak"], stats["failure_streak"])
            stats["last_success" if success else "last_failure"] = job["ended"]
            stats["last_sample"] = job["started"]
            stats["last_outcome"] = "completed" if success else "failed"
            counts[(job["model"], key)] += 1
    options = sorted(options, key=lambda x: (-counts[x], x))
    models = sorted({m for m, _ in options} | {m for s in sites.values() for m in s.get("models", [])})
    selected_model = model if model in models else options[0][0] if options else next(iter(models), "")
    available = [key for m, key in options if m == selected_model]
    selected_test = test if test in available else next(iter(available), "")
    quality = published_quality(db, sites, selected_model, start.timestamp(), at)
    result = []
    for sid, site in sites.items():
        stats = groups.get((selected_model, selected_test, sid))
        if not stats and sid not in quality and selected_model not in site.get("models", []):
            continue
        stats = stats or station_stats(site, dates)
        stats["quality"] = quality.get(sid, {"protocol": quality_bucket(), "ability": quality_bucket(), "records": []})
        records = stats["quality"]["records"]
        for event in stats["history"]:
            job, report_id = event.pop("_job"), event.pop("_report")
            report = next((r for r in records if (r["_job"] == job or r["id"] == report_id)), None)
            if report and event["outcome"] == "completed":
                event["report"] = {k: v for k, v in report.items() if not k.startswith("_")}
        for record in records:
            record.pop("_job", None)
        stats["timing"] = timing_summary(stats)
        stats["covered_days"] = sum(d["samples"] > 0 for d in stats["days"].values())
        reasons = []
        if stats["samples"] < MIN_SAMPLES:
            reasons.append(f"有效样本不足 {MIN_SAMPLES} 次")
        if stats["covered_days"] < MIN_DAYS:
            reasons.append(f"采样未覆盖 {MIN_DAYS} 天")
        if any(p["samples"] < MIN_PERIOD for p in stats["periods"].values()):
            reasons.append(f"各时段需至少 {MIN_PERIOD} 次样本")
        if stats["last_sample"] is None or at - stats["last_sample"] > 86400:
            reasons.append("最近 24 小时无有效样本")
        stats.update(eligible=not reasons, ineligible_reasons=reasons)
        result.append(stats)
    result.sort(key=lambda r: (not r["eligible"], -r["completed"] / max(1, r["samples"]), -r["samples"], r["station"]["domain"]))
    previous, rank = None, None
    for index, row in enumerate(result, 1):
        fraction = (row["completed"], row["samples"])
        if row["eligible"]:
            if previous is None or fraction[0] * previous[1] != previous[0] * fraction[1]:
                rank = index
            previous = fraction
        row["rank"] = rank if row["eligible"] else None
    return {"generated_at": at, "start": dates[0], "end": dates[-1], "timezone": "Asia/Shanghai",
            "selected_model": selected_model, "selected_test": selected_test, "models": models,
            "tests": [{"id": k, "label": tests[k]} for k in available], "stations": result,
            "thresholds": {"samples": MIN_SAMPLES, "days": MIN_DAYS, "period_samples": MIN_PERIOD, "fresh_hours": 24}}
