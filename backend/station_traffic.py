"""Organic station discovery events. No advertising records or counters are written."""
from __future__ import annotations

import csv
import io
import json
import math
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import InvalidToken
from fastapi import Depends, HTTPException, Request, Response
from pydantic import Field

from .ad_analytics import classify, visitor_hash
from .core import TZ, now
from .models import StrictModel

COOKIE = "modeltool_station_visitor"
PAGES = {"daily": "中转日报", "stability": "稳定性观察", "directory": "中转站列表"}
PLACEMENTS = {"daily_card": "日报站点卡片", "directory_card": "完整列表站点卡片",
              "stability_ranked": "稳定性 · 样本充分榜", "stability_observing": "稳定性 · 新站观察区"}
ALLOWED = {"daily": {"daily_card"}, "directory": {"directory_card"},
           "stability": {"stability_ranked", "stability_observing"}}
Traffic = Literal["clean", "all", "automated", "internal", "unknown"]


class TicketRequest(StrictModel):
    page: Literal["daily", "stability", "directory"]
    station_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=100)


class Event(StrictModel):
    token: str = Field(min_length=20, max_length=2000)
    view_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{16,80}$")
    page: Literal["daily", "stability", "directory"]
    placement: Literal["daily_card", "directory_card", "stability_ranked", "stability_observing"]
    kind: Literal["impression", "outbound", "profile", "report", "details"]
    automated: bool = False


class Batch(StrictModel):
    events: list[Event] = Field(min_length=1, max_length=20)


def same_origin(request, page=None):
    if request.headers.get("origin") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "不允许跨站统计")
    if page:
        ref = urlsplit(request.headers.get("referer", ""))
        expected = "/stations.html" if page == "directory" else "/relays.html"
        stability = parse_qs(ref.query).get("view", [""])[0] == "stability"
        if (ref.netloc != request.url.netloc or ref.scheme != request.url.scheme or ref.path != expected
                or page != "directory" and stability != (page == "stability")):
            raise HTTPException(403, "统计页面不匹配")


def measures(row):
    result = {key: row[key] or 0 for key in ("impressions", "outbound", "profile", "report", "details", "visitors", "outbound_visitors")}
    result["internal_clicks"] = sum(result[k] for k in ("profile", "report", "details"))
    result["ctr"] = round(result["outbound"] / result["impressions"] * 100, 2) if result["impressions"] else None
    return result


def report(db, start=None, end=None, station_id="", page="", placement="", traffic="clean"):
    today = datetime.now(TZ).date()
    start, end = start or today - timedelta(days=29), end or today
    if end < start or (end - start).days >= 366:
        raise HTTPException(422, "请选择结束不早于开始、最多 366 天的日期范围")
    if (page and page not in PAGES) or (placement and placement not in PLACEMENTS) or len(station_id) > 100:
        raise HTTPException(422, "中转站、页面或展示位置不正确")
    where, args = ["day>=?", "day<=?"], [start.isoformat(), end.isoformat()]
    for key, value in (("station_id", station_id), ("page", page), ("placement", placement)):
        if value:
            where.append(key + "=?"); args.append(value)
    base_where, base_args = " AND ".join(where), args.copy()
    if traffic != "all":
        where.append("traffic=?"); args.append(traffic)
    condition = " AND ".join(where)
    measure = ",".join(f"SUM(kind='{kind}') {alias}" for kind, alias in
                       (("impression", "impressions"), ("outbound", "outbound"), ("profile", "profile"), ("report", "report"), ("details", "details")))
    measure += ",COUNT(DISTINCT CASE WHEN kind='impression' THEN visitor END) visitors,COUNT(DISTINCT CASE WHEN kind='outbound' THEN visitor END) outbound_visitors"
    with db.connect() as con:
        con.execute("BEGIN")
        def aggregate(group="", raw=False):
            return con.execute("SELECT " + (group + "," if group else "") + measure + " FROM station_traffic WHERE "
                               + (base_where if raw else condition) + (" GROUP BY " + group if group else ""), base_args if raw else args).fetchall()
        summary, raw = measures(aggregate()[0]), measures(aggregate(raw=True)[0])
        groups = {key: [dict(row) | measures(row) for row in aggregate(columns)]
                  for key, columns in (("stations", "station_id"), ("pages", "page"), ("placements", "placement"),
                                       ("details", "station_id,page,placement"))}
        classes = {row["traffic"]: measures(row) for row in con.execute("SELECT traffic," + measure + " FROM station_traffic WHERE " + base_where + " GROUP BY traffic", base_args)}
        trend = {row["day"]: measures(row) for row in aggregate("day")}
        history = {r["station_id"]: {"id": r["station_id"], "name": r["station_name"], "domain": r["domain"], "hidden": True}
                   for r in con.execute("SELECT station_id,station_name,domain FROM station_traffic GROUP BY station_id,station_name,domain ORDER BY MAX(at)")}
        history.update({s["id"]: {"id": s["id"], "name": s["name"], "domain": s["domain"], "hidden": not s.get("visible")}
                        for s in db.list("stations", con)})
        started = con.execute("SELECT started FROM station_traffic_meta WHERE id=1").fetchone()[0]
    empty = {key: 0 for key in ("impressions", "outbound", "profile", "report", "details", "visitors", "outbound_visitors", "internal_clicks")} | {"ctr": None}
    days = [{"day": (start + timedelta(days=i)).isoformat(), **trend.get((start + timedelta(days=i)).isoformat(), empty)}
            for i in range((end - start).days + 1)]
    groups["stations"].sort(key=lambda r: (-r["outbound"], -r["impressions"], r["station_id"]))
    return {"start": start.isoformat(), "end": end.isoformat(), "traffic": traffic, "started_at": started,
            "summary": summary, "raw": raw, "classes": classes, "trend": days, **groups,
            "options": {"stations": list(history.values()), "pages": PAGES, "placements": PLACEMENTS}}


def register(app, db, session):
    with db.connect() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS station_traffic_meta(id INTEGER PRIMARY KEY CHECK(id=1),started REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS station_traffic(
                at REAL NOT NULL,day TEXT NOT NULL,station_id TEXT NOT NULL,station_name TEXT NOT NULL,domain TEXT NOT NULL,
                placement TEXT NOT NULL,page TEXT NOT NULL,kind TEXT NOT NULL,visitor TEXT NOT NULL,view_id TEXT NOT NULL,
                traffic TEXT NOT NULL,reason TEXT NOT NULL,
                PRIMARY KEY(visitor,view_id,station_id,placement,page,kind));
            CREATE INDEX IF NOT EXISTS station_traffic_report ON station_traffic(day,station_id,page,placement,traffic);
            CREATE INDEX IF NOT EXISTS station_traffic_rate ON station_traffic(visitor,at);
        """)
        con.execute("INSERT OR IGNORE INTO station_traffic_meta VALUES(1,?)", (now(),))

    @app.post("/api/public/station-traffic/session")
    def tickets(spec: TicketRequest, request: Request, response: Response):
        same_origin(request, spec.page)
        visitor = request.cookies.get(COOKIE, "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{32,100}", visitor):
            visitor = secrets.token_urlsafe(32)
            response.set_cookie(COOKIE, visitor, httponly=True, secure=request.url.scheme == "https", samesite="lax", max_age=365 * 86400, path="/")
        identity, expires = visitor_hash(db, "station-traffic:" + visitor), now() + 86400
        selected = set(spec.station_ids)
        tokens = {s["id"]: db.cipher.encrypt(json.dumps({"scope": "station-traffic", "station_id": s["id"], "page": spec.page,
                    "visitor": identity, "expires": expires}).encode()).decode()
                  for s in db.list("stations") if s["id"] in selected and s.get("visible") and not s.get("demo")}
        return {"tokens": tokens, "expires": expires}

    @app.post("/api/public/station-traffic/events")
    def collect(spec: Batch, request: Request):
        same_origin(request)
        cookie = request.cookies.get(COOKIE, "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{32,100}", cookie):
            raise HTTPException(403, "统计凭据已失效")
        identity, current = visitor_hash(db, "station-traffic:" + cookie), now()
        accepted = duplicates = rejected = 0
        with db.connect(write=True) as con:
            if con.execute("SELECT count(*) FROM station_traffic WHERE visitor=? AND at>?", (identity, current - 60)).fetchone()[0] >= 600:
                raise HTTPException(429, "统计请求过于频繁")
            traffic, reason = classify(db, request, any(e.automated for e in spec.events), con)
            for event in spec.events:
                try:
                    ticket = json.loads(db.cipher.decrypt(event.token.encode()).decode())
                except (InvalidToken, ValueError, UnicodeError):
                    rejected += 1; continue
                if (not isinstance(ticket, dict) or ticket.get("scope") != "station-traffic" or ticket.get("visitor") != identity
                        or type(ticket.get("expires")) not in (int, float) or not math.isfinite(ticket["expires"]) or ticket["expires"] < current
                        or ticket.get("page") != event.page or event.placement not in ALLOWED[event.page]):
                    rejected += 1; continue
                station = db.get("stations", ticket.get("station_id", ""), con)
                if not station or not station.get("visible") or station.get("demo"):
                    rejected += 1; continue
                inserted = con.execute("INSERT OR IGNORE INTO station_traffic VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                    current, datetime.fromtimestamp(current, TZ).date().isoformat(), ticket["station_id"], station["name"], station["domain"],
                    event.placement, event.page, event.kind, identity, event.view_id, traffic, reason)).rowcount
                accepted += bool(inserted); duplicates += not inserted
        return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}

    def data(start: date | None = None, end: date | None = None, station_id: str = "", page: str = "", placement: str = "",
             traffic: Traffic = "clean", user=Depends(session)):
        return report(db, start, end, station_id, page, placement, traffic)
    app.get("/api/admin/station-traffic")(data)

    @app.get("/api/admin/station-traffic/report.csv")
    def export(result=Depends(data)):
        stream = io.StringIO(); writer = csv.writer(stream)
        writer.writerow(["中转站", "域名", "页面", "位置", "曝光", "曝光人数", "官网点击", "官网点击人数", "外跳点击率", "站点档案", "查看报告", "展开详情"])
        stations = {s["id"]: s for s in result["options"]["stations"]}
        def cell(value):
            value = str(value)
            return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value
        for row in result["details"]:
            station = stations.get(row["station_id"], {})
            writer.writerow([cell(station.get("name", row["station_id"])), cell(station.get("domain", "")), PAGES[row["page"]],
                             PLACEMENTS[row["placement"]], row["impressions"], row["visitors"], row["outbound"], row["outbound_visitors"],
                             "" if row["ctr"] is None else str(row["ctr"]) + "%", row["profile"], row["report"], row["details"]])
        return Response("\ufeff" + stream.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="station-traffic.csv"'})
