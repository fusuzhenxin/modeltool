"""Use the shipped JavaScript engines as-is; retain Python's queue and budget guards."""
import http.client
import json
import queue
import shutil
import socket
import subprocess
import threading
import time
from datetime import datetime
from functools import lru_cache
from urllib.parse import urlsplit

from .core import ROOT, TZ
from .runner import RunStopped, endpoint, reserve, resolve_public
from chat_stream import LONG_TIMEOUT


def start_engine():
    node = shutil.which("node")
    if not node:
        raise RunStopped("本站检测需要 Node.js 18 或更新版本，请安装后重新启动后台")
    return subprocess.Popen([node, str(ROOT / "backend" / "site-engine.cjs")], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, encoding="utf-8",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), cwd=ROOT)


def bridge(init, exchange=None):
    process = start_engine()
    output = queue.Queue()
    def read():
        try:
            while True:
                line = process.stdout.readline(8 * 1024 * 1024)
                output.put(line)
                if not line:
                    return
        except (OSError, ValueError):
            output.put("")
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    try:
        process.stdin.write(json.dumps(init, ensure_ascii=True) + "\n"); process.stdin.flush()
        requests = 0
        while True:
            try:
                line = output.get(timeout=30)
            except queue.Empty:
                raise RunStopped("本站检测进程没有响应，请重试") from None
            if not line or not line.endswith("\n"):
                raise RunStopped("本站检测进程已停止，请检查后重试")
            message = json.loads(line)
            if message["type"] == "result":
                return message["result"]
            if message["type"] != "request":
                raise RunStopped(message.get("message", "本站检测执行失败"))
            requests += 1
            if exchange is None or requests > 200:
                raise RunStopped("本站检测请求数量超出范围")
            result = exchange(message["payload"], message["mode"])
            process.stdin.write(json.dumps({"type": "response", "id": message["id"], "result": result}, ensure_ascii=True) + "\n")
            process.stdin.flush()
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
        reader.join(timeout=2)
        process.stdin.close(); process.stdout.close()


@lru_cache(maxsize=4)
def cached_catalog(stamps):
    return bridge({"action": "catalog"})


def catalog():
    files = [ROOT / "js" / (name + ".js") for name in ("data", "engine", "probe", "trace")]
    files.append(ROOT / "backend" / "site-engine.cjs")
    return cached_catalog(tuple(p.stat().st_mtime_ns for p in files))


def post_exchange(url, headers, payload, timeout=120):
    address = resolve_public(url)
    parsed = urlsplit(url)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=min(timeout, 30))
    connection._create_connection = lambda target, timeout, source_address=None, **kw: socket.create_connection((address, target[1]), timeout, source_address)
    deadline = time.monotonic() + timeout
    started = time.monotonic()
    try:
        connection.request("POST", parsed.path or "/", json.dumps(payload).encode(), {"Content-Type": "application/json", **headers})
        if connection.sock:
            connection.sock.settimeout(max(.01, deadline - time.monotonic()))
        response = connection.getresponse()
        if response.status in (401, 403, 429) or response.status >= 500:
            raise RunStopped(f"接口返回 HTTP {response.status}，任务已停止，请检查后手动重试")
        if 300 <= response.status < 400:
            raise RunStopped("接口发生重定向，任务已停止，请核对接口地址")
        kept = {k.lower(): v for k, v in response.getheaders() if k.lower() in ("content-type", "x-request-id", "openai-version", "anthropic-request-id", "cf-ray")}
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            if connection.sock:
                connection.sock.settimeout(remaining)
            chunk = response.read1(32768)
            if not chunk:
                break
            size += len(chunk)
            if size > 2 * 1024 * 1024:
                raise RunStopped("接口响应超过 2MB 限制，任务已停止")
            chunks.append(chunk)
        return {"status": response.status, "text": b"".join(chunks).decode("utf-8", "replace"), "headers": kept,
                "elapsedMs": round((time.monotonic() - started) * 1000), "error": ""}
    finally:
        connection.close()


def run_site_suite(db, job, station, transport=None):
    key = db.decrypt(station.get("key_cipher"))
    if not key:
        raise RunStopped("该站点没有配置检测专用密钥")
    config = json.loads(job["config"])
    config = {"difficulty": "medium", "count": 10, "candy_count": 20, "pelican_mode": "html2d", **config}
    def exchange(payload, mode):
        limit = payload.get("max_completion_tokens", payload.get("max_tokens", 256))
        if payload.get("model") != job["model"] or not isinstance(limit, int) or not 1 <= limit <= 8192:
            raise RunStopped("检测请求参数不合法")
        usage_id = reserve(db, job, station, token_cap=limit + 2048)
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"} if station["protocol"] == "anthropic" else {"Authorization": "Bearer " + key}
        if transport:
            response = transport(endpoint(station), headers, payload)
            if not isinstance(response, dict) or "status" not in response:
                response = {"status": 200, "json": response, "text": json.dumps(response), "headers": {}, "elapsedMs": 0, "error": ""}
        else:
            response = post_exchange(endpoint(station), headers, payload, timeout=LONG_TIMEOUT if limit > 256 else 45)
        # Scrub before JS analysis, private report storage, or any error path.
        def scrub(value):
            if isinstance(value, dict):
                return {scrub(k): scrub(v) for k, v in value.items()}
            if isinstance(value, list):
                return [scrub(v) for v in value]
            if isinstance(value, str):
                for secret in (json.dumps(key)[1:-1], json.dumps(key, ensure_ascii=False)[1:-1], key):
                    value = value.replace(secret, "[已移除密钥]")
            return value
        response = scrub(response)
        if response["status"] in (401, 403, 429) or response["status"] >= 500 or 300 <= response["status"] < 400 or response["status"] <= 0:
            raise RunStopped(f"接口返回 HTTP {response['status']}，任务已停止")
        if "json" not in response:
            try:
                response["json"] = json.loads(response["text"])
            except ValueError:
                response["json"] = None
        usage = response["json"].get("usage") if isinstance(response.get("json"), dict) else None
        usage = dict(usage) if isinstance(usage, dict) else {}
        # Streaming usage is commonly reported in the final SSE event.
        if payload.get("stream"):
            for line in response.get("text", "").splitlines():
                if line.startswith("data:"):
                    try:
                        event = json.loads(line[5:].strip())
                        if isinstance(event, dict):
                            usage.update(event.get("message", {}).get("usage", {})); usage.update(event.get("usage", {}))
                    except (ValueError, AttributeError, TypeError):
                        pass
        total = usage.get("total_tokens")
        if total is None:
            first, second = usage.get("input_tokens", usage.get("prompt_tokens")), usage.get("output_tokens", usage.get("completion_tokens"))
            if isinstance(first, int) and isinstance(second, int):
                total = first + second
        if isinstance(total, int) and 0 < total < 10000000:
            with db.connect(write=True) as con:
                con.execute("UPDATE usage SET tokens=?,actual=1 WHERE id=?", (total, usage_id))
        if mode == "chat" and not payload.get("stream"):
            import serve
            status, body = serve._collapse_stream(response["status"], response["text"].encode(), response.get("headers"), station["protocol"] == "anthropic")
            response["status"], response["text"] = status, body.decode()
        return response
    result = bridge({"action": "run", "config": config, "model": job["model"], "endpoint": endpoint(station), "seed": job["id"]}, exchange)
    return report_from_site(result, config, job["model"])


def report_from_site(result, config, model):
    sections = result["sections"]
    relay = next((s for s in sections if s["kind"] == "relay"), None)
    artwork = next((s for s in sections if s["kind"] == "pelican"), None)
    tests = [s for s in sections if s["kind"] in ("ability", "logic", "code", "qa", "candy")]
    checks = []
    for section in sections:
        if section["kind"] == "relay":
            checks.extend({"name": "中转站 · " + c["name"], "status": c["status"], "detail": c.get("detail", "")} for c in section["checks"])
        elif section in tests:
            checks.extend({"name": section["name"] + " · " + item["stem"], "status": "pass" if item["correct"] else "fail",
                           "detail": "回答 " + ("ABCD"[item["choice"]] if item["choice"] is not None else "未识别") + "；正确答案 " + "ABCD"[item["answer"]] + "。" + item["explain"]} for item in section["items"])
    measured = result.get("ability")
    ability = None if not measured else {"score": measured["score"], "baseline": None, "questions": measured["questions"],
        "level": "normal" if measured["judgement"]["level"] == "ok" else "degraded", "judgement": measured["judgement"],
        "summary": "本站原版题库与评分。" + measured["judgement"]["desc"] + "各模块独立展示；未使用旧版五题参考基线。"}
    findings = [s["name"] + "：" + (s.get("judgement", {}).get("title") or s.get("title") or (s.get("prediction_name", "") + "（候选相似度，不能证明模型身份）" if s["kind"] == "trace" else "代码结构分 " + str(s.get("score")))) for s in sections]
    return {"kind": config["kind"], "suite": "site-original-v1", "test_name": result["name"], "model": model,
            "time": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"), "protocol_tested": bool(relay),
            "level": relay["level"] if relay else "unknown", "score": relay["score"] if relay else None,
            "title": relay["title"] if relay else result["name"] + "已完成", "runs": 1,
            "summary": "调用本站原有题库和检测代码；基础能力、糖果、中转站、指纹与作品分别展示结果。",
            "conditions": "本站原版检测 / " + {"easy": "简单", "medium": "中等", "hard": "困难"}[config["difficulty"]] + " / 单选题 temperature=0、max_tokens=256；指纹与作品 max_tokens=8192。",
            "retest": "采用本站原版流程。指纹最多 6 次收集 3 份有效回答；作品参数兼容重试沿用前台。鉴权、网络或预算错误会停止任务。",
            "findings": findings, "checks": checks, "ability": ability, "sections": sections,
            **({"artwork": artwork} if artwork else {}), "raw": result["raw"], "request_count": result["calls"]}
