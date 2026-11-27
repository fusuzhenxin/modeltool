import csv
import io
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import Database, TZ, now, password_ok
from backend.manage import backup, restore

ORIGIN = "http://127.0.0.1"
PASSWORD = "temporary-sponsor-password"


class SponsorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.admin = TestClient(self.app, base_url=ORIGIN)
        setup = self.admin.post("/api/auth/setup", json={"username": "ops_admin", "password": "temporary-admin-password", "token": (self.db.directory / "setup.token").read_text()}).json()
        self.headers = {"X-CSRF-Token": setup["csrf"]}
        self.clients = [self.admin]
        self.ads = []
        for title in ("Sponsor A", "Sponsor B", "Other Sponsor"):
            response = self.admin.post("/api/admin/ads", headers=self.headers, json={"name": "private-name-" + title, "title": title, "placement": "hero", "link": "https://example.com", "contact": "private-contact", "internal_note": "private-note", "contract_cents": 98765})
            self.assertEqual(response.status_code, 200, response.text)
            self.ads.append(response.json())
        self.account = self.save("station_a", [self.ads[0]["id"], self.ads[1]["id"]]).json()
        self.other = self.save("station_b", [self.ads[2]["id"]]).json()
        self.viewer = self.client()
        self.auth = self.login().json()

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.temp.cleanup()

    def client(self, **kwargs):
        client = TestClient(self.app, base_url=ORIGIN, **kwargs)
        self.clients.append(client)
        return client

    def save(self, username, ids, key=None, **changes):
        spec = {"username": username, "display_name": username, "password": PASSWORD if not key else "", "enabled": True, "ad_ids": ids} | changes
        return self.admin.request("PUT" if key else "POST", "/api/admin/sponsors" + ("/" + key if key else ""), headers=self.headers, json=spec)

    def login(self, client=None, **changes):
        return (client or self.viewer).post("/api/sponsor/login", json={"username": "station_a", "password": PASSWORD} | changes)

    def seed_traffic(self):
        today = datetime.now(TZ).date().isoformat()
        rows = []
        for index, ad in enumerate(self.ads):
            for slot in ("hero", "footer"):
                for page in ("/index.html", "/relays.html"):
                    for kind in ("impression", "click"):
                        for traffic in ("clean", "automated", "internal", "unknown"):
                            rows.append((now(), today, ad["id"], ad["title"], slot, page, kind, "same-visitor", f"view-{index}-{traffic}", traffic, "test"))
        with self.db.connect(write=True) as con:
            con.executemany("INSERT INTO ad_traffic VALUES(?,?,?,?,?,?,?,?,?,?,?)", rows)

    def test_scope_covers_aggregates_trends_options_filters_and_export(self):
        self.seed_traffic()
        response = self.viewer.get("/api/sponsor/analytics")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["summary"], {"impressions": 8, "clicks": 8, "visitors": 1, "ctr": 100.0})
        self.assertEqual(data["raw"]["impressions"], 32)
        self.assertEqual(data["classes"]["automated"]["impressions"], 8)
        self.assertEqual(data["trend"][-1]["impressions"], 8)
        self.assertEqual({r["id"] for r in data["options"]["ads"]}, set(self.account["ad_ids"]))
        for secret in ("Other Sponsor", self.ads[2]["id"], "private-name", "private-contact", "private-note", "98765"):
            self.assertNotIn(secret, response.text)
        filtered = self.viewer.get("/api/sponsor/analytics", params={"placement": "footer", "page": "/relays.html", "traffic": "all"}).json()
        self.assertEqual(filtered["summary"]["impressions"], 8)
        own = self.viewer.get("/api/sponsor/analytics", params={"ad_id": self.ads[0]["id"]}).json()
        self.assertEqual(own["summary"]["impressions"], 4)
        csv_response = self.viewer.get("/api/sponsor/report.csv?traffic=all")
        self.assertEqual(csv_response.status_code, 200)
        self.assertNotIn("Other Sponsor", csv_response.text)
        rows = list(csv.reader(io.StringIO(csv_response.content.decode("utf-8-sig"))))
        self.assertEqual(len(rows), 9)
        for endpoint in ("analytics", "report.csv"):
            self.assertEqual(self.viewer.get("/api/sponsor/" + endpoint, params={"ad_id": self.ads[2]["id"]}).status_code, 404)
        self.assertEqual(self.viewer.get("/api/sponsor/analytics?account_id=" + self.other["id"]).json()["summary"]["impressions"], 8)

    def test_read_only_role_and_cookie_separation(self):
        for path in ("/api/admin/sponsors", "/api/admin/stations", "/api/admin/advertising/overview", "/api/admin/advertising/analytics"):
            self.assertEqual(self.viewer.get(path).status_code, 401, path)
        self.assertEqual(self.viewer.post("/api/admin/ads", json={}, headers={"X-CSRF-Token": self.auth["csrf"]}).status_code, 401)
        self.assertEqual(self.viewer.get("/api/auth/session").json()["authenticated"], False)
        self.assertEqual(self.admin.get("/api/sponsor/session").json()["authenticated"], False)
        self.assertEqual(self.admin.get("/api/sponsor/campaigns").status_code, 401)
        self.assertEqual(self.viewer.get("/api/sponsor/session").json()["authenticated"], True)
        self.assertEqual(self.viewer.post("/api/sponsor/logout", json={}).status_code, 403)
        self.assertEqual(self.viewer.post("/api/sponsor/logout", json={}, headers={"X-CSRF-Token": self.auth["csrf"], "Origin": "https://attacker.example"}).status_code, 403)
        self.assertEqual(self.viewer.post("/api/sponsor/logout", json={}, headers={"X-CSRF-Token": self.auth["csrf"]}).status_code, 200)
        for endpoint in ("analytics", "report.csv", "campaigns"):
            self.assertEqual(self.viewer.get("/api/sponsor/" + endpoint).status_code, 401)

    def test_assignment_is_exclusive_atomic_and_removed_immediately(self):
        self.seed_traffic()
        conflict = self.save("station_b", [self.ads[0]["id"]], self.other["id"])
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.save("station_a", ["missing-ad"], self.account["id"]).status_code, 422)
        self.assertEqual(self.viewer.get("/api/sponsor/analytics").json()["summary"]["impressions"], 8)
        self.assertEqual(self.save("station_a", [], self.account["id"]).status_code, 200)
        empty = self.viewer.get("/api/sponsor/analytics").json()
        self.assertEqual(empty["summary"]["impressions"], 0)
        self.assertEqual(empty["options"]["ads"], [])
        self.assertEqual(empty["details"], [])
        self.assertEqual(empty["pages"], [])
        self.assertEqual(empty["raw"]["impressions"], 0)
        self.assertEqual(self.viewer.get("/api/sponsor/campaigns").json()["campaigns"], [])

    def test_disable_and_reset_revoke_sessions_password_is_never_returned(self):
        self.seed_traffic()
        second = self.client(); self.login(second)
        new_password = "new-sponsor-password-2026"
        updated = self.save("station_a", self.account["ad_ids"], self.account["id"], password=new_password)
        self.assertEqual(updated.status_code, 200)
        self.assertNotIn(new_password, updated.text)
        for client in (self.viewer, second):
            self.assertEqual(client.get("/api/sponsor/analytics").status_code, 401)
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(self.login(password=new_password).status_code, 200)
        self.assertEqual(self.save("station_a", self.account["ad_ids"], self.account["id"], enabled=False).status_code, 200)
        self.assertEqual(self.viewer.get("/api/sponsor/analytics").status_code, 401)
        self.assertEqual(self.login(password=new_password).status_code, 401)
        listing = self.admin.get("/api/admin/sponsors")
        self.assertNotIn(new_password, listing.text)
        self.assertNotIn('"password"', listing.text)
        with self.db.connect() as con:
            encoded = con.execute("SELECT password FROM sponsor_accounts WHERE id=?", (self.account["id"],)).fetchone()[0]
        self.assertNotEqual(encoded, new_password)
        self.assertTrue(password_ok(new_password, encoded))

    def test_validation_case_insensitivity_throttling_and_session_expiry(self):
        self.assertEqual(self.save("STATION_A", []).status_code, 409)
        self.assertEqual(self.login(username="STATION_A").status_code, 200)
        self.assertEqual(self.save("too_short", [], password="short").status_code, 422)
        self.assertEqual(self.save("blank_name", [], display_name=" ").status_code, 422)
        self.assertEqual(self.save("wrong_role", [], role="admin").status_code, 422)
        self.assertEqual(self.viewer.get("/api/sponsor/analytics?traffic=invalid").status_code, 422)
        self.assertEqual(self.viewer.get("/api/sponsor/analytics?start=2024-01-01&end=2026-01-01").status_code, 422)
        with self.db.connect(write=True) as con:
            con.execute("UPDATE sponsor_sessions SET expires=0")
        self.assertEqual(self.viewer.get("/api/sponsor/analytics").status_code, 401)
        for _ in range(10):
            self.assertEqual(self.login(password="wrong-password-123").status_code, 401)
        self.assertEqual(self.login().status_code, 429)
        self.assertEqual(self.admin.get("/api/auth/session").json()["authenticated"], True)

    def test_campaign_fields_status_and_deleted_history_remain_private(self):
        self.seed_traffic()
        response = self.viewer.get("/api/sponsor/campaigns")
        self.assertEqual(len(response.json()["campaigns"]), 2)
        for secret in ("private-", "Other Sponsor", "contract_cents", "received_cents", "advertiser"):
            self.assertNotIn(secret, response.text)
        with self.db.connect(write=True) as con:
            con.execute("DELETE FROM entities WHERE kind='ads' AND id=?", (self.ads[0]["id"],))
        report = self.viewer.get("/api/sponsor/analytics").json()
        self.assertEqual(report["summary"]["impressions"], 8)
        self.assertTrue(next(r for r in report["ads"] if r["id"] == self.ads[0]["id"])["deleted"])
        listing = self.admin.get("/api/admin/sponsors").json()
        self.assertTrue(next(r for r in listing["ads"] if r["id"] == self.ads[0]["id"])["deleted"])

    def test_csv_formula_guard_and_restore_invalidate_sponsor_sessions(self):
        self.seed_traffic()
        row = self.ads[0] | {"title": " =HYPERLINK(\"https://example.com\")"}
        self.db.save("ads", row["id"], row)
        csv_response = self.viewer.get("/api/sponsor/report.csv")
        self.assertIn("' =HYPERLINK", csv_response.text)
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "backup.zip"
            backup(self.db, archive)
            restore(archive, Path(directory) / "restored")
            restored = Database(Path(directory) / "restored")
            with restored.connect() as con:
                self.assertEqual(con.execute("SELECT count(*) FROM sponsor_sessions").fetchone()[0], 0)
                self.assertEqual(con.execute("SELECT count(*) FROM sponsor_accounts").fetchone()[0], 2)

    def test_portal_headers_and_no_unprovisioned_access(self):
        for path in ("/sponsor/", "/sponsor/index.html", "/sponsor/portal.js", "/sponsor/portal.css"):
            response = self.viewer.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertEqual(self.viewer.get("/sponsor/../backend/sponsors.py").status_code, 404)
        self.assertEqual(self.viewer.get("/admin/sponsors.js").status_code, 200)
        self.assertEqual(self.admin.post("/api/admin/sponsors", json={}, headers={}).status_code, 403)

    def test_https_session_cookie_and_crafted_admin_cookie_cannot_escalate_role(self):
        secure = TestClient(self.app, base_url="https://127.0.0.1")
        self.clients.append(secure)
        response = self.login(secure)
        cookie = response.headers["set-cookie"].lower()
        for attribute in ("httponly", "secure", "samesite=strict", "path=/api/sponsor"):
            self.assertIn(attribute, cookie)
        self.assertEqual(secure.get("/api/sponsor/campaigns").status_code, 200)
        token = secure.cookies.get("modeltool_sponsor_session")
        attacker = self.client()
        attacker.cookies.set("modeltool_session", token)
        self.assertEqual(attacker.get("/api/admin/sponsors").status_code, 401)
        invalid = self.admin.post("/api/admin/sponsors", headers=self.headers, json={"username": "bad", "display_name": "bad", "password": "secret-validation-value", "role": "admin"})
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn("secret-validation-value", invalid.text)


if __name__ == "__main__":
    unittest.main()
