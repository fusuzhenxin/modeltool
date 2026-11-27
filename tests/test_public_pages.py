import json
import re
import tempfile
import unittest
from urllib.parse import quote
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import day


class PublicPagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.db = self.app.state.db
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        self.site("visible", "公开站点", "public.example", True)
        self.site("hidden", "隐藏站点秘密", "hidden.example", False)
        self.report("public-report", "visible", "published")
        self.report("hidden-report", "hidden", "published")
        self.report("draft-report", "visible", "draft")
        self.report("billing-report", "visible", "published", excluded_reason="billing")

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def site(self, key, name, domain, visible):
        self.db.save("stations", key, {"name": name, "domain": domain, "visible": visible, "order": 0,
                                      "description": "站点简介", "models": ["test-model"],
                                      "base_url": "https://private.example/v1", "key_cipher": "secret-key-cipher",
                                      "internal_note": "内部备注秘密"})

    def report(self, key, site, status, **fields):
        self.db.save("reports", key, {"station_id": site, "status": status,
            "review_note": "审核备注秘密", **fields,
            "result": {"kind": "site_candy", "model": "test-model", "time": day() + " 10:30",
                       "score": 90, "ability": {"score": 90}, "level": "ok", "raw": "原始回答秘密",
                       "sections": [{"kind": "candy", "response": "题目回答秘密"}]}})

    def test_html_without_javascript_has_public_content_and_indexing(self):
        for path in ("/relays.html", "/stations.html"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('content="index,follow,max-image-preview:large"', response.text)
            self.assertIn('id="public-relay-summary"', response.text)
            self.assertIn("公开站点", response.text)
            self.assertIn("public.example", response.text)
            self.assertIn("test-model", response.text)
            self.assertIn("能力分数：90", response.text)
            self.assertNotIn("noindex", response.text)
            self.assertNotIn("当前包含用于预览效果的模拟案例", response.text)

    def test_private_content_never_enters_html_or_sitemap(self):
        for path in ("/relays.html", "/stations.html", "/sitemap.xml", "/llms.txt"):
            text = self.client.get(path).text
            for secret in ("hidden.example", "hidden-report", "draft-report", "billing-report", "secret-key-cipher",
                           "原始回答秘密", "题目回答秘密", "内部备注秘密", "审核备注秘密", "private.example"):
                self.assertNotIn(secret, text)

    def test_report_and_station_views_have_matching_content_and_canonicals(self):
        report = self.client.get("/relays.html?id=public-report&release=test").text
        self.assertIn('href="https://www.modeltool.cn/relays.html?id=public-report"', report)
        self.assertIn("公开站点 · test-model · 检测报告", report)
        station = self.client.get("/relays.html?station=public.example").text
        self.assertIn('href="https://www.modeltool.cn/relays.html?station=public.example"', station)
        self.assertIn("站点简介", station)
        schema = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', report).group(1))
        self.assertEqual(schema["mainEntity"]["itemListElement"][0]["url"], "https://www.modeltool.cn/relays.html?id=public-report")

    def test_hidden_draft_and_nonexistent_pages_are_404(self):
        for query in ("id=hidden-report", "id=draft-report", "id=billing-report", "id=missing", "station=hidden.example"):
            response = self.client.get("/relays.html?" + query)
            self.assertEqual(response.status_code, 404, query)

    def test_sitemap_discovers_only_public_reports_and_stations(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = [node.text for node in ET.fromstring(response.content).findall("s:url/s:loc", ns)]
        self.assertEqual(len(urls), len(set(urls)))
        for suffix in ("/relays.html", "/stations.html", "/relays.html?view=stability",
                       "/relays.html?station=public.example", "/relays.html?id=public-report"):
            self.assertIn("https://www.modeltool.cn" + suffix, urls)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_user_text_cannot_inject_html_or_structured_data(self):
        name = '站点</script><script>alert(1)</script>\\1'
        self.site("visible", name, "public.example", True)
        text = self.client.get("/relays.html?id=public-report").text
        self.assertNotIn(name, text)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", text)
        schema = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', text).group(1))
        self.assertIn(name, schema["name"])

    def test_llms_guide_and_robots_allow_public_pages(self):
        response = self.client.get("/llms.txt")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://www.modeltool.cn/relays.html", response.text)
        robots = self.client.get("/robots.txt").text
        self.assertIn("Allow: /", robots)
        self.assertNotIn("Disallow: /relays.html", robots)

    def test_stability_view_has_observation_context_in_plain_html(self):
        response = self.client.get("/relays.html?view=stability")
        self.assertEqual(response.status_code, 200)
        self.assertIn("中转站稳定性观察", response.text)
        self.assertIn("近 7 天抽样观察", response.text)
        self.assertIn("北京时间", response.text)
        self.assertIn("暂无样本", response.text)
