import json
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import TZ


ORIGIN = "http://127.0.0.1"
BROWSER = "Mozilla/5.0 Chrome/130.0 Safari/537.36"


class AdAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.admin = TestClient(self.app, base_url=ORIGIN)
        setup = self.admin.post("/api/auth/setup", json={"username": "ad_stats_admin", "password": "temporary-stats-password", "token": (self.db.directory / "setup.token").read_text()}).json()
        self.headers = {"X-CSRF-Token": setup["csrf"]}
        self.browser = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": BROWSER})
        self.clients = [self.browser, self.admin]
        self.ad = self.admin.post("/api/admin/ads", headers=self.headers, json={"name": "套餐订单", "title": "实际赞助商", "link": "https://example.com", "placement": "full", "side": "right", "booking_status": "published"}).json()

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.temp.cleanup()

    def tickets(self, client=None, page="/index.html"):
        return (client or self.browser).get("/api/public/bootstrap", headers={"Referer": ORIGIN + page}).json()["ads"]

    def test_parallel_report_request_does_not_replace_ad_visitor_or_tickets(self):
        headers = {"Referer": ORIGIN + "/index.html"}
        with patch("backend.ad_analytics.public_ads", side_effect=AssertionError("report request must not issue tickets")):
            reports = self.browser.get("/api/public/bootstrap?summary=true&reports_only=true", headers=headers)
        self.assertEqual(reports.status_code, 200)
        self.assertNotIn("set-cookie", reports.headers)
        self.assertEqual(reports.json()["ads"], [])
        self.assertEqual(reports.json()["announcements"], [])
        content = self.browser.get("/api/public/bootstrap?content_only=true", headers=headers)
        self.assertIn("modeltool_ad_visitor=", content.headers["set-cookie"])
        record = content.json()["ads"][0]
        self.assertEqual(self.send([self.event(record)]).json()["accepted"], 1)
        reports = self.browser.get("/api/public/bootstrap?summary=true&reports_only=true", headers=headers)
        self.assertNotIn("set-cookie", reports.headers)
        self.assertEqual(self.send([self.event(record, "click")]).json()["accepted"], 1)

    def event(self, record, kind="impression", view="pageview_1234567890", page="/index.html", **extra):
        return {"token": record["tracking_token"], "kind": kind, "view_id": view, "page": page, **extra}

    def send(self, events, client=None, **headers):
        return (client or self.browser).post("/api/public/advertising/events", json={"events": events}, headers={"Origin": ORIGIN, **headers})

    def report(self, **query):
        return self.admin.get("/api/admin/advertising/analytics", params=query).json()

    def test_package_slots_and_pages_are_independent_deduplicated_and_uv_not_summed(self):
        records = self.tickets()
        self.assertEqual({r["placement"] for r in records}, {"hero", "footer", "banner", "right"})
        events = [self.event(record) for record in records] + [self.event(records[0], "click")]
        self.assertEqual(self.send(events).json()["accepted"], 5)
        self.assertEqual(self.send(events).json()["duplicates"], 5)
        other_page = self.tickets(page="/trace.html")
        self.send([self.event(other_page[0], page="/trace.html", view="other_view_12345678")])
        result = self.report()
        self.assertEqual(result["summary"], {"impressions": 5, "clicks": 1, "visitors": 1, "ctr": 20.0})
        self.assertEqual(len(result["details"]), 5)
        self.assertEqual({row["page"] for row in result["pages"]}, {"/index.html", "/trace.html"})
        self.assertEqual(self.report(page="/trace.html")["summary"]["impressions"], 1)
        self.assertEqual(self.report(placement=records[0]["placement"])["summary"]["impressions"], 2)
        self.assertEqual(self.report(ad_id="other-ad")["summary"]["impressions"], 0)

    def test_each_ad_is_independent_even_with_same_link(self):
        second = self.admin.post("/api/admin/ads", headers=self.headers, json={"name": "独立订单", "title": "第二条", "link": "https://example.com", "placement": "hero", "booking_status": "published"}).json()
        records = self.tickets()
        self.send([self.event(r) for r in records if r["placement"] == "hero"])
        self.assertEqual(self.report(ad_id=second["id"])["summary"]["impressions"], 1)
        self.assertEqual(self.report(ad_id=self.ad["id"])["summary"]["impressions"], 1)

    def test_filtered_all_bot_internal_and_unknown_are_separate(self):
        record = self.tickets()[0]
        self.send([self.event(record)])
        self.send([self.event(record, view="webdriver_123456789", automated=True)])
        for index, ua in enumerate(("GPTBot/1.0", "curl/8.0", "unrecognized-client")):
            client = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": ua})
            self.clients.append(client)
            self.send([self.event(self.tickets(client)[0], view=f"client_pageview_{index:04d}")], client)
        self.send([self.event(self.tickets(self.admin)[0], view="internal_view_123456")], self.admin)
        result = self.report()
        self.assertEqual(result["summary"]["impressions"], 1)
        self.assertEqual(result["raw"]["impressions"], 6)
        self.assertEqual(result["classes"]["automated"]["impressions"], 3)
        self.assertEqual(result["classes"]["internal"]["impressions"], 1)
        self.assertEqual(result["classes"]["unknown"]["impressions"], 1)
        self.assertEqual(self.report(traffic="all")["summary"]["impressions"], 6)

    def test_credentials_origin_page_expiry_and_active_campaign_are_validated(self):
        record = self.tickets()[0]
        self.assertEqual(self.send([self.event(record)], Origin="https://attacker.example").status_code, 403)
        forged = self.event(record); forged["token"] = "x" * 50
        self.assertEqual(self.send([forged]).json()["rejected"], 1)
        self.assertEqual(self.send([self.event(record, page="/trace.html")]).json()["rejected"], 1)
        ticket = json.loads(self.db.cipher.decrypt(record["tracking_token"].encode()))
        ticket["expires"] = 0
        expired = record | {"tracking_token": self.db.cipher.encrypt(json.dumps(ticket).encode()).decode()}
        self.assertEqual(self.send([self.event(expired)]).json()["rejected"], 1)
        other = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": BROWSER}); self.clients.append(other)
        self.tickets(other)
        self.assertEqual(self.send([self.event(record)], other).json()["rejected"], 1)
        self.db.save("ads", self.ad["id"], self.ad | {"booking_status": "paused"})
        self.assertEqual(self.send([self.event(record)]).json()["rejected"], 1)
        self.assertEqual(self.report(traffic="all")["summary"]["impressions"], 0)

    def test_beijing_dates_history_privacy_and_auth(self):
        record = self.tickets()[0]
        at = datetime(2030, 1, 2, 0, 30, tzinfo=TZ).timestamp()
        ticket = json.loads(self.db.cipher.decrypt(record["tracking_token"].encode()))
        ticket["expires"] = at + 100
        record["tracking_token"] = self.db.cipher.encrypt(json.dumps(ticket).encode()).decode()
        with patch("backend.ad_analytics.now", return_value=at):
            self.assertEqual(self.send([self.event(record)]).json()["accepted"], 1)
        result = self.report(start="2030-01-02", end="2030-01-02")
        self.assertEqual(result["summary"]["impressions"], 1)
        self.assertEqual(result["trend"][0]["day"], "2030-01-02")
        self.assertEqual(self.report(start="2030-01-01", end="2030-01-01")["summary"]["impressions"], 0)
        self.assertEqual(self.browser.get("/api/admin/advertising/analytics").status_code, 401)
        for params in ({"start": "2030-01-02", "end": "2030-01-01"}, {"page": "/admin/"}, {"traffic": "fake"}, {"start": "2020-01-01", "end": "2030-01-01"}):
            self.assertEqual(self.admin.get("/api/admin/advertising/analytics", params=params).status_code, 422)
        self.assertNotIn("visitor\"", json.dumps(result))
        public = self.browser.get("/api/public/bootstrap").json()
        self.assertNotIn("ad_traffic", str(public))
        self.assertNotIn("tracking_token", str(public))  # no valid referring page, no tracking credential
        with self.db.connect() as con:
            con.execute("DELETE FROM entities WHERE kind='ads' AND id=?", (self.ad["id"],))
        history = self.report(start="2030-01-02", end="2030-01-02")
        self.assertEqual(history["summary"]["impressions"], 1)
        self.assertTrue(history["options"]["ads"][0]["deleted"])

    def test_statistics_assets_are_served_and_oversized_batch_is_rejected(self):
        self.assertEqual(self.browser.get("/admin/ad-analytics.js").status_code, 200)
        self.assertEqual(self.browser.get("/js/ad-analytics.js").status_code, 200)
        self.assertIn("/admin/ad-analytics.js?v=", self.browser.get("/admin/").text)
        self.assertIn("js/ad-analytics.js?v=", self.browser.get("/").text)
        record = self.tickets()[0]
        self.assertEqual(self.send([self.event(record)] * 21).status_code, 422)
        self.assertEqual(self.send([]).status_code, 422)
        self.assertEqual(self.browser.get("/api/public/bootstrap", headers={"Referer": "https://attacker.example/index.html"}).json()["ads"][0].get("tracking_token"), None)
        past = self.report(start="2000-01-01", end="2000-01-07")
        self.assertEqual(past["trend"], [])  # Unmeasured history must not become zero-valued traffic.

    def test_visitor_rate_limit_and_lifetime_order_counts(self):
        record = self.tickets()[0]
        ticket = json.loads(self.db.cipher.decrypt(record["tracking_token"].encode()))
        self.send([self.event(record)])
        total = self.admin.get("/api/admin/advertising/overview").json()["traffic_totals"][record["id"]]
        self.assertEqual(total, {"impressions": 1, "clicks": 0})
        from backend.core import now
        at = now()
        with self.db.connect(write=True) as con:
            con.executemany("INSERT INTO ad_traffic VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
                (at, datetime.fromtimestamp(at, TZ).date().isoformat(), record["id"], "Title", record["placement"], "/index.html", "impression", ticket["visitor"], f"rate_view_{i:08d}", "clean", "rule") for i in range(300)
            ])
        self.assertEqual(self.send([self.event(record, view="rate_limit_123456789")]).status_code, 429)


if __name__ == "__main__":
    unittest.main()
