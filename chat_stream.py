"""Bounded live chat transport shared by the local and operations servers."""
import codecs
import http.client
import json
import queue
import socket
import threading
import time
from urllib.parse import urlsplit

LONG_TIMEOUT = 30 * 60
MAX_RESPONSE = 5 * 1024 * 1024
HEARTBEAT = 5
STREAM_HEADERS = {"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "X-ModelTool-Stream": "1"}


def frame(value):
    return ("data: " + json.dumps(value, ensure_ascii=True) + "\n\n").encode()


class ChatStream:
    def __init__(self, data, target_url, resolve, on_finish=lambda: None):
        self.data, self.target_url, self.resolve = data, target_url, resolve
        self.on_finish = on_finish
        self.queue = queue.Queue(maxsize=8)
        self.stopped = threading.Event()
        self.connection = self.sock = None
        self.started = time.monotonic()

    def send(self, value):
        while not self.stopped.is_set():
            try:
                self.queue.put(value, timeout=.2)
                return
            except queue.Full:
                pass

    def start(self):
        threading.Thread(target=self.run, name="chat-stream", daemon=True).start()

    def close(self):
        self.stopped.set()
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        if self.connection:
            self.connection.close()

    def remaining(self):
        remaining = LONG_TIMEOUT - (time.monotonic() - self.started)
        if remaining <= 0 or self.stopped.is_set():
            raise TimeoutError()
        return remaining

    def run(self):
        try:
            data = self.data
            key = str(data.get("apiKey", ""))
            url = self.target_url(str(data.get("baseUrl", "")))
            address = self.resolve(url)
            parsed = urlsplit(url)
            cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
            connection = self.connection = cls(parsed.hostname, parsed.port, timeout=min(30, self.remaining()))
            if address:
                connection._create_connection = lambda target, timeout, source_address=None, **kw: socket.create_connection((address, target[1]), timeout, source_address)
            headers = {"Content-Type": "application/json", "Accept": "text/event-stream, application/json"}
            headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"} if url.endswith("/messages") else {"Authorization": "Bearer " + key})
            connection.connect()
            self.sock = connection.sock
            self.sock.settimeout(self.remaining())
            connection.request("POST", parsed.path or "/", json.dumps(data["payload"]).encode(), headers)
            self.sock.settimeout(self.remaining())
            upstream = connection.getresponse()
            if 300 <= upstream.status < 400:
                raise ValueError()
            self.send({"type": "status", "status": upstream.status})
            # Keep a possible secret prefix across reads so chunk boundaries cannot leak it.
            secret, pending = key.encode(), b""
            decoder = codecs.getincrementaldecoder("utf-8")("replace")
            size = 0
            while True:
                self.sock.settimeout(self.remaining())
                piece = upstream.read1(32768)
                if not piece:
                    break
                size += len(piece)
                if size > MAX_RESPONSE:
                    raise ValueError()
                pending += piece
                if secret:
                    pending = pending.replace(secret, b"[redacted]")
                    hold = next((n for n in range(min(len(secret) - 1, len(pending)), 0, -1) if pending.endswith(secret[:n])), 0)
                else:
                    hold = 0
                ready, pending = (pending[:-hold], pending[-hold:]) if hold else (pending, b"")
                text = decoder.decode(ready)
                if text:
                    self.send({"type": "chunk", "text": text})
            text = decoder.decode(pending, final=True)
            if text:
                self.send({"type": "chunk", "text": text})
            self.send({"type": "end"})
        except TimeoutError:
            message = "本次生成已等待 30 分钟，请稍后手动重试。" if time.monotonic() - self.started >= LONG_TIMEOUT else "接口连接或等待响应超时，请检查中转站状态后手动重试。"
            self.send({"type": "error", "message": message})
        except Exception:
            self.send({"type": "error", "message": "接口连接中断或响应异常，请检查中转站状态后手动重试。"})
        finally:
            if self.connection:
                self.connection.close()
            self.on_finish()

    def events(self):
        self.start()
        try:
            yield b": connected\n\n"
            while True:
                if time.monotonic() - self.started >= LONG_TIMEOUT:
                    yield frame({"type": "error", "message": "本次生成已等待 30 分钟，请稍后手动重试。"})
                    return
                try:
                    event = self.queue.get(timeout=min(HEARTBEAT, self.remaining()))
                except queue.Empty:
                    yield b": keepalive\n\n"
                    continue
                yield frame(event)
                if event["type"] in ("end", "error"):
                    return
        finally:
            self.close()
