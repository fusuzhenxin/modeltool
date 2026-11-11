import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from backend.app import create_app


class ArtworkVoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.db.save("stations", "site", {"name": "测试站", "domain": "test.example", "visible": True})
        self.report = {"station_id": "site", "status": "published", "result": {"artwork": {"available": True, "html": "<svg/>"}}}
        self.db.save("reports", "art", self.report)
        self.clients = []
        self.client, self.headers = self.visitor()
        self.path = "/api/public/reports/art/artwork-vote"

    def visitor(self):
        client = TestClient(self.app, base_url="http://127.0.0.1")
        self.clients.append(client)
        csrf = client.get("/api/public/proposal-session").json()["csrf"]
        return client, {"X-Proposal-CSRF": csrf}

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.temp.cleanup()

    def vote(self, choice):
        response = self.client.put(self.path, json={"choice": choice}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_idempotence_switch_withdraw_and_distinct_visitors(self):
        for _ in range(2):
            self.assertEqual(self.vote("real"), {"real": 1, "fake": 0, "choice": "real"})
        other, headers = self.visitor()
        self.assertEqual(other.put(self.path, json={"choice": "fake"}, headers=headers).json(), {"real": 1, "fake": 1, "choice": "fake"})
        self.assertEqual(self.vote("fake"), {"real": 0, "fake": 2, "choice": "fake"})
        self.assertEqual(self.vote(None), {"real": 0, "fake": 1, "choice": None})
        self.assertEqual(self.vote(None), {"real": 0, "fake": 1, "choice": None})

    def test_refresh_restart_and_anonymous_counts_preserve_privacy(self):
        self.vote("real")
        listing = self.client.get("/api/public/artwork-votes?ids=art").json()
        self.assertEqual(listing["items"]["art"]["choice"], "real")
        restarted = TestClient(create_app(self.temp.name), base_url="http://127.0.0.1")
        with restarted:
            restarted.cookies.set("modeltool_visitor", self.client.cookies.get("modeltool_visitor"))
            response = restarted.get("/api/public/artwork-votes?ids=art")
            self.assertEqual(response.json(), listing)
            self.assertEqual(response.headers["cache-control"], "no-store")
            restarted.cookies.clear()
            self.assertEqual(restarted.get("/api/public/artwork-votes?ids=art").json()["items"]["art"], {"real": 1, "fake": 0, "choice": None})
            self.assertNotIn("visitor", response.text)
            self.assertNotIn("<svg", response.text)

    def test_hidden_unpublished_and_missing_artwork_reject_reads_and_votes(self):
        self.vote("real")
        for status in ["draft", "rejected"]:
            self.db.save("reports", "art", self.report | {"status": status})
            self.assertEqual(self.client.get("/api/public/artwork-votes?ids=art").json()["items"], {})
            self.assertEqual(self.client.put(self.path, json={"choice": "fake"}, headers=self.headers).status_code, 404)
        self.db.save("reports", "art", self.report)
        self.db.save("stations", "site", {"visible": False})
        self.assertEqual(self.client.put(self.path, json={"choice": "fake"}, headers=self.headers).status_code, 404)
        self.db.save("stations", "site", {"visible": True})
        self.db.save("reports", "art", self.report | {"result": {"artwork": {"available": True}}})
        self.assertEqual(self.client.put(self.path, json={"choice": "real"}, headers=self.headers).status_code, 404)
        self.db.save("reports", "art", self.report)
        self.assertEqual(self.client.get("/api/public/artwork-votes?ids=art").json()["items"]["art"]["real"], 1)

    def test_csrf_origin_invalid_choices_and_bounded_reads(self):
        self.assertEqual(self.client.put(self.path, json={"choice": "real"}).status_code, 403)
        for extra in [{"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}]:
            self.assertEqual(self.client.put(self.path, json={"choice": "real"}, headers=self.headers | extra).status_code, 403)
        for data in [{"choice": True}, {"choice": "invalid"}, {"choice": "real", "votes": 999}, {}]:
            self.assertEqual(self.client.put(self.path, json=data, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get("/api/public/artwork-votes?ids=" + ",".join(map(str, range(25)))).status_code, 422)

    def test_parallel_submissions_keep_one_vote(self):
        cookie = self.client.cookies.get("modeltool_visitor")
        def submit(_):
            with TestClient(self.app, base_url="http://127.0.0.1") as client:
                client.cookies.set("modeltool_visitor", cookie)
                return client.put(self.path, json={"choice": "real"}, headers=self.headers).json()
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(submit, range(10)))
        self.assertTrue(all(row == {"real": 1, "fake": 0, "choice": "real"} for row in results))

    def test_rate_limits_are_shared_by_address_and_noop_does_not_consume(self):
        with self.db.connect(write=True) as con:
            import hmac, hashlib
            from backend.core import now
            secret = (self.db.directory / "encryption.key").read_bytes()
            address = hmac.new(secret, b"testclient", hashlib.sha256).hexdigest()
            con.executemany("INSERT INTO proposal_activity VALUES(?,?,?,?)", [("other", address, "artwork_vote", now())] * 120)
        self.assertEqual(self.vote(None), {"real": 0, "fake": 0, "choice": None})
        self.assertEqual(self.client.put(self.path, json={"choice": "real"}, headers=self.headers).status_code, 429)
