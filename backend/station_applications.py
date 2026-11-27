"""Private station enrollment requests; credentials never enter public site data."""
import ipaddress
import json
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Query, Request
from pydantic import ConfigDict, Field, field_validator, model_validator

from .core import ident, now
from .models import Station, StrictModel, web_url
from .station_keys import save_keys
from . import mailing

KIND = "station_applications"
STATES = ("pending", "reviewing", "approved", "rejected")


def public_url(value):
    value = web_url(value, endpoint=True)
    host = urlsplit(value).hostname or ""
    if host == "localhost" or host.endswith((".localhost", ".local")):
        raise ValueError("请填写中转站的公网地址")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return value
    if not address.is_global:
        raise ValueError("请填写中转站的公网地址")
    return value


class Application(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    name: str = Field(min_length=1, max_length=80)
    website_url: str = Field(min_length=8, max_length=500)
    login_url: str = Field(min_length=8, max_length=500)
    username: str = Field(min_length=1, max_length=250)
    password: str = Field(min_length=1, max_length=500)
    contact: str = Field(default="", max_length=250)
    email: str = Field(default="", max_length=254)
    notes: str = Field(default="", max_length=2000)
    consent: Literal[True]
    company: str = Field(default="", max_length=100)  # Invisible spam trap.

    @field_validator("email")
    @classmethod
    def notification_email(cls, value):
        return mailing.email_address(value) if value else ""

    @model_validator(mode="after")
    def contact_required(self):
        if not self.email and not self.contact:
            raise ValueError("请填写通知邮箱或有效联系方式")
        return self

    @field_validator("name", "username", "contact", "notes", "company", mode="before")
    @classmethod
    def trimmed(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(ord(c) < 32 and c not in "\n\t\r" for c in value):
                raise ValueError("请勿包含控制字符")
        return value

    @field_validator("website_url", "login_url")
    @classmethod
    def url(cls, value):
        return public_url(value.strip())

    @field_validator("password")
    @classmethod
    def password_text(cls, value):
        if not value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("请提供有效的探测账号密码")
        return value


class Decision(StrictModel):
    status: Literal["pending", "reviewing", "approved", "rejected"]
    note: str = Field(default="", max_length=2000)
    base_url: str = Field(default="", max_length=500)
    models: list[str] = Field(default_factory=list, max_length=30)
    protocol: Literal["openai", "anthropic"] = "openai"


def safe(row):
    fields = ("id", "name", "domain", "website_url", "login_url", "contact", "email", "notes",
              "status", "created_at", "reviewed_at", "reviewed_by", "note", "station_id")
    return {key: row.get(key, "") for key in fields} | {"has_credentials": bool(row.get("credentials_cipher"))}


def register_station_applications(app, db, session, guest, throttle):
    def record(key, con):
        row = db.get(KIND, key, con)
        if not row:
            raise HTTPException(404, "收录申请不存在")
        return row | {"id": key}

    @app.post("/api/public/station-applications", status_code=201)
    def submit(spec: Application, request: Request):
        with db.connect(write=True) as con:
            visitor = guest(request, con)
            throttle(request, visitor, "station_application", 3, con)
            if spec.company:
                raise HTTPException(422, "申请提交失败，请刷新后重试")
            domain = urlsplit(spec.website_url).hostname.lower().removeprefix("www.")
            duplicate = con.execute("SELECT 1 FROM entities WHERE kind=? AND json_extract(data,'$.domain')=? AND json_extract(data,'$.status') IN ('pending','reviewing') LIMIT 1", (KIND, domain)).fetchone()
            if duplicate:
                raise HTTPException(409, "这个中转站已有待处理申请，请勿重复提交")
            key = ident()
            credentials = json.dumps({"username": spec.username, "password": spec.password}, ensure_ascii=False)
            data = {"name": spec.name, "domain": domain, "website_url": spec.website_url,
                    "login_url": spec.login_url, "contact": spec.contact, "email": spec.email, "notes": spec.notes,
                    "consent": True, "credentials_cipher": db.encrypt(credentials),
                    "status": "pending", "created_at": now(), "station_id": "", "note": ""}
            db.save(KIND, key, data, con)
            db.audit("public-applicant", "station_application_submitted", key, con)
            mailing.submitted(db, data, key, con)
            mail_enabled = mailing.config(db, con)["enabled"]
        return {"id": key, "status": "pending", "mail_enabled": mail_enabled}

    @app.get("/api/admin/station-applications")
    def listing(q: str = Query(default="", max_length=150), status: str = "",
                page: int = Query(default=1, ge=1, le=100000), user=Depends(session)):
        if status and status not in STATES:
            raise HTTPException(422, "申请状态无效")
        where, args = ["kind=?"], [KIND]
        if status:
            where.append("json_extract(data,'$.status')=?"); args.append(status)
        if q:
            where.append("instr(lower(json_extract(data,'$.name') || ' ' || json_extract(data,'$.domain') || ' ' || json_extract(data,'$.contact') || ' ' || coalesce(json_extract(data,'$.email'),'')),lower(?))>0"); args.append(q)
        clause = " AND ".join(where)
        with db.connect() as con:
            total = con.execute("SELECT count(*) FROM entities WHERE " + clause, args).fetchone()[0]
            rows = con.execute("SELECT id,data FROM entities WHERE " + clause + " ORDER BY created DESC,id DESC LIMIT 20 OFFSET ?", [*args, (page-1)*20]).fetchall()
            counts = {r[0]: r[1] for r in con.execute("SELECT json_extract(data,'$.status'),count(*) FROM entities WHERE kind=? GROUP BY json_extract(data,'$.status')", (KIND,))}
        return {"items": [safe(json.loads(r["data"]) | {"id": r["id"]}) for r in rows], "total": total, "page": page, "pages": max(1, (total+19)//20), "counts": counts}

    @app.get("/api/admin/station-applications/{key}")
    def detail(key: str, user=Depends(session)):
        with db.connect() as con:
            return safe(record(key, con))

    @app.post("/api/admin/station-applications/{key}/credentials")
    def credentials(key: str, user=Depends(session)):
        with db.connect(write=True) as con:
            row = record(key, con)
            result = json.loads(db.decrypt(row["credentials_cipher"]))
            db.audit(user["username"], "station_application_credentials_viewed", key, con)
        return result

    @app.put("/api/admin/station-applications/{key}")
    def review(key: str, spec: Decision, user=Depends(session)):
        with db.connect(write=True) as con:
            row = record(key, con)
            previous_status = row["status"]
            if row["status"] == "approved" and spec.status != "approved":
                raise HTTPException(409, "已建站的申请请到中转站管理中处理")
            if spec.status == "approved" and not row.get("station_id"):
                if not spec.base_url or not spec.models:
                    raise HTTPException(422, "通过并建站前，请填写接口地址和至少一个实际模型 ID")
                try:
                    base_url = public_url(spec.base_url)
                    station = Station(name=row["name"], website_url=row["website_url"], base_url=base_url,
                                      models=spec.models, protocol=spec.protocol, visible=False, enabled=False).model_dump(mode="json")
                except ValueError:
                    raise HTTPException(422, "请检查公网接口地址与模型 ID，最多支持 30 个模型") from None
                domain = urlsplit(station["base_url"]).netloc.lower()
                if any(s["domain"] == domain for s in db.list("stations", con)):
                    raise HTTPException(409, "此接口域名已登记，请到中转站管理核对现有站点；不会覆盖原站点配置")
                station["domain"] = domain
                save_keys(db, station, None)
                station_id = ident()
                db.save("stations", station_id, station, con)
                db.audit(user["username"], "created_stations", station_id, con)
                row["station_id"] = station_id
            row.update(status=spec.status, note=spec.note, reviewed_at=now(), reviewed_by=user["username"])
            db.save(KIND, key, {k: v for k, v in row.items() if k != "id"}, con)
            db.audit(user["username"], "station_application_" + spec.status, key, con)
            if previous_status != spec.status:
                mailing.reviewed(db, row, key, con)
        return safe(row)

    @app.delete("/api/admin/station-applications/{key}")
    def delete(key: str, user=Depends(session)):
        with db.connect(write=True) as con:
            record(key, con)
            con.execute("DELETE FROM entities WHERE kind=? AND id=?", (KIND, key))
            con.execute("DELETE FROM mail_outbox WHERE application_id=? AND status!='sent'", (key,))
            db.audit(user["username"], "station_application_deleted", key, con)
        return {"ok": True}
