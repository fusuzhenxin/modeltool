"""Offline local administration; run with the web service stopped for restore."""
import argparse
import getpass
import json
import os
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from .core import Database, ROOT, TZ, ident, now, password_hash


def seed_demo(db):
    """Opt-in fixtures have no keys, enabled schedules or billable jobs."""
    from PIL import Image, ImageDraw
    names = [("清流 API", "api.clearstream.example", "#28a594"), ("云桥中转", "gateway.cloudbridge.example", "#7585d5"), ("快线 API", "relay.fastlane.example", "#d99d48"), ("星港 API", "api.starport.example", "#9b76c8"), ("松果中转", "relay.pinecone.example", "#5c9b7d"), ("极光 API", "api.aurora.example", "#bf7e9b")]
    with db.connect(write=True) as con:
        if any(r.get("demo") for r in db.list("reports", con)):
            print("已存在演示数据，未重复添加。")
            return
        for index, (name, domain, color) in enumerate(names):
            station_id = "demo-station-" + str(index)
            if db.get("stations", station_id, con):
                continue
            image = Image.new("RGB", (120, 120), color)
            draw = ImageDraw.Draw(image)
            if index % 3 == 0:
                for y in (35, 55, 75):
                    draw.arc((22, y-10, 60, y+18), 180, 350, fill="white", width=6)
                    draw.arc((58, y-10, 96, y+18), 0, 170, fill="white", width=6)
            elif index % 3 == 1:
                draw.rounded_rectangle((26, 30, 94, 83), radius=17, outline="white", width=6)
                draw.line((45, 76, 45, 98, 75, 98, 75, 76), fill="white", width=6)
            else:
                draw.polygon([(67, 18), (30, 65), (54, 65), (48, 104), (91, 48), (64, 48)], fill="white")
            filename = ident() + ".webp"
            image.save(db.uploads / filename, "WEBP")
            station = {"name": name, "domain": domain, "base_url": "https://" + domain + "/v1", "logo": "/media/" + filename, "description": "本地演示站点，用于预览后台与前台数据联动，不代表实际服务。", "models": ["gpt-4.1", "claude-sonnet-4-5"], "protocol": "openai", "visible": True, "enabled": False, "daily_calls": 60, "daily_tokens": 60000, "baselines": {}, "degradation_threshold": 20, "key_cipher": ""}
            db.save("stations", station_id, station, con)
            for run in range(2):
                level = ("ok", "warn", "bad")[index % 3]
                score = {"ok": 100, "warn": 78, "bad": 40}[level]
                timestamp = datetime.now(TZ).replace(hour=9 + index, minute=10 + run * 20).strftime("%Y-%m-%d %H:%M")
                result = {"model": station["models"][run], "time": timestamp, "level": level, "score": score, "title": {"ok": "未见掺水 · 模拟", "warn": "疑似掺水 · 模拟", "bad": "明显掺水 · 模拟"}[level], "runs": 2, "summary": "演示报告：域名、分数与逐项结论均为虚构，仅用于本地预览。", "conditions": "模拟固定题组，未进行外部 API 调用。", "retest": "模拟展示复测结果，不代表真实服务。", "checks": [{"name": "系统指令", "status": "pass" if level == "ok" else "warn", "detail": "模拟结果"}, {"name": "输出格式", "status": "fail" if level == "bad" else "pass", "detail": "模拟结果"}], "findings": ["这是一份明确标记的演示报告。"], "ability": {"score": 100 if level == "ok" else 60, "baseline": 100, "questions": 5, "level": "normal" if level == "ok" else "degraded", "summary": "能力分与基线均为模拟数据。"}, "raw": [], "suite": "demo"}
                db.save("reports", ident(), {"station_id": station_id, "job_id": None, "status": "draft" if index == 5 else "published", "note": "本地演示数据", "demo": True, "created": now(), "result": result}, con)
        db.save("announcements", ident(), {"title": "新版中转观察已开放", "content": "按日期查看检测报告，进入中转站档案追踪多模型表现。当前站点与报告为本地演示数据。", "link": "", "placement": "home", "pinned": True, "tone": "info", "enabled": True, "starts_at": None, "ends_at": None, "order": 0}, con)
        db.save("ads", ident(), {"name": "本地推荐位演示", "title": "你的推广内容，可以放在这里", "description": "在后台替换图片、文案和跳转链接", "link": "https://www.modeltool.cn", "image": "", "placement": "hero", "enabled": True, "starts_at": None, "ends_at": None, "order": 0}, con)
        db.audit("local-cli", "seed_demo", "fixtures", con)
    print("已添加 6 家虚构站点、12 份演示报告、公告和广告。没有密钥、检测计划或外部调用。")


def backup(db, output):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError("备份文件已存在，请使用新文件名")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        snapshot = Path(temp) / "operations.sqlite3"
        source, dest = sqlite3.connect(db.path), sqlite3.connect(snapshot)
        try:
            source.backup(dest)
        finally:
            source.close(); dest.close()
        with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot, "operations.sqlite3")
            archive.write(db.directory / "encryption.key", "encryption.key")
            for image in db.uploads.glob("*.webp"):
                if image.is_file() and not image.is_symlink():
                    archive.write(image, "uploads/" + image.name)
    try:
        os.chmod(output, 0o600)
    except OSError:
        pass
    print(f"备份已保存到 {output}（含加密密钥，仅限管理员保管）")


def restore(archive, target):
    target = Path(target).resolve()
    if target == ROOT or ROOT in target.parents or (target.exists() and any(target.iterdir())):
        raise ValueError("恢复目录必须位于网站之外且为空；不会覆盖现有数据")
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        import re
        if not {"operations.sqlite3", "encryption.key"}.issubset(names) or any(n not in ("operations.sqlite3", "encryption.key") and not re.fullmatch(r"uploads/[a-f0-9]{24}\.webp", n) for n in names):
            raise ValueError("不是有效的 ModelTool 备份")
        if sum(f.file_size for f in source.infolist()) > 2 * 1024 ** 3:
            raise ValueError("备份超过恢复大小限制")
        target.mkdir(parents=True, exist_ok=True)
        source.extractall(target)
    db = Database(target)
    with db.connect(write=True) as con:
        con.execute("DELETE FROM sessions")
        con.execute("UPDATE jobs SET status='interrupted',ended=?,error='备份恢复后请手动重试' WHERE status IN ('queued','running')", (now(),))
        settings = db.get("settings", "site", con)
        settings["paused"] = True
        db.save("settings", "site", settings, con)
        db.audit("local-cli", "restored", "backup", con)
    print("恢复完成。所有会话已退出，检测已全局暂停；核对后再恢复运行。")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("setup-url").add_argument("--port", type=int, default=8767)
    sub.add_parser("seed-demo")
    sub.add_parser("reset-password").add_argument("--username", required=True)
    sub.add_parser("backup").add_argument("--output", required=True)
    sub.add_parser("restore").add_argument("--archive", required=True)
    args = parser.parse_args()
    try:
        if args.command == "restore":
            if not args.data_dir:
                raise ValueError("恢复必须指定 --data-dir 空目录")
            return restore(args.archive, args.data_dir)
        db = Database(args.data_dir)
        if args.command == "seed-demo":
            seed_demo(db)
        elif args.command == "backup":
            backup(db, args.output)
        elif args.command == "setup-url":
            if db.has_admin():
                print("已初始化，请使用管理员账户登录。")
            else:
                print(f"http://127.0.0.1:{args.port}/admin/#setup=" + (db.directory / "setup.token").read_text().strip())
        else:
            password = getpass.getpass("新密码（至少 12 位）：")
            if len(password) < 12 or len(password) > 128 or password != getpass.getpass("再次确认："):
                raise ValueError("密码长度不符或两次输入不一致")
            with db.connect(write=True) as con:
                user = con.execute("SELECT id FROM users WHERE username=?", (args.username,)).fetchone()
                if not user:
                    raise ValueError("用户名不存在")
                con.execute("UPDATE users SET password=? WHERE id=?", (password_hash(password), user[0]))
                con.execute("DELETE FROM sessions WHERE user_id=?", (user[0],))
                db.audit("local-cli", "password_reset", args.username, con)
            print("密码已重设，所有已登录设备已退出。")
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
