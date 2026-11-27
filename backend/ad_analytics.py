"""First-party ad events, deduplication and private reporting by page and slot."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken
from fastapi import Depends, HTTPException, Request, Response
from pydantic import Field

from . import advertising
from .core import TZ, digest, now
from .models import StrictModel

COOKIE = "modeltool_ad_visitor"
PAGES = dict(zip(
    ["index", "detect", "trace", "basic", "candy", "pelican", "prompts", "works", "work", "relay", "relays", "stations", "result", "run", "records", "compare", "guide", "setup", "login", "cooperate", "status", "tasks", "examples", "proposals"],
    ["首页", "模型检测页", "模型指纹检测", "基础测试页", "糖果测试页", "鹈鹕骑车测试", "提示词库", "HTML 作品列表", "HTML 作品详情", "中转站检测", "中转日报", "中转站列表", "检测结果", "执行检测", "检测记录", "模型对比", "使用指南", "接口设置", "登录页", "商务合作", "官方模型状态", "检测任务", "检测案例", "收录提案"]
))
PAGE_LABELS = {"/" + name + ".html": label for name, label in PAGES.items()}
AI = re.compile(r"gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|anthropic|perplexitybot|perplexity-user|bytespider|cohere-ai|google-extended|amazonbot", re.I)
BOT = re.compile(r"bot\b|crawler|spider|slurp|bingpreview|headless|phantomjs|selenium|playwright|puppeteer|python|curl|wget|httpx|scrapy", re.I)


def page_path(path):
    return "/index.html" if path in ("/", "/index.html") else path


def visitor_hash(db, token):
    # Reuse the installation secret without storing the visitor cookie or a raw IP.
    secret = (db.directory / "encryption.key").read_bytes()
    return hmac.new(secret, token.encode(), hashlib.sha256).hexdigest()


def public_ads(db, request, response, records):
    ref = urlsplit(request.headers.get("referer", ""))
    page = page_path(ref.path)
    if not records or ref.netloc != request.url.netloc or ref.scheme != request.url.scheme or page not in PAGE_LABELS:
        return records
    visitor = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32,100}", visitor):
        visitor = secrets.token_urlsafe(32)
        response.set_cookie(COOKIE, visitor, httponly=True, secure=request.url.scheme == "https",
                            samesite="lax", max_age=365 * 86400, path="/")
    identity = visitor_hash(db, visitor)
    return [record | {"tracking_token": db.cipher.encrypt(json.dumps({
        "ad_id": record["id"], "placement": record["placement"], "page": page,
        "visitor": identity, "expires": now() + 86400,
    }).encode()).decode()} for record in records]


class Event(StrictModel):
    token: str = Field(min_length=20, max_length=2000)
    view_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{16,80}$")
    kind: Literal["impression", "click"]
    page: str = Field(max_length=80)
    automated: bool = False


class Batch(StrictModel):
    events: list[Event] = Field(min_length=1, max_length=20)


def classify(db, request, automated, con):
    session = request.cookies.get("modeltool_session", "")
    if session and con.execute("SELECT 1 FROM sessions WHERE token=? AND expires>?", (digest(session), now())).fetchone():
        return "internal", "管理员访问"
    ua = request.headers.get("user-agent", "")
    if AI.search(ua):
        return "automated", "已识别 AI 客户端"
    if automated or BOT.search(ua):
        return "automated", "已识别爬虫或自动化"
    if not re.search(r"Mozilla/|Chrome/|Firefox/|Safari/|Edg/", ua):
        return "unknown", "未识别浏览器"
    return "clean", "未识别自动化"


def metrics(row):
    values = {key: row[key] or 0 for key in ("impressions", "clicks", "visitors")}
    return values | {"ctr": round(values["clicks"] / values["impressions"] * 100, 2) if values["impressions"] else 0}


def report(db, start, end, ad_id="", placement="", page="", traffic="clean", sponsor_id=None):
    today = datetime.now(TZ).date()
    start, end = start or today - timedelta(days=29), end or today
    if end < start or (end - start).days >= 366:
        raise HTTPException(422, "请选择结束不早于开始、最多 366 天的日期范围")
    if (placement and placement not in advertising.SLOTS) or (page and page not in PAGE_LABELS):
        raise HTTPException(422, "页面或广告位置不正确")
    filters, args = ["day>=?", "day<=?"], [start.isoformat(), end.isoformat()]
    scope, scope_args = "", []
    if sponsor_id is not None:
        scope = "ad_id IN (SELECT a.ad_id FROM sponsor_ads a JOIN sponsor_accounts s ON s.id=a.account_id WHERE s.id=? AND s.enabled=1)"
        scope_args = [sponsor_id]
        filters.append(scope)
        args.extend(scope_args)
    for column, value in (("ad_id", ad_id), ("placement", placement), ("page", page)):
        if value:
            filters.append(column + "=?")
            args.append(value)
    where = " AND ".join(filters)
    measure = "SUM(kind='impression') impressions,SUM(kind='click') clicks,COUNT(DISTINCT visitor) visitors"
    with db.connect() as con:
        # Keep ownership, aggregates and historical options in one read snapshot.
        con.execute("BEGIN")
        def aggregate(group="", selected=True):
            condition = where + (" AND traffic=?" if selected and traffic != "all" else "")
            params = args + ([traffic] if selected and traffic != "all" else [])
            return con.execute("SELECT " + (group + "," if group else "") + measure + " FROM ad_traffic WHERE " + condition + (" GROUP BY " + group if group else ""), params).fetchall()
        summary = metrics(aggregate()[0])
        raw = metrics(aggregate(selected=False)[0])
        classes = {row["traffic"]: metrics(row) for row in con.execute("SELECT traffic," + measure + " FROM ad_traffic WHERE " + where + " GROUP BY traffic", args)}
        trends = {row["day"]: metrics(row) for row in aggregate("day")}
        pages = [{"page": row["page"], "label": PAGE_LABELS.get(row["page"], row["page"]), **metrics(row)} for row in aggregate("page")]
        slots = [{"placement": row["placement"], "label": advertising.SLOTS[row["placement"]]["label"], **metrics(row)} for row in aggregate("placement")]
        details = [dict(row) | metrics(row) for row in aggregate("ad_id,placement,page")]
        campaigns = {row["ad_id"]: metrics(row) for row in aggregate("ad_id")}
        history = {row["ad_id"]: row["ad_title"] for row in con.execute("SELECT ad_id,ad_title FROM ad_traffic" + (" WHERE " + scope if scope else "") + " GROUP BY ad_id,ad_title ORDER BY MAX(at)", scope_args)}
        records = db.list("ads", con)
        if sponsor_id is not None:
            owned = {r[0] for r in con.execute("SELECT a.ad_id FROM sponsor_ads a JOIN sponsor_accounts s ON s.id=a.account_id WHERE s.id=? AND s.enabled=1", (sponsor_id,))}
            records = [r for r in records if r["id"] in owned]
        started = con.execute("SELECT started FROM ad_traffic_meta WHERE id=1").fetchone()[0]
    options = {key: {"id": key, "title": title, "name": "已移除的广告", "deleted": True} for key, title in history.items()}
    options.update({r["id"]: {"id": r["id"], "title": r.get("title", ""), "name": r.get("name", ""), "placement": r.get("placement", ""), "deleted": False} for r in records})
    zero = {"impressions": 0, "clicks": 0, "visitors": 0, "ctr": 0}
    # Days before the module existed are unmeasured, rather than measured zeroes.
    days, cursor = [], max(start, datetime.fromtimestamp(started, TZ).date())
    while cursor <= end:
        days.append({"day": cursor.isoformat(), **trends.get(cursor.isoformat(), zero)})
        cursor += timedelta(days=1)
    ads = [r | campaigns.get(r["id"], zero) for r in options.values() if not ad_id or r["id"] == ad_id]
    return {"start": start.isoformat(), "end": end.isoformat(), "timezone": "Asia/Shanghai", "started_at": started,
            "traffic": traffic, "summary": summary, "raw": raw, "classes": {key: classes.get(key, zero) for key in ("clean", "automated", "internal", "unknown")},
            "trend": days, "pages": sorted(pages, key=lambda r: -r["impressions"]), "placements": slots,
            "ads": sorted(ads, key=lambda r: -r["impressions"]), "details": sorted(details, key=lambda r: (-r["impressions"], r["ad_id"], r["placement"], r["page"])),
            "options": {"ads": list(options.values()), "pages": PAGE_LABELS, "placements": {key: row["label"] for key, row in advertising.SLOTS.items()}}}


def register(app, db, session, active):
    with db.connect() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS ad_traffic_meta (id INTEGER PRIMARY KEY CHECK(id=1), started REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ad_traffic (
                at REAL NOT NULL, day TEXT NOT NULL, ad_id TEXT NOT NULL, ad_title TEXT NOT NULL,
                placement TEXT NOT NULL, page TEXT NOT NULL, kind TEXT NOT NULL,
                visitor TEXT NOT NULL, view_id TEXT NOT NULL, traffic TEXT NOT NULL, reason TEXT NOT NULL,
                PRIMARY KEY(view_id,ad_id,placement,page,kind)
            );
            CREATE INDEX IF NOT EXISTS ad_traffic_report ON ad_traffic(day,ad_id,placement,page,traffic);
            CREATE INDEX IF NOT EXISTS ad_traffic_rate ON ad_traffic(visitor,at);
            CREATE INDEX IF NOT EXISTS ad_traffic_ad ON ad_traffic(ad_id,day);
        """)
        con.execute("INSERT OR IGNORE INTO ad_traffic_meta VALUES(1,?)", (now(),))

    @app.post("/api/public/advertising/events")
    def collect(spec: Batch, request: Request):
        if request.headers.get("origin") != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "不允许跨站统计")
        cookie = request.cookies.get(COOKIE, "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{32,100}", cookie):
            raise HTTPException(403, "统计凭据已失效，请刷新页面")
        visitor, current = visitor_hash(db, cookie), now()
        accepted, duplicates, rejected = 0, 0, 0
        with db.connect(write=True) as con:
            if con.execute("SELECT COUNT(*) FROM ad_traffic WHERE visitor=? AND at>?", (visitor, current - 60)).fetchone()[0] >= 300:
                raise HTTPException(429, "统计请求过于频繁")
            for event in spec.events:
                try:
                    ticket = json.loads(db.cipher.decrypt(event.token.encode()).decode())
                except (InvalidToken, ValueError, UnicodeError):
                    rejected += 1
                    continue
                if not isinstance(ticket, dict) or ticket.get("visitor") != visitor or not isinstance(ticket.get("expires"), (int, float)) or ticket["expires"] < current or ticket.get("page") != event.page or event.page not in PAGE_LABELS:
                    rejected += 1
                    continue
                ad = db.get("ads", ticket.get("ad_id", ""), con)
                slot = ticket.get("placement")
                if not ad or not active(ad) or ad.get("booking_status", "published") != "published" or slot not in advertising.targets(ad):
                    rejected += 1
                    continue
                traffic, reason = classify(db, request, event.automated, con)
                row = con.execute("INSERT OR IGNORE INTO ad_traffic VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                    current, datetime.fromtimestamp(current, TZ).date().isoformat(), ticket["ad_id"], ad["title"], slot,
                    event.page, event.kind, visitor, event.view_id, traffic, reason))
                if row.rowcount:
                    accepted += 1
                else:
                    duplicates += 1
        return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}

    @app.get("/api/admin/advertising/analytics")
    def analytics(start: date | None = None, end: date | None = None, ad_id: str = "", placement: str = "", page: str = "",
                  traffic: Literal["clean", "all", "automated", "internal", "unknown"] = "clean", user=Depends(session)):
        return report(db, start, end, ad_id, placement, page, traffic)
