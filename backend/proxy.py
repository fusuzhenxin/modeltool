"""Browser compatibility proxy. Visitor credentials are never persisted."""
import http.client
import json
import socket
import threading
import time
from urllib.parse import urlsplit
from fastapi.responses import JSONResponse, Response
from .runner import resolve_public

_slots = threading.BoundedSemaphore(8)


def forward_browser(kind, raw):
    import serve
    if not _slots.acquire(blocking=False):
        return JSONResponse({"error": {"message": "检测请求较多，请稍后重试"}}, status_code=429)
    connection = None
    started = time.monotonic()
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("payload"), dict):
            raise ValueError()
        base, key = str(data.get("baseUrl", "")), str(data.get("apiKey", ""))
        if len(base) > 500 or len(key) > 1000:
            raise ValueError()
        url = serve.target_url(base)
        address = resolve_public(url)
        parsed = urlsplit(url)
        anthropic = url.endswith("/messages")
        headers = {"Content-Type": "application/json"}
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"} if anthropic else {"Authorization": "Bearer " + key})
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parsed.hostname, parsed.port, timeout=120)
        connection._create_connection = lambda target, timeout, source_address=None, **kw: socket.create_connection((address, target[1]), timeout, source_address)
        connection.request("POST", parsed.path or "/", json.dumps(data["payload"]).encode(), headers)
        upstream = connection.getresponse()
        status, kept = upstream.status, dict(upstream.headers)
        chunks, size = [], 0
        while True:
            remaining = 180 - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError()
            if connection.sock:
                connection.sock.settimeout(min(remaining, 120))
            piece = upstream.read1(32768)
            if not piece:
                break
            size += len(piece)
            if size > 5 * 1024 * 1024:
                raise ValueError()
            chunks.append(piece)
        body = b"".join(chunks)
        if 300 <= status < 400:
            raise ValueError()
        if key:
            body = body.replace(key.encode(), b"[redacted]")
        if kind == "probe":
            text = body.decode("utf-8", "replace")
            try:
                parsed_body = json.loads(text)
            except ValueError:
                parsed_body = None
            allowed = {"content-type", "x-request-id", "openai-version", "anthropic-request-id"}
            return JSONResponse({"status": status, "text": text[:20000], "json": parsed_body, "headers": {k: v for k, v in kept.items() if k.lower() in allowed}, "elapsedMs": round((time.monotonic() - started) * 1000), "error": ""})
        status, body = serve._collapse_stream(status, body, kept, anthropic)
        return Response(body, status_code=status, media_type="application/json")
    except Exception:
        message = "接口请求失败，请检查公网地址、网络和密钥；服务器不会保存密钥或错误正文。"
        if kind == "probe":
            return JSONResponse({"status": 0, "text": "", "json": None, "headers": {}, "elapsedMs": round((time.monotonic() - started) * 1000), "error": message})
        return JSONResponse({"error": {"message": message}}, status_code=502)
    finally:
        if connection:
            connection.close()
        _slots.release()
