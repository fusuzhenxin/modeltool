"""Read-only advertiser accounts, separate from operations administrators."""
from __future__ import annotations

import csv
import io
import math
import secrets
from datetime import date, datetime
from typing import Literal

from fastapi import Depends, HTTPException, Request, Response
from pydantic import ConfigDict, Field

from . import ad_analytics, advertising
from .core import ROOT, digest, ident, now, password_hash, password_ok
from .models import Credentials, StrictModel

COOKIE = "modeltool_sponsor_session"
TRAFFIC = Literal["clean", "all", "automated", "internal", "unknown"]


class Account(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(default="", max_length=128)
    enabled: bool = True
    ad_ids: list[str] = Field(default_factory=list, max_length=500)


def register(app, db, admin_session):
    with db.connect() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS sponsor_accounts (
                id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                display_name TEXT NOT NULL, password TEXT NOT NULL, enabled INTEGER NOT NULL,
                created REAL NOT NULL, updated REAL NOT NULL, last_login REAL
            );
            CREATE TABLE IF NOT EXISTS sponsor_ads (ad_id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS sponsor_ads_account ON sponsor_ads(account_id);
            CREATE TABLE IF NOT EXISTS sponsor_sessions (
                token TEXT PRIMARY KEY, account_id TEXT NOT NULL, csrf TEXT NOT NULL, expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sponsor_login_attempts (address TEXT NOT NULL, username TEXT NOT NULL, at REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS sponsor_attempt_time ON sponsor_login_attempts(at);
        """)

    def session(request: Request):
        with db.connect() as con:
            row = con.execute("SELECT s.token,s.csrf,s.account_id,a.username,a.display_name FROM sponsor_sessions s JOIN sponsor_accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>? AND a.enabled=1", (digest(request.cookies.get(COOKIE, "")), now())).fetchone()
        if not row:
            raise HTTPException(401, "请先登录赞助商后台")
        if request.method not in ("GET", "HEAD") and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), row["csrf"]):
            raise HTTPException(403, "登录校验已失效，请刷新页面")
        return dict(row)

    @app.get("/api/admin/sponsors")
    def accounts(user=Depends(admin_session)):
        with db.connect() as con:
            rows = [dict(row) for row in con.execute("SELECT id,username,display_name,enabled,created,updated,last_login FROM sponsor_accounts ORDER BY created DESC")]
            bindings = dict(con.execute("SELECT ad_id,account_id FROM sponsor_ads"))
            ads = [{"id": r["id"], "title": r["title"], "placement": r["placement"], "deleted": False} for r in db.list("ads", con)]
            current_ids = {r["id"] for r in ads}
            for ad_id in bindings.keys() - current_ids:
                title = con.execute("SELECT ad_title FROM ad_traffic WHERE ad_id=? ORDER BY at DESC LIMIT 1", (ad_id,)).fetchone()
                ads.append({"id": ad_id, "title": title[0] if title else "已移除的广告", "placement": "", "deleted": True})
        return {"accounts": [r | {"enabled": bool(r["enabled"]), "ad_ids": [key for key, owner in bindings.items() if owner == r["id"]]} for r in rows],
                "ads": [r | {"account_id": bindings.get(r["id"], "")} for r in ads]}

    def save_account(spec, key, actor, create=False):
        if not spec.display_name.strip():
            raise HTTPException(422, "请填写站长或中转站名称")
        if (create or spec.password) and len(spec.password) < 12:
            raise HTTPException(422, "密码需为 12 至 128 个字符")
        with db.connect(write=True) as con:
            previous = con.execute("SELECT * FROM sponsor_accounts WHERE id=?", (key,)).fetchone()
            if not create and not previous:
                raise HTTPException(404, "赞助商账号不存在")
            if con.execute("SELECT 1 FROM sponsor_accounts WHERE username=? AND id!=?", (spec.username, key)).fetchone():
                raise HTTPException(409, "赞助商用户名已存在")
            ids = list(dict.fromkeys(spec.ad_ids))
            for ad_id in ids:
                owner = con.execute("SELECT account_id FROM sponsor_ads WHERE ad_id=?", (ad_id,)).fetchone()
                if owner and owner[0] != key:
                    raise HTTPException(409, "所选广告已归属其他账号，请先从原账号解除分配")
                if not db.get("ads", ad_id, con) and not (owner and owner[0] == key):
                    raise HTTPException(422, "所选广告不存在，请刷新后重试")
            secret = password_hash(spec.password) if spec.password else previous["password"]
            if create:
                con.execute("INSERT INTO sponsor_accounts VALUES(?,?,?,?,?,?,?,NULL)", (key, spec.username, spec.display_name.strip(), secret, spec.enabled, now(), now()))
            else:
                con.execute("UPDATE sponsor_accounts SET username=?,display_name=?,password=?,enabled=?,updated=? WHERE id=?", (spec.username, spec.display_name.strip(), secret, spec.enabled, now(), key))
            con.execute("DELETE FROM sponsor_ads WHERE account_id=?", (key,))
            con.executemany("INSERT INTO sponsor_ads VALUES(?,?)", [(ad_id, key) for ad_id in ids])
            if spec.password or not spec.enabled:
                con.execute("DELETE FROM sponsor_sessions WHERE account_id=?", (key,))
            db.audit(actor, "created_sponsor" if create else "updated_sponsor", key, con)
            if not create and spec.password:
                db.audit(actor, "reset_sponsor_password", key, con)
        return {"id": key, "username": spec.username, "display_name": spec.display_name.strip(), "enabled": spec.enabled, "ad_ids": ids}

    @app.post("/api/admin/sponsors")
    def create(spec: Account, user=Depends(admin_session)):
        return save_account(spec, ident(), user["username"], True)

    @app.put("/api/admin/sponsors/{key}")
    def update(key: str, spec: Account, user=Depends(admin_session)):
        return save_account(spec, key, user["username"])

    @app.get("/api/sponsor/session")
    def auth_state(request: Request):
        try:
            user = session(request)
        except HTTPException:
            return {"authenticated": False}
        return {"authenticated": True, **{key: user[key] for key in ("username", "display_name", "csrf")}}

    @app.post("/api/sponsor/login")
    def login(spec: Credentials, request: Request, response: Response):
        address = digest(request.client.host if request.client else "unknown")
        username = digest(spec.username.lower())
        with db.connect(write=True) as con:
            con.execute("DELETE FROM sponsor_login_attempts WHERE at<?", (now() - 900,))
            if con.execute("SELECT COUNT(*) FROM sponsor_login_attempts WHERE address=? OR username=?", (address, username)).fetchone()[0] >= 10:
                raise HTTPException(429, "登录尝试过多，请 15 分钟后再试")
            user = con.execute("SELECT * FROM sponsor_accounts WHERE username=?", (spec.username,)).fetchone()
            verified = password_ok(spec.password, user["password"] if user else "0" * 32 + ":" + "0" * 128)
            verified = verified and bool(user["enabled"])
            if not verified:
                con.execute("INSERT INTO sponsor_login_attempts VALUES(?,?,?)", (address, username, now()))
            else:
                con.execute("DELETE FROM sponsor_login_attempts WHERE address=? AND username=?", (address, username))
                token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
                con.execute("DELETE FROM sponsor_sessions WHERE expires<?", (now(),))
                con.execute("INSERT INTO sponsor_sessions VALUES(?,?,?,?)", (digest(token), user["id"], csrf, now() + 8 * 3600))
                con.execute("UPDATE sponsor_accounts SET last_login=? WHERE id=?", (now(), user["id"]))
        if not verified:
            raise HTTPException(401, "用户名或密码不正确，或账号已停用")
        response.set_cookie(COOKIE, token, httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=8 * 3600, path="/api/sponsor")
        return {"username": user["username"], "display_name": user["display_name"], "csrf": csrf}

    @app.post("/api/sponsor/logout")
    def logout(response: Response, user=Depends(session)):
        with db.connect(write=True) as con:
            con.execute("DELETE FROM sponsor_sessions WHERE token=?", (user["token"],))
        response.delete_cookie(COOKIE, path="/api/sponsor")
        return {"ok": True}

    @app.get("/api/sponsor/campaigns")
    def campaigns(user=Depends(session)):
        with db.connect() as con:
            ids = {r[0] for r in con.execute("SELECT ad_id FROM sponsor_ads WHERE account_id=?", (user["account_id"],))}
            rows = [r for r in db.list("ads", con) if r["id"] in ids]
        current = now()
        result = []
        for row in rows:
            start, end = advertising.bounds(row)
            status = row.get("booking_status", "published" if row.get("enabled") else "draft")
            if status == "published":
                status = "disabled" if not row.get("enabled") else "scheduled" if start > current else "expired" if end <= current else "live"
            result.append({key: row.get(key, "") for key in ("id", "title", "description", "image", "link", "order_code", "starts_at", "ends_at")} | {
                "status": status, "placements": [{"key": key, "label": advertising.SLOTS[key]["label"]} for key in advertising.targets(row)],
                "remaining_days": max(0, math.ceil((end - max(start, current)) / 86400)) if math.isfinite(end) else None})
        return {"campaigns": result}

    def analytics_data(user, start, end, ad_id, placement, page, traffic):
        if ad_id:
            with db.connect() as con:
                if not con.execute("SELECT 1 FROM sponsor_ads WHERE account_id=? AND ad_id=?", (user["account_id"], ad_id)).fetchone():
                    raise HTTPException(404, "广告不存在或未分配给当前账号")
        data = ad_analytics.report(db, start, end, ad_id, placement, page, traffic, sponsor_id=user["account_id"])
        # Internal order names and contacts are operations-only, even for the owner.
        for row in data["ads"] + data["options"]["ads"]:
            row["name"] = row["title"]
        return data

    @app.get("/api/sponsor/analytics")
    def analytics(start: date | None = None, end: date | None = None, ad_id: str = "", placement: str = "", page: str = "", traffic: TRAFFIC = "clean", user=Depends(session)):
        return analytics_data(user, start, end, ad_id, placement, page, traffic)

    @app.get("/api/sponsor/report.csv")
    def export(start: date | None = None, end: date | None = None, ad_id: str = "", placement: str = "", page: str = "", traffic: TRAFFIC = "clean", user=Depends(session)):
        data = analytics_data(user, start, end, ad_id, placement, page, traffic)
        titles = {r["id"]: r["title"] for r in data["options"]["ads"]}
        rows = [["开始日期", "结束日期", "流量口径", "广告标题", "所在页面", "页面路径", "展示位置", "曝光次数", "点击次数", "独立访客", "点击率%"]]
        rows += [[data["start"], data["end"], traffic, titles.get(r["ad_id"], ""), data["options"]["pages"][r["page"]], r["page"], data["options"]["placements"][r["placement"]], r["impressions"], r["clicks"], r["visitors"], r["ctr"]] for r in data["details"]]
        out = io.StringIO()
        writer = csv.writer(out, quoting=csv.QUOTE_ALL)
        for row in rows:
            writer.writerow(["'" + str(cell) if str(cell).lstrip().startswith(("=", "+", "-", "@")) else cell for cell in row])
        return Response("\ufeff" + out.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="sponsor-{data["start"]}-{data["end"]}.csv"'})

    @app.get("/sponsor", include_in_schema=False)
    @app.get("/sponsor/{path:path}", include_in_schema=False)
    def portal(path: str = ""):
        from fastapi.responses import FileResponse
        if path not in ("", "index.html", "portal.js", "portal.css"):
            raise HTTPException(404)
        return FileResponse(ROOT / "sponsor" / (path or "index.html"))
