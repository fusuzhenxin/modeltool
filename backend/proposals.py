"""Public nominations and discussion; never initiate paid tests or accept API keys."""
import hashlib
import hmac
import json
import re
import secrets
from typing import Literal
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from fastapi import Depends, HTTPException, Query, Request, Response
from pydantic import Field, field_validator

from .core import digest, ident, now
from .models import StrictModel, web_url

TESTS = {
    "site_basic": "基础测试", "site_ability": "模型能力测试", "site_logic": "逻辑推理测试",
    "site_code": "代码能力测试", "site_qa": "知识问答测试", "site_candy": "糖果测试",
    "site_relay": "中转站测试", "site_trace": "指纹测试", "site_pelican": "鹈鹕骑车", "site_all": "完整模型检测",
}
STATUSES = {"collecting": "征集中", "scheduled": "已排期", "testing": "测试中", "completed": "已完成", "deferred": "暂不处理"}
GUEST_COOKIE = "modeltool_visitor"


def public_text(value):
    if re.search(r"\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.-]{16,}", value, re.I):
        raise ValueError("请勿提交 API Key 或访问令牌，只填写公开信息")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in value):
        raise ValueError("内容不能包含控制字符")
    return value


class Nomination(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    website_url: str = Field(min_length=8, max_length=500)
    models: list[str] = Field(min_length=1, max_length=30)
    tests: list[str] = Field(min_length=1, max_length=10)
    description: str = Field(default="", max_length=2000)
    author: str = Field(default="热心访客", min_length=1, max_length=40)

    @field_validator("author", mode="before")
    @classmethod
    def nickname(cls, value):
        if isinstance(value, str):
            return value.strip() or "热心访客"
        return value

    @field_validator("website_url")
    @classmethod
    def website(cls, value):
        parsed = urlsplit(web_url(public_text(value)))
        host = parsed.hostname.lower().encode("idna").decode()
        # Public website only: no private endpoints, credentials or token-bearing links.
        if "." not in host or ":" in host or parsed.port not in (None, 80, 443):
            raise ValueError("请填写中转站的公开网站地址")
        import ipaddress
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise ValueError("请填写公网网站地址")
        if host.endswith((".localhost", ".local", ".internal")):
            raise ValueError("请填写公网网站地址")
        if any(key.lower() in ("key", "api_key", "token", "access_token", "authorization") for key, _ in parse_qsl(parsed.query)):
            raise ValueError("网址不能包含密钥或访问令牌")
        return urlunsplit((parsed.scheme, host, parsed.path.rstrip("/"), parsed.query, ""))

    @field_validator("name", "description", "author")
    @classmethod
    def text(cls, value):
        return public_text(value)

    @field_validator("models")
    @classmethod
    def model_ids(cls, values):
        values = list(dict.fromkeys(v.strip() for v in values))
        if any(not v or len(v) > 150 for v in values):
            raise ValueError("请填写有效的模型名称，每个不超过 150 字")
        return [public_text(v) for v in values]

    @field_validator("tests")
    @classmethod
    def test_ids(cls, values):
        if any(v not in TESTS for v in values):
            raise ValueError("请选择本站提供的检测项目")
        return list(dict.fromkeys(values))


class Comment(StrictModel):
    author: str = Field(default="热心访客", min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=1500)

    @field_validator("author", "content")
    @classmethod
    def text(cls, value):
        return public_text(value)


class Vote(StrictModel):
    supported: bool


class Moderation(StrictModel):
    status: Literal["collecting", "scheduled", "testing", "completed", "deferred"]
    visible: bool = True
    pinned: bool = False
    admin_note: str = Field(default="", max_length=2000)
    report_id: str = Field(default="", max_length=100)
    reply: str = Field(default="", max_length=1500)

    @field_validator("admin_note", "reply")
    @classmethod
    def text(cls, value):
        return public_text(value)


class CommentVisibility(StrictModel):
    visible: bool


def register_proposals(app, db, session):
    address_secret = (db.directory / "encryption.key").read_bytes()

    def identity(request, con):
        token = request.cookies.get(GUEST_COOKIE, "")
        visitor = digest(token) if token else ""
        return con.execute("SELECT * FROM proposal_visitors WHERE token=? AND expires>?", (visitor, now())).fetchone()

    def guest(request, con):
        row = identity(request, con)
        if not row or not secrets.compare_digest(request.headers.get("x-proposal-csrf", ""), row["csrf"]):
            raise HTTPException(403, "参与凭据已失效，请刷新页面后重试")
        return row["token"]

    def throttle(request, visitor, kind, limit, con):
        host = request.client.host if request.client else "unknown"
        address = hmac.new(address_secret, host.encode(), hashlib.sha256).hexdigest()
        con.execute("DELETE FROM proposal_activity WHERE created<?", (now() - 3600,))
        count = con.execute("SELECT COUNT(*) FROM proposal_activity WHERE kind=? AND (actor=? OR address=?)", (kind, visitor, address)).fetchone()[0]
        if count >= limit:
            raise HTTPException(429, "操作较频繁，请稍后再试")
        con.execute("INSERT INTO proposal_activity VALUES(?,?,?,?)", (visitor, address, kind, now()))

    def get_proposal(key, con, admin=False):
        row = con.execute("SELECT * FROM proposals WHERE id=?", (key,)).fetchone()
        if not row or (not admin and not json.loads(row["data"])["visible"]):
            raise HTTPException(404, "提案不存在或已隐藏")
        return row

    def report_available(key, con):
        report = db.get("reports", key, con) if key else None
        station = db.get("stations", report["station_id"], con) if report else None
        return bool(report and report["status"] == "published" and station and station["visible"])

    def serialize(row, visitor, con, admin=False):
        data = json.loads(row["data"])
        data.update(id=row["id"], domain=row["domain"], created=row["created"], updated=row["updated"])
        data["votes"] = con.execute("SELECT COUNT(*) FROM proposal_votes WHERE proposal_id=?", (row["id"],)).fetchone()[0]
        data["supported"] = bool(visitor and con.execute("SELECT 1 FROM proposal_votes WHERE proposal_id=? AND visitor=?", (row["id"], visitor)).fetchone())
        data["comment_count"] = con.execute("SELECT COUNT(*) FROM proposal_comments WHERE proposal_id=?" + ("" if admin else " AND visible=1"), (row["id"],)).fetchone()[0]
        if not admin and not report_available(data.get("report_id"), con):
            data["report_id"] = ""
        return data

    def comments(key, con, admin=False, page=1):
        condition = "proposal_id=?" + ("" if admin else " AND visible=1")
        total = con.execute("SELECT COUNT(*) FROM proposal_comments WHERE " + condition, (key,)).fetchone()[0]
        rows = [dict(r) for r in con.execute("SELECT id,author,content,official,visible,created FROM proposal_comments WHERE " + condition + " ORDER BY created DESC,id DESC LIMIT 30 OFFSET ?", (key, (page - 1) * 30))]
        return {"items": rows, "total": total, "page": page, "pages": max(1, (total + 29) // 30)}

    @app.get("/api/public/proposal-session")
    def participant(request: Request, response: Response):
        with db.connect(write=True) as con:
            row = identity(request, con)
            if not row:
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
                con.execute("DELETE FROM proposal_visitors WHERE expires<?", (now(),))
                con.execute("INSERT INTO proposal_visitors VALUES(?,?,?)", (digest(token), csrf, now() + 365 * 86400))
                response.set_cookie(GUEST_COOKIE, token, max_age=365 * 86400, httponly=True, secure=request.url.scheme == "https", samesite="strict", path="/")
            else:
                csrf = row["csrf"]
        return {"csrf": csrf, "tests": TESTS, "statuses": STATUSES}

    @app.get("/api/public/proposals")
    def listing(request: Request, q: str = Query(default="", max_length=150), status: str = "", sort: Literal["popular", "newest"] = "popular", page: int = Query(default=1, ge=1, le=100000)):
        if status and status not in STATUSES:
            raise HTTPException(422, "无效的提案状态")
        with db.connect() as con:
            viewer = identity(request, con)
            # Filter and paginate in SQLite; aggregate votes without loading every proposal.
            where, args = ["json_extract(p.data,'$.visible')=1"], []
            if status:
                where.append("json_extract(p.data,'$.status')=?"); args.append(status)
            if q:
                where.append("instr(lower(p.data || p.domain),lower(?))>0"); args.append(q)
            clause = " AND ".join(where)
            total = con.execute("SELECT COUNT(*) FROM proposals p WHERE " + clause, args).fetchone()[0]
            order = "json_extract(p.data,'$.pinned') DESC," + ("votes DESC," if sort == "popular" else "") + "p.created DESC,p.id DESC"
            rows = con.execute("SELECT p.*, (SELECT COUNT(*) FROM proposal_votes v WHERE v.proposal_id=p.id) votes FROM proposals p WHERE " + clause + " ORDER BY " + order + " LIMIT 12 OFFSET ?", [*args, (page - 1) * 12]).fetchall()
            stats = dict(con.execute("SELECT COUNT(*) proposals,COALESCE(SUM(json_extract(data,'$.status')='completed'),0) completed FROM proposals WHERE json_extract(data,'$.visible')=1").fetchone())
            stats["supporters"] = con.execute("SELECT COUNT(DISTINCT visitor) FROM proposal_votes v JOIN proposals p ON p.id=v.proposal_id WHERE json_extract(p.data,'$.visible')=1").fetchone()[0]
            return {"items": [serialize(r, viewer["token"] if viewer else "", con) for r in rows], "total": total, "page": page, "pages": max(1, (total + 11) // 12), "stats": stats}

    @app.post("/api/public/proposals")
    def nominate(spec: Nomination, request: Request):
        domain = urlsplit(spec.website_url).hostname.removeprefix("www.")
        with db.connect(write=True) as con:
            visitor = guest(request, con)
            duplicate = con.execute("SELECT * FROM proposals WHERE domain=?", (domain,)).fetchone()
            if duplicate:
                if not json.loads(duplicate["data"])["visible"]:
                    raise HTTPException(409, "这个站点的提案正在由管理员处理，暂不能重复提交")
                return {"id": duplicate["id"], "duplicate": True}
            throttle(request, visitor, "proposal", 5, con)
            key = ident()
            data = spec.model_dump() | {"status": "collecting", "visible": True, "pinned": False, "admin_note": "", "report_id": ""}
            con.execute("INSERT INTO proposals VALUES(?,?,?,?,?)", (key, domain, json.dumps(data, ensure_ascii=False), now(), now()))
        return {"id": key, "duplicate": False}

    @app.get("/api/public/proposals/{key}")
    def detail(key: str, request: Request, page: int = Query(default=1, ge=1, le=100000)):
        with db.connect() as con:
            viewer = identity(request, con)
            return {"proposal": serialize(get_proposal(key, con), viewer["token"] if viewer else "", con), "comments": comments(key, con, page=page)}

    @app.put("/api/public/proposals/{key}/vote")
    def vote(key: str, spec: Vote, request: Request):
        with db.connect(write=True) as con:
            visitor = guest(request, con); get_proposal(key, con)
            existing = bool(con.execute("SELECT 1 FROM proposal_votes WHERE proposal_id=? AND visitor=?", (key, visitor)).fetchone())
            if existing != spec.supported:
                throttle(request, visitor, "vote", 120, con)
                if spec.supported:
                    con.execute("INSERT INTO proposal_votes VALUES(?,?,?)", (key, visitor, now()))
                else:
                    con.execute("DELETE FROM proposal_votes WHERE proposal_id=? AND visitor=?", (key, visitor))
            return {"supported": spec.supported, "votes": con.execute("SELECT COUNT(*) FROM proposal_votes WHERE proposal_id=?", (key,)).fetchone()[0]}

    @app.post("/api/public/proposals/{key}/comments")
    def add_comment(key: str, spec: Comment, request: Request):
        with db.connect(write=True) as con:
            visitor = guest(request, con); get_proposal(key, con)
            throttle(request, visitor, "comment", 30, con)
            comment_id = ident()
            con.execute("INSERT INTO proposal_comments(id,proposal_id,author,content,created) VALUES(?,?,?,?,?)", (comment_id, key, spec.author, spec.content, now()))
        return {"id": comment_id}

    # Register before the application's generic /api/admin/{kind} routes.
    @app.get("/api/admin/proposals")
    def admin_list(user=Depends(session)):
        with db.connect() as con:
            return [serialize(r, "", con, True) for r in con.execute("SELECT * FROM proposals ORDER BY updated DESC")]

    @app.get("/api/admin/proposals/{key}")
    def admin_detail(key: str, page: int = Query(default=1, ge=1, le=100000), user=Depends(session)):
        with db.connect() as con:
            return {"proposal": serialize(get_proposal(key, con, True), "", con, True), "comments": comments(key, con, True, page)}

    @app.put("/api/admin/proposals/{key}")
    def moderate(key: str, spec: Moderation, user=Depends(session)):
        with db.connect(write=True) as con:
            row = get_proposal(key, con, True)
            if spec.report_id and not report_available(spec.report_id, con):
                raise HTTPException(422, "只能关联已公开且所属站点可见的报告")
            data = json.loads(row["data"]) | spec.model_dump(exclude={"reply"})
            con.execute("UPDATE proposals SET data=?,updated=? WHERE id=?", (json.dumps(data, ensure_ascii=False), now(), key))
            if spec.reply:
                con.execute("INSERT INTO proposal_comments(id,proposal_id,author,content,official,created) VALUES(?,?,?,?,1,?)", (ident(), key, "管理员", spec.reply, now()))
            db.audit(user["username"], "moderated_proposal", key, con)
        return {"ok": True}

    @app.put("/api/admin/proposals/{key}/comments/{comment_id}")
    def moderate_comment(key: str, comment_id: str, spec: CommentVisibility, user=Depends(session)):
        with db.connect(write=True) as con:
            get_proposal(key, con, True)
            result = con.execute("UPDATE proposal_comments SET visible=? WHERE id=? AND proposal_id=?", (spec.visible, comment_id, key))
            if not result.rowcount:
                raise HTTPException(404, "评论不存在")
            db.audit(user["username"], "moderated_comment", comment_id, con)
        return {"ok": True}
