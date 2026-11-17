"""Classify fake upstream errors without retaining response bodies or credentials."""
import json
import unittest
from unittest.mock import MagicMock, patch

from backend.request_errors import MESSAGES, RequestIssue, error_issue, saved_diagnostic, stream_error
from backend.runner import post_json
from backend.site_tests import post_exchange


class RequestErrorTests(unittest.TestCase):
    def test_quota_errors_across_statuses_and_provider_formats(self):
        for status, body in (
            (402, "Payment Required"),
            (403, {"error": {"code": "insufficient_balance", "message": "private-key"}}),
            (429, {"error": {"type": "insufficient_quota"}}),
            (429, {"message": "You exceeded your current quota"}),
            (500, "用户额度不足 private-key"),
            (200, {"error": {"message": "credit balance is too low private-key"}}),
            (200, {"error": "user quota is not enough"}),
        ):
            with self.subTest(status=status, body=body):
                value = error_issue(status, json.dumps(body) if isinstance(body, dict) else body)
                self.assertEqual(value.code, "billing")
                self.assertEqual(str(value), MESSAGES["billing"])
                self.assertNotIn("private-key", str(value))

    def test_normal_answers_and_rate_limits_are_not_billing_errors(self):
        answer = {"choices": [{"message": {"content": "余额不足 insufficient_quota"}}]}
        self.assertIsNone(error_issue(200, answer))
        self.assertIsNone(error_issue(200, "余额不足"))
        self.assertIsNone(error_issue(429, {"error": {"code": "rate_limit_exceeded", "message": "Too many requests"}}))
        self.assertIsNone(error_issue(403, {"error": {"message": "Invalid API key"}}))
        self.assertEqual(saved_diagnostic("接口返回 HTTP 429"), "http_429")
        self.assertIsNone(saved_diagnostic("检测请求失败，请检查地址、网络或密钥"))

    def test_stream_only_inspects_explicit_error_events(self):
        self.assertEqual(stream_error('data: {"error":{"type":"insufficient_quota"}}\n\ndata: [DONE]\n').code, "billing")
        self.assertIsNone(stream_error('data: {"choices":[{"delta":{"content":"余额不足"}}]}\n\n'))
        self.assertIsNone(stream_error('data: invalid\n\ndata: [DONE]\n'))

    def test_both_http_transports_inspect_bounded_error_body_and_close(self):
        body = json.dumps({"error": {"code": "insufficient_quota", "message": "private-key"}}).encode()
        for module, send in (("backend.runner", post_json), ("backend.site_tests", post_exchange)):
            with self.subTest(module=module):
                connection = MagicMock()
                response = connection.getresponse.return_value
                response.status = 429
                response.read.return_value = body
                with patch(module + ".resolve_public", return_value="8.8.8.8"), patch(module + ".http.client.HTTPSConnection", return_value=connection):
                    with self.assertRaises(RequestIssue) as result:
                        send("https://fixture.example/v1/chat/completions", {"Authorization": "Bearer private-key"}, {})
                self.assertEqual(result.exception.code, "billing")
                response.read.assert_called_once_with(65536)
                connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
