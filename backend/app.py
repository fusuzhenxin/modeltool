from __future__ import annotations

import io
import json
import mimetypes
import os
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from PIL import Image, UnidentifiedImageError

from .core import Database, ROOT, day, digest, ident, now, password_hash, password_ok, public_report, safe_station
from .models import Ad, Announcement, Credentials, ModelDiscovery, PasswordChange, Review, Run, Schedule, ScheduleBatch, Settings, Setup, Station, StationOrder
from .worker import enqueue, validate_run
from . import advertising, ad_analytics, sponsors, mailing, station_traffic

MODELS = {"announcements": Announcement, "stations": Station, "ads": Ad, "schedules": Schedule}
COOKIE = "modeltool_session"


def active(row):
    current = now()
    def timestamp(value):
        return datetime.fromisoformat(value).timestamp() if value else None
    start, end = timestamp(row.get("starts_at")), timestamp(row.get("ends_at"))
    return row.get("enabled") and (start is None or start <= current) and (end is None or current < end)


def create_app(data_dir=None):
    db = Database(data_dir)
    app = FastAPI(title="ModelTool Operations", docs_url=None, redoc_url=None, openapi_url=None, lifespan=mailing.lifespan(db))
    app.state.db = db
    hosts = [x.strip() for x in os.environ.get("MODELTOOL_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]").split(",") if x.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's default response includes the submitted input, including passwords/keys.
        errors = [{"field": ".".join(str(v) for v in e["loc"] if v != "body"), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse({"detail": "请检查输入", "errors": errors}, status_code=422)

    @app.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, exc):
        return JSONResponse({"detail": "名称或记录已存在，请刷新后重试"}, status_code=409)

    @app.middleware("http")
    async def boundaries(request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            expected = str(request.base_url).rstrip("/")
            if origin and origin != expected:
                return JSONResponse({"detail": "不允许跨站提交"}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "不允许跨站提交"}, status_code=403)
            if not request.url.path.endswith("/media") and request.method != "DELETE" and "application/json" not in request.headers.get("content-type", ""):
                return JSONResponse({"detail": "请使用 JSON 提交"}, status_code=415)
            body, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 3 * 1024 * 1024:
                    return JSONResponse({"detail": "请求内容不能超过 3MB"}, status_code=413)
                body.append(chunk)
            request._body = b"".join(body)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY" if request.url.path.startswith(("/admin", "/sponsor")) else "SAMEORIGIN"
        if request.url.path.startswith(("/api/", "/admin", "/sponsor")):
            response.headers["Cache-Control"] = "no-store, no-transform" if response.headers.get("X-ModelTool-Stream") == "1" else "no-store"
        if request.url.path.startswith(("/admin", "/sponsor")):
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' http: https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.url.path.endswith("/artwork") and response.headers.get("content-type", "").startswith("text/html"):
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
            response.headers["Content-Security-Policy"] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        return response

    def session(request: Request):
        token = request.cookies.get(COOKIE, "")
        with db.connect() as con:
            row = con.execute("SELECT s.*,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?", (digest(token), now())).fetchone()
        if not row:
            raise HTTPException(401, "请先登录")
        if request.method not in ("GET", "HEAD") and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), row["csrf"]):
            raise HTTPException(403, "登录校验已失效，请刷新页面")
        return dict(row)

    def issue_session(user, response, request):
        token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
        with db.connect(write=True) as con:
            con.execute("DELETE FROM sessions WHERE expires<?", (now(),))
            con.execute("INSERT INTO sessions VALUES(?,?,?,?)", (digest(token), user["id"], csrf, now() + 8 * 3600))
        response.set_cookie(COOKIE, token, httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=8 * 3600, path="/")
        return {"username": user["username"], "csrf": csrf}

    @app.get("/api/auth/session")
    def auth_state(request: Request):
        try:
            state = session(request)
            return {"authenticated": True, "username": state["username"], "csrf": state["csrf"], "needs_setup": False}
        except HTTPException:
            needs_setup = not db.has_admin()
            state = {"authenticated": False, "needs_setup": needs_setup}
            # The loopback-only launcher can initialize without copying a console token.
            # Remote clients still need the one-time token from the local console.
            token_file = db.directory / "setup.token"
            if needs_setup and request.client and request.client.host in ("127.0.0.1", "::1") and token_file.exists():
                state["setup_token"] = token_file.read_text().strip()
            return state

    @app.post("/api/auth/setup")
    def setup(spec: Setup, request: Request, response: Response):
        token_file = db.directory / "setup.token"
        with db.connect(write=True) as con:
            if con.execute("SELECT 1 FROM users").fetchone():
                raise HTTPException(409, "管理员已经初始化")
            if not token_file.exists() or not secrets.compare_digest(spec.token, token_file.read_text().strip()):
                raise HTTPException(403, "初始化口令不正确，请使用本机启动窗口中的初始化链接")
            user = {"id": ident(), "username": spec.username}
            con.execute("INSERT INTO users VALUES(?,?,?)", (user["id"], user["username"], password_hash(spec.password)))
            db.audit(user["username"], "setup", "admin", con)
        token_file.unlink(missing_ok=True)
        return issue_session(user, response, request)

    @app.post("/api/auth/login")
    def login(spec: Credentials, request: Request, response: Response):
        address = request.client.host if request.client else "unknown"
        with db.connect(write=True) as con:
            con.execute("DELETE FROM login_attempts WHERE at<?", (now() - 900,))
            if con.execute("SELECT COUNT(*) FROM login_attempts WHERE address=?", (address,)).fetchone()[0] >= 10:
                raise HTTPException(429, "登录尝试过多，请 15 分钟后再试")
            user = con.execute("SELECT * FROM users WHERE username=?", (spec.username,)).fetchone()
            verified = password_ok(spec.password, user["password"] if user else "0" * 32 + ":" + "0" * 128)
            if not verified:
                con.execute("INSERT INTO login_attempts VALUES(?,?)", (address, now()))
            else:
                con.execute("DELETE FROM login_attempts WHERE address=?", (address,))
        if not verified:
            raise HTTPException(401, "用户名或密码不正确")
        db.audit(user["username"], "login", "admin")
        return issue_session(user, response, request)

    @app.post("/api/auth/logout")
    def logout(response: Response, user=Depends(session)):
        with db.connect(write=True) as con:
            con.execute("DELETE FROM sessions WHERE token=?", (user["token"],))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @app.post("/api/auth/password")
    def change_password(spec: PasswordChange, response: Response, user=Depends(session)):
        with db.connect(write=True) as con:
            row = con.execute("SELECT password FROM users WHERE id=?", (user["user_id"],)).fetchone()
            if not password_ok(spec.current_password, row[0]):
                raise HTTPException(400, "当前密码不正确")
            con.execute("UPDATE users SET password=? WHERE id=?", (password_hash(spec.new_password), user["user_id"]))
            con.execute("DELETE FROM sessions WHERE user_id=?", (user["user_id"],))
            db.audit(user["username"], "password_changed", "admin", con)
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    def list_jobs(limit=300):
        with db.connect() as con:
            rows = [dict(r) for r in con.execute("SELECT * FROM jobs WHERE json_extract(config,'$.execution_id') IS NULL ORDER BY created DESC LIMIT ?", (limit,))]
            for row in rows:
                row["exclusion"] = db.get("job_exclusions", row["id"], con)
                row["kind"] = json.loads(row.pop("config"))["kind"]
                row["scores"] = []
                report = db.get("reports", row["report_id"], con) if row["status"] == "done" and row["report_id"] else None
                if not report:
                    continue
                result = report["result"]
                for label, value in (
                    ("接口功能", result.get("score")),
                    ("糖果" if row["kind"] == "site_candy" else "能力", (result.get("ability") or {}).get("score")),
                    ("作品结构", (result.get("artwork") or {}).get("score")),
                ):
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        row["scores"].append({"label": label, "value": value})
            from .executions import describe
            keys = con.execute("SELECT id FROM entities WHERE kind='executions' ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
            rows.extend(describe(db, row[0], con) for row in keys)
        return sorted(rows, key=lambda row: row["created"], reverse=True)[:limit]

    @app.get("/api/admin/test-options")
    def test_options(user=Depends(session)):
        from .runner import RunStopped
        from .site_tests import catalog
        try:
            return catalog()
        except RunStopped as exc:
            raise HTTPException(503, str(exc)) from None

    @app.get("/api/admin/dashboard")
    def dashboard(user=Depends(session)):
        with db.connect() as con:
            usage = dict(con.execute("SELECT COUNT(*) AS calls,COALESCE(SUM(tokens),0) AS tokens,COALESCE(SUM(CASE WHEN actual=0 THEN 1 ELSE 0 END),0) AS estimated_calls FROM usage WHERE day=?", (day(),)).fetchone())
            counts = {r["status"]: r["count"] for r in con.execute("""SELECT status,count(*) AS count FROM (
                SELECT CASE WHEN sum(status='running')>0 THEN 'running' WHEN sum(status='queued')>0 THEN 'queued'
                    WHEN sum(status='done')=count(*) THEN 'done' WHEN sum(status='done')>0 THEN 'partial'
                    WHEN sum(status='failed')>0 THEN 'failed' WHEN sum(status='interrupted')>0 THEN 'interrupted' ELSE 'cancelled' END AS status
                FROM jobs GROUP BY coalesce(json_extract(config,'$.execution_id'),id)) GROUP BY status""")}
            worker = con.execute("SELECT heartbeat FROM worker WHERE id=1").fetchone()
            audit = [dict(r) for r in con.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 20")]
        reports = list(db.report_rows(summary=True))
        return {"day": day(), "usage": usage, "jobs": counts, "stations": len(db.list("stations")), "reports": {state: sum(r["status"] == state for r in reports) for state in ("draft", "published", "rejected")}, "settings": db.get("settings", "site"), "worker": {"online": bool(worker and now() - worker[0] < 100), "heartbeat": worker[0] if worker else None}, "recent_jobs": list_jobs(6), "audit": audit}

    @app.get("/api/admin/settings")
    def get_settings(user=Depends(session)):
        return db.get("settings", "site")

    @app.put("/api/admin/settings")
    def put_settings(spec: Settings, user=Depends(session)):
        with db.connect(write=True) as con:
            data = spec.model_dump()
            if "output_token_limit" not in spec.model_fields_set:
                data["output_token_limit"] = db.get("settings", "site", con).get("output_token_limit")
            db.save("settings", "site", data, con)
            db.audit(user["username"], "settings_updated", "site", con)
        return spec

    @app.get("/api/admin/jobs")
    def jobs(user=Depends(session)):
        return list_jobs()

    @app.get("/api/admin/jobs/{key}")
    def execution_detail(key: str, user=Depends(session)):
        from .executions import describe
        with db.connect() as con:
            result = describe(db, key, con, details=True)
        if result is None:
            raise HTTPException(404, "组合执行记录不存在")
        return result

    @app.post("/api/admin/jobs")
    def add_job(spec: Run, user=Depends(session)):
        try:
            return {"id": enqueue(db, spec.model_dump(), user["username"])}
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/admin/jobs/{key}/publish")
    def publish_execution(key: str, user=Depends(session)):
        from .executions import action
        with db.connect(write=True) as con:
            try:
                action(db, key, "publish", user["username"], con)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from None
        return {"ok": True}

    @app.post("/api/admin/jobs/{key}/cancel")
    def cancel_job(key: str, user=Depends(session)):
        with db.connect(write=True) as con:
            if db.get("executions", key, con):
                from .executions import action
                try:
                    action(db, key, "cancel", user["username"], con)
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from None
                return {"ok": True}
            row = con.execute("SELECT status FROM jobs WHERE id=?", (key,)).fetchone()
            if not row:
                raise HTTPException(404, "任务不存在")
            if row[0] not in ("queued", "running"):
                raise HTTPException(409, "任务已经结束")
            con.execute("UPDATE jobs SET cancel=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,ended=CASE WHEN status='queued' THEN ? ELSE ended END WHERE id=?", (now(), key))
            db.audit(user["username"], "job_cancelled", key, con)
        return {"ok": True}

    @app.post("/api/admin/jobs/{key}/retry")
    def retry_job(key: str, user=Depends(session)):
        with db.connect(write=True) as con:
            if db.get("executions", key, con):
                from .executions import action
                try:
                    return {"id": action(db, key, "retry", user["username"], con)}
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from None
            row = con.execute("SELECT * FROM jobs WHERE id=?", (key,)).fetchone()
            if not row:
                raise HTTPException(404, "任务不存在")
            if row["status"] not in ("failed", "interrupted", "cancelled"):
                raise HTTPException(409, "只能重试失败、取消或中断的任务")
            try:
                new_key = enqueue(db, {"station_id": row["station_id"], "model": row["model"], **json.loads(row["config"])}, user["username"], con=con)
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
        return {"id": new_key}

    @app.get("/api/admin/reports")
    def reports(user=Depends(session)):
        return [{k: v for k, v in r.items() if k != "result"} | {"model": r["result"]["model"], "time": r["result"]["time"], "level": r["result"]["level"], "score": r["result"].get("score"), "ability": r["result"].get("ability"), "identity": r["result"].get("identity"), "test_name": r["result"].get("test_name"), "kind": r["result"].get("kind"), "artwork": {k: v for k, v in r["result"].get("artwork", {}).items() if k != "html"}} for r in db.report_rows(summary=True)]

    def artwork_response(key, public=False):
        row = db.get("reports", key)
        station = db.get("stations", row["station_id"]) if row else None
        if not row or (public and (row["status"] != "published" or not station or not station["visible"])):
            raise HTTPException(404, "作品不存在或未公开")
        html = row["result"].get("artwork", {}).get("html")
        if not html:
            raise HTTPException(404, "没有完整作品")
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})

    @app.get("/api/admin/reports/{key}/artwork")
    def admin_artwork(key: str, user=Depends(session)):
        return artwork_response(key)

    @app.get("/api/public/reports/{key}/artwork")
    def public_artwork(key: str):
        return artwork_response(key, public=True)

    @app.get("/api/admin/reports/{key}")
    def report_detail(key: str, user=Depends(session)):
        row = db.get("reports", key)
        if not row:
            raise HTTPException(404, "报告不存在")
        from .report_quality import normalize_report
        return dict(row, id=key, result=normalize_report(row["result"]))

    @app.put("/api/admin/reports/{key}")
    def review_report(key: str, spec: Review, user=Depends(session)):
        with db.connect(write=True) as con:
            row = db.get("reports", key, con)
            if not row:
                raise HTTPException(404, "报告不存在")
            station = db.get("stations", row["station_id"], con)
            if spec.status == "published" and row.get("excluded_reason") == "billing":
                raise HTTPException(422, "余额不足的无效检测报告不能公开，请充值后重新检测")
            if spec.status == "published" and (not station or not station["visible"]):
                raise HTTPException(409, "请先将该中转站设为公开，再发布报告")
            row.update(spec.model_dump(), reviewed_by=user["username"], reviewed_at=now())
            db.save("reports", key, row, con)
            db.audit(user["username"], "report_" + spec.status, key, con)
        return dict(row, id=key)

    @app.post("/api/admin/media")
    async def upload(request: Request, user=Depends(session)):
        raw = await request.body()
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(413, "图片不能超过 2MB")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > 12000000:
                    raise ValueError()
                image.thumbnail((1600, 1600))
                image = image.convert("RGBA")
                key = ident() + ".webp"
                image.save(db.uploads / key, format="WEBP", quality=88)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(422, "请上传有效的 PNG、JPEG 或 WebP 图片，最大 1200 万像素")
        db.audit(user["username"], "media_uploaded", key)
        return {"url": "/media/" + key}

    @app.post("/api/admin/stations/discover-models")
    def discover_models(spec: ModelDiscovery, user=Depends(session)):
        key = spec.api_key
        if not key and spec.station_id:
            stored = db.get("stations", spec.station_id)
            if not stored:
                raise HTTPException(404, "中转站不存在，请重新打开编辑窗口")
            from .station_keys import entries, connection_for_key
            pool = entries(stored)
            selected = next((item for item in pool if item["id"] == spec.key_id), None) if spec.key_id else next((item for item in pool if item["enabled"]), None)
            if not selected:
                raise HTTPException(422, "请选择已保存的 Key，或填写新的密钥")
            if connection_for_key(stored, selected)["base_url"].rstrip("/") != spec.base_url:
                raise HTTPException(422, "此 Key 的接口地址已修改，请重新输入密钥后识别")
            key = db.decrypt(selected["cipher"])
        if not key:
            raise HTTPException(422, "请先填写检测专用密钥，再识别模型")
        from .catalog import discover
        try:
            return discover(spec.base_url, spec.protocol, key)
        except ValueError as exc:
            raise HTTPException(422, str(exc).replace(key, "[已移除密钥]")) from None
        except Exception:
            raise HTTPException(502, "无法读取模型列表，请检查公网地址、网络和密钥，或手动填写模型 ID") from None

    from .proposals import register_proposals
    mailing.register_mail(app, db, session)
    register_proposals(app, db, session)

    def resource(kind):
        if kind not in MODELS:
            raise HTTPException(404, "没有这个管理模块")
        return MODELS[kind]

    def prepare_schedule(data, con, previous=None):
        linked = db.get("stations", data["station_id"], con)
        if not linked or any(model not in linked["models"] for model in data.get("models") or [data["model"]]):
            raise HTTPException(422, "定时计划必须选择已登记的中转站与模型")
        try:
            validate_run(db, data, con)
        except ValueError as exc:
            # A paused plan may be stored before its credential is configured.
            if data["enabled"]:
                raise HTTPException(409, f"{linked['name']}：{exc}") from exc
        from .scheduling import initial_run
        changed = not previous or any(data.get(k, default) != previous.get(k, default) for k, default in
                                     (("schedule_mode", "interval"), ("daily_time", ""), ("first_run", None), ("interval_minutes", 360), ("enabled", True)))
        data["next_run"] = initial_run(data)
        if data.get("schedule_mode") == "once" and changed and data["enabled"] and data["next_run"] <= now():
            raise HTTPException(422, "单次执行时间须晚于当前时间，请选择新的日期和时间")
        if not changed:
            data["next_run"] = previous["next_run"]
            if previous.get("completed_at"):
                data["completed_at"] = previous["completed_at"]
        else:
            data.pop("completed_at", None)
        data["last_error"] = (previous or {}).get("last_error", "")
        fields = ("models", "kinds", "model", "kind", "difficulty", "count", "candy_count", "pelican_mode", "publish_mode")
        data["version"] = (previous or {}).get("version", 1) + int(bool(previous) and any(data.get(k) != previous.get(k) for k in fields))
        return data

    from .bulk import register_bulk
    register_bulk(app, db, session, prepare_schedule)

    @app.post("/api/admin/schedules/batch")
    def create_schedule_batch(spec: ScheduleBatch, user=Depends(session)):
        # Keep the whole batch atomic: a failed station must not leave partial plans.
        with db.connect(write=True) as con:
            plans = [prepare_schedule(item.model_dump(mode="json"), con) for item in spec.schedules]
            saved = []
            for plan in plans:
                key = ident()
                saved.append(db.save("schedules", key, plan, con))
                db.audit(user["username"], "created_schedules", key, con)
        return {"count": len(saved), "schedules": saved}

    @app.put("/api/admin/stations/{key}/order")
    def update_station_order(key: str, spec: StationOrder, user=Depends(session)):
        with db.connect(write=True) as con:
            station = db.get("stations", key, con)
            if not station:
                raise HTTPException(404, "中转站不存在")
            station["order"] = spec.order
            db.save("stations", key, station, con)
            db.audit(user["username"], "updated_station_order", key, con)
        return {"ok": True, "order": spec.order}

    advertising.register(app, db, session)
    ad_analytics.register(app, db, session, active)
    sponsors.register(app, db, session)
    station_traffic.register(app, db, session)

    @app.get("/api/admin/{kind}")
    def get_items(kind: str, user=Depends(session)):
        resource(kind)
        rows = db.list(kind)
        if kind == "stations":
            return [safe_station(r) | {"order": r.get("order", 0)} for r in sorted(rows, key=lambda r: (r.get("order", 0), r["domain"]))]
        return rows

    async def save_item(kind, key, request, user, create=False):
        model = resource(kind)
        try:
            spec = model.model_validate(await request.json())
        except Exception as exc:
            from pydantic import ValidationError
            if isinstance(exc, ValidationError):
                errors = [{"field": ".".join(str(v) for v in e["loc"]), "message": e["msg"]} for e in exc.errors()]
                return JSONResponse({"detail": "请检查输入", "errors": errors}, status_code=422)
            raise HTTPException(422, "请输入有效的 JSON 数据") from exc
        data = spec.model_dump(mode="json")
        with db.connect(write=True) as con:
            previous = db.get(kind, key, con)
            if not create and not previous:
                raise HTTPException(404, "记录不存在")
            if kind == "stations":
                data["domain"] = urlsplit(data["base_url"]).netloc.lower()
                if previous and data["domain"] != previous["domain"]:
                    has_history = con.execute("SELECT 1 FROM jobs WHERE station_id=? LIMIT 1", (key,)).fetchone() or any(r["station_id"] == key for r in db.list("reports", con))
                    if has_history:
                        raise HTTPException(409, "已有检测历史的站点不能更换域名，请为新域名添加独立中转站")
                duplicate = [r for r in db.list(kind, con) if r["domain"] == data["domain"] and r["id"] != key]
                if duplicate:
                    raise HTTPException(409, "这个完整域名已登记，请编辑现有中转站")
                from .station_keys import save_keys
                try:
                    save_keys(db, data, previous)
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from None
            if kind == "schedules":
                prepare_schedule(data, con, previous)
            if kind == "ads":
                advertising.validate_booking(db, data, key, con)
                data["created_at"] = previous.get("created_at") if previous else datetime.now().astimezone().isoformat()
                data["updated_at"] = datetime.now().astimezone().isoformat()
                data["order_code"] = previous.get("order_code", "AD-" + key[:10].upper()) if previous else "AD-" + key[:10].upper()
                advertising.record_event(db, key, previous, data, user["username"], con, "created" if create else "updated")
            saved = db.save(kind, key, data, con)
            db.audit(user["username"], ("created_" if create else "updated_") + kind, key, con)
        return safe_station(saved) if kind == "stations" else saved

    @app.post("/api/admin/{kind}")
    async def create_item(kind: str, request: Request, user=Depends(session)):
        return await save_item(kind, ident(), request, user, True)

    @app.put("/api/admin/{kind}/{key}")
    async def update_item(kind: str, key: str, request: Request, user=Depends(session)):
        return await save_item(kind, key, request, user)

    @app.delete("/api/admin/{kind}/{key}")
    def delete_item(kind: str, key: str, user=Depends(session)):
        resource(kind)
        with db.connect(write=True) as con:
            if not db.get(kind, key, con):
                raise HTTPException(404, "记录不存在")
            if kind == "ads":
                ad = db.get(kind, key, con)
                if advertising.reserves(ad) or ad.get("received_cents") or ad.get("contract_cents"):
                    raise HTTPException(409, "已预订或有金额记录的广告请取消投放并保留账目，不能直接删除")
                advertising.record_event(db, key, ad, None, user["username"], con, "deleted")
            if kind == "stations":
                in_use = con.execute("SELECT 1 FROM jobs WHERE station_id=? AND status IN ('queued','running')", (key,)).fetchone()
                has_reports = any(r["station_id"] == key for r in db.list("reports", con))
                has_plans = any(r["station_id"] == key for r in db.list("schedules", con))
                if in_use or has_reports or has_plans:
                    raise HTTPException(409, "该站点有关联任务、计划或报告，请改为隐藏/暂停，保留历史记录")
            con.execute("DELETE FROM entities WHERE kind=? AND id=?", (kind, key))
            db.audit(user["username"], "deleted_" + kind, key, con)
        return {"ok": True}

    @app.get("/api/public/bootstrap")
    def public_bootstrap(request: Request, response: Response, summary: bool = False, report_id: str | None = None, content_only: bool = False, reports_only: bool = False):
        # Independent views need published site content without loading detection history.
        stations = {} if content_only else {r["id"]: r for r in db.list("stations") if r["visible"]}
        reports = [] if content_only else [public_report(r, stations[r["station_id"]]) for r in db.report_rows(summary=summary, key=report_id, published=True) if r["station_id"] in stations]
        if summary:
            # Lists and the homepage need conclusions, not every answer/check in every report.
            reports = [{k: v for k, v in report.items() if k not in ("checks", "sections", "conditions", "retest", "findings")} for report in reports]
        # Only the lightweight content request issues ad cookies/tickets on first visit.
        announcements = [] if reports_only else sorted((r for r in db.list("announcements") if active(r)), key=lambda r: (not r["pinned"], r["order"]))
        ads = [] if reports_only else ad_analytics.public_ads(db, request, response, advertising.public_ads(db, active))
        return {"mode": "live", "stations": [{k: r.get(k, "") for k in ("id", "name", "domain", "description", "logo", "models", "website_url")} | {"order": r.get("order", 0)} for r in sorted(stations.values(), key=lambda r: (r.get("order", 0), r["domain"]))], "reports": reports, "announcements": announcements, "ads": ads}

    @app.get("/api/public/stability")
    def public_stability(model: str = "", test: str = ""):
        if len(model) > 150 or len(test) > 64:
            raise HTTPException(422, "筛选条件过长")
        from .stability import snapshot
        return snapshot(db, model, test)

    @app.get("/api/health")
    def health():
        with db.connect() as con:
            con.execute("SELECT 1").fetchone()
        return {"ok": True, "service": "modeltool-operations", "schema": 1}

    @app.get("/api/status")
    async def status(request: Request):
        import serve
        code, body = await run_in_threadpool(serve.api_status, request.url.query)
        return Response(body, code, media_type="application/json")

    @app.post("/api/{legacy}")
    async def legacy_proxy(legacy: str, request: Request):
        if legacy not in ("chat", "probe"):
            raise HTTPException(404, "接口不存在")
        from .proxy import forward_browser
        return await run_in_threadpool(forward_browser, legacy, await request.body())

    @app.get("/media/{filename}")
    def media(filename: str):
        import re
        if not re.fullmatch(r"[a-f0-9]{24}\.webp", filename) or not (db.uploads / filename).is_file():
            raise HTTPException(404, "图片不存在")
        return FileResponse(db.uploads / filename, media_type="image/webp", headers={"Cache-Control": "public,max-age=86400"})

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{path:path}", include_in_schema=False)
    def admin(path: str = ""):
        name = path or "index.html"
        if name not in ("index.html", "admin.css", "admin.js", "select.js", "models.js", "keys.js", "schedules.js", "executions.js", "bulk.js", "ads.js", "ad-ops.js", "ad-analytics.js", "sponsors.js", "applications.js", "mail.js", "station-traffic.js", "station-traffic.css"):
            raise HTTPException(404)
        return FileResponse(ROOT / "admin" / name)

    @app.get("/{path:path}", include_in_schema=False)
    def static(request: Request, path: str):
        path = path or "index.html"
        full = (ROOT / path).resolve()
        if ROOT not in full.parents or not full.is_file() or any(part.startswith(".") for part in Path(path).parts):
            raise HTTPException(404)
        root_file = len(Path(path).parts) == 1 and (full.suffix in (".html", ".ico") or path in ("robots.txt", "sitemap.xml", "llms.txt"))
        asset = Path(path).parts[0] in ("js", "css", "assets", "works", "data") and full.suffix.lower() in (".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff2", ".json", ".html")
        if not (root_file or asset):
            raise HTTPException(404)
        if full.suffix in (".html", ".xml") or path in ("robots.txt", "llms.txt"):
            text = full.read_text(encoding="utf-8").replace("__SITE_ORIGIN__", str(request.base_url).rstrip("/"))
            if path == "sitemap.xml":
                from .public_pages import sitemap
                return Response(sitemap(db, text), media_type="application/xml", headers={"Cache-Control": "no-store"})
            if full.suffix == ".html":
                if path in ("relays.html", "stations.html"):
                    from .public_pages import render
                    text = render(db, text, path, request.query_params)
                    if text is None:
                        raise HTTPException(404, "公开记录不存在")
                text = text.replace("</head>", '<meta name="modeltool-backend" content="live"></head>')
                return HTMLResponse(text, headers={"Cache-Control": "no-store"})
            return Response(text, media_type=mimetypes.guess_type(str(full))[0] or "text/plain")
        return FileResponse(full)

    return app
