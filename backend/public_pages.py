"""Readable public HTML for visitors and crawlers; never render private records."""
import json
import math
import re
from datetime import datetime
from html import escape
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

from .core import day
from .report_quality import IDENTITY_LABELS, PROTOCOL_TITLES
from .stability import KINDS

ORIGIN = "https://www.modeltool.cn"
DESCRIPTION = "查看中转站检测日报、公开报告和稳定性观察，分别了解请求完成情况、响应速度、能力测试与模型指纹结果。"


def link(**query):
    return "/relays.html" + ("?" + urlencode(query) if query else "")


def public_rows(db):
    stations = {s["id"]: {k: s.get(k, "") for k in ("id", "name", "domain", "description", "order")}
                for s in db.list("stations") if s.get("visible")}
    reports = []
    for row in db.report_rows(summary=True, published=True):
        if row["station_id"] not in stations:
            continue
        result = row["result"]
        reports.append({k: result.get(k) for k in
                        ("model", "time", "kind", "score", "ability", "identity", "level", "protocol_tested")}
                       | {"id": row["id"], "station_id": row["station_id"], "demo": bool(row.get("demo"))})
    reports.sort(key=lambda r: str(r.get("time") or ""), reverse=True)
    return stations, reports


def number(value):
    return str(value) if type(value) in (int, float) and math.isfinite(value) else None


def verdict(report):
    parts = []
    if report.get("protocol_tested"):
        parts.append("中转站功能：" + PROTOCOL_TITLES.get(report.get("level"), "暂无法判断"))
    identity = report.get("identity") or {}
    parts.append("模型指纹：" + IDENTITY_LABELS.get(identity.get("status"), "未测指纹"))
    score = number((report.get("ability") or {}).get("score"))
    if score is not None:
        parts.append("能力分数：" + score)
    elif not report.get("protocol_tested") and report.get("kind") not in ("site_trace", "site_pelican", "pelican"):
        score = number(report.get("score"))
        if score is not None:
            parts.append("本项得分：" + score)
    return "；".join(parts)


def render(db, template, path, query):
    stations, reports = public_rows(db)
    station = query.get("station", "")
    report_id = query.get("id", "") if path == "relays.html" else ""
    selected = next((r for r in reports if r["id"] == report_id), None) if report_id else None
    site = next((s for s in stations.values() if s["domain"] == station), None) if station else None
    if (report_id and not selected) or (not report_id and station and not site):
        return None
    canonical = "/" + path
    heading = "中转站列表" if path == "stations.html" else "中转检测日报"
    description = DESCRIPTION
    if selected:
        site = stations[selected["station_id"]]
        reports = [selected]
        heading = f"{site['name']} · {selected.get('model') or ''} · 检测报告"
        canonical = link(id=selected["id"])
        description = f"{site['name']}（{site['domain']}）的公开检测报告。" + verdict(selected)
    elif site:
        reports = [r for r in reports if r["station_id"] == site["id"]]
        heading = site["name"] + " · 公开检测报告"
        canonical = link(station=site["domain"])
        description = f"查看{site['name']}（{site['domain']}）的公开检测记录、能力与模型指纹结果。"
    elif query.get("view") == "stability" and path == "relays.html":
        heading = "中转站稳定性观察"
        canonical = link(view="stability")
    elif path == "relays.html":
        date = query.get("date", "")
        try:
            valid_date = datetime.strptime(date, "%Y-%m-%d").strftime("%Y-%m-%d") == date
        except (ValueError, TypeError):
            valid_date = False
        date = date if valid_date else day()
        reports = [r for r in reports if str(r.get("time") or "").startswith(date)]
        heading = date + " 中转检测日报"
        if valid_date:
            canonical = link(date=date)
    visible = reports[:30]
    ordered = sorted(stations.values(), key=lambda s: (s.get("order") or 0, s["domain"]))
    pieces = [f'<main class="container" id="public-relay-summary"><section class="panel"><div class="panel-bd"><h1>{escape(heading)}</h1>',
              '<p>能力测试、模型指纹与中转站功能分别展示。稳定性观察来自定时抽样，不代表连续在线率；指纹相符不等于保证模型未被替换。</p>',
              '<nav aria-label="公开检测导航"><a href="/relays.html">检测日报</a> · <a href="/relays.html?view=stability">稳定性观察</a> · <a href="/stations.html">中转站列表</a></nav>']
    if site:
        pieces.append(f'<h2>{escape(site["name"])}</h2><p>{escape(site["domain"])}</p>')
        if site.get("description"):
            pieces.append('<p>' + escape(str(site["description"])) + '</p>')
    else:
        pieces.append('<h2>已公开的中转站</h2><ul>')
        for s in ordered:
            pieces.append(f'<li><a href="{escape(link(station=s["domain"]))}">{escape(s["name"])}</a> — {escape(s["domain"])}</li>')
        pieces.append('</ul>')
    if query.get("view") == "stability" and path == "relays.html" and not selected:
        from .stability import snapshot
        observation = snapshot(db, str(query.get("model", ""))[:150], str(query.get("test", ""))[:64])
        test_label = next((t["label"] for t in observation["tests"] if t["id"] == observation["selected_test"]), "暂无有效样本")
        pieces.append('<h2>近 7 天抽样观察</h2><p>' + escape(f'{observation["start"]} 至 {observation["end"]}（北京时间） · {observation["selected_model"]} · {test_label}') + '</p><ul>')
        for stats in observation["stations"]:
            if site and stats["station"]["id"] != site["id"]:
                continue
            total, completed = stats["samples"], stats["completed"]
            rate = f'{completed / total:.1%}' if total else "暂无样本"
            sample_note = "样本充分" if stats["eligible"] else "样本积累中"
            label = f'{stats["station"]["name"]}：完成 {completed}/{total} 次，完成率 {rate}，{sample_note}'
            pieces.append('<li>' + escape(label) + '</li>')
        pieces.append('</ul>')
    pieces.append('<h2>公开检测记录</h2>')
    if not visible:
        pieces.append('<p>当前条件下暂无公开报告，可以进入各站档案查看历史记录。</p>')
    items = []
    for report in visible:
        s = stations[report["station_id"]]
        name = f'{s["name"]} · {report.get("model") or ""} · {KINDS.get(report.get("kind"), "检测报告")}'
        url = link(id=report["id"])
        pieces.append(f'<article><h3><a href="{escape(url)}">{escape(name)}</a></h3><p>{escape(str(report.get("time") or ""))} · {escape(s["domain"])}</p><p>{escape(verdict(report))}</p>'
                      + ('<p>演示数据，不代表真实服务表现。</p>' if report["demo"] else '') + '</article>')
        items.append({"@type": "ListItem", "position": len(items) + 1, "name": name, "url": ORIGIN + url})
    if len(reports) > len(visible):
        pieces.append(f'<p>共有 {len(reports)} 份匹配报告，这里列出最近 {len(visible)} 份；启用 JavaScript 可使用完整筛选与报告详情。</p>')
    pieces.append('</div></section></main>')
    schema = {"@context": "https://schema.org", "@type": "CollectionPage", "name": heading, "url": ORIGIN + canonical,
              "description": description, "mainEntity": {"@type": "ItemList", "itemListElement": items}}
    encoded = json.dumps(schema, ensure_ascii=False).replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    html = template.replace('<div id="app"></div>', '<div id="app">' + ''.join(pieces) + '</div>')
    title = heading + " | 大模型降智检测"
    html = re.sub(r'<title>.*?</title>', lambda _: '<title>' + escape(title) + '</title>', html, count=1)
    for attribute, name, content in (("name", "description", description), ("property", "og:title", title),
                                     ("name", "twitter:title", title), ("property", "og:description", description),
                                     ("name", "twitter:description", description), ("property", "og:url", ORIGIN + canonical)):
        pattern = r'<meta ' + attribute + '="' + re.escape(name) + r'" content="[^"]*">'
        html = re.sub(pattern, lambda _: f'<meta {attribute}="{name}" content="{escape(content)}">', html, count=1)
    html = re.sub(r'<link rel="canonical" href="[^"]*">', lambda _: f'<link rel="canonical" href="{escape(ORIGIN + canonical)}">', html, count=1)
    return html.replace('</head>', '<script type="application/ld+json">' + encoded + '</script></head>')


def sitemap(db, template):
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    root = ET.fromstring(template)
    known = {node.text for node in root.findall(f"{{{namespace}}}url/{{{namespace}}}loc")}
    stations, reports = public_rows(db)
    urls = [(link(), "daily"), (link(view="stability"), "daily"), ("/stations.html", "daily")]
    urls += [(link(station=s["domain"]), "daily") for s in stations.values()]
    urls += [(link(id=r["id"]), "weekly") for r in reports]
    for path, frequency in urls:
        if ORIGIN + path in known:
            continue
        node = ET.SubElement(root, f"{{{namespace}}}url")
        ET.SubElement(node, f"{{{namespace}}}loc").text = ORIGIN + path
        ET.SubElement(node, f"{{{namespace}}}changefreq").text = frequency
        known.add(ORIGIN + path)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
