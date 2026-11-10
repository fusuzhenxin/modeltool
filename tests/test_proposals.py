import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import Database, now


class ProposalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.admin = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        result = self.admin.post("/api/auth/setup", json={"username": "admin", "password": "proposal-test-password", "token": token})
        self.admin_headers = {"X-CSRF-Token": result.json()["csrf"]}
        self.guests = []
        self.guest, self.headers = self.visitor()

    def tearDown(self):
        for guest in self.guests:
            guest.close()
        self.admin.close()
        self.temp.cleanup()

    def visitor(self):
        guest = TestClient(self.app, base_url="http://127.0.0.1")
        self.guests.append(guest)
        response = guest.get("/api/public/proposal-session")
        self.assertEqual(response.status_code, 200)
        self.assertIn("site_trace", response.json()["tests"])
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        return guest, {"X-Proposal-CSRF": response.json()["csrf"]}

    def spec(self, **overrides):
        return {"name": "测试中转站", "website_url": "https://relay.example/register?ref=community", "models": ["test-model", "second-model"], "tests": ["site_relay", "site_trace", "site_candy", "site_pelican"], "description": "希望核对指纹、协议和指定模型的能力表现。", "author": "测试访客"} | overrides

    def create(self, **overrides):
        response = self.guest.post("/api/public/proposals", json=self.spec(**overrides), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def moderate(self, key, **overrides):
        spec = {"status": "collecting", "visible": True, "pinned": False, "admin_note": "", "report_id": "", "reply": ""} | overrides
        return self.admin.put("/api/admin/proposals/" + key, json=spec, headers=self.admin_headers)

    def test_optional_description_and_nickname(self):
        for i, extra in enumerate(({}, {"description": "", "author": ""}, {"description": "简述", "author": "   "})):
            spec = self.spec(website_url=f"https://optional{i}.example")
            spec.pop("description")
            spec.pop("author")
            response = self.guest.post("/api/public/proposals", json=spec | extra, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            detail = self.guest.get("/api/public/proposals/" + response.json()["id"]).json()["proposal"]
            self.assertEqual(detail["description"], extra.get("description", ""))
            self.assertEqual(detail["author"], "热心访客")

    def test_submission_persists_deduplicates_domain_and_never_starts_jobs(self):
        key = self.create(models=["test-model", "test-model"])
        response = self.guest.post("/api/public/proposals", json=self.spec(website_url="http://www.RELAY.example/another"), headers=self.headers)
        self.assertEqual(response.json(), {"id": key, "duplicate": True})
        detail = self.guest.get("/api/public/proposals/" + key).json()["proposal"]
        self.assertEqual(detail["domain"], "relay.example")
        self.assertEqual(detail["models"], ["test-model"])
        self.assertEqual(detail["status"], "collecting")
        self.assertNotIn("visitor", detail)
        Database(self.temp.name)
        self.assertEqual(len(self.admin.get("/api/admin/proposals").json()), 1)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM usage").fetchone()[0], 0)

    def test_votes_idempotent_toggle_and_distinct_visitors(self):
        key = self.create()
        path = "/api/public/proposals/" + key + "/vote"
        for _ in range(3):
            result = self.guest.put(path, json={"supported": True}, headers=self.headers)
            self.assertEqual(result.json(), {"supported": True, "votes": 1})
        other, headers = self.visitor()
        self.assertEqual(other.put(path, json={"supported": True}, headers=headers).json()["votes"], 2)
        self.assertTrue(self.guest.get("/api/public/proposals/" + key).json()["proposal"]["supported"])
        self.assertEqual(self.guest.get("/api/public/proposals").json()["stats"]["supporters"], 2)
        self.assertEqual(self.guest.put(path, json={"supported": False}, headers=self.headers).json()["votes"], 1)
        self.assertFalse(self.guest.get("/api/public/proposals/" + key).json()["proposal"]["supported"])
        self.assertEqual(self.guest.get("/api/public/proposal-session").json()["csrf"], self.headers["X-Proposal-CSRF"])

    def test_parallel_duplicate_votes_are_atomic(self):
        key = self.create()
        token = self.guest.cookies.get("modeltool_visitor")
        def support(_):
            with TestClient(self.app, base_url="http://127.0.0.1") as client:
                client.cookies.set("modeltool_visitor", token)
                return client.put("/api/public/proposals/" + key + "/vote", json={"supported": True}, headers=self.headers)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(support, range(4)))
        self.assertTrue(all(result.status_code == 200 and result.json()["votes"] == 1 for result in results))

    def test_comments_official_reply_visibility_restore_and_admin_auth(self):
        key = self.create()
        path = "/api/public/proposals/" + key + "/comments"
        content = '<img src=x onerror="alert(1)">希望测试推理模型'
        result = self.guest.post(path, json={"author": "普通访客", "content": content}, headers=self.headers)
        comment_id = result.json()["id"]
        self.assertEqual(self.guest.post(path, json={"content": "伪造官方", "official": True}, headers=self.headers).status_code, 422)
        self.assertEqual(self.moderate(key, status="testing", admin_note="正在核对模型指纹", reply="已收到，会测试指定模型。").status_code, 200)
        data = self.guest.get("/api/public/proposals/" + key).json()
        self.assertEqual(data["comments"]["total"], 2)
        self.assertEqual(data["comments"]["items"][0]["official"], 1)
        self.assertEqual(data["comments"]["items"][1]["content"], content)
        admin_path = "/api/admin/proposals/" + key + "/comments/" + comment_id
        self.assertEqual(self.guest.put(admin_path, json={"visible": False}).status_code, 401)
        self.assertEqual(self.admin.put(admin_path, json={"visible": False}, headers=self.admin_headers).status_code, 200)
        self.assertEqual(self.guest.get("/api/public/proposals/" + key).json()["comments"]["total"], 1)
        self.assertEqual(self.admin.get("/api/admin/proposals/" + key).json()["comments"]["total"], 2)
        self.admin.put(admin_path, json={"visible": True}, headers=self.admin_headers)
        self.assertEqual(self.guest.get("/api/public/proposals/" + key).json()["comments"]["total"], 2)

    def test_hidden_proposals_excluded_and_reject_public_interactions(self):
        key = self.create()
        self.assertEqual(self.moderate(key, visible=False).status_code, 200)
        self.assertEqual(self.guest.get("/api/public/proposals").json()["stats"]["proposals"], 0)
        self.assertEqual(self.guest.get("/api/public/proposals/" + key).status_code, 404)
        self.assertEqual(self.guest.put("/api/public/proposals/" + key + "/vote", json={"supported": True}, headers=self.headers).status_code, 404)
        self.assertEqual(self.guest.post("/api/public/proposals/" + key + "/comments", json={"content": "测试评论"}, headers=self.headers).status_code, 404)
        self.assertEqual(self.guest.post("/api/public/proposals", json=self.spec(), headers=self.headers).status_code, 409)
        self.assertEqual(len(self.admin.get("/api/admin/proposals").json()), 1)
        self.moderate(key, visible=True)
        self.assertEqual(self.guest.get("/api/public/proposals/" + key).status_code, 200)

    def test_csrf_cross_site_input_validation_and_keys_never_echoed(self):
        spec = self.spec()
        self.assertEqual(self.guest.post("/api/public/proposals", json=spec).status_code, 403)
        self.assertEqual(self.guest.post("/api/public/proposals", json=spec, headers=self.headers | {"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.guest.post("/api/public/proposals", json=spec, headers=self.headers | {"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        for invalid in (dict(tests=[]), dict(models=[]), dict(tests=["imaginary"]), dict(website_url="javascript:alert(1)"), dict(website_url="https://user:pass@example.com"), dict(website_url="http://127.0.0.1"), dict(website_url="https://host.local"), dict(website_url="https://relay.example/?token=private"), dict(status="completed")):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.guest.post("/api/public/proposals", json=spec | invalid, headers=self.headers).status_code, 422)
        secret = "sk-never-public-secret-key-123456789"
        response = self.guest.post("/api/public/proposals", json=spec | {"description": secret}, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)
        self.assertEqual(self.guest.get("/api/admin/proposals").status_code, 401)
        self.assertEqual(self.admin.put("/api/admin/proposals/missing", json={"status": "testing"}).status_code, 403)

    def test_rate_limit_is_persistent_and_shared_by_address(self):
        for i in range(5):
            self.create(website_url=f"https://relay{i}.example")
        other, headers = self.visitor()
        self.assertEqual(other.post("/api/public/proposals", json=self.spec(website_url="https://relay99.example"), headers=headers).status_code, 429)
        self.assertEqual(self.guest.get("/api/public/proposals").json()["total"], 5)

    def test_report_link_only_public_and_withdrawal_removes_public_link(self):
        key = self.create()
        self.db.save("stations", "station", {"visible": True})
        self.db.save("reports", "report", {"station_id": "station", "status": "draft"})
        self.assertEqual(self.moderate(key, report_id="report").status_code, 422)
        self.db.save("reports", "report", {"station_id": "station", "status": "published"})
        self.assertEqual(self.moderate(key, status="completed", report_id="report").status_code, 200)
        data = self.guest.get("/api/public/proposals/" + key).json()["proposal"]
        self.assertEqual(data["report_id"], "report")
        self.db.save("reports", "report", {"station_id": "station", "status": "rejected"})
        self.assertEqual(self.guest.get("/api/public/proposals/" + key).json()["proposal"]["report_id"], "")

    def test_search_status_sort_pagination_and_comment_pages(self):
        first = self.create()
        with self.db.connect(write=True) as con:
            for i in range(14):
                spec = self.spec(name=f"候选站 {i}", website_url=f"https://site{i}.example") | {"status": "completed" if i == 0 else "collecting", "visible": True, "pinned": i == 1, "admin_note": "", "report_id": ""}
                con.execute("INSERT INTO proposals VALUES(?,?,?,?,?)", (str(i), f"site{i}.example", json.dumps(spec, ensure_ascii=False), now() + i, now()))
            for i in range(35):
                con.execute("INSERT INTO proposal_comments(id,proposal_id,author,content,created) VALUES(?,?,?,?,?)", (str(i), first, "访客", f"评论{i}", now() + i))
        listing = self.guest.get("/api/public/proposals").json()
        self.assertEqual(listing["total"], 15)
        self.assertEqual(len(listing["items"]), 12)
        self.assertEqual(listing["items"][0]["id"], "1")
        self.assertEqual(len(self.guest.get("/api/public/proposals?page=2").json()["items"]), 3)
        filtered = self.guest.get("/api/public/proposals?status=completed&q=site0").json()
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(self.guest.get("/api/public/proposals?sort=newest").json()["items"][1]["id"], "13")
        comments = self.guest.get("/api/public/proposals/" + first + "?page=2").json()["comments"]
        self.assertEqual(comments["total"], 35)
        self.assertEqual(len(comments["items"]), 5)
        self.assertEqual(self.guest.get("/api/public/proposals?status=invalid").status_code, 422)
        self.assertEqual(self.guest.get("/api/public/proposals?page=0").status_code, 422)


if __name__ == "__main__":
    unittest.main()
