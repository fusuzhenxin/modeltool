"""Bounded admin batch actions; preserve measurements, credentials and audit history."""
import json
from datetime import datetime
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import Field, field_validator, model_validator, ValidationError

from .core import now
from .models import Run, Schedule, StrictModel
from .proposals import STATUSES
from .worker import enqueue


class ScheduleChanges(StrictModel):
    publish_mode: Literal["review", "auto"] | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)
    interval_minutes: int | None = Field(default=None, ge=1, le=43200)
    next_run: datetime | None = None
    schedule_mode: Literal["interval", "once", "daily"] | None = None
    daily_time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")

    @model_validator(mode="after")
    def valid_changes(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("请至少填写一项要修改的配置，不能设为空值")
        if self.model is not None and not self.model.strip():
            raise ValueError("模型不能为空")
        if self.next_run is not None and (self.next_run.tzinfo is None or self.next_run.timestamp() <= now()):
            raise ValueError("下次运行时间必须包含时区且晚于当前时间")
        if self.schedule_mode == "once" and self.next_run is None:
            raise ValueError("切换为单次执行时请填写执行日期和时间")
        if self.schedule_mode == "daily" and not self.daily_time:
            raise ValueError("切换为每天执行时请填写北京时间的执行时刻")
        if self.daily_time and self.schedule_mode != "daily":
            raise ValueError("每天执行时刻需要选择每天执行方式")
        if self.schedule_mode in ("once", "daily") and self.interval_minutes is not None:
            raise ValueError("仅按间隔重复时设置检测间隔")
        if self.schedule_mode == "daily" and self.next_run is not None:
            raise ValueError("每天执行时请只设置每日时刻")
        return self


class BulkAction(StrictModel):
    ids: list[str] = Field(min_length=1, max_length=100)
    action: str = Field(min_length=1, max_length=40)
    note: str | None = Field(default=None, max_length=1500)
    changes: ScheduleChanges | None = None
    exclusion_reason: Literal["group_unavailable", "credential_changed", "model_unavailable", "test_invalid"] | None = None

    @field_validator("ids")
    @classmethod
    def valid_ids(cls, ids):
        if len(set(ids)) != len(ids) or any(not key or len(key) > 100 for key in ids):
            raise ValueError("请选择不重复的有效记录，最多 100 条")
        return ids


class RunBatch(StrictModel):
    runs: list[Run] = Field(min_length=1, max_length=100)

    @field_validator("runs")
    @classmethod
    def unique_targets(cls, runs):
        if len({(run.station_id, run.model) for run in runs}) != len(runs):
            raise ValueError("同一批检测不能重复选择相同中转站和模型")
        return runs


ACTIONS = {
    "reports": {"published", "draft", "rejected"},
    "stations": {"show", "hide", "enable", "disable", "delete"},
    "schedules": {"run", "enable", "disable", "delete", "edit"},
    "jobs": {"cancel", "retry", "exclude", "restore"},
    "announcements": {"enable", "disable", "pin", "unpin", "delete"},
    "ads": {"enable", "disable", "delete"},
    "proposals": {"show", "hide", "pin", "unpin", *STATUSES},
}


def register_bulk(app, db, session, prepare_schedule):
    @app.post("/api/admin/jobs/batch")
    def batch_jobs(spec: RunBatch, user=Depends(session)):
        try:
            with db.connect(write=True) as con:
                created = [enqueue(db, run.model_dump(), user["username"], con=con) for run in spec.runs]
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"count": len(created), "ids": created}

    @app.post("/api/admin/bulk/{kind}")
    def bulk_action(kind: str, spec: BulkAction, user=Depends(session)):
        if kind not in ACTIONS or spec.action not in ACTIONS[kind]:
            raise HTTPException(422, "这个模块不支持所选批量操作")
        if spec.note is not None and kind != "reports" and not (kind == "jobs" and spec.action in ("exclude", "restore")):
            raise HTTPException(422, "只有报告审核支持批量审核备注")
        if kind == "jobs" and spec.action == "exclude":
            if not spec.exclusion_reason or not spec.note or len(spec.note.strip()) < 5:
                raise HTTPException(422, "请选择排除原因并填写至少 5 字的核查依据")
        elif spec.exclusion_reason is not None:
            raise HTTPException(422, "只有排除任务统计时可以设置排除原因")
        if (spec.changes is not None) != (kind == "schedules" and spec.action == "edit"):
            raise HTTPException(422, "批量修改定时计划必须提供修改项，其他操作不能附带修改项")
        updated, skipped, created = [], [], []
        with db.connect(write=True) as con:
            for key in spec.ids:
                raw = None
                if kind == "jobs":
                    raw = con.execute("SELECT * FROM jobs WHERE id=?", (key,)).fetchone()
                    row = dict(raw) if raw else None
                    execution = db.get("executions", key, con) if row is None else None
                    if execution:
                        try:
                            if spec.action not in ("cancel", "retry"):
                                raise ValueError("组合执行请展开详情，对具体失败项目排除或恢复统计")
                            from .executions import action as execution_action
                            new_key = execution_action(db, key, spec.action, user["username"], con)
                            if new_key:
                                created.append(new_key)
                            updated.append(key)
                        except ValueError as exc:
                            skipped.append({"id": key, "label": execution["name"], "reason": str(exc)})
                        continue
                elif kind == "proposals":
                    raw = con.execute("SELECT * FROM proposals WHERE id=?", (key,)).fetchone()
                    row = json.loads(raw["data"]) if raw else None
                else:
                    row = db.get(kind, key, con)
                label = (row or {}).get("name") or (row or {}).get("title") or key
                if row and kind in ("jobs", "reports"):
                    site = db.get("stations", row["station_id"], con)
                    model = row.get("model") or row.get("result", {}).get("model", "")
                    label = f"{site['name'] if site else '已移除站点'} · {model} · {key[:8]}"
                try:
                    if not row:
                        raise ValueError("记录已不存在，请刷新列表")
                    action = spec.action
                    audit = f"bulk_{kind}_{action}"
                    if kind == "jobs":
                        if action in ("exclude", "restore"):
                            from .job_exclusions import set_exclusion
                            set_exclusion(db, row, action, spec.exclusion_reason, spec.note, user["username"], con)
                            updated.append(key)
                            continue
                        elif action == "cancel":
                            if row["status"] not in ("queued", "running") or row["cancel"]:
                                raise ValueError("任务已结束或已请求取消")
                            con.execute("UPDATE jobs SET cancel=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,ended=CASE WHEN status='queued' THEN ? ELSE ended END WHERE id=?", (now(), key))
                            audit = "job_cancelled"
                        else:
                            if row["status"] not in ("failed", "interrupted", "cancelled"):
                                raise ValueError("只能重试失败、取消或中断的任务")
                            new_key = enqueue(db, {"station_id": row["station_id"], "model": row["model"], **json.loads(row["config"])}, user["username"], con=con)
                            created.append(new_key)
                    elif kind == "schedules" and action == "run":
                        new_key = enqueue(db, row, user["username"], schedule_id=key, con=con)
                        created.append(new_key)
                    elif kind == "schedules" and action == "edit":
                        changes = spec.changes.model_dump(exclude_unset=True)
                        requested_time = changes.pop("next_run", None)
                        data = row | changes
                        if "model" in changes and row.get("models"):
                            data["models"] = [changes["model"]]
                        if "interval_minutes" in changes and "schedule_mode" not in changes:
                            data.update(schedule_mode="interval", daily_time="", first_run=None)
                        if changes.get("schedule_mode") == "interval" and (row.get("schedule_mode", "interval") != "interval" or "interval_minutes" in changes):
                            data["first_run"] = None
                        if requested_time is not None and data.get("schedule_mode") == "once":
                            data["first_run"] = requested_time.isoformat()
                        try:
                            validated = Schedule.model_validate({field: value for field, value in data.items() if field in Schedule.model_fields}).model_dump(mode="json")
                            data.update(validated)
                            prepare_schedule(data, con, row)
                        except HTTPException as exc:
                            raise ValueError(str(exc.detail)) from exc
                        except ValidationError as exc:
                            raise ValueError("计划配置不合法，请检查后单独编辑") from exc
                        if "interval_minutes" in changes and data.get("schedule_mode", "interval") == "interval":
                            data["next_run"] = now() + data["interval_minutes"] * 60
                            data["first_run"] = None
                        if requested_time is not None:
                            data["next_run"] = requested_time.timestamp()
                            if data.get("schedule_mode") != "daily":
                                data["first_run"] = requested_time.isoformat()
                        if data == row:
                            raise ValueError("配置未变化")
                        db.save(kind, key, data, con)
                    elif action == "delete":
                        if kind == "ads":
                            from .advertising import reserves, record_event
                            if reserves(row) or row.get("received_cents") or row.get("contract_cents"):
                                raise ValueError("已预订或有金额记录的广告请取消投放并保留账目，不能直接删除")
                            record_event(db, key, row, None, user["username"], con, "deleted")
                        if kind == "stations":
                            in_use = con.execute("SELECT 1 FROM jobs WHERE station_id=? AND status IN ('queued','running')", (key,)).fetchone()
                            has_reports = any(r["station_id"] == key for r in db.list("reports", con))
                            has_plans = any(r["station_id"] == key for r in db.list("schedules", con))
                            if in_use or has_reports or has_plans:
                                raise ValueError("有关联任务、计划或报告，请改为隐藏或暂停")
                        con.execute("DELETE FROM entities WHERE kind=? AND id=?", (kind, key))
                        audit = "deleted_" + kind
                    else:
                        if kind == "reports":
                            if action == "published" and row.get("excluded_reason") == "billing":
                                raise ValueError("余额不足的无效检测报告不能公开，请充值后重新检测")
                            site = db.get("stations", row["station_id"], con)
                            if action == "published" and (not site or not site["visible"]):
                                raise ValueError("中转站未公开，请先将站点设为公开")
                            changes = {"status": action}
                            if spec.note is not None:
                                changes["note"] = spec.note
                            if all(row.get(field) == value for field, value in changes.items()):
                                raise ValueError("报告已是所选状态，备注也未变化")
                            changes.update(reviewed_by=user["username"], reviewed_at=now())
                            audit = "report_" + action
                        elif kind == "proposals" and action in STATUSES:
                            changes = {"status": action}
                        else:
                            field, value = {"show": ("visible", True), "hide": ("visible", False), "enable": ("enabled", True), "disable": ("enabled", False), "pin": ("pinned", True), "unpin": ("pinned", False)}[action]
                            changes = {field: value}
                        if all(row.get(field) == value for field, value in changes.items()):
                            raise ValueError("已经是所选状态")
                        data = row | changes
                        if kind == "ads" and action == "enable":
                            from .advertising import validate_booking
                            try:
                                validate_booking(db, data, key, con)
                            except HTTPException as exc:
                                raise ValueError(str(exc.detail)) from exc
                        if kind == "ads":
                            from .advertising import record_event
                            record_event(db, key, row, data, user["username"], con)
                        if kind == "schedules" and action == "enable":
                            try:
                                prepare_schedule(data, con, row)
                            except HTTPException as exc:
                                raise ValueError(str(exc.detail)) from exc
                        if kind == "proposals":
                            con.execute("UPDATE proposals SET data=?,updated=? WHERE id=?", (json.dumps(data, ensure_ascii=False), now(), key))
                            audit = "moderated_proposal"
                        else:
                            db.save(kind, key, data, con)
                    db.audit(user["username"], audit, key, con)
                    updated.append(key)
                except ValueError as exc:
                    skipped.append({"id": key, "label": label, "reason": str(exc)})
        return {"count": len(updated), "updated": updated, "skipped": skipped, "created_ids": created}
