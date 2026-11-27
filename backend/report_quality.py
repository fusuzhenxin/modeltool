"""Keep identity evidence separate from task accuracy and protocol compatibility."""
import math

TRACE_SQL = """(SELECT json_object('claimed',json_extract(t.value,'$.claimed'),
    'known',json_extract(t.value,'$.known'),'prediction',json_extract(t.value,'$.prediction'),
    'prediction_name',json_extract(t.value,'$.prediction_name'),'probability',json_extract(t.value,'$.probability'),
    'runner_up',json_extract(t.value,'$.results[1].probability'),'used_outputs',json_extract(t.value,'$.used_outputs'),
    'method',json_extract(t.value,'$.method'),'built_at',json_extract(t.value,'$.built_at'))
    FROM json_each(e.data,'$.result.sections') t WHERE json_extract(t.value,'$.kind')='trace' LIMIT 1)"""

IDENTITY_LABELS = {"untested": "未测指纹", "inconclusive": "暂无法判断",
                   "consistent": "指纹相符", "mismatch": "疑似模型不符"}
PROTOCOL_TITLES = {"ok": "功能正常", "warn": "部分功能异常",
                   "bad": "多项功能异常", "unknown": "未测接口功能"}


def fingerprint(section, model=""):
    status = "untested" if not isinstance(section, dict) else "inconclusive"
    result = {"status": status, "label": IDENTITY_LABELS[status]}
    if status == "untested":
        return result
    for key in ("claimed", "prediction", "prediction_name", "used_outputs", "built_at"):
        result[key] = section.get(key)
    p = section.get("probability")
    second = section.get("runner_up")
    if second is None:
        candidates = section.get("results") or []
        second = candidates[1].get("probability") if isinstance(candidates, list) and len(candidates) > 1 and isinstance(candidates[1], dict) else None
    numeric = lambda v: type(v) in (float, int) and math.isfinite(v) and 0 <= v <= 1
    enough = type(section.get("used_outputs")) is int and section["used_outputs"] >= 3
    # A conservative display rule, not a calibrated identity accuracy estimate.
    if (section.get("known") in (True, 1) and section.get("claimed")
            and (not model or section["claimed"] == model) and section.get("prediction")
            and section.get("method") != "manual" and enough
            and numeric(p) and numeric(second) and p >= .8 and p - second >= .2):
        result["status"] = "consistent" if section["claimed"] == section["prediction"] else "mismatch"
    result["label"] = IDENTITY_LABELS[result["status"]]
    return result


def compatibility_tested(result):
    if result.get("protocol_tested") is not None:
        return bool(result["protocol_tested"])
    kind = result.get("kind")
    return (any(s.get("kind") == "relay" for s in result.get("sections", []))
            or kind in ("protocol", "combined", "site_relay", "site_all")
            or not kind and result.get("level") in ("ok", "warn", "bad", "unknown"))


def normalize_report(result, trace=None):
    """Read-time projection: historical answers and measurements stay unchanged."""
    result = dict(result)
    if trace is None:
        trace = next((s for s in result.get("sections", []) if s.get("kind") == "trace"), None)
    result["identity"] = fingerprint(trace, result.get("model", ""))
    result["protocol_tested"] = compatibility_tested(result)
    if result["protocol_tested"]:
        result["title"] = PROTOCOL_TITLES.get(result.get("level"), "功能情况暂无法判断")
        result["summary"] = "接口功能只反映协议、参数与响应行为，不判断模型是否被替换。能力与指纹结果分别展示。"
    result["sections"] = [dict(s, title=PROTOCOL_TITLES.get(s.get("level"), "功能情况暂无法判断"),
                               summary="协议与参数兼容性检查，不能据此判断模型身份。")
                          if s.get("kind") == "relay" else s for s in result.get("sections", [])]
    replacements = {"未见掺水": PROTOCOL_TITLES["ok"], "疑似掺水": PROTOCOL_TITLES["warn"], "明显掺水": PROTOCOL_TITLES["bad"]}
    if result.get("findings"):
        result["findings"] = [next((text.replace(old, new) for old, new in replacements.items() if old in text), text)
                              if isinstance(text, str) else text for text in result["findings"]]
    return result
