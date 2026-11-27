import csv
import io
import json
import tempfile
import unittest

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import now
from backend.station_traffic import COOKIE

ORIGIN = "https://127.0.0.1"
BROWSER = "Mozilla/5.0 Chrome/130.0 Safari/537.36"


class StationTrafficTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name); self.db = self.app.state.db
        self.admin = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": BROWSER})
        setup = self.admin.post("/api/auth/setup", json={"username": "station_stats", "password": "temporary-station-stats-password",
                    "token": (self.db.directory / "setup.token").read_text()}).json()
        self.headers = {"X-CSRF-Token": setup["csrf"]}
        self.browser = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": BROWSER})
        self.clients = [self.admin, self.browser]
        self.station = self.admin.post("/api/admin/stations", headers=self.headers, json={"name": "站点甲", "base_url": "https://relay.example/v1",
                    "models": ["test-model"], "api_key": "sk-private-detection-key"}).json()
        self.sid = self.station["id"]

    def tearDown(self):
        for client in self.clients: client.close()
        self.temp.cleanup()

    def tokens(self, page="daily", client=None, ids=None):
        path = "/stations.html" if page == "directory" else "/relays.html?view=stability" if page == "stability" else "/relays.html?utm_source=test"
        return (client or self.browser).post("/api/public/station-traffic/session", json={"page": page, "station_ids": ids or [self.sid]},
                    headers={"Origin": ORIGIN, "Referer": ORIGIN + path})

    def event(self, token, kind="impression", **changes):
        return {"token": token, "view_id": "station_pageview_123456", "page": "daily", "placement": "daily_card", "kind": kind, **changes}

    def send(self, events, client=None, **headers):
        return (client or self.browser).post("/api/public/station-traffic/events", json={"events": events}, headers={"Origin": ORIGIN, **headers})

    def stats(self, **params):
        response = self.admin.get("/api/admin/station-traffic", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_pages_positions_and_click_kinds_are_independent_and_uv_is_deduplicated(self):
        daily = self.tokens().json()["tokens"][self.sid]
        stable = self.tokens("stability").json()["tokens"][self.sid]
        directory = self.tokens("directory").json()["tokens"][self.sid]
        events = [self.event(daily, kind) for kind in ("impression", "outbound", "profile", "report")]
        events += [self.event(stable, kind, page="stability", placement=slot) for slot in ("stability_ranked", "stability_observing") for kind in ("impression", "outbound", "details")]
        events.append(self.event(directory, page="directory", placement="directory_card"))
        self.assertEqual(self.send(events).json()["accepted"], 11)
        self.assertEqual(self.send(events).json()["duplicates"], 11)
        result = self.stats()
        self.assertEqual(result["summary"]["impressions"], 4)
        self.assertEqual(result["summary"]["outbound"], 3)
        self.assertEqual(result["summary"]["internal_clicks"], 4)
        self.assertEqual(result["summary"]["visitors"], 1)
        self.assertEqual(result["summary"]["outbound_visitors"], 1)
        self.assertEqual(result["summary"]["ctr"], 75)
        self.assertEqual(len(result["details"]), 4)
        self.assertEqual(self.stats(page="stability")["summary"]["impressions"], 2)
        self.assertEqual(self.stats(placement="daily_card")["summary"]["report"], 1)

    def test_organic_and_ad_events_never_cross_count(self):
        ad = self.admin.post("/api/admin/ads", headers=self.headers, json={"name": "独立广告", "title": "广告", "link": "https://example.com", "placement": "hero", "booking_status": "published"}).json()
        station_token = self.tokens().json()["tokens"][self.sid]
        ad_token = self.browser.get("/api/public/bootstrap?content_only=true", headers={"Referer": ORIGIN + "/relays.html"}).json()["ads"][0]["tracking_token"]
        self.assertEqual(self.send([self.event(station_token)]).json()["accepted"], 1)
        self.assertEqual(self.send([self.event(ad_token)]).json()["rejected"], 1)
        response = self.browser.post("/api/public/advertising/events", headers={"Origin": ORIGIN}, json={"events": [
            {"token": ad_token, "view_id": "ad_pageview_123456", "kind": "impression", "page": "/relays.html"}]})
        self.assertEqual(response.json()["accepted"], 1)
        self.assertEqual(self.stats()["summary"]["impressions"], 1)
        ad_stats = self.admin.get("/api/admin/advertising/analytics").json()
        self.assertEqual(ad_stats["summary"]["impressions"], 1)
        self.assertEqual(ad_stats["ads"][0]["id"], ad["id"])

    def test_invalid_expired_cross_visitor_and_wrong_placement_tickets_are_rejected(self):
        token = self.tokens().json()["tokens"][self.sid]
        ticket = json.loads(self.db.cipher.decrypt(token.encode()))
        expired = self.db.cipher.encrypt(json.dumps(ticket | {"expires": now() - 1}).encode()).decode()
        other = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": BROWSER}); self.clients.append(other)
        self.tokens(client=other)
        self.assertEqual(self.send([self.event(token)], client=other).json()["rejected"], 1)
        for event in (self.event(expired), self.event(token, placement="stability_ranked"), self.event("invalid-ticket-value-1234567")):
            self.assertEqual(self.send([event]).json()["rejected"], 1)
        self.assertEqual(self.stats()["summary"]["impressions"], 0)

    def test_hiding_station_immediately_revokes_collection_but_keeps_private_history(self):
        token = self.tokens().json()["tokens"][self.sid]
        self.send([self.event(token)])
        saved = self.db.get("stations", self.sid); self.db.save("stations", self.sid, saved | {"visible": False})
        self.assertEqual(self.tokens().json()["tokens"], {})
        self.assertEqual(self.send([self.event(token, view_id="another_pageview_12345")]).json()["rejected"], 1)
        self.assertEqual(self.stats()["summary"]["impressions"], 1)
        self.assertTrue(self.stats()["options"]["stations"][0]["hidden"])

    def test_traffic_classes_admin_and_automation_are_separate_from_visitors(self):
        clean = self.tokens().json()["tokens"][self.sid]
        self.send([self.event(clean)])
        admin = self.tokens(client=self.admin).json()["tokens"][self.sid]
        self.send([self.event(admin)], client=self.admin)
        bot = TestClient(self.app, base_url=ORIGIN, headers={"User-Agent": "GPTBot/1.3"}); self.clients.append(bot)
        token = self.tokens(client=bot).json()["tokens"][self.sid]
        self.send([self.event(token)], client=bot)
        self.assertEqual(self.stats()["summary"]["impressions"], 1)
        self.assertEqual(self.stats(traffic="all")["summary"]["impressions"], 3)
        self.assertEqual(self.stats(traffic="automated")["summary"]["impressions"], 1)
        self.assertEqual(self.stats(traffic="internal")["summary"]["impressions"], 1)

    def test_private_reports_and_csv_require_login_and_inputs_are_bounded(self):
        for path in ("/api/admin/station-traffic", "/api/admin/station-traffic/report.csv"):
            self.assertEqual(self.browser.get(path).status_code, 401)
        self.assertEqual(self.tokens().headers["cache-control"], "no-store")
        for params in ({"start": "2026-11-27", "end": "2026-11-01"}, {"page": "admin"}, {"placement": "hero"}, {"traffic": "invalid"}):
            self.assertEqual(self.admin.get("/api/admin/station-traffic", params=params).status_code, 422)
        token = self.tokens().json()["tokens"][self.sid]
        self.assertEqual(self.send([self.event(token)], Origin="https://evil.example").status_code, 403)
        self.assertEqual(self.send([self.event(token)] * 21).status_code, 422)
        self.assertEqual(self.browser.post("/api/public/station-traffic/session", json={"page": "stability", "station_ids": [self.sid]}, headers={"Origin": ORIGIN, "Referer": ORIGIN + "/relays.html"}).status_code, 403)

    def test_csv_is_scoped_and_formula_safe_without_private_data(self):
        saved = self.db.get("stations", self.sid); self.db.save("stations", self.sid, saved | {"name": "=SUM(1,1)"})
        token = self.tokens().json()["tokens"][self.sid]
        self.send([self.event(token), self.event(token, "outbound")])
        response = self.admin.get("/api/admin/station-traffic/report.csv", params={"station_id": self.sid})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.text.lstrip("\ufeff"))))
        self.assertEqual(rows[1][0], "'=SUM(1,1)")
        for private in ("sk-private-detection-key", "base_url", "key_cipher", "modeltool_station_visitor"):
            self.assertNotIn(private, response.text)

    def test_new_module_starts_empty_and_never_counts_issued_tickets_as_views(self):
        self.tokens()
        self.assertEqual(self.stats()["summary"]["impressions"], 0)
        self.assertGreater(self.stats()["started_at"], 0)
        with self.db.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM ad_traffic").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT count(*) FROM station_traffic").fetchone()[0], 0)
