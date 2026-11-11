"""Streaming fixtures use no model API calls or real long waits."""
import asyncio
import json
import http.client
import socket
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from chat_stream import ChatStream, LONG_TIMEOUT
from backend.proxy import live_events
from backend.core import Database, now
from backend.worker import renew_lease


class FakeSocket:
    def __init__(self):
        self.timeouts = []
        self.closed = False
    def settimeout(self, value):
        self.timeouts.append(value)
    def shutdown(self, *_):
        self.closed = True


class Connection:
    status = 200
    gate = None
    pieces = []
    def __init__(self, *_args, **_kwargs):
        self.sock = FakeSocket()
        self.chunks = iter(self.pieces)
    def connect(self):
        pass
    def request(self, *args):
        self.request_args = args
    def getresponse(self):
        if self.gate:
            self.gate.wait(2)
        return self
    def read1(self, _size):
        return next(self.chunks, b"")
    def close(self):
        pass


class StreamingTests(unittest.TestCase):
    def make(self, **kwargs):
        return ChatStream({"baseUrl": "https://fixture.invalid/v1", "apiKey": "sk-test-secret", "payload": {"stream": True}}, lambda _: "https://fixture.invalid/v1/chat/completions", lambda _: "192.0.2.1", **kwargs)

    def decode(self, events):
        return [json.loads(row.decode()[6:]) for row in events if row.startswith(b"data:")]

    def test_connected_and_heartbeat_arrive_before_upstream_headers(self):
        gate, finished = threading.Event(), threading.Event()
        with patch("chat_stream.http.client.HTTPSConnection", Connection), patch.object(Connection, "gate", gate), patch("chat_stream.HEARTBEAT", .01):
            stream = self.make(on_finish=finished.set)
            events = stream.events()
            self.assertEqual(next(events), b": connected\n\n")
            self.assertEqual(next(events), b": keepalive\n\n")
            gate.set()
            result = self.decode(list(events))
            self.assertEqual(result[0], {"type": "status", "status": 200})
            self.assertEqual(result[-1]["type"], "end")
            self.assertTrue(finished.wait(1))

    def test_split_credentials_are_redacted_and_utf8_is_preserved(self):
        text = 'data: {"choices":[{"delta":{"content":"鹈鹕😀 sk-test-secret"}}]}\n\n'
        pieces = [bytes([byte]) for byte in text.encode()]
        with patch("chat_stream.http.client.HTTPSConnection", Connection), patch.object(Connection, "pieces", pieces):
            result = self.decode(list(self.make().events()))
        joined = "".join(row.get("text", "") for row in result)
        self.assertEqual(joined, text.replace("sk-test-secret", "[redacted]"))

    def test_six_minute_silence_is_within_limit_and_thirty_minutes_is_bounded(self):
        clock = [0]
        gate = threading.Event()
        with patch("chat_stream.time", SimpleNamespace(monotonic=lambda: clock[0])), patch("chat_stream.http.client.HTTPSConnection", Connection), patch.object(Connection, "gate", gate):
            stream = self.make()
            events = stream.events()
            next(events)
            clock[0] = 360
            gate.set()
            result = self.decode(list(events))
            self.assertEqual(result[-1]["type"], "end")
            self.assertEqual(LONG_TIMEOUT, 1800)
            expired = self.make()
            expired.started -= LONG_TIMEOUT
            self.assertIn("30 分钟", self.decode(list(expired.events()))[-1]["message"])

    def test_browser_disconnect_closes_socket_and_releases_slot(self):
        async def check():
            finished = threading.Event()
            stream = self.make(on_finish=finished.set)
            events = live_events(stream)
            self.assertEqual(await anext(events), b": connected\n\n")
            await events.aclose()
            self.assertTrue(stream.stopped.is_set())
            self.assertTrue(finished.wait(1))
        with patch("chat_stream.http.client.HTTPSConnection", Connection):
            asyncio.run(check())

    def test_task_lease_and_worker_heartbeat_are_renewed(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Database(temp)
            with db.connect(write=True) as con:
                con.execute("INSERT INTO jobs(id,station_id,model,config,status,created,lease) VALUES('job','station','model','{}','running',?,?)", (now(), now() - 1))
            renew_lease(db, "job")
            with db.connect() as con:
                self.assertGreater(con.execute("SELECT lease FROM jobs").fetchone()[0], now() + 170)
                self.assertLess(now() - con.execute("SELECT heartbeat FROM worker").fetchone()[0], 2)

    def test_real_http_flushes_before_upstream_finishes_on_both_servers(self):
        import uvicorn
        import serve
        from backend.app import create_app
        ready, finish = threading.Event(), threading.Event()
        class Upstream(BaseHTTPRequestHandler):
            def do_POST(handler):
                payload = json.loads(handler.rfile.read(int(handler.headers["Content-Length"])))
                self.assertTrue(payload["stream"])
                ready.wait(3)
                handler.send_response(200)
                handler.send_header("Content-Type", "text/event-stream")
                handler.end_headers()
                handler.wfile.write('data: {"choices":[{"delta":{"content":"鹈鹕"}}]}\n\n'.encode())
                handler.wfile.flush()
                finish.wait(3)
                handler.wfile.write(b"data: [DONE]\n\n"); handler.wfile.flush()
            def log_message(*_):
                pass
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True); upstream_thread.start()
        try:
            for mode in ("operations", "local"):
                with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                    ready.clear(); finish.clear()
                    if mode == "operations":
                        listener = socket.socket(); listener.bind(("127.0.0.1", 0))
                        port = listener.getsockname()[1]
                        server = uvicorn.Server(uvicorn.Config(create_app(temp), log_level="error", access_log=False))
                        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
                    else:
                        server = ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
                        port = server.server_port
                        thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        if mode == "operations":
                            for _ in range(100):
                                if server.started: break
                                time.sleep(.01)
                        body = json.dumps({"baseUrl": f"http://fixture.invalid:{upstream.server_port}/v1", "apiKey": "test-only", "payload": {"stream": True}, "streamResponse": True})
                        with patch("backend.proxy.resolve_public", return_value="127.0.0.1"), patch("chat_stream.socket.getaddrinfo", wraps=socket.getaddrinfo) as _dns:
                            # Local preview intentionally allows loopback fixtures, as before.
                            if mode == "local": body = body.replace("fixture.invalid", "127.0.0.1")
                            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                            connection.request("POST", "/api/chat", body, {"Content-Type": "application/json"})
                            response = connection.getresponse()
                            self.assertEqual(response.getheader("X-ModelTool-Stream"), "1")
                            self.assertIn(b": connected", response.read1(4096))
                            ready.set()
                            partial = b""
                            while b'"type": "chunk"' not in partial:
                                partial += response.read1(4096)
                            self.assertFalse(finish.is_set())
                            self.assertIn("鹈鹕", "".join(row.get("text", "") for row in self.decode(partial.splitlines(keepends=True))))
                            finish.set()
                            self.assertIn(b'"type": "end"', response.read())
                            connection.close()
                    finally:
                        ready.set(); finish.set()
                        if mode == "operations": server.should_exit = True
                        else: server.shutdown(); server.server_close()
                        thread.join(3)
        finally:
            ready.set(); finish.set()
            upstream.shutdown(); upstream.server_close(); upstream_thread.join(3)


if __name__ == "__main__":
    unittest.main()
