"use strict";

const Admin = (() => {
  const state = { csrf: "", user: "", route: "dashboard", rows: [], stations: [], tests: [], search: "", filter: "", page: 1, ticket: 0, setupToken: "", selected: new Set(), bulkResult: null, bulkBusy: false };
  const app = document.getElementById("admin-app");
  const editor = document.getElementById("editor");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const titles = { dashboard: "运营总览", announcements: "公告管理", stations: "中转站管理", schedules: "定时检测", jobs: "任务记录", reports: "报告审核", proposals: "收录提案", ads: "广告位管理", settings: "系统设置" };
  const subtitles = { dashboard: "看一眼运行情况，再开始今天的运营。", announcements: "维护全宽滚动公告，支持颜色、置顶、展示范围与生效时间。", stations: "维护站点资料与检测密钥；排序数字越小，前台展示越靠前，修改后点击保存。", schedules: "设置检测频率，按计划采集，审核后公开。", jobs: "查看任务进度、失败原因与检测用量。", reports: "先核对逐项结果，再决定是否公开到中转日报。", proposals: "处理用户提名、测试需求、投票与评论，同步公开进度。", ads: "管理首页推荐、内容横幅与页尾广告，按时间自动展示。", settings: "控制检测预算、全局暂停与管理员账户。" };
  const paths = { dashboard: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z", announcements: "m4 10 12-5v14L4 14Zm0 0v4M7 15l2 6h3l-2-5M20 9v6", stations: "M4 4h16v6H4zm0 10h16v6H4zM7 7h.01M7 17h.01M11 7h6M11 17h6", schedules: "M12 8v5l3 2M4 5 2 7m18-2 2 2M7 2h10M12 2v3", jobs: "M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01", reports: "M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h5", ads: "M3 5h18v14H3ZM3 14l5-5 6 6 3-3 4 4M16 8h.01", settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6", arrow: "M5 12h14m-5-5 5 5-5 5", plus: "M12 5v14M5 12h14", out: "M14 3h7v7M21 3 10 14M10 4H4v16h16v-6", close: "m6 6 12 12M18 6 6 18", search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", refresh: "M20 11a8 8 0 1 0-2 6M20 4v7h-7", play: "m8 4 12 8-12 8Z", shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6", menu: "M4 6h16M4 12h16M4 18h16", clock: "M12 7v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" };
  const icon = (key) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key] || paths.reports}"/></svg>`;
  const fmt = (n) => new Intl.NumberFormat("zh-CN").format(n || 0);
  const date = (t) => t ? new Date(typeof t === "number" ? t * 1000 : t).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const localValue = (t) => { if (!t) return ""; const d = new Date(t); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const station = (id) => state.stations.find((s) => s.id === id);
  const name = (id) => station(id)?.name || "已移除站点";
  const chip = (text, color = "") => `<span class="chip ${color}">${esc(text)}</span>`;
  const statuses = { queued: ["排队中", "blue"], running: ["检测中", "blue"], done: ["已完成", "green"], failed: ["失败", "red"], cancelled: ["已取消", ""], interrupted: ["已中断", "orange"], draft: ["待审核", "orange"], published: ["已公开", "green"], rejected: ["已驳回", "red"], ok: ["协议通过", "green"], warn: ["协议需核对", "orange"], bad: ["协议异常", "red"], unknown: ["未测协议", ""] };
  const badge = (status) => chip(...(statuses[status] || [status, ""]));
  const kindLabel = (kind) => state.tests.find((item) => item.id === kind)?.label || ({ combined: "历史简化测试（8 项）", protocol: "历史简化协议测试（3 项）", ability: "历史简化能力测试（5 题）", pelican: "鹈鹕骑车（旧任务）" }[kind] || kind);
  let toastTimer;
  function toast(text, error = false) {
    const el = document.getElementById("toast");
    el.textContent = text; el.className = "toast" + (error ? " error" : ""); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
  async function api(path, method = "GET", body, binary = false) {
    const headers = {};
    if (method !== "GET") headers["X-CSRF-Token"] = state.csrf;
    if (body !== undefined) headers["Content-Type"] = binary ? "application/octet-stream" : "application/json";
    const res = await fetch("/api/" + path, { method, headers, body: body === undefined ? undefined : binary ? body : JSON.stringify(body), credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.user) { state.user = ""; state.csrf = ""; editor.close(); renderAuth(false); }
      const fields = data.errors?.map((e) => `${e.field}：${e.message}`).join("；");
      throw new Error(fields || (typeof data.detail === "string" ? data.detail : "操作失败，请稍后重试"));
    }
    return data;
  }
  const button = (action, label, primary = false, id = "") => `<button class="btn${primary ? " primary" : ""}" type="button" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${icon(action === "run" ? "play" : action === "refresh" ? "refresh" : "plus")}${label}</button>`;
  function shell(body) {
    const nav = Object.keys(titles).map((key, i) => `${key === "settings" ? '<div class="nav-spacer"></div>' : ""}<a href="#${key}" class="${state.route === key ? "active" : ""}">${icon(key)}${titles[key]}</a>`).join("");
    app.innerHTML = `<div class="admin-layout"><aside class="sidebar"><a href="#dashboard" class="admin-brand"><img src="/assets/favicon-32.png" alt=""><span><strong>ModelTool</strong><small>OPERATIONS CONSOLE</small></span></a><div class="nav-caption">工作空间</div><nav class="side-nav" aria-label="后台导航">${nav}</nav><div class="sidebar-bottom"><a href="/" target="_blank" rel="noopener">查看网站 ${icon("out")}</a><p>运营后台 · 本地预览</p></div></aside><header class="topline"><button class="mobile-menu" data-action="menu" aria-label="打开导航">${icon("menu")}</button><span class="breadcrumb">工作空间 <span class="muted"> / </span> <b>${titles[state.route]}</b></span><div class="top-actions"><span>ModelTool 运营中心</span><a href="/" target="_blank" rel="noopener">打开前台 ${icon("out")}</a><span class="user-pill"><span class="avatar">${esc(state.user[0]?.toUpperCase())}</span>${esc(state.user)}</span><button class="text-btn" data-action="logout">退出</button></div></header><main class="main">${body}</main></div>`;
    AdminSelect.enhance(app);
    syncBulkSelection();
    document.title = `${titles[state.route]} · ModelTool 后台`;
  }
  function heading(actions = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${state.route === "dashboard" ? "OVERVIEW / " + new Date().toLocaleDateString("zh-CN") : "WORKSPACE / " + state.route.toUpperCase()}</div><h1>${titles[state.route]}</h1><p>${subtitles[state.route]}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function empty(text, hint = "", action = "") {
    return `<div class="empty-state"><span class="empty-icon">${icon(state.route)}</span><h3>${text}</h3><p>${hint}</p>${action}</div>`;
  }
  function table(head, rows) { return `<div class="table-scroll"><table><thead><tr>${head.map((v) => `<th>${v}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`; }
  function jobRows(rows, compact = false) {
    return rows.map((r) => `<tr><td><span class="main-text">${esc(name(r.station_id))}</span><span class="sub">${esc(r.model)}</span></td>${compact ? "" : `<td>${esc(kindLabel(r.kind))}</td>`}<td>${badge(r.status)}${r.error ? `<span class="sub" title="${esc(r.error)}">${esc(r.error)}</span>` : ""}</td>${compact ? "" : `<td class="job-scores">${r.status === "done" && r.scores?.length ? r.scores.map((score) => `<span class="job-score"><small>${esc(score.label)}</small><strong>${esc(score.value)}</strong><small>/ 100</small></span>`).join("") : `<span class="muted">${r.status === "done" && r.report_id ? "未计分" : "—"}</span>`}</td>`}<td>${date(r.created)}</td><td class="actions">${r.report_id ? `<button class="text-btn" data-action="report" data-id="${r.report_id}">查看报告</button>` : ["queued", "running"].includes(r.status) ? `<button class="text-btn danger" data-action="cancel-job" data-id="${r.id}">${r.cancel ? "取消中…" : "取消"}</button>` : `<button class="text-btn" data-action="retry-job" data-id="${r.id}">重新检测</button>`}</td></tr>`);
  }
  function dashboard(d) {
    const counts = d.jobs;
    const cards = [["收录中转站", d.stations, "stations", `${d.reports.published} 份公开报告`, "家"], ["今日检测调用", d.usage.calls, "jobs", `${counts.running || 0} 个检测中 · ${counts.queued || 0} 个排队中`, "次"], ["等待审核", d.reports.draft, "reports", "检测结果审核后才会公开", "份"], ["今日 Token 用量", d.usage.tokens, "dashboard", d.settings.daily_tokens === 0 ? "Token 无上限" : `日上限 ${fmt(d.settings.daily_tokens)}`, ""]];
    const limitText = (value) => value === 0 ? "无上限" : fmt(value);
    const budgetBar = (value, max) => max > 0 ? `<div class="progress"><i style="width:${Math.min(100, Math.round(value / max * 100))}%"></i></div>` : "";
    const activityLabels = { login: "登录运营后台", setup: "初始化管理员", enqueue: "创建检测任务", report_created: "生成待审核报告", report_published: "公开检测报告", report_draft: "撤回公开报告", report_rejected: "驳回检测报告", settings_updated: "更新检测设置", password_changed: "修改管理员密码", media_uploaded: "上传图片", job_cancelled: "取消检测任务", failed: "检测失败", cancelled: "检测已停止" };
    const activityText = (v) => activityLabels[v] || (v.startsWith("created_") ? "添加" : v.startsWith("deleted_") ? "删除" : "更新") + ({ stations: "中转站", schedules: "定时计划", announcements: "公告", ads: "广告位" }[v.replace(/^(created|updated|deleted)_/, "")] || "记录");
    return heading(button("run", "手动检测", true)) + `<div class="status-line ${!d.worker.online || d.settings.paused ? "warning" : ""}"><span><i class="dot ${d.worker.online && !d.settings.paused ? "green" : "orange"}"></i>${d.settings.paused ? "自动检测已全局暂停，排队任务保留" : d.worker.online ? "检测任务进程运行正常" : "检测任务进程未连接；请使用 start-admin.bat 启动完整服务"}<span class="muted">· 所有新报告先进入待审核</span></span><a href="#settings">检测设置 →</a></div><div class="stats-grid">${cards.map(([label, value, key, note, unit]) => `<div class="metric"><div class="metric-label">${label}<span class="metric-icon">${icon(key)}</span></div><div class="metric-value">${fmt(value)}<small>${unit}</small></div><div class="metric-note">${note}</div></div>`).join("")}</div><div class="dashboard-grid"><div><section class="card"><div class="card-head"><h2>最近检测任务</h2><a class="text-btn" href="#jobs">全部任务 →</a></div>${d.recent_jobs.length ? table(["中转站 / 模型", "任务状态", "创建时间", ""], jobRows(d.recent_jobs, true)) : empty("还没有检测任务", "添加站点并配置专用密钥后，即可手动检测或安排定时计划。", '<a class="btn small" href="#stations">添加中转站 →</a>')}</section><section class="card"><div class="card-head"><h2>内容与公开数据</h2><span>运营快捷入口</span></div><div class="card-body quick-links"><a href="#reports"><span class="quick-icon">${icon("reports")}</span><span>审核检测报告<small>${d.reports.draft} 份待审核，${d.reports.published} 份已公开</small></span>${icon("arrow")}</a><a href="#announcements"><span class="quick-icon">${icon("announcements")}</span><span>发布网站公告<small>设置展示范围、置顶与生效时间</small></span>${icon("arrow")}</a><a href="#ads"><span class="quick-icon">${icon("ads")}</span><span>管理广告位置<small>首页推荐 / 内容横幅 / 页尾</small></span>${icon("arrow")}</a></div></section></div><div><section class="card"><div class="card-head"><h2>今日检测预算</h2><span>${d.day}</span></div><div class="card-body"><div class="usage-row"><div class="usage-label"><span>调用次数</span><small>${fmt(d.usage.calls)} / ${limitText(d.settings.daily_calls)}</small></div>${budgetBar(d.usage.calls, d.settings.daily_calls)}</div><div class="usage-row"><div class="usage-label"><span>Token 用量</span><small>${fmt(d.usage.tokens)} / ${limitText(d.settings.daily_tokens)}</small></div>${budgetBar(d.usage.tokens, d.settings.daily_tokens)}</div><p class="usage-note">${d.usage.estimated_calls ? `${d.usage.estimated_calls} 次未返回用量，按预留上限计入。` : "优先使用接口返回的实际用量。"}0 表示该项无上限，用量仍持续统计；设置了上限的项目达到上限后停止新调用，每天北京时间零点重新统计。</p></div></section><section class="card"><div class="card-head"><h2>最近操作</h2><span>操作日志</span></div><div class="card-body">${d.audit.slice(0, 7).map((r) => `<div class="activity"><i class="dot"></i><span>${esc(activityText(r.action))}<small class="sub muted"> · ${esc(r.actor)}</small></span><time>${date(r.at)}</time></div>`).join("") || '<p>暂无操作记录</p>'}</div></section></div></div>`;
  }
  function resourceActions(row) {
    return `<button class="text-btn" data-action="edit" data-id="${row.id}">编辑</button><button class="text-btn danger" data-action="delete" data-id="${row.id}">删除</button>`;
  }
  const proposalStatuses = { collecting: "征集中", scheduled: "已排期", testing: "测试中", completed: "已完成", deferred: "暂不处理" };
  const proposalTests = { site_basic: "基础测试", site_ability: "模型能力", site_logic: "逻辑推理", site_code: "代码能力", site_qa: "知识问答", site_candy: "糖果测试", site_relay: "中转站测试", site_trace: "指纹测试", site_pelican: "鹈鹕骑车", site_all: "完整检测" };
  function proposalTable(rows, render = table) {
    return render(["提名中转站", "模型 / 测试需求", "支持 / 评论", "处理进度", "提交时间", "操作"], rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong>${r.pinned ? chip("置顶", "blue") : ""}<span class="sub">${esc(r.domain)}</span><span class="sub">${esc(r.author)}</span></td><td>${r.models.map((m) => `<span class="sub">${esc(m)}</span>`).join("")}<span class="sub">${r.tests.map((id) => esc(proposalTests[id] || id)).join(" · ")}</span></td><td>${r.votes} 人支持<span class="sub">${r.comment_count} 条评论</span></td><td>${chip(proposalStatuses[r.status], r.status === "completed" ? "green" : "blue")} ${chip(r.visible ? "公开" : "已隐藏", r.visible ? "" : "orange")}</td><td>${date(r.created)}</td><td class="actions"><button class="text-btn" data-action="edit" data-id="${r.id}">处理 / 评论</button>${r.visible ? `<a href="/proposals.html?id=${r.id}" target="_blank" rel="noopener">查看前台 ↗</a>` : ""}</td></tr>`));
  }
  async function editProposal(id, page = 1) {
    const [data, reports] = await Promise.all([api("admin/proposals/" + id + "?page=" + page), api("admin/reports")]);
    const r = data.proposal, comments = data.comments;
    const eligible = reports.filter((item) => item.status === "published" && station(item.station_id)?.visible);
    const related = eligible.sort((a, b) => Number((station(b.station_id)?.domain || "").replace(/^www\./, "") === r.domain) - Number((station(a.station_id)?.domain || "").replace(/^www\./, "") === r.domain));
    const body = `<section class="admin-proposal-brief"><div><strong>${esc(r.name)}</strong><a href="${esc(r.website_url)}" target="_blank" rel="noopener noreferrer">${esc(r.domain)} ↗</a></div><p>${esc(r.description)}</p><p><b>模型：</b>${r.models.map(esc).join("、")}</p><p><b>测试：</b>${r.tests.map((v) => esc(proposalTests[v] || v)).join("、")}</p><small>${r.votes} 人支持 · ${esc(r.author)} 提交 · ${date(r.created)}</small></section>`
      + select("status", "公开处理进度", Object.entries(proposalStatuses), r.status)
      + `<div class="field-row">${check("visible", "在前台公开提案", r.visible)}${check("pinned", "置顶提案", r.pinned)}</div>`
      + area("admin_note", "处理说明（前台公开）", r.admin_note, "说明排期、测试进展或暂不处理的原因。", 'maxlength="2000"')
      + select("report_id", "关联已公开的检测报告", [["", "暂不关联"], ...related.map((item) => [item.id, `${name(item.station_id)} · ${item.model} · ${item.time}`])], r.report_id)
      + `<p class="tabs-note">仅展示已公开报告，请选择该提案对应的中转站与模型。同域名报告优先展示；官网与 API 域名不同也可关联。<button type="button" class="text-btn" data-action="proposal-register" data-id="${r.id}">登记中转站 →</button></p>`
      + area("reply", "新增官方回复", "", "保存后作为官方评论发布，留空则不新增。", 'maxlength="1500"')
      + `<section class="admin-proposal-discussion"><h3>讨论管理 <small>${comments.total} 条</small></h3>${comments.items.map((c) => `<article><header><strong>${esc(c.author)}</strong>${c.official ? chip("官方", "blue") : ""}${!c.visible ? chip("已隐藏", "orange") : ""}<time>${date(c.created)}</time></header><p>${esc(c.content)}</p><button class="text-btn" type="button" data-action="proposal-comment" data-id="${esc(r.id)}" data-comment="${esc(c.id)}" data-visible="${c.visible ? "false" : "true"}">${c.visible ? "隐藏评论" : "恢复评论"}</button></article>`).join("") || '<p class="muted">暂无评论</p>'}<div class="admin-proposal-pages"><span>${comments.page} / ${comments.pages}</span>${comments.page > 1 ? `<button type="button" class="text-btn" data-action="proposal-comments-page" data-id="${r.id}" data-page="${comments.page - 1}">上一页</button>` : ""}${comments.page < comments.pages ? `<button type="button" class="text-btn" data-action="proposal-comments-page" data-id="${r.id}" data-page="${comments.page + 1}">下一页</button>` : ""}</div></section>`;
    openDialog("处理收录提案", body, "edit-form", "保存处理结果", `data-kind="proposals" data-id="${id}" data-comment-page="${page}"`);
  }
  function identity(r) {
    return `<span class="identity">${r.logo ? `<img class="station-logo" src="${esc(r.logo)}" alt="" loading="lazy">` : `<span class="station-logo">${esc(Array.from(r.name)[0])}</span>`}<span><span class="main-text">${esc(r.name)}</span><span class="sub">${esc(r.domain)}</span></span></span>`;
  }
  function visibleRows() {
    const text = state.search.toLowerCase();
    return state.rows.filter((r) => (!text || [r.name, r.title, r.content, r.domain, r.model, name(r.station_id), r.description, r.error, r.models?.join(" "), r.author].join(" ").toLowerCase().includes(text)) && (!state.filter || (state.filter === "enabled" ? r.enabled : state.filter === "disabled" ? !r.enabled : r.status === state.filter)));
  }
  function listContent() {
    const route = state.route;
    const rows = visibleRows();
    const pages = Math.max(1, Math.ceil(rows.length / 12));
    state.page = Math.min(state.page, pages);
    const shown = rows.slice((state.page - 1) * 12, state.page * 12);
    const listTable = (head, rendered) => AdminBulk.table(head, rendered, shown, state.selected, esc, table);
    let html;
    if (!shown.length) html = empty(state.search || state.filter ? "没有符合条件的记录" : "这里还没有内容", { stations: "添加中转站资料和检测密钥，随后就可以安排检测。", schedules: "创建周期计划后，后台会自动排队执行，不需要一直打开网页。", reports: "检测完成后，报告会自动进入这里等待审核。", jobs: "发起一次手动检测，或者创建定时计划。", announcements: "添加一条公告，它会按设定时间出现在网站上。", ads: "添加广告素材，选择一个前台展示位置。" }[route]);
    else if (route === "stations") html = listTable(["中转站", "展示排序", "已登记模型", "展示 / 检测", "检测凭据", "每日上限", "操作"], shown.map((r) => `<tr><td>${identity(r)}</td><td><div class="station-order-control"><input type="number" min="-10000" max="10000" step="1" required value="${r.order ?? 0}" data-station-order="${r.id}" aria-label="${esc(r.name)}的展示排序"><button class="text-btn" data-action="station-order" data-id="${r.id}">保存</button></div></td><td>${r.models.slice(0, 2).map((m) => `<span class="sub">${esc(m)}</span>`).join("")}${r.models.length > 2 ? `<span class="sub">另 ${r.models.length - 2} 个模型</span>` : ""}</td><td>${chip(r.visible ? "公开" : "隐藏", r.visible ? "green" : "")} ${chip(r.enabled ? "可检测" : "已暂停", r.enabled ? "blue" : "")}</td><td>${chip(r.has_key ? "已加密保存" : "未配置密钥", r.has_key ? "green" : "orange")}</td><td>调用：${r.daily_calls === 0 ? "无上限" : fmt(r.daily_calls) + " 次"}<span class="sub">Token：${r.daily_tokens === 0 ? "无上限" : fmt(r.daily_tokens)}</span></td><td class="actions">${resourceActions(r)}<button class="text-btn" data-action="run" data-id="${r.id}">检测</button></td></tr>`));
    else if (route === "proposals") html = proposalTable(shown, listTable);
    else if (route === "jobs") html = listTable(["中转站 / 模型", "检测内容", "任务状态", "检测分数", "创建时间", "操作"], jobRows(shown));
    else if (route === "reports") html = listTable(["中转站 / 模型", "检测结果", "能力分数", "审核状态", "检测时间", "操作"], shown.map((r) => `<tr><td><span class="main-text">${esc(name(r.station_id))}${r.demo ? '<span class="demo-label">演示</span>' : ""}</span><span class="sub">${esc(r.model)}</span></td><td>${r.test_name ? chip(r.test_name, "blue") + `<span class="sub">${r.score == null ? "各项结果见报告" : "中转站 " + r.score + " 分"}</span>` : r.artwork?.mode ? chip("鹈鹕骑车", "purple") + `<span class="sub">${esc(r.artwork.mode_name)} · 结构分 ${r.artwork.score}</span>` : badge(r.level) + `<span class="sub">${r.score == null ? "未计分" : r.score + " / 100"}</span>`}</td><td>${r.ability?.score ?? "—"}<span class="sub">${r.test_name ? "本站原版评分" : r.ability?.baseline == null ? "没有参考基线" : "参考基线 " + r.ability.baseline}</span></td><td>${badge(r.status)}</td><td>${esc(r.time)}</td><td class="actions"><button class="text-btn" data-action="report" data-id="${r.id}">查看 / 审核</button>${r.status === "published" ? `<a href="/relays.html?id=${r.id}" target="_blank" rel="noopener">前台报告 ↗</a>` : ""}</td></tr>`));
    else if (route === "schedules") html = listTable(["计划名称", "中转站 / 模型", "检测间隔", "下次运行", "状态", "操作"], shown.map((r) => `<tr><td><span class="main-text">${esc(r.name)}</span><span class="sub">${esc(kindLabel(r.kind))}</span></td><td>${esc(name(r.station_id))}<span class="sub">${esc(r.model)}</span></td><td>每 ${r.interval_minutes >= 60 && r.interval_minutes % 60 === 0 ? r.interval_minutes / 60 + " 小时" : r.interval_minutes + " 分钟"}</td><td>${r.enabled ? date(r.next_run) : "—"}${r.last_error ? `<span class="sub" title="${esc(r.last_error)}">${esc(r.last_error)}</span>` : ""}</td><td>${chip(r.enabled ? "已启用" : "已暂停", r.enabled ? "green" : "")}</td><td class="actions">${resourceActions(r)}</td></tr>`));
    else if (route === "announcements") html = listTable(["公告内容", "展示范围", "生效时间", "状态", "操作"], shown.map((r) => `<tr><td><span class="main-text">${esc(r.title)}</span>${r.pinned ? ' <span class="chip blue">置顶</span>' : ""}<span class="sub">${esc(r.content)}</span></td><td>${r.placement === "all" ? "全站" : "仅首页"}</td><td>${r.starts_at ? date(r.starts_at) : "立即"}<span class="sub">${r.ends_at ? "截止 " + date(r.ends_at) : "长期有效"}</span></td><td>${timedStatus(r)}</td><td class="actions">${resourceActions(r)}</td></tr>`));
    else html = listTable(["广告素材", "位置 / 排序", "投放时间", "状态", "操作"], shown.map((r) => `<tr><td><span class="identity">${r.image ? `<img class="station-logo" src="${esc(r.image)}" alt="">` : `<span class="station-logo">${icon("ads")}</span>`}<span><span class="main-text">${esc(r.name)}</span><span class="sub">${esc(r.title)}</span></span></span></td><td>${{ hero: "首页推荐", banner: "内容横幅", footer: "页尾广告" }[r.placement]}<span class="sub">排序 ${r.order}</span></td><td>${r.starts_at ? date(r.starts_at) : "立即"}<span class="sub">${r.ends_at ? "截止 " + date(r.ends_at) : "长期有效"}</span></td><td>${timedStatus(r)}</td><td class="actions">${resourceActions(r)}</td></tr>`));
    return AdminBulk.result(state.bulkResult, esc) + AdminBulk.toolbar(route, state.selected, rows.length) + html + `<div class="table-footer"><span>共 ${rows.length} 条记录${route === "jobs" ? " · 展示最近 300 条" : ""}</span><div class="pager"><button data-action="prev" ${state.page === 1 ? "disabled" : ""}>←</button><span>${state.page} / ${pages}</span><button data-action="next" ${state.page === pages ? "disabled" : ""}>→</button></div></div>`;
  }
  function renderList() {
    document.getElementById("list-content").innerHTML = listContent();
    syncBulkSelection();
  }
  function syncBulkSelection() {
    const count = document.getElementById("bulk-count");
    if (!count) return;
    count.textContent = state.selected.size;
    app.querySelectorAll("[data-bulk-id]").forEach((field) => {
      field.checked = state.selected.has(field.dataset.bulkId);
      field.closest("tr").classList.toggle("bulk-selected", field.checked);
    });
    const page = app.querySelector("[data-bulk-page]");
    if (page) {
      const fields = [...app.querySelectorAll("[data-bulk-id]")];
      const checked = fields.filter((field) => field.checked).length;
      page.checked = fields.length > 0 && checked === fields.length;
      page.indeterminate = checked > 0 && checked < fields.length;
    }
    app.querySelectorAll('[data-action="bulk-open"],[data-action="bulk-clear"]').forEach((button) => { button.disabled = !state.selected.size || state.bulkBusy; });
  }
  function openBulk(operation) {
    const option = AdminBulk.actions[state.route]?.find(([action]) => action === operation);
    if (!option || !state.selected.size || state.bulkBusy) return;
    if (state.route === "stations" && operation === "run") {
      openDialog("批量手动检测", runFields({ station_ids: [...state.selected] }, false, true), "batch-run-form", "加入检测队列");
      return;
    }
    const rows = state.rows.filter((row) => state.selected.has(row.id));
    const body = `<div class="bulk-preview"><strong>将对所选 ${rows.length} 条记录执行「${option[1]}」</strong><p>${esc(AdminBulk.explanation(state.route, operation))}</p><small>不满足条件或状态已变化的记录会跳过，并在完成后列出原因。</small><ul>${rows.map((row) => `<li>${esc(row.name || row.title || name(row.station_id))}${row.model ? ` · ${esc(row.model)}` : ""}${row.status ? ` · ${esc(proposalStatuses[row.status] || statuses[row.status]?.[0] || row.status)}` : ""}</li>`).join("")}</ul></div>${rows.map((row) => `<input type="hidden" name="ids" value="${esc(row.id)}">`).join("")}${state.route === "reports" ? area("note", "统一审核备注（选填）", "", "留空保留每份报告原有的审核备注。", 'maxlength="1500"') : ""}`;
    openDialog(option[1], body, "bulk-form", operation === "delete" ? "确认删除" : operation === "retry" ? "确认重试并使用额度" : "确认处理", `data-kind="${state.route}" data-operation="${operation}"`);
  }
  function timedStatus(r) {
    if (!r.enabled) return chip("已停用");
    if (r.starts_at && Date.parse(r.starts_at) > Date.now()) return chip("待生效", "blue");
    if (r.ends_at && Date.parse(r.ends_at) <= Date.now()) return chip("已到期");
    return chip("展示中", "green");
  }
  function listPage() {
    const route = state.route;
    const action = route === "jobs" ? button("run", "手动检测", true) : ["reports", "proposals"].includes(route) ? "" : button("create", { stations: "添加中转站", announcements: "添加公告", schedules: "创建计划", ads: "添加广告" }[route], true);
    const filters = route === "proposals" ? Object.keys(proposalStatuses) : route === "jobs" ? ["queued", "running", "done", "failed", "cancelled", "interrupted"] : route === "reports" ? ["draft", "published", "rejected"] : ["enabled", "disabled"];
    const notice = route === "proposals" ? "用户无需注册即可提交、支持与评论。提案不会自动触发检测；可设置公开进度、关联已发布报告，隐藏不合适的提案或评论。" : route === "reports" ? "检测原始结果不能在审核时改分。公开报告进入日报与站点档案；撤回后立即从前台移除。" : route === "schedules" ? "按固定间隔排队执行，错过的轮次不会集中补跑。同一站点模型避免重复排队，异常项会在单次任务中复测一次。" : route === "jobs" ? "取消运行中的任务会在当前请求结束后生效。任务进程中断后不会自动重新扣费，可检查原因后手动重试。" : route === "ads" ? "前台广告位当前暂停展示，保存或启用广告也不会公开展示。原有维渡 AI 推荐继续保留。" : "";
    return heading(action + button("refresh", "刷新")) + (notice ? `<div class="notice">${notice}</div>` : "") + `<div class="toolbar"><label class="search">${icon("search")}<input id="search" type="search" aria-label="搜索记录" placeholder="搜索名称、域名或模型…" value="${esc(state.search)}"></label><select id="filter" aria-label="筛选状态"><option value="">全部状态</option>${filters.map((v) => `<option value="${v}" ${state.filter === v ? "selected" : ""}>${({ enabled: "已启用", disabled: "已停用" }[v]) || proposalStatuses[v] || statuses[v][0]}</option>`).join("")}</select><span class="muted" style="font-size:11px">${route === "jobs" ? "每 8 秒自动更新" : ""}</span></div><section class="card" id="list-content">${listContent()}</section>`;
  }
  const input = (key, label, value = "", type = "text", hint = "", attrs = "") => `<label class="field" for="f-${key}"><span>${label}</span><input id="f-${key}" name="${key}" aria-label="${esc(label)}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<small>${hint}</small>` : ""}</label>`;
  const area = (key, label, value = "", hint = "", attrs = "") => `<label class="field" for="f-${key}"><span>${label}</span><textarea id="f-${key}" name="${key}" aria-label="${esc(label)}" ${attrs}>${esc(value)}</textarea>${hint ? `<small>${hint}</small>` : ""}</label>`;
  const select = (key, label, options, value = "") => `<div class="field"><label for="f-${key}">${esc(label)}</label><select id="f-${key}" name="${key}" aria-label="${esc(label)}">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
  const check = (key, label, value) => `<label class="check-field"><input name="${key}" type="checkbox" ${value ? "checked" : ""}>${label}</label>`;
  function imageField(key, label, value) {
    return input(key, label, value, "text", "可填写公网图片地址，或上传 PNG / JPEG / WebP，最大 2MB。") + `<div class="file-upload"><input type="file" data-upload="${key}" accept="image/png,image/jpeg,image/webp" aria-label="上传${label}"><span class="muted upload-status" aria-live="polite"></span></div><br>`;
  }
  function timedFields(r) {
    return `<div class="field-row">${input("starts_at", "开始时间", localValue(r.starts_at), "datetime-local", "留空则立即生效")}${input("ends_at", "结束时间", localValue(r.ends_at), "datetime-local", "留空则长期有效")}</div><div class="field-row">${input("order", "展示排序", r.order ?? 0, "number", "数字越小越靠前", 'min="-10000" max="10000"')}${check("enabled", "启用展示", r.enabled ?? true)}</div>`;
  }
  function stationFields(r) {
    const baselineLines = Object.entries(r.baselines || {}).map(([k, v]) => k + "=" + v).join("\n");
    return input("name", "中转站名称", r.name, "text", "", 'required maxlength="80"')
      + input("website_url", "中转站跳转链接（选填）", r.website_url, "url", "填写官网或控制台地址，前台显示「访问中转站」，在新标签页打开。", 'maxlength="500"')
      + input("base_url", "接口基础地址", r.base_url, "url", "例如 https://api.example.com/v1，完整域名会公开展示。", "required")
      + select("protocol", "接口协议", [["openai", "OpenAI 兼容"], ["anthropic", "Anthropic Messages"]], r.protocol || "openai")
      + input("api_key", r.has_key ? "替换检测专用密钥" : "检测专用密钥", "", "password", r.has_key ? "留空保留已有密钥，也可直接用已有密钥识别模型。" : "填入 Key 后点击下方「识别模型」，保存中转站后才会加密保存。", 'autocomplete="new-password" maxlength="1000"')
      + (r.has_key ? check("clear_key", "移除已保存的检测密钥", false) : "")
      + `<div class="field model-discovery"><div class="model-discovery-head"><label for="f-models">模型 ID</label><button type="button" class="btn small" data-model-action="discover">识别模型</button></div><textarea id="f-models" name="models" aria-label="模型 ID" required>${esc((r.models || []).join("\n"))}</textarea><small>可从接口读取并勾选，或手动填写；每行一个，最多 30 个。列表来自接口声明，不代表已验证模型身份。</small><div class="model-discovery-status" role="status" aria-live="polite"></div><section class="model-picker" aria-label="选择识别到的模型" hidden><input type="search" placeholder="搜索模型名称…" aria-label="搜索识别到的模型"><div class="model-picker-toolbar"><span class="model-picker-count"></span><button type="button" class="text-btn" data-model-action="select">选择搜索结果</button><button type="button" class="text-btn" data-model-action="clear">清空选择</button></div><div class="model-picker-list"></div><div class="model-picker-foot"><small>填入后会替换上面的模型列表。</small><button type="button" class="btn primary small" data-model-action="apply">填入所选模型</button></div></section></div>`
      + input("order", "展示排序", r.order ?? 0, "number", "数字越小越靠前，默认 0；相同时前台优先展示最近检测的站点。", 'min="-10000" max="10000" step="1" required')
      + imageField("logo", "中转站图标", r.logo)
      + area("description", "站点简介", r.description, "", 'maxlength="1500"') + `<div class="field-row">${input("daily_calls", "每日调用上限", r.daily_calls ?? 60, "number", "0 表示无上限，包括异常项复测；仍受全站上限约束。", 'min="0" max="100000" required')}${input("daily_tokens", "每日 Token 上限", r.daily_tokens ?? 60000, "number", "0 表示无上限；用量仍记录，仍受全站上限约束。", 'min="0" max="100000000" required')}</div><div hidden>${area("baselines", "各模型在固定题组 v1 的基线", baselineLines, "每行 模型ID=分数，例如 gpt-4.1=100。只能填同模型、同题组、同参数测得的参考分；留空不会判断降智。")}${input("degradation_threshold", "异常分差阈值", r.degradation_threshold ?? 20, "number", "本次分数低于基线、且分差超过该阈值时，才标为能力异常。", 'min="5" max="100"')}</div><div class="field-row">${check("visible", "在前台公开站点", r.visible ?? true)}${check("enabled", "允许后台检测", r.enabled ?? true)}</div>`;
  }
  function runExplanation(kind, values = {}) {
    const meta = state.tests.find((item) => item.id === kind);
    if (!meta) return "";
    const difficulty = values.difficulty || "medium", count = Number(values.count || (kind === "site_candy" ? 20 : 10));
    const candyCount = Number(values.candy_count || 20);
    const pools = meta.pools[difficulty];
    const questions = pools.reduce((sum, item) => sum + (item.count == null ? 0 : Math.min(item.count, item.kind === "candy" && kind === "site_all" ? candyCount : count)), 0);
    const relay = pools.some((item) => item.kind === "relay"), trace = pools.some((item) => item.kind === "trace");
    const calls = questions + (relay ? 10 : 0) + (trace ? 3 : 0) + (meta.artwork ? 1 : 0);
    const maxCalls = questions + (relay ? 12 : 0) + (trace ? 6 : 0) + (meta.artwork ? 2 : 0);
    const bank = pools.filter((item) => item.count != null).map((item) => ({ability:"模型能力",logic:"逻辑推理",code:"代码能力",qa:"知识问答",candy:"糖果"}[item.kind]) + " " + item.count + " 题").join("、");
    return `<section class="run-explanation"><strong>${esc(meta.label)} · 本站原版</strong><p>${esc(meta.description)}</p>${bank ? `<p>${{easy:"简单",medium:"中等",hard:"困难"}[difficulty]}题库：${bank}。本次共 ${questions} 题，题库不足时只测实际题数。</p>` : ""}<small>预计 ${calls === maxCalls ? calls : calls + "–" + maxCalls} 次接口调用，按所选题量与本站原版流程执行。超出站点或全站预算会停止。</small></section>`;
  }
  function updateRunOptions() {
    const form = editor.querySelector("form");
    const kind = form.elements.namedItem("kind")?.value;
    const meta = state.tests.find((item) => item.id === kind);
    if (!meta) return;
    const countLabel = editor.querySelector('label[for="f-count"]') || editor.querySelector('[name="count"]')?.parentElement.parentElement.querySelector("label");
    if (countLabel) {
      countLabel.textContent = ["site_basic", "site_all"].includes(kind) ? "基础每项题量" : "检测题量";
      const trigger = editor.querySelector('[name="count"]')?.parentElement.querySelector(".admin-select-trigger");
      if (trigger) trigger.setAttribute("aria-label", countLabel.textContent);
    }
    editor.querySelector("#site-question-options").hidden = !meta.questions;
    editor.querySelector("#site-candy-options").hidden = !meta.candy_count;
    editor.querySelector("#pelican-options").hidden = !meta.artwork;
    editor.querySelector("#run-explanation").innerHTML = runExplanation(kind, Object.fromEntries(new FormData(form)));
  }
  function runFields(r = {}, schedule = false, batchRun = false) {
    const options = state.stations.map((s) => [s.id, `${s.name}${s.has_key ? "" : "（未配置密钥）"}${s.enabled ? "" : "（已暂停）"}`]);
    const selected = r.station_id || state.stations[0]?.id || "";
    const batch = batchRun || (schedule && !r.id);
    const selectedIds = r.station_ids || [selected];
    const models = station(selected)?.models || [];
    const legacy = r.kind && !r.kind.startsWith("site_");
    const kind = legacy ? ({protocol:"site_relay",combined:"site_relay",ability:"site_basic",pelican:"site_pelican"}[r.kind] || "site_basic") : r.kind || "site_basic";
    const meta = state.tests.find((item) => item.id === kind);
    const counts = [3,5,10,20,30].map((n) => [n,n + " 题"]);
    return (schedule ? input("name", "计划名称", r.name, "text", "", 'required maxlength="100"') : "")
      + (legacy ? `<div class="notice warning">此记录原用旧版简化题组。保存后将改用下面选择的本站原版测试，请核对题量与预算。</div>` : "")
      + (batch ? AdminSchedules.stationField(state.stations, selectedIds, esc, batchRun) + `<div id="schedule-model-fields">${AdminSchedules.modelFields(state.stations, selectedIds, undefined, select, esc)}</div>` : select("station_id", "中转站", options, selected) + select("model", "检测模型", models.map((m) => [m,m]), r.model || models[0]))
      + select("kind", "选择本站检测项目", state.tests.map((item) => [item.id,item.label]), kind)
      + `<div id="site-question-options" ${meta?.questions ? "" : "hidden"}><div class="field-row">${select("difficulty","题目难度",[["easy","简单"],["medium","中等"],["hard","困难"]],r.difficulty || "medium")}${select("count",kind === "site_basic" || kind === "site_all" ? "基础每项题量" : "检测题量",counts,r.count || (kind === "site_candy" ? 20 : 10))}</div></div>`
      + `<div id="site-candy-options" ${meta?.candy_count ? "" : "hidden"}>${select("candy_count","糖果测试题量",counts,r.candy_count || 20)}</div>`
      + `<div id="pelican-options" ${meta?.artwork ? "" : "hidden"}>${select("pelican_mode","鹈鹕作品类型",[["svg","经典 SVG"],["html2d","2D 动画 HTML"],["three","3D 动画 HTML（Three.js）"]],r.pelican_mode || "html2d")}</div><div id="run-explanation">${runExplanation(kind,r)}</div>`
      + (schedule ? input("interval_minutes", "检测间隔（分钟）", r.interval_minutes ?? 360, "number", "最短 1 分钟；360 分钟 = 6 小时。同一站点模型的上次任务尚未结束时，不会重复排队。", 'min="1" max="43200" step="1" required') + input("first_run", "首次运行时间", localValue(r.first_run), "datetime-local", "留空则在一个检测间隔后首次运行。") + check("enabled", "启用此检测计划", r.enabled ?? true) : "")
      + `<div class="notice warning">${batchRun ? "将为每个所选站点创建一次检测任务，上方预计调用数为每个站点单次用量。" : batch ? "将为每个所选站点创建独立计划，名称自动附带站点名；上方预计调用数为每个站点单次用量。" : ""}检测使用各站点专用密钥的额度；每个项目都有独立结果，完成后进入待审核。</div>`;
  }
  function scheduleSelection(form) {
    const values = new FormData(form);
    return { mode: String(values.get("schedule_model_mode") || "shared"), shared: String(values.get("schedule_model") || ""), models: Object.fromEntries(state.stations.map((station) => [station.id, String(values.get("station_model_" + station.id) || "")])) };
  }
  function updateScheduleStations(form) {
    const ids = new FormData(form).getAll("station_ids");
    const previous = scheduleSelection(form);
    editor.querySelector("#schedule-model-fields").innerHTML = AdminSchedules.modelFields(state.stations, ids, previous, select, esc);
    AdminSelect.enhance(editor);
  }
  function openDialog(title, body, form = "edit-form", submit = "保存", extra = "") {
    AdminSelect.close();
    editor.innerHTML = `<form id="${form}" ${extra}><div class="dialog-head"><h2 id="editor-title">${title}</h2><button type="button" class="close-btn" data-action="close" aria-label="关闭">${icon("close")}</button></div><div class="dialog-body">${body}<div class="error-box" id="form-error" role="alert"></div></div><div class="dialog-foot"><button type="button" class="btn" data-action="close">取消</button><button type="submit" class="btn primary">${submit}</button></div></form>`;
    AdminSelect.enhance(editor);
    AdminModels.enhance(editor, api);
    if (!editor.open) editor.showModal();
  }
  function edit(r = {}) {
    const route = state.route;
    if (route === "proposals") return editProposal(r.id);
    let body;
    if (route === "stations") body = stationFields(r);
    if (route === "announcements") body = input("title", "公告标题", r.title, "text", "", 'required maxlength="100"') + area("content", "公告正文", r.content, "使用纯文本展示，避免富文本带来的排版与安全问题。", 'required maxlength="1500"') + input("link", "跳转链接（可选）", r.link, "url") + `<div class="field-row">${select("placement", "展示范围", [["all", "全站"], ["home", "仅首页"]], r.placement || "all")}${select("tone", "公告样式", [["info", "普通通知"], ["warning", "注意提醒"], ["success", "更新消息"]], r.tone || "info")}</div>` + `<div class="field-row">${input("background_color", "公告背景颜色", r.background_color || ({info: "#eef2ff", warning: "#fff7e6", success: "#eafaf2"}[r.tone] || "#eef2ff"), "color", "铺满整个公告横条")}${input("text_color", "公告文字颜色", r.text_color || ({info: "#4338ca", warning: "#92400e", success: "#166534"}[r.tone] || "#4338ca"), "color", "标题、正文与链接统一使用此颜色")}</div>` + check("pinned", "置顶公告", r.pinned) + timedFields(r);
    if (route === "ads") body = input("name", "内部名称", r.name, "text", "仅后台识别使用", 'required maxlength="80"') + input("title", "广告标题", r.title, "text", "", 'required maxlength="100"') + area("description", "简短说明", r.description, "", 'maxlength="250"') + input("link", "目标链接", r.link, "url", "点击后在新标签页打开。", "required") + imageField("image", "广告图片 / 图标", r.image) + select("placement", "展示位置", [["hero", "首页右侧推荐（同时启用时取排序最靠前的一条）"], ["banner", "页面内容顶部横幅（最多 2 条）"], ["footer", "页面底部广告（最多 2 条）"]], r.placement || "hero") + timedFields(r);
    if (route === "schedules") {
      if (!state.stations.length) return toast("请先添加中转站", true);
      body = runFields(r, true);
    }
    openDialog((r.id ? "编辑" : "添加") + { stations: "中转站", announcements: "公告", ads: "广告", schedules: "定时检测计划" }[route], body, "edit-form", "保存", `data-kind="${route}" data-id="${r.id || ""}" data-has-key="${r.has_key ? "true" : ""}"`);
  }
  async function report(id) {
    const r = await api("admin/reports/" + id);
    const result = r.result;
    const artwork = result.artwork;
    const artworkPanel = artwork ? `<h3>鹈鹕骑车 · ${esc(artwork.mode_name)}</h3><p class="tabs-note">代码结构分只检查代码特征，不代表画面质量、模型身份或降智结论。请人工检查鹈鹕长嘴、喉囊、两个轮子和骑行关系。</p>${artwork.available ? `<iframe class="artwork-preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/api/admin/reports/${encodeURIComponent(id)}/artwork" title="鹈鹕骑车作品预览"></iframe>` : '<div class="notice warning">没有提取出完整作品，请查看下面的原始回答。</div>'}<div class="artwork-features">${artwork.checks.map((c) => chip((c.passed ? "✓ " : "— ") + c.name + (c.passed ? " +" + c.points : ""), c.passed ? "green" : "")).join("")}</div>` : "";
    const verdict = { pass: ["通过", "green"], warn: ["复测通过", "orange"], fail: ["未通过", "red"], skip: ["不支持", ""], miss: ["未命中", ""], unknown: ["无法确认", ""] };
    const body = `<div class="report-detail"><p class="muted">${esc(name(r.station_id))} · ${esc(result.model)} ${r.demo ? '<span class="demo-label">演示报告</span>' : ""}</p><p class="tabs-note">${esc(result.time)} · ${esc(result.conditions)}</p><div class="report-summary">${artwork && !(result.sections || []).some((s) => s.kind !== "pelican") ? `<div><span>作品类型</span><strong>${esc(artwork.mode_name)}</strong></div><div><span>代码结构分</span><strong>${artwork.score} / 100</strong></div><div><span>作品状态</span><strong>${artwork.available ? "已提取" : "不完整"}</strong></div>` : `<div><span>中转站测试分</span><strong>${result.score ?? "—"}</strong></div><div><span>基础能力分</span><strong>${result.ability?.score ?? "—"}</strong></div><div><span>${result.suite === "site-original-v1" ? "实际调用数" : "同条件基线"}</span><strong>${result.request_count ?? result.ability?.baseline ?? "—"}</strong></div>`}</div>${artworkPanel}${SiteReport.render(result.sections || [], esc)}<p class="tabs-note">${esc(result.summary)}</p>${result.ability ? `<p class="tabs-note">${esc(result.ability.summary)}</p>` : ""}<h3>逐项结果</h3>${(result.checks || []).map((c) => `<div class="report-check"><span>${esc(c.name)}<small>${esc(c.detail)}</small></span>${chip(...(verdict[c.status] || [c.status, ""]))}</div>`).join("")}<details><summary>查看检测题目与原始回答</summary><pre class="report-raw">${esc(JSON.stringify(result.raw || [], null, 2))}</pre></details>${select("status", "审核决定", [["draft", "待审核 / 撤回公开"], ["published", "审核通过，公开报告"], ["rejected", "驳回，不公开"]], r.status)}${area("note", "内部审核备注", r.note, "备注只在后台保存，不会出现在公开报告中。", 'maxlength="1500"')}</div>`;
    openDialog("检测报告审核", body, "review-form", "保存审核决定", `data-id="${id}"`);
  }
  function settingsPage(s) {
    return heading() + `<div class="settings-grid"><section class="card"><div class="card-head"><h2>检测预算与暂停</h2>${icon("shield")}</div><form id="settings-form" class="card-body">${input("daily_calls", "全站每日调用上限", s.daily_calls, "number", "0 表示无上限，所有站点和异常复测合并统计。", 'min="0" max="1000000" required')}${input("daily_tokens", "全站每日 Token 上限", s.daily_tokens, "number", "0 表示无上限。未返回用量时按本次输出上限 + 2048 Token 预留值计入；指纹与作品每次预留 10240 Token。", 'min="0" max="1000000000" required')}${check("paused", "暂停所有后台检测", s.paused)}<p class="tabs-note">暂停后停止新调用与调度，队列保留。已发出的请求结束后才会停下。预算按北京时间自然日统计；全站和站点上限独立生效，0 仅取消当前这一项限制，其他非零上限仍生效。</p><div class="error-box" role="alert"></div><button class="btn primary" type="submit">保存检测设置</button></form></section><div><section class="card"><div class="card-head"><h2>管理员账户</h2>${icon("settings")}</div><form id="password-form" class="card-body">${input("current_password", "当前密码", "", "password", "", 'required autocomplete="current-password"')}${input("new_password", "新密码", "", "password", "至少 12 个字符；修改后所有已登录设备都会退出。", 'required minlength="12" maxlength="128" autocomplete="new-password"')}<div class="error-box" role="alert"></div><button class="btn" type="submit">修改密码并退出</button></form></section><section class="card"><div class="card-head"><h2>数据保存与恢复</h2></div><div class="card-body"><p>数据库、图片与加密密钥存放在网站目录之外。请通过本机管理命令备份，密钥与数据库需要一起妥善保管。</p><p class="tabs-note">具体操作见项目中的 ADMIN.md。访客浏览器保存的密钥不会进入这份后台数据库。</p></div></section></div></div>`;
  }
  async function loadPage(quiet = false) {
    if (!state.user) return;
    const ticket = ++state.ticket;
    try {
      const [stations, data, tests] = await Promise.all([api("admin/stations"), api("admin/" + (state.route === "dashboard" ? "dashboard" : state.route)), api("admin/test-options")]);
      if (ticket !== state.ticket || !state.user) return;
      state.stations = stations; state.tests = tests;
      if (state.route === "dashboard") shell(dashboard(data));
      else if (state.route === "settings") shell(settingsPage(data));
      else { state.rows = data; AdminBulk.prune(state.selected, data); shell(listPage()); }
    } catch (e) {
      if (!state.user) return;
      if (quiet) toast(e.message, true);
      else shell(heading() + `<div class="card content-error">${esc(e.message)}<br><br>${button("refresh", "重新加载")}</div>`);
    }
  }
  function route() {
    if (!state.user) return;
    const next = location.hash.slice(1);
    state.route = titles[next] ? next : "dashboard";
    state.search = ""; state.filter = ""; state.page = 1; state.selected.clear(); state.bulkResult = null;
    editor.close();
    loadPage();
  }
  function renderAuth(setup) {
    app.innerHTML = `<div class="auth-page"><section class="auth-art"><a class="admin-brand" href="/"><img src="/assets/favicon-32.png" alt=""><span><strong>ModelTool</strong><small>OPERATIONS CONSOLE</small></span></a><h1>每一份公开结果，<br>都有据可查。</h1><p>管理中转站、安排检测、审核报告。<br>让网站运营有条不紊。</p><footer>MODELTOOL · 运营工作空间</footer></section><div class="auth-form-wrap"><form class="auth-form" id="auth-form" data-setup="${setup}"><div class="eyebrow">${setup ? "FIRST TIME SETUP" : "WELCOME BACK"}</div><h2>${setup ? "初始化运营后台" : "登录运营后台"}</h2><p>${setup ? "创建自己的管理员账户。初始化仅需完成一次，请妥善保管密码。" : "使用管理员账户继续，登录有效期为 8 小时。"}</p>${setup ? state.setupToken ? `<input type="hidden" name="token" value="${esc(state.setupToken)}">` : input("token", "初始化口令", "", "password", "", 'required autocomplete="off"') : ""}${input("username", "管理员用户名", "", "text", setup ? "3–64 个英文字母、数字、下划线或点" : "", 'required autocomplete="username" pattern="[a-zA-Z0-9_.-]{3,64}"')}${input("password", "密码", "", "password", setup ? "至少 12 个字符，请妥善保管。" : "", `required minlength="12" maxlength="128" autocomplete="${setup ? "new-password" : "current-password"}"`)}<div class="error-box" role="alert"></div><button class="btn primary" type="submit">${setup ? "创建管理员并进入" : "登录"} ${icon("arrow")}</button><a class="backlink" href="/">← 返回网站首页</a></form></div></div>`;
    document.title = (setup ? "初始化后台" : "管理员登录") + " · ModelTool";
  }
  function serialize(form, kind) {
    const f = new FormData(form);
    const value = (k) => String(f.get(k) || "").trim();
    const bool = (k) => f.has(k);
    const number = (k) => Number(value(k));
    const time = (k) => value(k) ? new Date(value(k)).toISOString() : null;
    const timed = () => ({ enabled: bool("enabled"), starts_at: time("starts_at"), ends_at: time("ends_at"), order: number("order") });
    if (kind === "proposals") return { status: value("status"), visible: bool("visible"), pinned: bool("pinned"), admin_note: value("admin_note"), report_id: value("report_id"), reply: value("reply") };
    if (kind === "announcements") return { ...timed(), title: value("title"), content: value("content"), link: value("link"), placement: value("placement"), tone: value("tone"), background_color: value("background_color"), text_color: value("text_color"), pinned: bool("pinned") };
    if (kind === "ads") return { ...timed(), name: value("name"), title: value("title"), description: value("description"), link: value("link"), image: value("image"), placement: value("placement") };
    if (kind === "stations") {
      const baselines = {};
      for (const line of value("baselines").split(/\n/).filter((s) => s.trim())) {
        const split = line.lastIndexOf("=");
        if (split < 1 || !line.slice(split + 1).trim() || !Number.isFinite(Number(line.slice(split + 1)))) throw new Error("基线格式应为每行 模型ID=分数");
        baselines[line.slice(0, split).trim()] = Number(line.slice(split + 1));
      }
      return { order: number("order"), name: value("name"), base_url: value("base_url"), website_url: value("website_url"), logo: value("logo"), description: value("description"), models: value("models").split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean), protocol: value("protocol"), api_key: String(f.get("api_key") || "") || null, clear_key: bool("clear_key"), daily_calls: number("daily_calls"), daily_tokens: number("daily_tokens"), baselines, degradation_threshold: number("degradation_threshold"), visible: bool("visible"), enabled: bool("enabled") };
    }
    const run = { station_id: value("station_id"), model: value("model"), kind: value("kind"), pelican_mode: value("pelican_mode") || "html2d", difficulty: value("difficulty") || "medium", count: number("count") || 10, candy_count: number("candy_count") || 20 };
    return kind === "schedules" ? { ...run, name: value("name"), enabled: bool("enabled"), interval_minutes: number("interval_minutes"), first_run: time("first_run") } : run;
  }
  async function submit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector(".error-box");
    errorBox.textContent = ""; submitButton.disabled = true;
    try {
      const f = new FormData(form);
      if (form.id === "auth-form") {
        const setup = form.dataset.setup === "true";
        const body = { username: String(f.get("username")), password: String(f.get("password")) };
        if (setup) body.token = String(f.get("token")).trim();
        const r = await api("auth/" + (setup ? "setup" : "login"), "POST", body);
        state.user = r.username; state.csrf = r.csrf; state.setupToken = "";
        history.replaceState(null, "", "#dashboard"); route();
      } else if (form.id === "edit-form") {
        const kind = form.dataset.kind, id = form.dataset.id;
        let message = "已保存";
        if (kind === "schedules" && !id) {
          const body = AdminSchedules.build(serialize(form, kind), state.stations, f.getAll("station_ids"), scheduleSelection(form));
          const result = await api("admin/schedules/batch", "POST", body);
          message = `已创建 ${result.count} 条定时计划`;
        } else {
          await api("admin/" + kind + (id ? "/" + id : ""), id ? "PUT" : "POST", serialize(form, kind));
        }
        editor.close(); toast(message); await loadPage();
      } else if (form.id === "bulk-form") {
        const kind = form.dataset.kind, operation = form.dataset.operation;
        const label = AdminBulk.actions[kind].find(([action]) => action === operation)[1];
        const body = { ids: f.getAll("ids"), action: operation };
        if (kind === "reports" && String(f.get("note") || "").trim()) body.note = String(f.get("note")).trim();
        state.bulkBusy = true;
        try {
          const result = await api(`admin/bulk/${kind}`, "POST", body);
          editor.close();
          if (state.route === kind) {
            state.selected = new Set(result.skipped.map((item) => item.id));
            state.bulkResult = { ...result, label };
            await loadPage();
          }
          toast(`${label}：已处理 ${result.count} 条，跳过 ${result.skipped.length} 条`);
        } finally { state.bulkBusy = false; syncBulkSelection(); }
      } else if (form.id === "batch-run-form") {
        const body = AdminSchedules.buildRuns(serialize(form, "jobs"), state.stations, f.getAll("station_ids"), scheduleSelection(form));
        const result = await api("admin/jobs/batch", "POST", body);
        editor.close(); state.selected.clear(); toast(`已加入 ${result.count} 个检测任务，完成后进入报告审核`);
        if (state.route === "jobs") await loadPage(); else location.hash = "jobs";
      } else if (form.id === "run-form") {
        await api("admin/jobs", "POST", serialize(form, "jobs"));
        editor.close(); toast("检测任务已加入队列，完成后进入报告审核");
        if (state.route === "jobs") await loadPage(); else location.hash = "jobs";
      } else if (form.id === "review-form") {
        await api("admin/reports/" + form.dataset.id, "PUT", { status: f.get("status"), note: f.get("note") });
        editor.close(); toast("审核决定已保存"); await loadPage();
      } else if (form.id === "settings-form") {
        await api("admin/settings", "PUT", { daily_calls: Number(f.get("daily_calls")), daily_tokens: Number(f.get("daily_tokens")), paused: f.has("paused") });
        toast("检测设置已保存");
      } else if (form.id === "password-form") {
        await api("auth/password", "POST", { current_password: f.get("current_password"), new_password: f.get("new_password") });
        state.user = ""; state.csrf = ""; renderAuth(false); toast("密码已修改，请重新登录");
      }
    } catch (e) { errorBox.textContent = e.message; }
    finally { submitButton.disabled = false; }
  }
  async function action(event) {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action, id = el.dataset.id;
    el.disabled = true;
    try {
      if (action === "close") { AdminSelect.close(); editor.close(); }
      else if (action === "menu") app.querySelector(".sidebar").classList.toggle("open");
      else if (action === "refresh") await loadPage();
      else if (action === "create") edit();
      else if (action === "edit") await edit(state.rows.find((r) => r.id === id));
      else if (action === "report") await report(id);
      else if (action === "bulk-open") openBulk(el.dataset.operation);
      else if (action === "bulk-clear") { state.selected.clear(); syncBulkSelection(); }
      else if (action === "bulk-filter") {
        state.selected.clear();
        AdminBulk.choose(state.selected, visibleRows().slice(0, 100).map((row) => row.id), true);
        syncBulkSelection();
      }
      else if (action === "station-order") {
        const field = app.querySelector(`[data-station-order="${id}"]`);
        if (!field.reportValidity()) return;
        await api(`admin/stations/${id}/order`, "PUT", { order: Number(field.value) });
        toast("排序已保存，刷新前台即可查看");
        await loadPage();
      }
      else if (action === "proposal-register") {
        const r = state.rows.find((item) => item.id === id);
        if (!confirm("将打开中转站登记表，尚未保存的提案处理内容需要先保存。继续？")) return;
        openDialog("登记提名中转站", stationFields({ name: r.name, website_url: r.website_url, models: r.models, description: r.description }), "edit-form", "保存中转站", 'data-kind="stations" data-id=""');
      }
      else if (action === "proposal-comment") {
        await api(`admin/proposals/${id}/comments/${el.dataset.comment}`, "PUT", { visible: el.dataset.visible === "true" });
        el.dataset.visible = el.dataset.visible === "true" ? "false" : "true";
        el.textContent = el.dataset.visible === "true" ? "恢复评论" : "隐藏评论";
        const article = el.closest("article");
        article.querySelector(".chip.orange")?.remove();
        if (el.dataset.visible === "true") article.querySelector("header").insertAdjacentHTML("beforeend", chip("已隐藏", "orange"));
        toast("评论展示状态已更新");
      } else if (action === "proposal-comments-page") {
        const form = editor.querySelector("form");
        const values = new FormData(form);
        await editProposal(id, Number(el.dataset.page));
        // Paging comments must preserve unsaved processing notes and replies.
        for (const key of ["status", "admin_note", "report_id", "reply"]) editor.querySelector(`[name="${key}"]`).value = values.get(key);
        for (const key of ["visible", "pinned"]) editor.querySelector(`[name="${key}"]`).checked = values.has(key);
        AdminSelect.enhance(editor);
      }
      else if (action === "run") {
        if (!state.stations.length) return toast("请先添加中转站", true);
        openDialog("发起手动检测", runFields({ station_id: id }), "run-form", "加入检测队列");
      } else if (action === "delete") {
        if (!confirm("确定删除这条记录？有关联报告或任务的中转站只能隐藏，不能删除。")) return;
        await api(`admin/${state.route}/${id}`, "DELETE"); toast("已删除"); await loadPage();
      } else if (action === "cancel-job") {
        await api(`admin/jobs/${id}/cancel`, "POST", {}); toast("已请求取消，当前请求结束后停止"); await loadPage();
      } else if (action === "retry-job") {
        if (!confirm("重新检测会消耗专用密钥额度，确定创建新任务？")) return;
        await api(`admin/jobs/${id}/retry`, "POST", {}); toast("新任务已加入队列"); await loadPage();
      } else if (action === "logout") {
        await api("auth/logout", "POST", {}); state.user = ""; state.csrf = ""; renderAuth(false);
      } else if (action === "prev" || action === "next") {
        state.page += action === "next" ? 1 : -1; renderList();
      }
    } catch (e) { toast(e.message, true); }
    finally { el.disabled = false; syncBulkSelection(); }
  }
  editor.addEventListener("close", () => AdminSelect.close());
  document.addEventListener("submit", submit);
  document.addEventListener("click", action);
  document.addEventListener("input", (event) => {
    if (event.target.id === "search") { state.search = event.target.value; state.page = 1; state.selected.clear(); state.bulkResult = null; renderList(); }
  });
  document.addEventListener("change", async (event) => {
    const el = event.target;
    if (el.hasAttribute("data-bulk-id") || el.hasAttribute("data-bulk-page")) {
      try {
        const ids = el.hasAttribute("data-bulk-page") ? visibleRows().slice((state.page - 1) * 12, state.page * 12).map((row) => row.id) : [el.dataset.bulkId];
        AdminBulk.choose(state.selected, ids, el.checked);
      } catch (error) { toast(error.message, true); }
      syncBulkSelection();
    }
    if (["kind", "difficulty", "count", "candy_count", "pelican_mode"].includes(el.name)) updateRunOptions();
    if (el.name === "tone" && editor.querySelector('[name="background_color"]')) {
      const colors = { info: ["#eef2ff", "#4338ca"], warning: ["#fff7e6", "#92400e"], success: ["#eafaf2", "#166534"] }[el.value];
      editor.querySelector('[name="background_color"]').value = colors[0];
      editor.querySelector('[name="text_color"]').value = colors[1];
    }
    if (el.id === "filter") { state.filter = el.value; state.page = 1; state.selected.clear(); state.bulkResult = null; renderList(); }
    if (el.name === "station_id") {
      const select = editor.querySelector('[name="model"]');
      select.innerHTML = (station(el.value)?.models || []).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    }
    if (el.name === "station_ids") updateScheduleStations(el.form);
    if (el.name === "schedule_model_mode") {
      editor.querySelector("#schedule-station-models").hidden = el.value !== "separate";
      editor.querySelector("#schedule-shared-model").hidden = el.value !== "shared";
    }
    if (el.name === "schedule_model") editor.querySelector("#schedule-model-hint").innerHTML = AdminSchedules.modelHint(state.stations, new FormData(el.form).getAll("station_ids"), el.value, esc);
    if (el.dataset.upload && el.files[0]) {
      const status = el.parentElement.querySelector(".upload-status");
      status.textContent = "上传中…"; el.disabled = true;
      try {
        const result = await api("admin/media", "POST", el.files[0], true);
        editor.querySelector(`[name="${el.dataset.upload}"]`).value = result.url;
        status.textContent = "已上传，保存后生效";
      } catch (e) { status.textContent = e.message; }
      finally { el.disabled = false; }
    }
  });
  window.addEventListener("hashchange", route);
  setInterval(() => {
    if (state.user && ["jobs", "dashboard"].includes(state.route) && !editor.open && !state.selected.size && !state.bulkBusy && !document.hidden && !["INPUT", "SELECT"].includes(document.activeElement.tagName)) loadPage(true);
  }, 8000);
  async function start() {
    if (location.hash.startsWith("#setup=")) {
      state.setupToken = location.hash.slice(7); history.replaceState(null, "", location.pathname);
    }
    try {
      const session = await api("auth/session");
      if (session.authenticated) { state.user = session.username; state.csrf = session.csrf; route(); }
      else { state.setupToken = state.setupToken || session.setup_token || ""; renderAuth(session.needs_setup); }
    } catch (e) { app.innerHTML = `<div class="loading-screen">${esc(e.message)}<p>请使用 start-admin.bat 启动后台，再访问 http://127.0.0.1:8767/admin/</p></div>`; }
  }
  start();
  return { refresh: loadPage };
})();
