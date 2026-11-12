from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parent.parent
TZ = timezone(timedelta(hours=8))


def now():
    return time.time()


def stamp(value=None):
    return datetime.fromtimestamp(now() if value is None else value, timezone.utc).isoformat()


def day():
    return datetime.now(TZ).strftime("%Y-%m-%d")


def ident():
    return secrets.token_hex(12)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ":" + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def password_ok(password, encoded):
    try:
        return secrets.compare_digest(password_hash(password, encoded.split(":")[0]), encoded)
    except (ValueError, TypeError):
        return False


class Database:
    def __init__(self, directory=None):
        default = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "ModelTool"
        self.directory = Path(directory or os.environ.get("MODELTOOL_DATA_DIR", default)).resolve()
        if self.directory == ROOT or ROOT in self.directory.parents:
            raise RuntimeError("后台数据目录必须放在网站目录之外")
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "operations.sqlite3"
        self.uploads = self.directory / "uploads"
        self.uploads.mkdir(exist_ok=True)
        key_path = self.directory / "encryption.key"
        if self.path.exists() and not key_path.exists():
            raise RuntimeError("已有数据库的加密密钥丢失，请从备份恢复数据库与密钥，不能自动重新生成")
        if not key_path.exists():
            try:
                fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as out:
                    out.write(Fernet.generate_key())
            except FileExistsError:
                pass
        self.cipher = Fernet(key_path.read_bytes())
        with self.connect() as con:
            con.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts (address TEXT NOT NULL, at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, station_id TEXT NOT NULL, schedule_id TEXT, model TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, started REAL, ended REAL, lease REAL, cancel INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', report_id TEXT, attempts INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created);
                CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, day TEXT NOT NULL, station_id TEXT NOT NULL, job_id TEXT NOT NULL, tokens INTEGER NOT NULL, actual INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS usage_day ON usage(day,station_id);
                CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS worker (id INTEGER PRIMARY KEY CHECK(id=1), heartbeat REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS proposal_visitors (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, domain TEXT UNIQUE NOT NULL, data TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS artwork_votes (report_id TEXT NOT NULL, visitor TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN ('real','fake')), created REAL NOT NULL, PRIMARY KEY(report_id,visitor));
                CREATE TABLE IF NOT EXISTS proposal_votes (proposal_id TEXT NOT NULL, visitor TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(proposal_id,visitor));
                CREATE TABLE IF NOT EXISTS proposal_comments (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL, official INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS proposal_comments_parent ON proposal_comments(proposal_id,created);
                CREATE TABLE IF NOT EXISTS proposal_activity (actor TEXT NOT NULL, address TEXT NOT NULL, kind TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS proposal_activity_time ON proposal_activity(created);
                PRAGMA user_version=1;
            """)
            if not con.execute("SELECT 1 FROM entities WHERE kind='settings'").fetchone():
                self.save("settings", "site", {"daily_calls": 200, "daily_tokens": 200000, "paused": False}, con)
        token_path = self.directory / "setup.token"
        if not self.has_admin() and not token_path.exists():
            try:
                fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as out:
                    out.write(secrets.token_urlsafe(32))
            except FileExistsError:
                pass

    @contextmanager
    def connect(self, write=False):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=15000")
        try:
            if write:
                con.execute("BEGIN IMMEDIATE")
            yield con
            con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            con.close()

    def has_admin(self):
        with self.connect() as con:
            return bool(con.execute("SELECT 1 FROM users LIMIT 1").fetchone())

    def get(self, kind, key, con=None):
        if con is None:
            with self.connect() as conn:
                return self.get(kind, key, conn)
        row = con.execute("SELECT data FROM entities WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind, con=None):
        if con is None:
            with self.connect() as conn:
                return self.list(kind, conn)
        return [dict(json.loads(row["data"]), id=row["id"]) for row in con.execute("SELECT id,data FROM entities WHERE kind=? ORDER BY updated DESC", (kind,))]

    def save(self, kind, key, data, con=None):
        if con is None:
            with self.connect(write=True) as conn:
                return self.save(kind, key, data, conn)
        con.execute("INSERT INTO entities(kind,id,data,created,updated) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated=excluded.updated", (kind, key, json.dumps(data, ensure_ascii=False), now(), now()))
        return dict(data, id=key)

    def report_rows(self, summary=False, key=None, published=False):
        """Strip heavy private content in SQLite before decoding one report at a time."""
        paths = ["$.result.raw", "$.result.artwork.html"]
        if summary:
            paths += ["$.result.sections", "$.result.checks", "$.result.conditions", "$.result.retest", "$.result.findings"]
        expression = "json_remove(data," + ",".join("?" for _ in paths) + ")"
        query = "SELECT id," + expression + " AS data FROM entities WHERE kind='reports'"
        args = list(paths)
        if key:
            query += " AND id=?"
            args.append(key)
        if published:
            query += " AND json_extract(data,'$.status')='published'"
        query += " ORDER BY updated DESC"
        with self.connect() as con:
            for row in con.execute(query, args):
                yield dict(json.loads(row["data"]), id=row["id"])

    def audit(self, actor, action, target, con=None):
        if con is None:
            with self.connect(write=True) as conn:
                return self.audit(actor, action, target, conn)
        con.execute("INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)", (now(), actor, action, target))

    def encrypt(self, value):
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt(self, value):
        return self.cipher.decrypt(value.encode()).decode() if value else ""


def safe_station(row):
    return {k: v for k, v in row.items() if k != "key_cipher"} | {"has_key": bool(row.get("key_cipher"))}


def public_report(row, station):
    result = {k: v for k, v in row["result"].items() if k not in ("raw",)}
    if result.get("artwork"):
        result["artwork"] = {k: v for k, v in result["artwork"].items() if k != "html"}
    if result.get("sections"):
        def public_section(value):
            if isinstance(value, dict):
                return {k: public_section(v) for k, v in value.items() if k not in ("html", "raw", "reply", "payload", "response")}
            if isinstance(value, list):
                return [public_section(v) for v in value]
            return value
        result["sections"] = public_section(result["sections"])
    return dict(result, id=row["id"], domain=station["domain"], stationName=station["name"], logo=station.get("logo", ""), website_url=station.get("website_url", ""), stationId=station["id"], demo=bool(row.get("demo")))
