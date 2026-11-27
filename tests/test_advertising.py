import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.advertising import quote


class AdvertisingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        token = (self.db.directory / "setup.token").read_text()
        response = self.client.post("/api/auth/setup", json={"username": "ads_admin", "password": "temporary-ad-password", "token": token})
        self.headers = {"X-CSRF-Token": response.json()["csrf"]}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def ad(self, **overrides):
        return {"name": "广告订单", "title": "中转站宣传", "link": "https://example.com", "placement": "banner",
                "booking_status": "reserved", "starts_at": "2030-01-01T00:00:00+08:00", "ends_at": "2030-01-08T00:00:00+08:00", **overrides}

    def save(self, body, key=None):
        return self.client.request("PUT" if key else "POST", "/api/admin/ads" + ("/" + key if key else ""), json=body, headers=self.headers)

    def overview(self, **query):
        return self.client.get("/api/admin/advertising/overview", params=query)

    def test_capacity_and_boundary_and_draft_publish_conflict(self):
        first = self.save(self.ad())
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.save(self.ad()).status_code, 409)
        second = self.save(self.ad(starts_at="2030-01-08T00:00:00+08:00", ends_at="2030-01-15T00:00:00+08:00"))
        self.assertEqual(second.status_code, 200, second.text)
        draft = self.save(self.ad(booking_status="draft"))
        self.assertEqual(draft.status_code, 200)
        self.assertEqual(self.save(self.ad(booking_status="published"), draft.json()["id"]).status_code, 409)
        result = self.overview(start="2030-01-01T00:00:00+08:00", end="2030-01-15T00:00:00+08:00").json()
        slot = next(s for s in result["slots"] if s["key"] == "banner")
        self.assertEqual(slot["peak_booked"], 1)  # two intersecting orders, never concurrent
        self.assertEqual(slot["remaining"], 0)
        self.assertEqual(self.save(self.ad(booking_status="cancelled"), first.json()["id"]).status_code, 200)
        self.assertEqual(self.save(self.ad(booking_status="published"), draft.json()["id"]).status_code, 200)

    def test_concurrent_booking_cannot_oversell(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            statuses = list(pool.map(lambda _: self.save(self.ad()).status_code, range(5)))
        self.assertEqual(statuses.count(200), 1, statuses)
        self.assertEqual(statuses.count(409), 4, statuses)

    def test_prices_pending_free_quotes_and_auth(self):
        result = self.overview().json()
        self.assertEqual(result["totals"]["capacity"], 14)
        self.assertTrue(all(s["daily_cents"] is None for s in result["slots"]))
        path = "/api/admin/advertising/prices/banner"
        self.assertEqual(self.client.put(path, json={"daily_cents": 1200}).status_code, 403)
        self.assertEqual(self.client.put(path, json={"daily_cents": -1}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.put(path, json={"daily_cents": 0, "weekly_cents": 7000}, headers=self.headers).status_code, 200)
        row = self.save(self.ad(billing_unit="week", contract_cents=6000, received_cents=3000)).json()
        result = self.overview().json()
        saved = next(r for r in result["records"] if r["id"] == row["id"])
        self.assertEqual(saved["reference_quote"]["total_cents"], 7000)
        self.assertTrue(saved["order_code"].startswith("AD-"))
        self.assertTrue(any(e["action"] == "prices" and e["changes"]["weekly_cents"]["after"] == 7000 for e in result["events"]))
        self.assertEqual(result["totals"]["received_cents"], 3000)
        self.assertEqual(self.save(self.ad(contract_cents=1, received_cents=2)).status_code, 422)
        self.assertEqual(self.client.put(path, json={"accepting": False}, headers=self.headers).status_code, 200)
        self.assertEqual(self.save(self.ad(starts_at="2031-01-01T00:00:00+08:00", ends_at="2031-02-01T00:00:00+08:00")).status_code, 409)
        self.assertEqual(self.save(self.ad(booking_status="paused", contract_cents=6000, received_cents=3000), row["id"]).status_code, 200)
        self.assertEqual(self.overview(start="2030-01-01T00:00:00", end="2030-01-02T00:00:00").status_code, 422)
        self.assertEqual(self.overview(start="2030-01-01T00:00:00Z", end="2032-01-01T00:00:00Z").status_code, 422)

    def test_private_fields_and_booking_states_never_leak(self):
        for status in ("draft", "reserved", "paused", "cancelled", "published"):
            response = self.save(self.ad(placement="hero", booking_status=status, starts_at=None, ends_at=None,
                                         advertiser="private-client", contact="private-contact", internal_note="private-note", contract_cents=12345, received_cents=12))
            self.assertEqual(response.status_code, 200, response.text)
        public = self.client.get("/api/public/bootstrap").json()["ads"]
        self.assertEqual(len(public), 1)
        for field in ("name", "advertiser", "contact", "internal_note", "contract_cents", "received_cents", "order_code", "reference_quote", "booking_status"):
            self.assertNotIn(field, public[0])
        self.assertNotIn("private-", str(public))
        row = self.db.list("ads")[0]
        self.assertEqual(self.client.delete("/api/admin/ads/" + row["id"], headers=self.headers).status_code, 409)

    def test_left_right_are_independent_and_dock_uses_left(self):
        self.assertEqual(self.save(self.ad(placement="right")).status_code, 200)
        self.assertEqual(self.save(self.ad(placement="dock")).status_code, 200)
        self.assertEqual(self.save(self.ad(placement="left")).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="right")).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="inline")).status_code, 422)
        self.assertEqual(self.save(self.ad(placement="inline", booking_status="draft")).status_code, 200)

    def test_bulk_actions_cannot_bypass_capacity_or_delete_financial_records(self):
        first = self.save(self.ad()).json()
        self.db.save("ads", "legacy", self.ad(booking_status="published", enabled=False) | {"booking_status": "draft"})
        with self.db.connect(write=True) as con:
            row = self.db.get("ads", "legacy", con)
            row.pop("booking_status")  # legacy disabled row didn't reserve
            self.db.save("ads", "legacy", row, con)
        enabled = self.client.post("/api/admin/bulk/ads", json={"ids": ["legacy"], "action": "enable"}, headers=self.headers).json()
        self.assertEqual(enabled["count"], 0)
        self.assertIn("已满", enabled["skipped"][0]["reason"])
        deleted = self.client.post("/api/admin/bulk/ads", json={"ids": [first["id"]], "action": "delete"}, headers=self.headers).json()
        self.assertEqual(deleted["count"], 0)
        draft = self.save(self.ad(booking_status="draft", contract_cents=100)).json()
        deleted = self.client.post("/api/admin/bulk/ads", json={"ids": [draft["id"]], "action": "delete"}, headers=self.headers).json()
        self.assertEqual(deleted["count"], 0)

    def test_existing_oversold_legacy_records_are_capped_publicly_and_flagged(self):
        for i in range(3):
            row = self.ad(placement="left", starts_at=None, ends_at=None, enabled=True)
            row.pop("booking_status")
            self.db.save("ads", str(i), row)
        self.assertEqual(len(self.client.get("/api/public/bootstrap").json()["ads"]), 1)
        result = self.overview().json()
        self.assertTrue(all(r["booking_status"] == "published" for r in result["records"]))
        slot = next(s for s in result["slots"] if s["key"] == "left")
        self.assertEqual(slot["overbooked"], 2)

    def test_partial_period_quotes_round_up_and_zero_is_not_pending(self):
        configs = [{"key": "banner", "daily_cents": 0, "weekly_cents": 100, "monthly_cents": None}]
        row = self.ad(ends_at="2030-01-08T00:01:00+08:00", billing_unit="week")
        self.assertEqual(quote(row, configs)["total_cents"], 200)
        self.assertEqual(quote(row | {"billing_unit": "day"}, configs)["total_cents"], 0)
        self.assertIsNone(quote(row | {"billing_unit": "month"}, configs)["total_cents"])

    def test_full_package_reserves_all_components_and_cancel_releases_them(self):
        row = self.save(self.ad(placement="full", side="right", contract_cents=10000))
        self.assertEqual(row.status_code, 200, row.text)
        for placement in ("hero", "footer", "banner", "right"):
            result = self.overview(start="2030-01-01T00:00:00+08:00", end="2030-01-08T00:00:00+08:00").json()
            slot = next(s for s in result["slots"] if s["key"] == placement)
            self.assertEqual(slot["peak_booked"], 1)
        self.assertEqual(result["totals"]["contract_cents"], 10000)
        self.assertEqual(self.save(self.ad()).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="left")).status_code, 200)
        self.assertEqual(self.save(self.ad(placement="full", side="right", booking_status="cancelled"), row.json()["id"]).status_code, 200)
        self.assertEqual(self.save(self.ad()).status_code, 200)
        self.assertEqual(self.save(self.ad(placement="right")).status_code, 200)

    def test_package_save_and_side_switch_are_atomic(self):
        blocker = self.save(self.ad(placement="right")).json()
        row = self.save(self.ad(placement="full", side="left")).json()
        response = self.save(self.ad(placement="full", side="right"), row["id"])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.db.get("ads", row["id"])["side"], "left")
        self.assertEqual(len(self.db.list("ads")), 2)
        draft = self.save(self.ad(placement="full", side="right", booking_status="draft")).json()
        self.assertEqual(self.save(self.ad(placement="full", side="right", booking_status="published"), draft["id"]).status_code, 409)
        overview = self.overview(start="2030-01-01T00:00:00+08:00", end="2030-01-08T00:00:00+08:00").json()
        self.assertEqual(next(p for p in overview["packages"] if p["key"] == "full")["remaining"], 0)

    def test_top_bottom_and_single_orders_share_capacity(self):
        for _ in range(5):
            self.assertEqual(self.save(self.ad(placement="top_bottom")).status_code, 200)
        self.assertEqual(self.save(self.ad(placement="top_bottom")).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="hero")).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="footer")).status_code, 409)
        self.assertEqual(self.save(self.ad(placement="banner")).status_code, 200)

    def test_five_sponsors_per_row_are_public_and_sixth_booking_is_rejected(self):
        for placement in ("hero", "footer"):
            for index in range(5):
                response = self.save(self.ad(placement=placement, title=f"Sponsor {index + 1}",
                                             booking_status="published", starts_at=None, ends_at=None))
                self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.save(self.ad(placement=placement)).status_code, 409)
        public = self.client.get("/api/public/bootstrap").json()["ads"]
        overview = self.overview().json()
        for placement in ("hero", "footer"):
            self.assertEqual(sum(ad["placement"] == placement for ad in public), 5)
            slot = next(s for s in overview["slots"] if s["key"] == placement)
            self.assertEqual((slot["capacity"], slot["occupied_now"], slot["remaining"]), (5, 5, 0))
            self.assertTrue(all(day["slots"][placement] == 0 for day in overview["calendar"]))
        self.assertEqual(next(p for p in overview["packages"] if p["key"] == "top_bottom")["remaining"], 0)

    def test_package_price_public_expansion_and_private_metadata(self):
        path = "/api/admin/advertising/prices/full"
        self.assertEqual(self.client.put(path, json={"weekly_cents": 8000}, headers=self.headers).status_code, 200)
        self.save(self.ad(placement="full", side="right", billing_unit="week", advertiser="private", booking_status="published", starts_at=None, ends_at=None))
        public = self.client.get("/api/public/bootstrap").json()["ads"]
        self.assertEqual({ad["placement"] for ad in public}, {"hero", "footer", "banner", "right"})
        self.assertTrue(all("advertiser" not in ad and "side" not in ad for ad in public))
        future = self.save(self.ad(placement="full", booking_status="draft", billing_unit="week")).json()
        record = next(r for r in self.overview().json()["records"] if r["id"] == future["id"])
        self.assertEqual(record["reference_quote"]["total_cents"], 8000)

    def test_concurrent_package_and_single_order_cannot_oversell(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda placement: self.save(self.ad(placement=placement)).status_code, ["full", "banner", "full", "banner"]))
        self.assertEqual(results.count(200), 1, results)
        self.assertEqual(results.count(409), 3, results)

    def test_full_package_availability_offers_the_free_side_and_closed_part_blocks_booking(self):
        self.save(self.ad(placement="left"))
        overview = self.overview(start="2030-01-01T00:00:00+08:00", end="2030-01-08T00:00:00+08:00").json()
        package = next(p for p in overview["packages"] if p["key"] == "full")
        self.assertEqual(package["variants"], {"left": 0, "right": 1})
        self.assertEqual(package["remaining"], 1)
        self.client.put("/api/admin/advertising/prices/banner", json={"accepting": False}, headers=self.headers)
        self.assertEqual(self.save(self.ad(placement="full", side="right")).status_code, 409)


if __name__ == "__main__":
    unittest.main()
