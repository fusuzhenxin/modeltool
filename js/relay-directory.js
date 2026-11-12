/* 按报告所属日期和完整域名聚合，不把协议分作为能力降智依据。 */
const RelayDirectory = {
  categories: [
    { id: "degraded", title: "出现降智信号", tone: "purple", hint: "至少一份能力测试出现异常信号" },
    { id: "bad", title: "明显掺水", tone: "bad", hint: "当日至少一份报告为明显掺水" },
    { id: "warn", title: "疑似掺水", tone: "warn", hint: "当日最严重的协议结论为疑似掺水" },
    { id: "ok", title: "未见掺水", tone: "ok", hint: "当日所有已公开协议报告均未见掺水" }
  ],
  domain(item) { return String(item.domain || item.maskedDomain || "").trim().toLowerCase(); },
  day(item) { return /^\d{4}-\d{2}-\d{2}/.exec(String(item.time || ""))?.[0] || ""; },
  today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  },
  validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(value + "T12:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  },
  rows() { return (typeof PublicData !== "undefined" && PublicData.live ? PublicData.reports : typeof RELAY_PUBLIC === "undefined" ? [] : RELAY_PUBLIC).slice().sort((a, b) => String(b.time || "").localeCompare(String(a.time || ""))); },
  directoryGroups(rows) {
    const groups = RelayDirectory.group(rows);
    if (typeof PublicData !== "undefined" && PublicData.live) {
      for (const site of PublicData.stations) {
        if (!groups.some((g) => g.domain === site.domain)) groups.push({ domain: site.domain, name: site.name, reports: [], level: "unknown", degraded: false, abilityCount: 0 });
      }
    }
    return groups;
  },
  compareStations(a, b) {
    const order = (group) => {
      const site = typeof PublicData !== "undefined" && PublicData.live ? PublicData.stations.find((site) => RelayDirectory.domain(site) === group.domain) : null;
      return Number.isFinite(site?.order) ? site.order : 0;
    };
    return order(a) - order(b) || String(b.reports[0]?.time || "").localeCompare(String(a.reports[0]?.time || "")) || a.domain.localeCompare(b.domain);
  },
  url(params = {}, hash = "", file = "relays.html") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return file + (query.size ? "?" + query.toString() : "") + hash;
  },
  stationsUrl(params = {}, hash = "") { return RelayDirectory.url(params, hash, "stations.html"); },
  stationVisit(station, button = false, iconOnly = false) {
    const site = typeof PublicData !== "undefined" && PublicData.live ? PublicData.stations.find((s) => s.domain === RelayDirectory.domain(station)) : station;
    const domain = RelayDirectory.domain(station);
    const value = site?.website_url || (iconOnly && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i.test(domain) ? `https://${domain}` : "");
    if (!value) return "";
    let href;
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
      url.searchParams.set("utm_source", "modeltool.cn");
      href = url.href;
    } catch (_) { return ""; }
    if (iconOnly) return `<a class="relay-artwork-visit" href="${UI.esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${UI.esc('访问中转站：' + (station.stationName || station.name || domain))}" title="访问中转站"><span aria-hidden="true">↗</span></a>`;
    return `<a class="relay-station-visit${button ? " relay-station-visit-button" : ""}" href="${UI.esc(href)}" target="_blank" rel="noopener noreferrer">访问中转站 <span aria-hidden="true">↗</span></a>`;
  },
  stationIntro(description) {
    const text = String(description || "").trim();
    if (!text) return "";
    const chars = Array.from(text);
    const content = chars.length > 100
      ? `<details class="relay-station-intro-more"><summary><span class="relay-station-intro-preview">${UI.esc(chars.slice(0, 100).join(""))}…</span><span class="relay-station-intro-expand">展开全文 <span aria-hidden="true">⌄</span></span><span class="relay-station-intro-collapse">收起简介 <span aria-hidden="true">⌃</span></span></summary><p class="relay-station-intro-full">${UI.esc(text)}</p></details>`
      : `<p class="relay-station-intro-text">${UI.esc(text)}</p>`;
    return `<div class="relay-station-intro"><span class="relay-station-intro-label">站点简介</span>${content}</div>`;
  },
  stationProfile(station, name, site) {
    return `<div class="relay-station-profile">${RelayDirectory.stationMark({ domain: station, name })}<div class="relay-station-profile-meta"><div class="relay-station-title-row"><h1>${UI.esc(site?.name || name || station)}</h1>${RelayDirectory.stationVisit(site || { domain: station }, true)}</div><p class="relay-station-domain">${UI.esc(station)}</p></div></div>${RelayDirectory.stationIntro(site?.description)}`;
  },
  stationMark(group) {
    const custom = typeof PublicData !== "undefined" && PublicData.live ? PublicData.stations.find((s) => s.domain === group.domain)?.logo : "";
    if (custom) return `<img class="relay-station-logo relay-station-image" src="${UI.esc(custom)}" alt="" loading="lazy">`;
    const brands = {
      "api.clearstream.example": ["#168f8b", '<path d="M4 8c3-4 5 4 8 0s5 4 8 0M4 13c3-4 5 4 8 0s5 4 8 0M4 18c3-4 5 4 8 0s5 4 8 0"/>'],
      "gateway.cloudbridge.example": ["#6476d7", '<path d="M7 16H6a4 4 0 1 1 .6-8A5.5 5.5 0 0 1 17 7a4.5 4.5 0 0 1 1 9h-1M8 20v-6h8v6M11 14v-3h2v3"/>'],
      "relay.fastlane.example": ["#b87a29", '<path d="m13 3-8 11h6l-1 7 9-12h-7l1-6Z"/>'],
      "api.starport.example": ["#8360c9", '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/>'],
      "relay.pinecone.example": ["#57946d", '<path d="m12 3-6 8h3l-5 7h6v3h4v-3h6l-5-7h3l-6-8Z"/>'],
      "api.aurora.example": ["#b76c8d", '<path d="M4 18h16M6 14a6 6 0 0 1 12 0M12 3v3M4 7l2 2M20 7l-2 2"/>'],
      "gateway.voyager.example": ["#4689b5", '<path d="m12 3 8 17-8-4-8 4 8-17ZM12 3v13"/>'],
      "api.pixelgate.example": ["#6577b5", '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'],
      "relay.orbit.example": ["#7a6d9c", '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/>']
    };
    const brand = brands[group.domain];
    const initial = Array.from(String(group.name || group.domain || "站"))[0];
    return `<span class="relay-station-logo" style="--station-color:${brand ? brand[0] : "#6476a6"}" aria-hidden="true">${brand ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${brand[1]}</svg>` : UI.esc(initial)}</span>`;
  },
  group(rows) {
    const groups = new Map();
    for (const row of rows) {
      const domain = RelayDirectory.domain(row);
      if (!domain) continue;
      if (!groups.has(domain)) groups.set(domain, { domain, name: row.stationName || domain, reports: [] });
      groups.get(domain).reports.push(row);
    }
    const weight = { unknown: 0, ok: 1, warn: 2, bad: 3 };
    return Array.from(groups.values()).map((group) => {
      group.reports.sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
      group.level = group.reports.reduce((level, row) => (weight[row.level] || 0) > weight[level] ? row.level : level, "unknown");
      // 只有协议报告都明确为 ok，站点才进入“未见掺水”；其他测试不覆盖协议结论。
      if (group.level === "ok" && group.reports.some((row) => row.level !== "ok" && row.kind !== "pelican" && row.protocol_tested !== false)) group.level = "unknown";
      group.degraded = group.reports.some((row) => row.ability?.level === "degraded");
      group.abilityCount = group.reports.filter((row) => typeof row.ability?.score === "number").length;
      return group;
    }).sort((a, b) => weight[b.level] - weight[a.level] || a.domain.localeCompare(b.domain));
  },
  matches(group, category) { return category === "degraded" ? group.degraded : group.level === category; },
  badge(level) {
    const titles = { ok: "未见掺水", warn: "疑似掺水", bad: "明显掺水", unknown: "结论不足" };
    return `<span class="badge ${level === "unknown" ? "" : level}"><i></i>${titles[level] || titles.unknown}</span>`;
  },
  abilityBadge(item) {
    const ability = item.ability;
    if (ability?.level === "degraded") return `<span class="badge ability-degraded">降智信号 · ${UI.esc(ability.score)} 分</span>`;
    if (ability?.level === "normal") return `<span class="badge ok">能力表现正常 · ${UI.esc(ability.score)} 分</span>`;
    if (typeof ability?.score === "number") return `<span class="badge">能力 ${UI.esc(ability.score)} 分 · 未设基线</span>`;
    return `<span class="badge">未测能力</span>`;
  },
  demoNotice(rows) {
    return rows.some((row) => row.demo) ? `<p class="demo-notice"><strong>演示数据</strong> 当前含虚构站点和模拟报告，用于预览统计、站点档案和报告详情。域名完整显示，模拟数据不代表实际服务。</p>` : "";
  },
  datePicker(date, station = "") {
    return `<form class="relay-date-form" action="relays.html" method="get">${station ? `<input type="hidden" name="station" value="${UI.esc(station)}">` : ""}<label for="relay-date">报告日期<input id="relay-date" type="date" name="date" value="${UI.esc(date)}" required></label><button class="btn btn-primary" type="submit">查看</button><a class="btn btn-ghost" href="${RelayDirectory.url({ station, date: RelayDirectory.today() })}">今天</a></form>`;
  },
  dateLinks(rows, date, station = "") {
    const dates = [...new Set(rows.map(RelayDirectory.day).filter(Boolean))].sort().reverse();
    return `<nav class="relay-date-links" aria-label="有报告的日期"><span>已有报告：</span>${dates.map((day) => `<a ${day === date ? 'aria-current="date"' : ""} href="${RelayDirectory.url({ date: day, station })}">${day}</a>`).join("") || "暂无"}</nav>`;
  },
  chart(groups, date, compact = false) {
    return `<div class="relay-bars" aria-label="${UI.esc(date)} 按站点去重的分类统计">${RelayDirectory.categories.map((category) => {
      const stations = groups.filter((group) => RelayDirectory.matches(group, category.id));
      const href = RelayDirectory.url({ date, category: category.id }, "#relay-stations");
      return `<div class="relay-bar-row tone-${category.tone}"><a class="relay-bar-label" href="${href}">${category.title}<b>${stations.length}<small> 家</small></b></a><a class="relay-bar-track" href="${href}" aria-label="${category.title}：${stations.length} 家，查看站点"><span style="width:${groups.length ? stations.length / groups.length * 100 : 0}%"></span></a>${compact ? "" : `<div class="relay-bar-stations">${stations.map((group) => `<a href="${RelayDirectory.url({ date, station: group.domain })}">${UI.esc(group.name)}</a>`).join("") || `<span>暂无站点</span>`}</div>`}</div>`;
    }).join("")}</div>`;
  },
  overview() {
    const date = RelayDirectory.today();
    const rows = RelayDirectory.rows().filter((row) => RelayDirectory.day(row) === date);
    const groups = RelayDirectory.group(rows);
    const latest = groups.slice().sort(RelayDirectory.compareStations).slice(0, 3).map((group) => group.reports[0]);
    return `<section class="panel home-watch" aria-labelledby="home-watch-title"><div class="home-watch-head"><div><h2 id="home-watch-title">中转观察</h2><p>${date}<span>·</span>${groups.length} 家中转站<span>·</span>${rows.length} 份报告${rows.some((row) => row.demo) ? '<span class="home-watch-demo">演示数据</span>' : ""}</p></div><a href="relays.html">完整日报 ${UI.icon("arrow")}</a></div><div class="home-watch-stats">${RelayDirectory.chart(groups, date, true)}</div><div class="home-watch-report-head"><h3>各站最新报告</h3><a href="${RelayDirectory.stationsUrl({ date })}">查看更多中转站 →</a></div><div class="home-watch-reports">${latest.map((row) => `<a class="home-watch-report" href="${RelayDirectory.url({ id: row.id })}"><div class="home-watch-report-top"><span class="home-watch-station">${RelayDirectory.stationMark({ domain: RelayDirectory.domain(row), name: row.stationName })}<strong>${UI.esc(row.stationName || RelayDirectory.domain(row))}</strong></span>${RelayDirectory.badge(row.level)}</div><span class="home-watch-domain">${UI.esc(RelayDirectory.domain(row))}</span><div class="home-watch-report-bottom"><span>${UI.esc(row.model)}</span><span>${row.score == null ? "查看报告" : UI.esc(row.score) + " 分"} ${UI.icon("arrow")}</span></div></a>`).join("") || '<p class="home-watch-empty">今天还没有公开报告，<a href="relays.html">查看历史日报</a>。</p>'}</div><p class="home-watch-note">按站点去重 · 能力与协议分别统计 · 未测不代表正常</p></section>`;
  },
  table(rows, date, showStation = true) {
    if (!rows.length) return `<div class="empty"><h3>这一天还没有公开报告</h3><p>可以选择上方已有报告的日期，或自行检测。</p></div>`;
    return `<div class="table-wrap"><table class="grid relay-reports"><thead><tr><th>检测时间</th>${showStation ? "<th>中转站 / 完整域名</th>" : ""}<th>宣称模型</th><th>协议结论</th><th>能力表现</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td><time>${UI.esc(row.time)}</time>${row.demo ? `<span class="demo-tag">演示数据</span>` : ""}</td>${showStation ? `<td><a href="${RelayDirectory.url({ station: RelayDirectory.domain(row), date })}">${UI.esc(row.stationName || RelayDirectory.domain(row))}</a><span class="relay-table-domain">${UI.esc(RelayDirectory.domain(row))}</span></td>` : ""}<td>${UI.esc(row.model)}</td><td>${RelayDirectory.badge(row.level)}</td><td>${RelayDirectory.abilityBadge(row)}</td><td><a href="${RelayDirectory.url({ id: row.id })}">查看报告</a></td></tr>`).join("")}</tbody></table></div>`;
  },
  stationCard(group, date) {
    const all = RelayDirectory.rows().filter((row) => RelayDirectory.domain(row) === group.domain);
    return `<article class="panel relay-station-card"><div class="relay-station-heading"><div class="relay-station-identity">${RelayDirectory.stationMark(group)}<div><h3><a href="${RelayDirectory.url({ station: group.domain, date })}">${UI.esc(group.name)}</a></h3><span class="relay-station-domain">${UI.esc(group.domain)}</span></div></div>${group.reports.some((row) => row.demo) ? `<span class="demo-tag">演示数据</span>` : ""}</div><div class="relay-station-badges">${RelayDirectory.badge(group.level)}${group.degraded ? `<span class="badge ability-degraded">出现降智信号</span>` : `<span class="badge">${group.abilityCount ? "已测能力 " + group.abilityCount + " 份" : "未测能力"}</span>`}</div><p class="relay-muted">当日 ${group.reports.length} 份 · 历史 ${all.length} 份 · 当日已测 ${new Set(group.reports.map((row) => row.model)).size} 个模型</p><ul class="relay-station-reports">${group.reports.slice(0, 3).map((row) => `<li><a href="${RelayDirectory.url({ id: row.id })}"><time>${UI.esc(row.time.slice(11))}</time><span>${UI.esc(row.model)}</span><span>${UI.esc(row.title)}</span></a></li>`).join("")}</ul><div class="relay-station-links"><a class="relay-station-more" href="${RelayDirectory.url({ station: group.domain, date })}">查看该中转站的全部报告 →</a>${RelayDirectory.stationVisit(group)}</div></article>`;
  },
  stationsPage() {
    const query = new URLSearchParams(location.search);
    const date = RelayDirectory.validDay(query.get("date")) ? query.get("date") : RelayDirectory.today();
    const category = RelayDirectory.categories.find((item) => item.id === query.get("category"));
    const search = (query.get("q") || "").trim().slice(0, 120);
    const all = RelayDirectory.rows();
    const rows = all.filter((row) => RelayDirectory.day(row) === date);
    const groups = RelayDirectory.directoryGroups(rows);
    const filtered = groups.filter((group) => (!category || RelayDirectory.matches(group, category.id)) && (!search || (group.name + " " + group.domain).toLowerCase().includes(search.toLowerCase()))).sort(RelayDirectory.compareStations);
    const pageSize = 6;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const requested = /^\d+$/.test(query.get("page") || "") ? Number(query.get("page")) : 1;
    const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, pageCount)) : 1;
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
    const params = { date, category: category?.id, q: search };
    const range = filtered.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + visible.length}` : "0";
    const numbers = [...new Set([1, page - 1, page, page + 1, pageCount].filter((value) => value >= 1 && value <= pageCount))].sort((a, b) => a - b);
    const pagination = pageCount > 1 ? `<nav class="relay-pagination" aria-label="中转站列表分页">${page > 1 ? `<a href="${RelayDirectory.stationsUrl({ ...params, page: page - 1 }, "#station-results")}">← 上一页</a>` : '<span aria-disabled="true">← 上一页</span>'}${numbers.map((value, index) => `${index && value - numbers[index - 1] > 1 ? '<span class="relay-page-gap">…</span>' : ""}<a ${page === value ? 'aria-current="page"' : ""} aria-label="第 ${value} 页" href="${RelayDirectory.stationsUrl({ ...params, page: value }, "#station-results")}">${value}</a>`).join("")}${page < pageCount ? `<a href="${RelayDirectory.stationsUrl({ ...params, page: page + 1 }, "#station-results")}">下一页 →</a>` : '<span aria-disabled="true">下一页 →</span>'}</nav>` : "";
    return UI.shell("relay-public", `<div class="page-head relay-directory-head"><div><div class="crumb"><a href="index.html">首页</a> / <a href="${RelayDirectory.url({ date })}">中转检测日报</a> / 中转站列表</div><h1>中转站列表</h1><p>按名称、完整域名和当天检测结论查找，进入站点查看多模型与历史报告。</p></div><a class="btn btn-ghost" href="${RelayDirectory.url({ date }, "#relay-stations")}">← 返回当天日报</a></div>${RelayDirectory.demoNotice(rows)}<form class="panel relay-directory-form" action="stations.html" method="get"><label class="relay-directory-search" for="station-search">搜索中转站<input class="text-input" id="station-search" name="q" type="search" maxlength="120" placeholder="搜索名称或完整域名" value="${UI.esc(search)}"></label><label for="station-date">报告日期<input class="text-input" id="station-date" name="date" type="date" value="${UI.esc(date)}" required></label><label for="station-category">检测分类<select class="select-native" id="station-category" name="category" aria-label="检测分类"><option value="">全部分类</option>${RelayDirectory.categories.map((item) => `<option value="${item.id}" ${category?.id === item.id ? "selected" : ""}>${item.title}</option>`).join("")}</select></label><button class="btn btn-primary" type="submit">查找</button><a class="relay-directory-reset" href="${RelayDirectory.stationsUrl({ date })}">重置</a></form><section id="station-results" class="relay-directory-results"><div class="section-intro"><div><h2>${category ? category.title + "的中转站" : "全部中转站"} <span class="relay-muted">${filtered.length} 家</span></h2><p>${UI.esc(date)} · 已登记 ${groups.length} 家 · 当日 ${RelayDirectory.group(rows).length} 家有公开报告 / ${rows.length} 份报告 · 仅统计公开报告</p></div><span class="relay-muted">显示 ${range} / ${filtered.length} 家</span></div><div class="relay-station-grid">${visible.map((group) => RelayDirectory.stationCard(group, date)).join("") || `<div class="panel relay-directory-empty"><h2>没有符合条件的中转站</h2><p>试试其他名称、分类或日期。</p><a href="${RelayDirectory.stationsUrl({ date })}">清除搜索与分类 →</a></div>`}</div>${pagination}</section><p class="note">按站点展示顺序排列，每页 6 家。协议与能力结论分别展示，未测不代表正常。模拟站点图标仅用于演示。</p>`);
  },
  reportContext(item) {
    const date = RelayDirectory.day(item);
    const station = RelayDirectory.domain(item);
    const siblings = RelayDirectory.rows().filter((row) => RelayDirectory.domain(row) === station && RelayDirectory.day(row) === date && row.id !== item.id);
    const ability = item.ability;
    const measured = typeof ability?.score === "number";
    const original = item.suite === "site-original-v1";
    return `<section class="panel relay-ability"><div class="panel-hd"><h2>模型能力表现${item.demo ? " · 模拟" : ""}</h2>${RelayDirectory.abilityBadge(item)}</div><div class="panel-bd">${measured ? `<div class="relay-ability-scores"><div><span>本次能力分</span><strong>${UI.esc(ability.score)}<small> / 100</small></strong></div>${original ? '<div><span>评分依据</span><strong>本站原版</strong></div>' : `<div><span>同条件参考基线</span><strong>${UI.esc(ability.baseline ?? "未设定")}<small> / 100</small></strong></div>`}</div><p>${UI.esc(ability.summary || "")}</p><p class="note">${UI.esc(ability.questions || "—")} 道题 · ${original ? "题目和判分直接复用网站测试；各模块结果见上方。" : "相同题组与设置。"}${item.demo ? "本次分数与参考基线均为模拟数据。" : "请结合题目范围与同条件复测判断。"}</p>` : `<p>这份报告没有模型能力测试，不能据协议检测结果判断是否降智。</p>`}</div></section><section class="panel relay-related"><div class="panel-hd"><h2>该中转站当天的其他报告</h2><a href="${RelayDirectory.url({ station, date })}">进入中转站档案 →</a></div>${RelayDirectory.table(siblings, date, false)}<div class="panel-bd entry-actions"><a class="btn btn-primary" href="${RelayDirectory.url({ date }, "#daily-reports")}">查看 ${date} 所有中转站的报告</a><a class="btn btn-ghost" href="${RelayDirectory.url({ station, date })}">查看该站当天全部报告</a></div></section>`;
  },
  mountArtworkPreviews() {
    if (RelayDirectory.previewObserver) RelayDirectory.previewObserver.disconnect();
    const fit = (viewport) => {
      const frame = viewport.querySelector("iframe");
      if (!frame || !viewport.clientWidth || !viewport.clientHeight) return;
      const scale = Math.min(viewport.clientWidth / 1200, viewport.clientHeight / 1000);
      frame.style.transform = `translate(${(viewport.clientWidth - 1200 * scale) / 2}px, ${(viewport.clientHeight - 1000 * scale) / 2}px) scale(${scale})`;
      frame.style.visibility = "visible";
    };
    const viewports = document.querySelectorAll(".relay-artwork-viewport");
    if (typeof ResizeObserver !== "undefined") {
      RelayDirectory.previewObserver = new ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target)));
      viewports.forEach((viewport) => { fit(viewport); RelayDirectory.previewObserver.observe(viewport); });
    } else viewports.forEach(fit);
  },
  artworkPage() {
    const query = new URLSearchParams(location.search);
    const search = (query.get("q") || "").trim().slice(0, 120);
    const date = RelayDirectory.validDay(query.get("date")) ? query.get("date") : "";
    const modes = { svg: "经典 SVG", html2d: "2D 动画 HTML", three: "3D 动画 HTML" };
    const mode = Object.hasOwn(modes, query.get("mode")) ? query.get("mode") : "";
    const all = RelayDirectory.rows().filter((row) => row.id && row.artwork?.available);
    const rows = all.filter((row) => (!date || RelayDirectory.day(row) === date) && (!mode || row.artwork.mode === mode) && (!search || [row.stationName, RelayDirectory.domain(row), row.model].join(" ").toLowerCase().includes(search.toLowerCase())));
    const pages = Math.max(1, Math.ceil(rows.length / 6));
    const requested = Number(query.get("page") || 1);
    const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, pages)) : 1;
    const shown = rows.slice((page - 1) * 6, page * 6);
    const url = (page) => RelayDirectory.url({ view: "artworks", q: search, mode, date, page });
    const card = (row) => {
      const art = row.artwork, source = `/api/public/reports/${encodeURIComponent(row.id)}/artwork`;
      const score = typeof art.score === "number" && Number.isFinite(art.score) && art.score >= 0 && art.score <= 100 ? art.score : null;
      const tone = score === null ? "unscored" : score >= 85 ? "high" : score >= 70 ? "medium" : "low";
      return `<article class="panel relay-artwork-card"><div class="relay-artwork-viewport"><iframe width="1200" height="1000" class="relay-artwork-preview" loading="lazy" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${source}" title="${UI.esc((row.stationName || row.domain) + ' · ' + row.model + ' 鹈鹕作品')}"></iframe></div><div class="panel-bd"><div class="relay-artwork-header"><div class="relay-artwork-identity"><div class="relay-artwork-title"><h2>${UI.esc(row.stationName || RelayDirectory.domain(row))}</h2>${RelayDirectory.stationVisit(row, false, true)}${row.demo ? '<span class="demo-tag">演示数据</span>' : ""}</div><p class="relay-muted">${UI.esc(RelayDirectory.domain(row))}</p></div><div class="artwork-votes" data-artwork-votes="${UI.esc(row.id)}" role="group" aria-label="网友判定，仅供参考，不代表模型身份认证" title="网友判定，仅供参考；同一浏览器一票，可改票或撤回"><div class="artwork-vote-buttons"><button type="button" class="artwork-vote-real" disabled>判真 <b>—</b></button><button type="button" class="artwork-vote-fake" disabled>判假 <b>—</b></button></div><small role="status">加载中…</small></div></div><p>${UI.esc(row.model)} · ${UI.esc(art.mode_name || modes[art.mode] || "鹈鹕骑车")}</p><div class="relay-artwork-score score-${tone}"><span>代码结构分</span><div><strong>${UI.esc(score ?? "—")}</strong><span> / 100</span></div></div><p class="relay-artwork-time relay-muted"><time>${UI.esc(row.time)}</time></p><div class="entry-actions"><a class="btn btn-primary btn-sm" href="${source}" target="_blank" rel="noopener noreferrer">新标签页打开作品</a><a class="btn btn-ghost btn-sm" href="${RelayDirectory.url({ id: row.id })}">报告与分享 →</a></div></div></article>`;
    };
    return UI.shell("relay-artworks", `<div class="page-head"><div class="crumb"><a href="relays.html">中转日报</a> / 中转站鹈鹕作品</div><h1>中转站鹈鹕骑车作品</h1><p>查看各中转站、模型在测试中生成的已公开作品，支持 SVG、2D 和 3D。</p></div><form class="panel relay-directory-form relay-artwork-filters" action="relays.html" method="get"><input type="hidden" name="view" value="artworks"><label class="relay-directory-search" for="artwork-search">搜索站点或模型<input class="text-input" id="artwork-search" type="search" name="q" maxlength="120" value="${UI.esc(search)}" placeholder="名称、完整域名或模型"></label><label for="artwork-date">报告日期（可选）<input class="text-input" id="artwork-date" type="date" name="date" value="${date}"></label><label for="artwork-mode">作品类型<select class="select-native" id="artwork-mode" name="mode"><option value="">全部类型</option>${Object.entries(modes).map(([key, name]) => `<option value="${key}" ${mode === key ? "selected" : ""}>${name}</option>`).join("")}</select></label><button class="btn btn-primary" type="submit">查找</button><a class="relay-directory-reset" href="relays.html?view=artworks">重置</a></form><p class="note">${date || "全部日期"} · ${rows.length} 件作品 · 每页 6 件。代码结构分不代表画面质量或模型身份；打开报告可生成海报和分享链接。</p>${RelayDirectory.demoNotice(rows)}<div class="relay-artwork-grid">${shown.map(card).join("") || '<div class="panel"><div class="panel-bd"><h2>暂无符合条件的公开作品</h2><p>试试其他条件。检测完成的作品经审核公开后会显示在这里。</p></div></div>'}</div>${pages > 1 ? `<nav class="relay-pagination" aria-label="作品列表分页">${page > 1 ? `<a href="${UI.esc(url(page - 1))}">← 上一页</a>` : ""}<span>${page} / ${pages}</span>${page < pages ? `<a href="${UI.esc(url(page + 1))}">下一页 →</a>` : ""}</nav>` : ""}`);
  },
  page() {
    if (typeof PublicData !== "undefined" && PublicData.failed) return UI.shell("relay-public", '<div class="page-head" role="status"><h1>公开记录暂时无法加载</h1><p>连接暂时中断，无法确认这份记录的状态。请重新加载。</p><button class="btn btn-primary" type="button" onclick="location.reload()">重新加载</button></div>');
    const all = RelayDirectory.rows();
    const query = new URLSearchParams(location.search);
    if (query.get("view") === "artworks" && !query.get("id")) return RelayDirectory.artworkPage();
    if (query.get("id")) {
      const report = all.find((row) => row.id === query.get("id"));
      return report ? relayPublicDetail(report) : UI.shell("relay-public", `<div class="page-head"><h1>没有找到这份公开记录</h1><a href="relays.html">返回检测日报</a></div>`);
    }
    const date = RelayDirectory.validDay(query.get("date")) ? query.get("date") : RelayDirectory.today();
    const station = (query.get("station") || "").trim().toLowerCase();
    if (station) return RelayDirectory.stationPage(all, station, date);
    const rows = all.filter((row) => RelayDirectory.day(row) === date);
    const groups = RelayDirectory.group(rows);
    const category = RelayDirectory.categories.find((item) => item.id === query.get("category"));
    const visible = category ? groups.filter((group) => RelayDirectory.matches(group, category.id)) : groups;
    const preview = visible.slice().sort(RelayDirectory.compareStations).slice(0, 3);
    const abilityReports = rows.filter((row) => typeof row.ability?.score === "number").length;
    return UI.shell("relay-public", `<div class="page-head"><div class="crumb"><a href="index.html">首页</a> / 中转检测日报</div><h1>${date === RelayDirectory.today() ? "今天，哪些中转站出现了异常？" : date + " 中转检测日报"}</h1><p>先看当天统计，再按中转站查看模型与每一次报告。</p></div>${RelayDirectory.demoNotice(all)}<section class="panel relay-day-toolbar"><div><strong>${UI.esc(date)}</strong><span>${groups.length} 家中转站 · ${rows.length} 份报告 · ${abilityReports} 份含能力测试</span></div>${RelayDirectory.datePicker(date)}</section>${RelayDirectory.dateLinks(all, date)}<article class="panel relay-day-chart"><div class="panel-hd"><h2>当天站点分布</h2><a href="${RelayDirectory.url({ date }, "#daily-reports")}">当天全部 ${rows.length} 份报告 →</a></div><div class="panel-bd">${RelayDirectory.chart(groups, date)}<p class="note">每家中转站在每个类别只计 1 次；掺水按当天最严重的公开结论归类。降智信号独立统计，可能与掺水重叠。只统计本页已收录报告，未测不代表正常。</p></div></article><section id="relay-stations" class="relay-stations"><div class="section-intro"><h2>${category ? category.title + "的中转站" : "当天检测的中转站"} <span class="relay-muted">${visible.length} 家</span></h2><a class="relay-stations-more" href="${RelayDirectory.stationsUrl({ date, category: category?.id })}">查看更多中转站 <span aria-hidden="true">→</span></a></div><div class="relay-category-tabs"><a ${!category ? 'aria-current="page"' : ""} href="${RelayDirectory.url({ date }, "#relay-stations")}">全部</a>${RelayDirectory.categories.map((item) => `<a ${category?.id === item.id ? 'aria-current="page"' : ""} href="${RelayDirectory.url({ date, category: item.id }, "#relay-stations")}">${item.title}</a>`).join("")}</div><div class="relay-station-grid">${preview.map((group) => RelayDirectory.stationCard(group, date)).join("") || `<div class="empty">这一天没有符合该分类的中转站。</div>`}</div><p class="relay-preview-note">${visible.length > preview.length ? `这里展示 ${preview.length} 家，共 ${visible.length} 家可在完整列表查看。` : `已展示当天${category ? "该分类" : "已收录"}的全部 ${visible.length} 家中转站。`}</p></section><article id="daily-reports" class="panel relay-public relay-daily-reports"><div class="panel-hd"><h2>${UI.esc(date)} 全部报告</h2><span>${rows.length} 份 · 不受上方站点分类筛选影响</span></div>${RelayDirectory.table(rows, date)}</article><p class="note">协议结论与模型能力分别展示。单次结果不代表站点长期质量；模拟报告的分数和基线同样为演示数据。</p>`);
  },
  stationPage(all, station, date) {
    const history = all.filter((row) => RelayDirectory.domain(row) === station);
    const site = typeof PublicData !== "undefined" && PublicData.live ? PublicData.stations.find((s) => s.domain === station) : null;
    if (!history.length && site) return UI.shell("relay-public", `<div class="page-head"><div class="crumb"><a href="stations.html">中转站列表</a> / 站点档案</div>${RelayDirectory.stationProfile(station, site.name, site)}</div><section class="panel"><div class="panel-bd"><h2>还没有公开报告</h2><p>已登记模型：${site.models.map(UI.esc).join("、")}。未测不代表正常，检测报告经审核后会出现在这里。</p><a href="stations.html">返回中转站列表 →</a></div></section>`);
    if (!history.length) return UI.shell("relay-public", `<div class="page-head"><h1>还没有这个中转站的公开报告</h1><a href="relays.html">返回检测日报</a></div>`);
    const rows = history.filter((row) => RelayDirectory.day(row) === date);
    const group = RelayDirectory.group(rows)[0];
    const models = [...new Set(rows.map((row) => row.model))];
    return UI.shell("relay-public", `<div class="page-head"><div class="crumb"><a href="${RelayDirectory.url({ date })}">中转检测日报</a> / 中转站档案</div>${RelayDirectory.stationProfile(station, history[0].stationName, site || history[0])}<p class="relay-station-report-note">同一中转站的不同模型、不同时间分别保留报告。</p></div>${RelayDirectory.demoNotice(history)}<section class="panel relay-day-toolbar"><div><strong>${UI.esc(date)} · ${rows.length} 份报告</strong><span>历史共 ${history.length} 份 · 当日 ${models.length} 个模型</span></div>${RelayDirectory.datePicker(date, station)}</section>${RelayDirectory.dateLinks(history, date, station)}${group ? `<div class="relay-station-badges">${RelayDirectory.badge(group.level)}${group.degraded ? `<span class="badge ability-degraded">出现降智信号</span>` : ""}<span class="relay-muted">当日汇总 · 能力测试 ${group.abilityCount}/${rows.length} 份</span></div>` : ""}<article class="panel relay-public relay-daily-reports"><div class="panel-hd"><h2>${UI.esc(date)} 该站全部报告</h2><a href="${RelayDirectory.url({ date }, "#daily-reports")}">查看这一天所有中转站的报告 →</a></div>${RelayDirectory.table(rows, date, false)}</article><section class="panel relay-station-history"><div class="panel-hd"><h2>历史报告按天查看</h2></div><div class="panel-bd relay-history-days">${[...new Set(history.map(RelayDirectory.day))].sort().reverse().map((day) => `<a href="${RelayDirectory.url({ station, date: day })}"><time>${day}</time><span>${history.filter((row) => RelayDirectory.day(row) === day).length} 份报告 →</span></a>`).join("")}</div></section>`);
  }
};
