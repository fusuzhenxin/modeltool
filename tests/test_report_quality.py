import copy
import json
import unittest
from pathlib import Path

from backend.report_quality import fingerprint, normalize_report


class ReportQualityTests(unittest.TestCase):
    def test_fingerprint_display_rules_match_shared_cases(self):
        for case in json.loads((Path(__file__).parent / "quality-cases.json").read_text(encoding="utf-8")):
            with self.subTest(case["name"]):
                self.assertEqual(fingerprint(case["section"], case.get("model", ""))["status"], case["expected"])

    def test_legacy_protocol_is_relabelled_without_mutating_original_or_identity(self):
        old = {"model": "m", "level": "bad", "score": 45, "title": "明显掺水", "raw": [{"answer": "private"}],
               "findings": ["中转站：明显掺水"], "sections": [{"kind": "relay", "level": "bad", "title": "明显掺水"}]}
        before = copy.deepcopy(old)
        view = normalize_report(old)
        self.assertEqual(old, before)
        self.assertEqual(view["score"], 45)
        self.assertEqual(view["identity"]["status"], "untested")
        self.assertEqual(view["title"], "多项功能异常")
        self.assertNotIn("明显掺水", json.dumps(view, ensure_ascii=False))

    def test_candy_and_artwork_never_imply_identity_or_protocol(self):
        for kind in ("site_candy", "site_basic", "site_pelican", "ability", "pelican"):
            view = normalize_report({"kind": kind, "model": "m", "level": "ok", "ability": {"score": 100}})
            self.assertFalse(view["protocol_tested"])
            self.assertEqual(view["identity"]["status"], "untested")
