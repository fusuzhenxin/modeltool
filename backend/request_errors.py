"""Safe request diagnostics. Never persist upstream bodies or credentials."""
import http.client
import json
import re
import socket
import ssl

MESSAGES = {
    "billing": "账户余额不足或额度已用尽，检测已跳过；不计入稳定性失败",
    "group": "检测密钥的分组不存在或已停用，检测已跳过；不计入稳定性失败",
    "timeout": "接口请求超时，任务已停止",
    "dns": "域名解析失败，无法连接中转站",
    "connection": "网络连接失败或连接中断",
    "tls": "TLS 证书校验或安全连接失败",
    "invalid_json": "接口没有返回有效 JSON",
    "invalid_response": "接口响应结构不合法",
    "empty_response": "接口未返回文本回答",
    "response_limit": "接口响应超过 2MB 限制",
    "internal": "检测程序内部异常，未计入稳定性失败，请检查后台",
    "auth": "接口密钥无效或没有访问权限",
    "model": "接口不支持所选模型或没有模型权限",
    "parameters": "接口不接受当前检测参数",
    "output_limit_required": "接口要求指定单次输出上限，请到后台检测设置填写大于 0 的 Token 数",
    "output_exhausted": "输出额度已耗尽，未生成文本答案；请提高单次输出 Token 上限后重试，不计入稳定性失败",
}
BILLING_CODES = {"insufficient_quota", "insufficient_balance", "balance_not_enough", "quota_exceeded",
                 "credit_balance_too_low", "billing_hard_limit_reached", "billing_not_active",
                 "insufficient_funds", "out_of_credit", "out_of_credits", "quota_exhausted"}
BILLING_WORDS = ("余额不足", "余额已用尽", "额度不足", "额度已用尽", "配额已用尽", "配额不足",
                 "账户欠费", "账号欠费", "令牌额度已用尽", "insufficient balance", "insufficient quota",
                 "insufficient credit", "insufficient funds", "credit balance is too low",
                 "not enough credits", "not enough balance", "quota exhausted", "quota has been exhausted",
                 "exceeded your current quota", "run out of credits", "余额不够",
                 "quota is not enough", "not enough quota", "balance is insufficient",
                 "balance is not enough", "account balance insufficient")


class RequestIssue(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(MESSAGES.get(code, "接口返回 HTTP " + code[5:] if code.startswith("http_") else MESSAGES["internal"]))


def error_issue(status, body=None):
    """Inspect only error envelopes (or HTTP error bodies); return safe categories."""
    if status == 402:
        return RequestIssue("billing")
    if isinstance(body, bytes):
        body = body[:65536].decode("utf-8", "replace")
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
        except (ValueError, TypeError):
            parsed = body[:65536] if status >= 400 else None
    else:
        parsed = body
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if error is None and status >= 400:
        error = parsed
    # A successful answer mentioning money is never a billing error.
    if error is None:
        return None
    if isinstance(error, dict):
        text = " ".join(str(error.get(k, "")) for k in ("code", "type", "message")).lower()
        codes = {str(error.get(k, "")).lower() for k in ("code", "type")}
    else:
        text, codes = str(error).lower()[:65536], set()
    if codes & BILLING_CODES or any(word in text for word in BILLING_WORDS):
        return RequestIssue("billing")
    # Only explicit group invalidation is configuration failure. An unavailable
    # channel or generic 503 may be an actual outage and must remain a failure.
    if codes & {"invalid_group", "group_not_found", "group_disabled", "group_deleted"} or re.search(
        r"分组.{0,20}(?:不存在|已删除|已失效|已停用|已禁用)|(?:invalid|deleted|disabled) group\b|group\b.{0,24}(?:not found|does not exist|has been deleted|is disabled)", text
    ):
        return RequestIssue("group")
    if status in (200, 400, 403, 404, 422) and codes & {"model_not_found", "invalid_model", "model_not_supported"}:
        return RequestIssue("model")
    if status in (400, 422) and re.search(r"max_(?:completion_)?tokens", text) and re.search(r"required|must be provided|missing|必填|必须提供|不能为空", text):
        return RequestIssue("output_limit_required")
    if status == 200:
        return RequestIssue("http_429" if "rate_limit" in text else "invalid_response")
    return None


def stream_error(body):
    """Only explicit SSE error events are inspected, never normal generated content."""
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            data = json.loads(line[5:].strip())
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and data.get("error") is not None:
            return error_issue(200, data)
    return None


def safe_exception(exc):
    if isinstance(exc, RequestIssue):
        return str(exc)
    if isinstance(exc, TimeoutError):
        return MESSAGES["timeout"]
    if isinstance(exc, socket.gaierror):
        return MESSAGES["dns"]
    if isinstance(exc, ssl.SSLError):
        return MESSAGES["tls"]
    if isinstance(exc, (ConnectionError, http.client.HTTPException, OSError)):
        return MESSAGES["connection"]
    if isinstance(exc, json.JSONDecodeError):
        return MESSAGES["invalid_json"]
    message = str(exc)
    if message in MESSAGES.values() or re.fullmatch(r"接口返回 HTTP [0-9]{3}", message):
        return message
    if isinstance(exc, ValueError) and message in (
        "检测接口地址不合法", "检测仅支持 80、443、8080、8443 端口", "定时检测不允许访问本机、内网或保留地址"):
        return message
    return MESSAGES["internal"]


def saved_diagnostic(error):
    """Read canonical messages plus legacy errors without guessing missing details."""
    for code, message in MESSAGES.items():
        if error == message:
            return code
    match = re.match(r"^接口返回 HTTP ([0-9]{3})(?:[，, ]|$)", error or "")
    if match:
        code = int(match[1])
        issue = error_issue(code, error)
        if issue:
            return issue.code
        return "http_" + match[1]
    # Legacy explicit account messages may precede the structured recorder.
    if any(word in (error or "").lower() for word in BILLING_WORDS):
        return "billing"
    return None
