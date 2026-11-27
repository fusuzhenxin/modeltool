"""Reversible sample exclusions. Preserve jobs and an attributed review history."""
from .core import now


REASONS = {
    "group_unavailable": "分组已失效",
    "credential_changed": "密钥或权限已变更",
    "model_unavailable": "检测模型已下架",
    "test_invalid": "检测配置无效",
}


def set_exclusion(db, job, action, reason, note, actor, con):
    if job["status"] not in ("failed", "cancelled", "interrupted"):
        raise ValueError("只能处理已失败、取消或中断的任务；完成和运行中的任务不能排除")
    previous = db.get("job_exclusions", job["id"], con) or {}
    active = action == "exclude"
    if active and (reason not in REASONS or not note or len(note.strip()) < 5):
        raise ValueError("请选择排除原因并填写至少 5 字的核查依据")
    if bool(previous.get("active")) == active:
        raise ValueError("该任务已排除" if active else "该任务未被人工排除")
    event = {"active": active, "reason": reason if active else previous["reason"],
             "note": note or "", "actor": actor, "at": now()}
    data = event | {"history": previous.get("history", []) + [event]}
    db.save("job_exclusions", job["id"], data, con)
    db.audit(actor, "job_sample_excluded" if active else "job_sample_restored", job["id"], con)
    return data
