"""Generate one pelican artwork; structural features never imply model capability."""
import json
import re
from datetime import datetime

from .core import TZ


def modes():
    # This versioned fixture matches DATA.pelicanModes (checked in tests).
    from .core import ROOT
    items = json.loads((ROOT / "data" / "pelican-modes.json").read_text(encoding="utf-8"))
    if set(items) != {"svg", "html2d", "three"}:
        raise ValueError("检测作品题组配置不完整")
    return items


def extract_artwork(text):
    fenced = re.search(r"```(?:html|svg|xml)?\s*([\s\S]*?)```", text, re.I)
    body = (fenced[1] if fenced else text).strip()
    html = re.search(r"(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*</html>", body, re.I)
    if html:
        return html[0]
    svg = re.search(r"<svg\b[\s\S]*</svg>", body, re.I)
    if svg:
        return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>鹈鹕骑车</title><style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#f7f8fc}svg{max-width:100%;height:auto}</style></head><body>' + svg[0] + '</body></html>'
    return ""


def artwork_checks(html):
    specs = [
        ("包含页面内容", 20, bool(html)),
        ("包含 SVG 元素", 20, bool(re.search(r"<svg\b", html, re.I))),
        ("包含 circle 元素", 15, bool(re.search(r"<circle\b", html, re.I))),
        ("包含线条或路径", 10, bool(re.search(r"<(line|path|polyline|polygon)\b", html, re.I))),
        ("代码超过 800 字符", 10, len(html.encode("utf-16-le", errors="surrogatepass")) // 2 > 800),
        ("包含动画相关代码", 15, bool(re.search(r"animate|requestAnimationFrame|@keyframes", html, re.I))),
        ("包含 Three.js 或 Canvas 相关代码", 10, bool(re.search(r"three|canvas", html, re.I))),
    ]
    return [{"name": name, "points": points, "passed": passed} for name, points, passed in specs]


def run_pelican(db, job, station, transport):
    from .runner import complete
    mode_id = json.loads(job["config"]).get("pelican_mode", "html2d")
    mode = modes()[mode_id]
    sample = complete(db, job, station, mode["system"], mode["prompt"], transport=transport, max_tokens=8192, temperature=0.4)
    html = extract_artwork(sample["text"])
    # A length-stopped response is incomplete even if it contains a closed SVG.
    if sample["truncated"]:
        html = ""
    checks = artwork_checks(html)
    score = sum(c["points"] for c in checks if c["passed"])
    summary = "代码结构分与前台采用相同的 7 项代码特征，不识别画面，不判断模型身份或降智。"
    detail = "已提取 HTML / SVG，请预览画面后人工审核。" if html else "回复被截断，未保存为完整作品。" if sample["truncated"] else "回复中没有完整 HTML 或 SVG，可查看原始回答。"
    return {
        "kind": "pelican", "suite": "pelican-v1", "model": job["model"],
        "time": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"), "level": "unknown", "score": None,
        "ability": None, "title": "鹈鹕骑车 · " + mode["name"], "runs": 1,
        "summary": summary, "conditions": mode["name"] + " / temperature=0.4 / max_tokens=8192 / 非流式 / 仅调用一次。",
        "retest": "作品生成不自动重试，避免重复消耗额度。", "findings": [detail],
        "checks": [{"name": "完整作品提取", "status": "pass" if html else "fail", "detail": detail}],
        "artwork": {"mode": mode_id, "mode_name": mode["name"], "score": score, "html": html, "available": bool(html), "checks": checks},
        "raw": [{"name": "鹈鹕骑车", "system": mode["system"], "prompt": mode["prompt"], "samples": [sample]}],
    }
