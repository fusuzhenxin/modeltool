"""Advertisement inventory, pricing and private booking operations."""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from pydantic import Field

from .core import TZ, now, ident
from .models import StrictModel

SLOTS = {
    "masthead": {"label": "顶部通栏", "capacity": 1, "spec": "文字通栏，标题与介绍"},
    "banner": {"label": "首屏横幅", "capacity": 1, "spec": "建议 1200 × 200，图片完整显示"},
    "hero": {"label": "顶部赞助商", "capacity": 5, "spec": "建议 600 × 240，卡片宽 268px"},
    "left": {"label": "全站赞助位 · 左侧", "capacity": 1, "spec": "所有前台页面展示，左下角；窄屏转为页内"},
    "right": {"label": "全站赞助位 · 右侧", "capacity": 1, "spec": "所有前台页面展示，右下角；窄屏转为页内"},
    "footer": {"label": "页尾赞助商", "capacity": 5, "spec": "建议 600 × 240，与顶部卡片一致"},
}
PACKAGES = {
    "top_bottom": {"label": "顶部＋底部套餐", "capacity": 5, "spec": "顶部赞助商＋页尾赞助商，各占 1 个名额"},
    "full": {"label": "全包套餐", "capacity": 1, "spec": "顶部＋底部＋横幅＋左侧或右侧全站赞助位"},
}
PRODUCTS = SLOTS | PACKAGES
PUBLIC_FIELDS = ("id", "title", "description", "link", "image", "placement", "order", "enabled", "starts_at", "ends_at")
RESERVING = {"reserved", "published", "paused"}


class SlotPrices(StrictModel):
    daily_cents: int | None = Field(default=None, ge=0, le=10000000000)
    weekly_cents: int | None = Field(default=None, ge=0, le=10000000000)
    monthly_cents: int | None = Field(default=None, ge=0, le=10000000000)
    accepting: bool = True
    note: str = Field(default="", max_length=500)


def slot_key(value):
    return "left" if value == "dock" else value


def targets(row):
    placement = slot_key(row["placement"])
    if placement == "top_bottom":
        return ["hero", "footer"]
    if placement == "full":
        return ["hero", "footer", "banner", row.get("side", "left")]
    return [placement] if placement in SLOTS else []


def bounds(row):
    return tuple(datetime.fromisoformat(row[k]).timestamp() if row.get(k) else fallback
                 for k, fallback in (("starts_at", -math.inf), ("ends_at", math.inf)))


def reserves(row):
    # Historical disabled ads did not have a booking contract.
    return row.get("booking_status", "published" if row.get("enabled", True) else "draft") in RESERVING


def peak(rows, placement, start, end, exclude=""):
    events = []
    for row in rows:
        if row.get("id") == exclude or placement not in targets(row) or not reserves(row):
            continue
        a, b = bounds(row)
        a, b = max(a, start), min(b, end)
        if a < b:
            events.extend(((a, 1), (b, -1)))
    count = result = 0
    # At a shared boundary, departures happen before arrivals.
    for _, delta in sorted(events):
        count += delta
        result = max(result, count)
    return result


def slots(db, con=None):
    return [dict(value, key=key, daily_cents=None, weekly_cents=None, monthly_cents=None,
                 accepting=True, note="") | (db.get("ad_slots", key, con) or {}) for key, value in PRODUCTS.items()]


def record_event(db, key, previous, data, actor, con, action="updated"):
    fields = ("name", "title", "description", "image", "link", "placement", "side", "booking_status", "enabled",
              "starts_at", "ends_at", "order", "advertiser", "contact", "internal_note", "billing_unit",
              "contract_cents", "received_cents", "daily_cents", "weekly_cents", "monthly_cents", "accepting", "note")
    changes = {field: {"before": (previous or {}).get(field), "after": (data or {}).get(field)}
               for field in fields if (previous or {}).get(field) != (data or {}).get(field)}
    if changes:
        db.save("ad_events", ident(), {"ad_id": key, "name": (data or previous).get("name", PRODUCTS.get(key, {}).get("label", key)),
                                      "actor": actor, "at": now(), "action": action, "changes": changes}, con)


def validate_booking(db, row, key, con):
    placement = slot_key(row["placement"])
    if placement not in PRODUCTS:
        if reserves(row):
            raise HTTPException(422, "此广告位已停用，请选择现有位置或套餐")
        return
    if not reserves(row):
        return
    previous = db.get("ads", key, con)
    unchanged_booking = previous and reserves(previous) and targets(previous) == targets(row) and all(
        previous.get(field) == row.get(field) for field in ("starts_at", "ends_at"))
    for product in dict.fromkeys([placement, *targets(row)]):
        config = db.get("ad_slots", product, con) or {}
        if not config.get("accepting", True) and not unchanged_booking:
            raise HTTPException(409, PRODUCTS[product]["label"] + "已暂停接单，请先保存草稿")
    rows = db.list("ads", con)
    for target in targets(row):
        if peak(rows, target, *bounds(row), exclude=key) >= SLOTS[target]["capacity"]:
            raise HTTPException(409, SLOTS[target]["label"] + "在该时间段已满，请调整排期或先保存为草稿")


def public_ads(db, active):
    configs = {s["key"]: s for s in slots(db)}
    rows = sorted((r for r in db.list("ads") if active(r)
                   and r.get("booking_status", "published") == "published"), key=lambda r: r.get("order", 0))
    result, counts = [], {}
    for row in rows:
        for key in targets(row):
            if counts.get(key, 0) >= configs[key]["capacity"]:
                continue
            counts[key] = counts.get(key, 0) + 1
            result.append({k: row.get(k) for k in PUBLIC_FIELDS} | {"placement": key})
    return result


def quote(row, configs):
    start, end = bounds(row)
    if not math.isfinite(start) or not math.isfinite(end):
        return None
    days = max(1, math.ceil((end - start) / 86400))
    unit = row.get("billing_unit", "day")
    periods = math.ceil(days / {"day": 1, "week": 7, "month": 30}[unit])
    config = next((s for s in configs if s["key"] == slot_key(row["placement"])), {})
    price = config.get({"day": "daily_cents", "week": "weekly_cents", "month": "monthly_cents"}[unit])
    return {"days": days, "periods": periods, "unit": unit, "unit_cents": price,
            "total_cents": price * periods if price is not None else None}


def register(app, db, session):
    @app.get("/api/admin/advertising/overview")
    def overview(start: datetime | None = None, end: datetime | None = None, user=Depends(session)):
        start = start or datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        end = end or start + timedelta(days=30)
        if start.tzinfo is None or end.tzinfo is None or end <= start or end - start > timedelta(days=366):
            raise HTTPException(422, "请选择含时区、结束晚于开始且不超过 366 天的区间")
        with db.connect() as con:
            configs, rows = slots(db, con), db.list("ads", con)
            audit = [dict(r) for r in con.execute("SELECT at,actor,action,target FROM audit WHERE action LIKE '%_ads' OR action='updated_ad_prices' ORDER BY id DESC LIMIT 50")]
            events = db.list("ad_events", con)[:50]
            traffic_totals = {r["ad_id"]: {"impressions": r["impressions"], "clicks": r["clicks"]}
                              for r in con.execute("SELECT ad_id,SUM(kind='impression') impressions,SUM(kind='click') clicks FROM ad_traffic GROUP BY ad_id")}
        current = now()
        physical = [s for s in configs if s["key"] in SLOTS]
        packages = [s for s in configs if s["key"] in PACKAGES]
        for config in physical:
            key = config["key"]
            config["occupied_now"] = peak(rows, key, current, current + .001)
            config["peak_booked"] = peak(rows, key, start.timestamp(), end.timestamp())
            config["remaining"] = max(0, config["capacity"] - config["peak_booked"])
            config["overbooked"] = max(0, config["peak_booked"] - config["capacity"])
        by_key = {s["key"]: s for s in physical}
        for package in packages:
            def available(side="left"):
                needed = targets({"placement": package["key"], "side": side})
                if not package["accepting"] or any(not by_key[k]["accepting"] for k in needed):
                    return 0
                return min(by_key[k]["remaining"] for k in needed)
            package["variants"] = {side: available(side) for side in ("left", "right")}
            package["remaining"] = max(package["variants"].values())
        calendar = []
        cursor = start
        while cursor < end:
            until = min(cursor + timedelta(days=1), end)
            calendar.append({"date": cursor.astimezone(TZ).strftime("%m-%d"), "start": cursor.isoformat(),
                             "slots": {s["key"]: max(0, s["capacity"] - peak(rows, s["key"], cursor.timestamp(), until.timestamp())) for s in physical}})
            cursor = until
        records = [r | {"booking_status": r.get("booking_status", "published" if r.get("enabled", True) else "draft"),
                        "reference_quote": quote(r, configs), "created_at": r.get("created_at"),
                        "remaining_days": max(0, math.ceil((bounds(r)[1] - current) / 86400)) if math.isfinite(bounds(r)[1]) else None} for r in rows]
        return {"slots": physical, "packages": packages, "records": records, "calendar": calendar, "audit": audit, "events": events, "traffic_totals": traffic_totals,
                "start": start.isoformat(), "end": end.isoformat(),
                "totals": {"capacity": sum(s["capacity"] for s in physical),
                           "remaining": sum(s["remaining"] for s in physical),
                           "expiring": sum(reserves(r) and current < bounds(r)[1] <= current + 7 * 86400 for r in rows),
                           "pending_contracts": sum(r.get("contract_cents") is None for r in rows if r.get("booking_status") != "cancelled"),
                           "contract_cents": sum(r.get("contract_cents") or 0 for r in rows if r.get("booking_status") != "cancelled"),
                           "received_cents": sum(r.get("received_cents", 0) for r in rows if r.get("booking_status") != "cancelled")}}

    @app.put("/api/admin/advertising/prices/{key}")
    def prices(key: str, spec: SlotPrices, user=Depends(session)):
        if key not in PRODUCTS:
            raise HTTPException(404, "广告位不存在")
        with db.connect(write=True) as con:
            previous = db.get("ad_slots", key, con)
            saved = db.save("ad_slots", key, spec.model_dump(mode="json"), con)
            record_event(db, key, previous, saved, user["username"], con, "prices")
            db.audit(user["username"], "updated_ad_prices", key, con)
        return saved
