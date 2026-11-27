"""Authenticated SMTP configuration and a durable, encrypted notification outbox."""
import json
import re
import smtplib
import ssl
import threading
from contextlib import asynccontextmanager
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import ConfigDict, Field, field_validator, model_validator

from .core import ident, now
from .models import StrictModel, web_url

DEFAULTS = {"enabled": False, "host": "", "port": 465, "security": "ssl", "username": "",
            "from_email": "", "from_name": "ModelTool 中转站观察", "notify_email": "",
            "site_url": "https://www.modeltool.cn", "password_cipher": ""}


def email_address(value):
    value = value.strip()
    if not value or len(value) > 254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value):
        raise ValueError("请输入有效的邮箱地址")
    if ".." in value or value.startswith(".") or ".@" in value:
        raise ValueError("请输入有效的邮箱地址")
    return value


class MailSettings(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    enabled: bool = False
    host: str = Field(default="", max_length=253, pattern=r"^[A-Za-z0-9.:-]*$")
    port: int = Field(default=465, ge=1, le=65535)
    security: Literal["ssl", "starttls"] = "ssl"
    username: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=1000)
    clear_password: bool = False
    from_email: str = Field(default="", max_length=254)
    from_name: str = Field(default="ModelTool 中转站观察", min_length=1, max_length=100)
    notify_email: str = Field(default="", max_length=254)
    site_url: str = Field(default="https://www.modeltool.cn", max_length=500)

    @field_validator("username", "password", "from_name")
    @classmethod
    def no_headers(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("不能包含换行或控制字符")
        return value

    @field_validator("from_email", "notify_email")
    @classmethod
    def addresses(cls, value):
        return email_address(value) if value else ""

    @field_validator("site_url")
    @classmethod
    def site(cls, value):
        return web_url(value, endpoint=True)

    @model_validator(mode="after")
    def configured(self):
        if self.enabled and not all((self.host, self.from_email, self.notify_email, self.site_url)):
            raise ValueError("启用前请填写 SMTP 服务器、发件邮箱、管理员收件邮箱和网站地址")
        return self


class TestMail(StrictModel):
    recipient: str = Field(min_length=3, max_length=254)

    @field_validator("recipient")
    @classmethod
    def address(cls, value):
        return email_address(value)


def config(db, con=None):
    return DEFAULTS | (db.get("mail_settings", "smtp", con) or {})


def enqueue(db, event_key, application_id, recipient, subject, body, con):
    key = ident()
    # Neither account credentials nor internal review notes belong in email content.
    payload = db.encrypt(json.dumps({"recipient": recipient, "subject": subject, "body": body}, ensure_ascii=False))
    con.execute("INSERT OR IGNORE INTO mail_outbox(id,event_key,application_id,payload,status,attempts,next_attempt,created,last_error) VALUES(?,?,?,?,'pending',0,?,?,'')", (key, event_key, application_id, payload, now(), now()))
    return con.execute("SELECT id FROM mail_outbox WHERE event_key=?", (event_key,)).fetchone()[0]


def submitted(db, row, key, con):
    settings = config(db, con)
    admin_body = f"收到新的中转站收录申请。\n\n站点：{row['name']}\n官网：{row['website_url']}\n申请编号：{key}\n\n请在后台审核：{settings['site_url']}/admin/#applications\n\n邮件不包含探测账号、密码或 API Key。"
    enqueue(db, f"application:{key}:submitted:admin", key, None, "新的中转站收录申请", admin_body, con)
    if row.get("email"):
        body = f"你的中转站「{row['name']}」收录申请已收到。\n\n申请编号：{key}\n我们将核验专用探测账号，再配置模型并安排检测。请保持账号可用，并预留建议 100 检测额度（单位以中转站后台为准）。\n审核结果将发送到此邮箱。\n\n本邮件不代表已通过审核或已公开。\n{settings['site_url']}/relays.html"
        enqueue(db, f"application:{key}:submitted:applicant", key, row["email"], "中转站收录申请已收到", body, con)


def reviewed(db, row, key, con):
    if not row.get("email") or row["status"] not in ("approved", "rejected"):
        return
    label = "审核通过" if row["status"] == "approved" else "暂未通过"
    conclusion = "申请已通过审核，进入接口配置和检测准备阶段；测试报告尚未公开。请保持探测账号可用及额度充足。" if row["status"] == "approved" else "本次申请暂未通过审核。可通过之前留下的联系方式沟通，核对账号、权限和额度后重新申请。"
    body = f"中转站「{row['name']}」收录申请{label}。\n\n申请编号：{key}\n{conclusion}\n\n{config(db, con)['site_url']}/relays.html"
    enqueue(db, f"application:{key}:{row['status']}:applicant", key, row["email"], "中转站收录申请" + label, body, con)


def send_email(db, settings, payload, key):
    recipient = payload["recipient"] or settings["notify_email"]
    email_address(recipient)
    message = EmailMessage()
    message["From"] = formataddr((settings["from_name"], settings["from_email"]))
    message["To"] = recipient
    message["Subject"] = payload["subject"]
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = f"<{key}@{settings['from_email'].split('@')[-1]}>"
    message.set_content(payload["body"])
    context = ssl.create_default_context()
    smtp = None
    try:
        if settings["security"] == "ssl":
            smtp = smtplib.SMTP_SSL(settings["host"], settings["port"], timeout=10, context=context)
        else:
            smtp = smtplib.SMTP(settings["host"], settings["port"], timeout=10)
            smtp.ehlo(); smtp.starttls(context=context); smtp.ehlo()
        if settings["username"]:
            smtp.ehlo_or_helo_if_needed()
            password = db.decrypt(settings["password_cipher"])
            # Some QQ servers disconnect on AUTH PLAIN instead of returning a
            # useful authentication error. LOGIN works over the same verified TLS.
            if "LOGIN" in smtp.esmtp_features.get("auth", "").upper().split():
                smtp.user, smtp.password = settings["username"], password
                smtp.auth("LOGIN", smtp.auth_login, initial_response_ok=False)
            else:
                smtp.login(settings["username"], password, initial_response_ok=False)
        refused = smtp.send_message(message, from_addr=settings["from_email"], to_addrs=[recipient])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    finally:
        if smtp:
            try:
                smtp.quit()
            except Exception:
                smtp.close()


def error_message(exc):
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "SMTP 登录失败，请确认邮箱已开启 SMTP 服务、授权码有效，或稍后重试"
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return "SMTP 服务器中断连接，请检查邮箱服务状态、授权码或稍后重试"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "邮件服务器拒绝了收件地址，请检查邮箱或发信限制"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "邮件服务器拒绝了发件地址，请检查发件邮箱"
    if isinstance(exc, ssl.SSLError):
        return "SMTP 加密连接失败，请检查安全方式、端口与服务器证书"
    if isinstance(exc, (OSError, TimeoutError)):
        return "无法连接邮件服务器，请检查 SMTP 地址、端口和网络"
    return "邮件发送失败，请检查 SMTP 配置或稍后重试"


def deliver_one(db, only_id=None, send=None):
    with db.connect(write=True) as con:
        settings = config(db, con)
        if not settings["enabled"]:
            return False
        # A crashed web process releases its leased message for a later retry.
        con.execute("UPDATE mail_outbox SET status='pending',lease=NULL WHERE status='sending' AND lease<?", (now(),))
        query = "SELECT * FROM mail_outbox WHERE status='pending' AND next_attempt<=?"
        args = [now()]
        if only_id:
            query += " AND id=?"; args.append(only_id)
        row = con.execute(query + " ORDER BY created,id LIMIT 1", args).fetchone()
        if not row:
            return False
        row = dict(row)
        con.execute("UPDATE mail_outbox SET status='sending',lease=?,attempts=attempts+1 WHERE id=?", (now()+120, row["id"]))
    try:
        payload = json.loads(db.decrypt(row["payload"]))
        (send or send_email)(db, settings, payload, row["id"])
    except Exception as exc:
        attempts = row["attempts"] + 1
        with db.connect(write=True) as con:
            con.execute("UPDATE mail_outbox SET status=?,lease=NULL,next_attempt=?,last_error=? WHERE id=?", ("failed" if attempts >= 5 else "pending", now()+min(3600, 60*2**(attempts-1)), error_message(exc), row["id"]))
    else:
        with db.connect(write=True) as con:
            con.execute("UPDATE mail_outbox SET status='sent',lease=NULL,sent_at=?,last_error='' WHERE id=?", (now(), row["id"]))
    return True


def lifespan(db):
    @asynccontextmanager
    async def service(app):
        stop = threading.Event()
        def dispatch():
            while not stop.is_set():
                try:
                    processed = deliver_one(db)
                except Exception:
                    processed = False
                stop.wait(0.2 if processed else 2)
        thread = threading.Thread(target=dispatch, name="mail-dispatcher", daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=0.2)
    return service


def register_mail(app, db, session):
    @app.get("/api/admin/mail")
    def overview(user=Depends(session)):
        settings = config(db)
        masked = {k: v for k, v in settings.items() if k != "password_cipher"}
        masked["has_password"] = bool(settings["password_cipher"])
        with db.connect() as con:
            counts = dict(con.execute("SELECT status,count(*) FROM mail_outbox GROUP BY status"))
            rows = con.execute("SELECT * FROM mail_outbox ORDER BY created DESC,id DESC LIMIT 30").fetchall()
        messages = []
        for row in rows:
            payload = json.loads(db.decrypt(row["payload"]))
            messages.append({k: row[k] for k in ("id", "application_id", "status", "attempts", "created", "sent_at", "next_attempt", "last_error")} | {"recipient": payload["recipient"] or settings["notify_email"] or "管理员收件邮箱（待配置）", "subject": payload["subject"]})
        return {"settings": masked, "counts": counts, "messages": messages}

    @app.put("/api/admin/mail")
    def save(spec: MailSettings, user=Depends(session)):
        with db.connect(write=True) as con:
            previous = config(db, con)
            data = spec.model_dump()
            password = data.pop("password")
            clear = data.pop("clear_password")
            data["password_cipher"] = "" if clear else db.encrypt(password) if password else previous["password_cipher"]
            if data["enabled"] and data["username"] and not data["password_cipher"]:
                raise HTTPException(422, "请填写 SMTP 授权码；保存后留空可保留原授权码")
            db.save("mail_settings", "smtp", data, con)
            db.audit(user["username"], "mail_settings_updated", "smtp", con)
        return {"ok": True}

    @app.post("/api/admin/mail/test")
    def test(spec: TestMail, user=Depends(session)):
        with db.connect(write=True) as con:
            if not config(db, con)["enabled"]:
                raise HTTPException(422, "请先保存并启用邮件配置")
            key = enqueue(db, "test:"+ident(), "", spec.recipient, "ModelTool 测试邮件", "这是一封由 ModelTool 后台通过 SMTP 发送的测试邮件。收到此邮件，表示收件路径正常。\n本邮件不包含探测账号、密码或 API Key。", con)
            db.audit(user["username"], "mail_test_requested", key, con)
        deliver_one(db, only_id=key)
        with db.connect() as con:
            row = con.execute("SELECT status,last_error FROM mail_outbox WHERE id=?", (key,)).fetchone()
        if row["status"] != "sent":
            if row["status"] == "sending":
                return {"id": key, "status": "sending"}
            raise HTTPException(502, row["last_error"] or "测试邮件未发送，请检查配置后重试")
        return {"id": key, "status": "sent"}

    @app.post("/api/admin/mail/{key}/retry")
    def retry(key: str, user=Depends(session)):
        with db.connect(write=True) as con:
            row = con.execute("SELECT status FROM mail_outbox WHERE id=?", (key,)).fetchone()
            if not row:
                raise HTTPException(404, "邮件记录不存在")
            if row["status"] in ("sent", "sending"):
                raise HTTPException(409, "已提交服务器或正在发送的邮件不能重复发送")
            con.execute("UPDATE mail_outbox SET status='pending',attempts=0,next_attempt=?,last_error='' WHERE id=?", (now(), key))
            db.audit(user["username"], "mail_retry_requested", key, con)
        return {"ok": True}
