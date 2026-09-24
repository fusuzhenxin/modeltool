# 本机站点加转发。浏览器只访问 127.0.0.1，由这里代为请求外部模型接口。
import ipaddress
import json
import mimetypes
import os
import re
import socket
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

mimetypes.add_type("image/x-icon", ".ico")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
_STATUS_CACHE = {"at": 0, "body": None}

STATUS_TEXT = {
    "operational": "正常",
    "degraded_performance": "降级",
    "partial_outage": "部分中断",
    "major_outage": "中断",
    "under_maintenance": "维护",
}
INCIDENT_TEXT = {
    "investigating": "调查中",
    "identified": "已定位",
    "monitoring": "观察中",
    "resolved": "已恢复",
    "postmortem": "已复盘",
    "scheduled": "计划维护",
    "in_progress": "进行中",
    "verifying": "核实中",
    "completed": "已完成",
}


BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def _fetch_public(url):
    box = {}

    def wrap():
        try:
            req = Request(url, headers={"User-Agent": BROWSER_UA, "Accept": "application/json, application/xml, */*"})
            with urlopen(req, timeout=8) as resp:
                box["body"] = resp.read()
        except Exception as exc:
            box["err"] = exc

    thread = threading.Thread(target=wrap, daemon=True)
    thread.start()
    thread.join(8)
    if thread.is_alive():
        raise TimeoutError("官方状态超时")
    if "err" in box:
        raise box["err"]
    return box.get("body", b"")


def _level_from_statuses(statuses, indicator):
    if "major_outage" in statuses or indicator == "critical":
        return "bad", "中断"
    if "partial_outage" in statuses or indicator == "major":
        return "bad", "部分中断"
    if "degraded_performance" in statuses or "under_maintenance" in statuses or indicator == "minor":
        return "warn", "降级"
    if statuses and all(item == "operational" for item in statuses) and indicator in ("none", "", None):
        return "ok", "正常"
    if indicator == "none":
        return "ok", "正常"
    return "idle", "未标明"


def _trim(text, limit=280):
    raw = re.sub(r"<[^>]+>", " ", str(text or ""))
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) <= limit:
        return raw
    return raw[:limit].rstrip() + "…"


def _bars_from_svg(svg):
    kinds = []
    for klass in re.findall(r'<rect\b[^>]*class="([^"]+)"', svg):
        if "pillFullOutage" in klass:
            kinds.append("down")
        elif "pillPartialOutage" in klass:
            kinds.append("partial")
        elif "pillDegradedPerformance" in klass:
            kinds.append("warn")
        elif "pillOperational" in klass:
            kinds.append("ok")
        else:
            kinds.append("empty")
    return kinds


def _parse_incidentio_html(html):
    banner_title = ""
    banner_body = ""
    level, level_text = "ok", "正常"
    if "We’re fully operational" in html or "We're fully operational" in html:
        banner_title = "We're fully operational"
        banner_body = "We're not aware of any issues affecting our systems."
    elif "Some systems are degraded" in html or "Partial system outage" in html or "Major system outage" in html:
        level, level_text = "bad" if "Major system outage" in html else "warn", "中断" if "Major system outage" in html else "降级"
        if "Some systems are degraded" in html:
            banner_title = "Some systems are degraded"
        elif "Partial system outage" in html:
            banner_title = "Partial system outage"
        else:
            banner_title = "Major system outage"
    period = ""
    range_m = re.search(r">([A-Z][a-z]{2} \d{4})<span class=\"px-1\">-</span>([A-Z][a-z]{2} \d{4})<", html)
    if range_m:
        period = range_m.group(1) + " - " + range_m.group(2)
    head_re = re.compile(
        r'<h3 class="font-medium text-slate-900[^"]*">([^<]+)</h3>.{0,2200}?(\d+) components?',
        re.S,
    )
    svg_re = re.compile(r'<svg width="100%" height="16".*?</svg>', re.S)
    child_re = re.compile(
        r'<h3 class="font-medium text-slate-900[^"]*">([^<]+)</h3>.{0,1400}?<var percentage>([\d.]+)</var>',
        re.S,
    )
    matches = list(head_re.finditer(html))
    groups = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(html)
        chunk = html[match.end():end]
        tail = chunk[:1000]
        pct_m = re.search(r'<var percentage>([\d.]+)</var>', tail)
        uptime = None
        if pct_m and "<h3" not in tail[:pct_m.start()]:
            uptime = float(pct_m.group(1))
        svgs = svg_re.findall(chunk)
        children = []
        for child_name, child_uptime in child_re.findall(chunk):
            children.append({"name": child_name, "uptime": float(child_uptime), "bars": []})
        group_bars = []
        if len(svgs) == len(children) + 1:
            group_bars = _bars_from_svg(svgs[-1])
            for child, svg in zip(children, svgs[:-1]):
                child["bars"] = _bars_from_svg(svg)
        elif svgs:
            group_bars = _bars_from_svg(svgs[-1])
        groups.append({
            "name": match.group(1),
            "count": int(match.group(2)),
            "uptime": uptime,
            "bars": group_bars,
            "children": children,
        })
    return {
        "bannerTitle": banner_title,
        "bannerBody": banner_body,
        "period": period,
        "level": level,
        "levelText": level_text,
        "groups": groups,
    }


def _fmt_period(iso):
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    text = str(iso or "")
    if len(text) < 7 or text[4] != "-":
        return ""
    return names[int(text[5:7]) - 1] + " " + text[:4]


def _month_bars(months):
    colors = []
    weighted = 0.0
    count = 0
    first = ""
    last = ""
    for month in months or []:
        days = month.get("days") or []
        for day in days:
            colors.append(day.get("color") or "#EAEAEA")
            if not first:
                first = day.get("date") or ""
            last = day.get("date") or last
        pct = month.get("uptime_percentage")
        if days and isinstance(pct, (int, float)):
            weighted += pct * len(days)
            count += len(days)
    uptime = round(weighted / count * 100, 2) if count else None
    period = ""
    if first and last:
        period = _fmt_period(first) + " - " + _fmt_period(last)
    return uptime, colors, period


def _atlassian_groups(page, components):
    parents = {}
    loose = []
    groups = []
    for comp in components or []:
        if comp.get("group") is True:
            groups.append(comp)
            continue
        parent = comp.get("group_id")
        if parent:
            parents.setdefault(parent, []).append(comp)
        else:
            loose.append(comp)
    targets = []
    if groups:
        targets.extend(groups)
        for kids in parents.values():
            targets.extend(kids)
        targets.extend(loose)
    else:
        targets = [comp for comp in components or [] if comp.get("group") is not True]

    def load(comp):
        try:
            data = json.loads(_fetch_public(page.rstrip("/") + "/uptime/" + comp["id"] + ".json").decode("utf-8"))
            uptime, colors, period = _month_bars(data.get("months") or [])
            return comp["id"], uptime, colors, period
        except (URLError, HTTPError, json.JSONDecodeError, TimeoutError, ValueError, OSError):
            return comp["id"], None, [], ""

    found = {}
    if targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for cid, uptime, colors, period in pool.map(load, targets):
                found[cid] = (uptime, colors, period)

    def pack(comp, kids):
        uptime, colors, period = found.get(comp.get("id"), (None, [], ""))
        children = []
        for kid in kids:
            kid_uptime, kid_colors, _period = found.get(kid.get("id"), (None, [], ""))
            children.append({"name": kid.get("name") or "", "uptime": kid_uptime, "bars": kid_colors})
        return {
            "name": comp.get("name") or "",
            "count": len(kids),
            "uptime": uptime,
            "bars": colors,
            "children": children,
        }, period

    rows = []
    period = ""
    if groups:
        for comp in groups:
            row, row_period = pack(comp, parents.get(comp.get("id"), []))
            rows.append(row)
            period = period or row_period
        for comp in loose:
            row, row_period = pack(comp, [])
            row["count"] = 0
            rows.append(row)
            period = period or row_period
    else:
        for comp in targets:
            row, row_period = pack(comp, [])
            row["count"] = 0
            rows.append(row)
            period = period or row_period
    return [row for row in rows if row.get("bars") or row.get("children")], period


def _statuspage_vendor(name, summary_url, incident_url, page):
    summary = json.loads(_fetch_public(summary_url).decode("utf-8"))
    components = []
    for item in summary.get("components") or []:
        if item.get("group") is True:
            continue
        status = item.get("status") or "unknown"
        components.append({
            "name": item.get("name") or "",
            "status": status,
            "statusText": STATUS_TEXT.get(status, status),
        })
    incidents = list(summary.get("incidents") or [])
    if incident_url:
        try:
            extra = json.loads(_fetch_public(incident_url).decode("utf-8"))
            incidents = extra.get("incidents") or incidents
        except (URLError, HTTPError, json.JSONDecodeError, TimeoutError, ValueError):
            pass
    packed = []
    for item in incidents[:8]:
        updates = item.get("incident_updates") or []
        body = updates[0].get("body") if updates else ""
        status = item.get("status") or ""
        packed.append({
            "name": item.get("name") or "",
            "status": status,
            "statusText": INCIDENT_TEXT.get(status, status or "更新"),
            "time": item.get("updated_at") or item.get("created_at") or "",
            "body": _trim(body),
        })
    indicator = (summary.get("status") or {}).get("indicator")
    description = (summary.get("status") or {}).get("description") or ""
    level, level_text = _level_from_statuses([item["status"] for item in components], indicator)
    percent = None
    if components:
        good = sum(1 for item in components if item["status"] == "operational")
        percent = round(100.0 * good / len(components), 2)
    layout = {"bannerTitle": "", "bannerBody": "", "period": "", "groups": []}
    try:
        html = _fetch_public(page).decode("utf-8", "replace")
        layout = _parse_incidentio_html(html)
    except (URLError, HTTPError, TimeoutError, ValueError, OSError):
        layout = {"bannerTitle": "", "bannerBody": "", "period": "", "groups": []}
    if not layout.get("groups"):
        built, period = _atlassian_groups(page, summary.get("components") or [])
        if built:
            layout = {
                "bannerTitle": description,
                "bannerBody": "",
                "period": period,
                "level": level,
                "levelText": level_text,
                "groups": built,
            }
        else:
            layout = {"bannerTitle": "", "bannerBody": "", "period": "", "groups": []}
    if layout.get("groups"):
        level, level_text = layout.get("level") or level, layout.get("levelText") or level_text
        description = layout.get("bannerBody") or layout.get("bannerTitle") or description
        uptimes = [group.get("uptime") for group in layout["groups"] if isinstance(group.get("uptime"), (int, float))]
        percent = round(min(uptimes), 2) if uptimes else None
    return {
        "ok": True,
        "name": name,
        "source": page,
        "history": page.rstrip("/") + "/history",
        "description": description,
        "bannerTitle": layout.get("bannerTitle") or "",
        "bannerBody": layout.get("bannerBody") or "",
        "period": layout.get("period") or "",
        "level": level,
        "levelText": level_text,
        "percent": percent,
        "groups": layout.get("groups") or [],
        "components": components,
        "incidents": packed,
        "error": "",
    }


def _gemini_vendor():
    rows = json.loads(_fetch_public("https://status.cloud.google.com/incidents.json").decode("utf-8"))
    matched = []
    for row in rows if isinstance(rows, list) else []:
        products = json.dumps(row.get("affected_products") or [], ensure_ascii=False)
        blob = " ".join([
            str(row.get("service_name") or ""),
            str(row.get("external_desc") or ""),
            products,
        ]).lower()
        if "gemini" not in blob:
            continue
        matched.append(row)
    open_rows = [row for row in matched if not row.get("end")]
    incidents = []
    for row in (open_rows + matched)[:8]:
        incidents.append({
            "name": _trim(row.get("external_desc") or row.get("service_name") or "Gemini", 160),
            "status": "resolved" if row.get("end") else "investigating",
            "statusText": "已恢复" if row.get("end") else "进行中",
            "time": row.get("end") or row.get("begin") or "",
            "body": _trim((row.get("most_recent_update") or {}).get("text") or ""),
        })
    if open_rows:
        level, level_text = "warn", "降级"
        description = "Google Cloud 公开事件里有未结束的 Gemini 相关记录。"
    else:
        level, level_text = "ok", "正常"
        description = "Google Cloud 公开事件里没有未结束的 Gemini 相关记录。"
    return {
        "ok": True,
        "name": "Gemini",
        "source": "https://status.cloud.google.com/",
        "description": description,
        "bannerTitle": "All systems operational" if not open_rows else "Gemini incident in progress",
        "bannerBody": description,
        "level": level,
        "levelText": level_text,
        "percent": None,
        "groups": [],
        "components": [],
        "incidents": incidents,
        "error": "",
    }


def _xai_vendor():
    root = ET.fromstring(_fetch_public("https://status.x.ai/feed.xml"))
    incidents = []
    unresolved = False
    for item in root.findall("./channel/item")[:8]:
        desc = item.findtext("description") or ""
        resolved = "status: resolved" in desc.lower()
        if not resolved:
            unresolved = True
        incidents.append({
            "name": _trim(item.findtext("title") or "", 160),
            "status": "resolved" if resolved else "investigating",
            "statusText": "已恢复" if resolved else "进行中",
            "time": item.findtext("pubDate") or "",
            "body": _trim(desc),
        })
    if unresolved:
        level, level_text = "warn", "降级"
        description = "xAI 官方事件源里有尚未标成已恢复的记录。"
    else:
        level, level_text = "ok", "正常"
        description = "xAI 官方事件源里，最近几条都已标成已恢复。"
    return {
        "ok": True,
        "name": "Grok",
        "source": "https://status.x.ai/",
        "description": description,
        "bannerTitle": "All services are operating normally." if not unresolved else "Some systems are degraded",
        "bannerBody": description,
        "level": level,
        "levelText": level_text,
        "percent": None,
        "groups": [],
        "components": [],
        "incidents": incidents,
        "error": "",
    }


def _status_one(vendor_id):
    spec = {
        "openai": ("OpenAI", "https://status.openai.com/api/v2/summary.json", "https://status.openai.com/api/v2/incidents.json", "https://status.openai.com/"),
        "anthropic": ("Claude", "https://status.claude.com/api/v2/summary.json", "https://status.claude.com/api/v2/incidents.json", "https://status.claude.com/"),
        "deepseek": ("DeepSeek", "https://status.deepseek.com/api/v2/summary.json", "https://status.deepseek.com/api/v2/incidents.json", "https://status.deepseek.com/"),
        "moonshot": ("Kimi", "https://status.moonshot.cn/api/v2/summary.json", "https://status.moonshot.cn/api/v2/incidents.json", "https://status.moonshot.cn/"),
    }
    try:
        if vendor_id == "gemini":
            row = _gemini_vendor()
        elif vendor_id == "xai":
            row = _xai_vendor()
        else:
            name, summary_url, incident_url, page = spec[vendor_id]
            row = _statuspage_vendor(name, summary_url, incident_url, page)
    except (URLError, HTTPError, json.JSONDecodeError, TimeoutError, ET.ParseError, ValueError, OSError) as err:
        reason = getattr(err, "reason", None) or err
        names = {"openai": "OpenAI", "anthropic": "Claude", "gemini": "Gemini", "deepseek": "DeepSeek", "moonshot": "Kimi", "xai": "Grok"}
        pages = {
            "openai": "https://status.openai.com/",
            "anthropic": "https://status.claude.com/",
            "gemini": "https://status.cloud.google.com/",
            "deepseek": "https://status.deepseek.com/",
            "moonshot": "https://status.moonshot.cn/",
            "xai": "https://status.x.ai/",
        }
        row = {
            "ok": False,
            "name": names.get(vendor_id, vendor_id),
            "source": pages.get(vendor_id, ""),
            "description": "",
            "level": "idle",
            "levelText": "未获取",
            "percent": None,
            "components": [],
            "incidents": [],
            "error": str(reason),
        }
    row["id"] = vendor_id
    return row


def _status_payload(fresh):
    now = time.time()
    if not fresh and _STATUS_CACHE["body"] and now - _STATUS_CACHE["at"] < 45:
        return _STATUS_CACHE["body"]
    order = ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(_status_one, order))
    body = {"fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "vendors": rows}
    _STATUS_CACHE["at"] = now
    _STATUS_CACHE["body"] = body
    return body


def _reject_private_target(url):
    if not os.environ.get("VERCEL"):
        return
    host = (urlparse(url).hostname or "").strip("[]").lower()
    if not host or host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("不能转发到内网地址")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError("接口地址无法解析") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ValueError("不能转发到内网地址")


def target_url(base):
    raw = str(base or "").strip().rstrip("/")
    if not raw.startswith("http://") and not raw.startswith("https://"):
        raise ValueError("接口地址需要以 http:// 或 https:// 开头")
    if raw.endswith("/chat/completions") or raw.endswith("/messages"):
        return raw
    host = raw.split("/")[2].lower()
    if host.endswith("anthropic.com"):
        if raw.endswith("/v1"):
            return raw + "/messages"
        return raw + "/v1/messages"
    path = raw.split("/", 3)[3] if raw.count("/") >= 3 else ""
    if path == "":
        raw = raw + "/v1"
    return raw + "/chat/completions"


def api_status(query):
    fresh = "fresh=1" in (query or "")
    body = json.dumps(_status_payload(fresh), ensure_ascii=False).encode("utf-8")
    return 200, body


def api_post(path, raw):
    try:
        data = json.loads(raw.decode("utf-8"))
        status, body, upstream_headers, elapsed = Handler._forward(Handler, data)
    except (URLError, ValueError, json.JSONDecodeError, TimeoutError) as err:
        reason = getattr(err, "reason", None) or err
        if path == "/api/probe":
            body = json.dumps({
                "status": 0,
                "text": "",
                "json": None,
                "headers": {},
                "elapsedMs": 0,
                "error": str(reason),
            }, ensure_ascii=False).encode("utf-8")
            return 200, body
        body = json.dumps({"error": {"message": str(reason)}}, ensure_ascii=False).encode("utf-8")
        return 502, body
    if path == "/api/probe":
        text = body.decode("utf-8", "replace")
        parsed = None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        kept = {}
        for key, value in upstream_headers.items():
            if key.lower() in ("content-type", "x-request-id", "openai-version", "openai-organization", "anthropic-request-id", "cf-ray"):
                kept[key] = value
        body = json.dumps({
            "status": status,
            "text": text[:20000],
            "json": parsed,
            "headers": kept,
            "elapsedMs": elapsed,
            "error": "",
        }, ensure_ascii=False).encode("utf-8")
        return 200, body
    return status, body


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _origin(self):
        host = self.headers.get("Host", "127.0.0.1:%s" % PORT)
        if not re.fullmatch(r"[A-Za-z0-9.\-:]+", host or ""):
            host = "127.0.0.1:%s" % PORT
        return "http://" + host

    def _tokenized_path(self):
        path = self.path.split("?", 1)[0]
        if path in ("/robots.txt", "/sitemap.xml") or path.endswith(".html"):
            return path
        return ""

    def _serve_tokenized(self, path, write_body):
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(ROOT, rel))
        if os.path.commonpath([ROOT, full]) != os.path.normpath(ROOT) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, encoding="utf-8") as handle:
            text = handle.read().replace("__SITE_ORIGIN__", self._origin())
        body = text.encode("utf-8")
        if path.endswith(".xml"):
            ctype = "application/xml; charset=utf-8"
        elif path.endswith(".txt"):
            ctype = "text/plain; charset=utf-8"
        else:
            ctype = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if write_body:
            self.wfile.write(body)

    def do_HEAD(self):
        path = self._tokenized_path()
        if path:
            self._serve_tokenized(path, write_body=False)
            return
        super().do_HEAD()

    def _serve_status(self):
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        status, body = api_status(query)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/status":
            self._serve_status()
            return
        path = self._tokenized_path()
        if path:
            self._serve_tokenized(path, write_body=True)
            return
        super().do_GET()

    def _forward(self, data):
        url = target_url(data.get("baseUrl", ""))
        _reject_private_target(url)
        key = str(data.get("apiKey") or "")
        payload = data.get("payload") or {}
        anthropic = "anthropic.com" in url or url.endswith("/messages")
        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "User-Agent": BROWSER_UA,
        }
        if anthropic:
            headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = "Bearer " + key
        req = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        started = time.time()
        upstream_headers = {}
        try:
            with urlopen(req, timeout=None) as resp:
                body = resp.read()
                status = resp.status
                upstream_headers = dict(resp.headers)
        except HTTPError as err:
            body = err.read()
            status = err.code
            upstream_headers = dict(err.headers or {})
        elapsed = int((time.time() - started) * 1000)
        return status, body, upstream_headers, elapsed

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/api/chat", "/api/probe"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length)
        status, body = api_post(path, raw)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("REQ", fmt % args, flush=True)


if __name__ == "__main__":
    os.chdir(ROOT)
    print("评测站已启动： http://127.0.0.1:%s/index.html" % PORT, flush=True)
    print("请用这个地址打开，不要直接双击 html 文件。", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
