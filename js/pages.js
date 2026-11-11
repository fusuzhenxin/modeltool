(function () {
  if (window.__vdVisit) return;
  var s = document.createElement("script");
  s.src = "https://www.veridrop.cn/js/visit.js?v=20261020a";
  s.setAttribute("data-site", "modeltool");
  s.setAttribute("data-endpoint", "https://www.veridrop.cn/api/visit");
  document.head.appendChild(s);
})();

const Actions = {};

const App = {
  page: "home",
  timer: null,
  paused: false,
  phase: "think",
  show: "all",
  async start(page) {
    const startToken = {};
    App.startToken = startToken;
    const publicReady = typeof PublicData !== "undefined" ? PublicData.load(page !== "relays") : null;
    await Store.init();
    if (App.startToken !== startToken) return;
    UI.bind();
    App.page = page;
    if (App.timer) clearInterval(App.timer);
    App.timer = null;
    App.paused = false;
    App.phase = "think";
    App.busy = false;
    App.rush = false;
    App.runError = "";
    App.runToken = {};
    const waitForPublic = typeof PublicData !== "undefined" && PublicData.loading && ["relays", "stations", "examples"].includes(page);
    if (waitForPublic) {
      document.getElementById("app").innerHTML = UI.shell(page,
        '<section class="panel"><div class="panel-bd" role="status" aria-live="polite"><h1>正在加载页面数据</h1><p>导航已可使用，公开数据正在读取中…</p></div></section>');
    } else App.paint(page);
    await publicReady;
    if (App.startToken !== startToken) return;
    if (waitForPublic) App.paint(page);
    else {
      // Update only public content; keep forms, running tests and open dialogs intact.
      const notices = document.getElementById("public-notices");
      if (notices && typeof PublicData !== "undefined") notices.innerHTML = PublicData.notices(page === "home");
      const overview = document.getElementById("home-public-overview");
      if (page === "home" && overview) overview.innerHTML = Pages.publicOverview();
    }
  },
  paint(page) {
    document.getElementById("app").innerHTML = Pages[page]();
    if (document.querySelector("#app h1")) {
      document.querySelectorAll(".seo-only-h1").forEach((node) => node.remove());
    }
    applyHead();
    if (Pages.mount && Pages.mount[page]) Pages.mount[page]();
  },
  refresh() { App.start(App.page); }
};

function qs() {
  return Object.fromEntries(new URLSearchParams(location.search));
}
function setMeta(selector, attr, value) {
  document.querySelectorAll(selector).forEach((node) => node.setAttribute(attr, value));
}
function applyHead() {
  const file = location.pathname.split("/").pop() || "index.html";
  if (file === "relays.html" || file === "stations.html") {
    const title = (document.querySelector("#app h1")?.textContent || "中转检测日报") + " | 大模型降智检测";
    document.title = title;
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "content", title);
    return;
  }
  if (file === "setup.html") {
    const meta = DATA.kinds[qs().type];
    if (!meta) return;
    const title = meta.label + " - 选择模型、题量和难度 | 大模型降智检测";
    document.title = title;
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "content", title);
    return;
  }
  if (file === "status.html") {
    const names = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini", deepseek: "DeepSeek", moonshot: "Kimi", xai: "Grok" };
    const title = (names[qs().id] || "OpenAI") + " 官方状态 | 大模型降智检测";
    document.title = title;
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "content", title);
    return;
  }
  if (file === "work.html") {
    const item = findWork(qs().id || "");
    if (!item) return;
    const title = item.title + " - HTML作品 | 大模型降智检测";
    document.title = title;
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "content", title);
    return;
  }
  if (file === "examples.html" && typeof Examples !== "undefined") {
    const item = Examples.items.find((row) => row.id === qs().id);
    const title = item ? item.model + " 鹈鹕作品分析 - 评分依据 | 大模型降智检测" : "检测案例 - 公开作品与评分依据 | 大模型降智检测";
    document.title = title;
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[name="twitter:title"]', "content", title);
    const canonical = "https://www.modeltool.cn/examples.html" + (item ? "?id=" + encodeURIComponent(item.id) : "");
    setMeta('link[rel="canonical"]', "href", canonical);
    setMeta('meta[property="og:url"]', "content", canonical);
    return;
  }
  if (file !== "run.html" && file !== "result.html") return;
  const task = Store.task(qs().id || "");
  if (!task || !task.name) return;
  const kind = file === "result.html" ? "测试报告" : "测试进行中";
  const title = task.name + " - " + kind + " | 大模型降智检测";
  document.title = title;
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[name="twitter:title"]', "content", title);
  if (file === "result.html" && task.score != null) {
    const desc = task.modelName + " 的" + task.name + "得分为 " + task.score + "。报告包含降智判定、逐题对错和分维度成绩。";
    setMeta('meta[name="description"]', "content", desc);
    setMeta('meta[property="og:description"]', "content", desc);
    setMeta('meta[name="twitter:description"]', "content", desc);
  }
}
function byTime(a, b) {
  return Engine.parseTime(b.createdAt) - Engine.parseTime(a.createdAt);
}
function defaultModelId() {
  const first = DATA.models.find((item) => /^gpt-6/i.test(item.id));
  return (first || DATA.models[0]).id;
}
function modelOptions() {
  return DATA.models.map((model) => ({
    value: model.id,
    label: model.name + " · " + model.id,
    icon: UI.modelMark(model)
  }));
}
function kindIcon(kind) {
  return { ability: "doc", logic: "chat", code: "code", qa: "doc", candy: "candy", pelican: "car", detect: "shield" }[kind] || "doc";
}
function apiHint() {
  const cfg = Store.api();
  if (cfg.baseUrl && cfg.apiKey) {
    let host = cfg.baseUrl;
    try { host = new URL(cfg.baseUrl).host; } catch (err) { host = cfg.baseUrl; }
    const extra = cfg.modelOverride ? "，模型 ID 覆盖为 " + UI.esc(cfg.modelOverride) : "";
    return `<p class="note mt16">将请求 ${UI.esc(host)}${extra}。密钥只保存在这台浏览器。<button type="button" class="linkish" data-action="open-api">修改接口</button></p>`;
  }
  const where = UI.siteIsLocal()
    ? "并用 start.bat 打开本站。浏览器会把请求交给本机转发，再由本机去调接口。"
    : "请求由当前网站转发到你填写的接口。";
  return `<p class="note mt16">开始前要填写接口地址和密钥，${where}<button type="button" class="linkish" data-action="open-api">去填写</button></p>`;
}
function ensureApi() {
  const cfg = Store.api();
  if (cfg.baseUrl && cfg.apiKey) return true;
  Actions["open-api"]();
  UI.toast("请先填写接口地址和密钥");
  return false;
}
function activeSuiteTask() {
  const list = Store.tasks().filter((item) => item.suiteId && (item.status === "running" || item.status === "pending"));
  if (!list.length) return null;
  const running = list.find((item) => item.status === "running");
  if (running) return running;
  return list.slice().sort((a, b) => (b.suiteAt || 0) - (a.suiteAt || 0) || a.suiteStep - b.suiteStep)[0];
}
function suiteCount(id) {
  const n = Number(Form.get(id, "3"));
  return [3, 5, 10, 20, 30].includes(n) ? n : 3;
}
function suiteNote() {
  const active = activeSuiteTask();
  if (active) return "还有一套没测完（" + active.modelName + "）。点按钮会从第 " + active.suiteStep + " 项接着测，不会另开一套。";
  const basic = suiteCount("detect-count");
  const candy = suiteCount("detect-candy-count");
  return "一次测完按顺序跑能力、逻辑、代码、问答（各 " + basic + " 题）、糖果（" + candy + " 题），最后生成一幅 2D 鹈鹕骑车。只出中等题。这一档不够时做到用完为止。测完回到这一页汇总。";
}
function createLiveTask(kind, opts) {
  if (!ensureApi()) return null;
  const cfg = Store.api();
  const model = DATA.model(opts.modelId);
  const requested = (cfg.modelOverride || model.id).trim();
  const pelican = kind === "pelican";
  const mode = pelican ? (DATA.pelicanModes.find((item) => item.id === (opts.variant || "html2d")) || DATA.pelicanModes[1]) : null;
  let name = DATA.kinds[kind].label + "-" + UI.diffLabel(opts.difficulty || "medium");
  if (kind === "candy") {
    const n = Store.tasks().filter((item) => /^糖果测试-第\d+次$/.test(item.name)).length + 1;
    name = "糖果测试-第" + n + "次";
  }
  if (pelican) {
    const n = Store.tasks().filter((item) => item.kind === "pelican" && item.pelicanMode).length + 1;
    name = "鹈鹕骑车-" + mode.short + "-第" + n + "次";
  }
  return Store.addTask({
    kind,
    name,
    modelId: model.id,
    modelName: cfg.modelOverride ? model.name + "（" + requested + "）" : model.name,
    requestedModel: requested,
    source: "live",
    pelicanMode: mode ? mode.id : "",
    difficulty: opts.difficulty || "medium",
    count: pelican ? 1 : opts.count,
    rounds: pelican ? 1 : null,
    status: opts.status || "running",
    suiteId: opts.suiteId || "",
    suiteAt: opts.suiteAt || 0,
    suiteStep: opts.suiteStep || 0,
    suiteTotal: opts.suiteTotal || 0
  });
}
function launchTask(kind, opts) {
  const task = createLiveTask(kind, opts);
  if (!task) return;
  location.href = "run.html?id=" + encodeURIComponent(task.id);
}
function discardPendingSuite(suiteId, keepId) {
  const ids = Store.tasks()
    .filter((item) => item.suiteId === suiteId && item.id !== keepId && item.status === "pending")
    .map((item) => item.id);
  ids.forEach((id) => Store.remove(id));
}
function suiteFollow(task) {
  if (!task || !task.suiteId) return false;
  const next = Store.tasks()
    .filter((item) => item.suiteId === task.suiteId && item.status === "pending")
    .sort((a, b) => a.suiteStep - b.suiteStep)[0];
  if (next) {
    location.href = "run.html?id=" + encodeURIComponent(next.id);
    return true;
  }
  const open = Store.tasks().some((item) => item.suiteId === task.suiteId && (item.status === "running" || item.status === "pending"));
  if (!open) {
    location.href = "detect.html?suite=done";
    return true;
  }
  return false;
}
function taskLink(task) {
  if (task.status === "running") return `run.html?id=${encodeURIComponent(task.id)}`;
  if (task.status === "pending") return `setup.html?type=${task.kind}&task=${encodeURIComponent(task.id)}`;
  return `result.html?id=${encodeURIComponent(task.id)}`;
}
function opLabel(task) {
  if (task.suiteId && task.status === "pending") return "排队中";
  if (task.status === "running") return "查看进度";
  if (task.status === "pending") return "开始测试";
  if (task.status === "stopped") return "查看记录";
  return task.kind === "pelican" ? "查看详情" : "查看结果";
}
function ensureSelect(id, value) {
  if (Form.get(id, null) == null) Form.set(id, value);
  return Form.get(id, value);
}
function checks(lines) {
  return `<ul class="checks">${lines.map((line) => `<li><span class="tick">${UI.icon("check")}</span><span>${line}</span></li>`).join("")}</ul>`;
}
function hero(opts) {
  const art = UI.veridropCard();
  const icon = opts.icon ? `<span class="ico-box">${UI.icon(opts.icon)}</span>` : "";
  const head = (opts.icon || opts.back)
    ? `<div class="hero-title">${opts.back || ""}${icon}<h1>${opts.title}</h1></div>`
    : `<h1>${opts.title}</h1>`;
  return `<section class="hero"><div class="hero-copy">${head}<p class="sub">${opts.sub}</p>${opts.bar ? '<div class="accent"></div>' : ""}</div>${art}</section>`;
}
function entryInvite() {
  return typeof Examples === "undefined" ? "" : Examples.teaser();
}
const QUESTION_COUNTS = [3, 5, 10, 20, 30].map((n) => ({ value: String(n), label: n + " 题" }));
function featureMark(name) {
  const pen = "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"";
  const marks = {
    detect: `<path ${pen} d="M12 3.2 18.6 5.8v5.2c0 3.8-2.6 6.4-6.6 8-4-1.6-6.6-4.2-6.6-8V5.8L12 3.2z"/><path ${pen} d="m8.7 11.7 2.2 2.2 4.3-4.5"/>`,
    basic: `<path ${pen} d="M7.2 4.2h6.2L17.8 8.6V19.6a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 19.6V5.4a1.2 1.2 0 0 1 1.2-1.2z"/><path ${pen} d="M13.2 4.4V8.6h4.4M8.6 12.4h5.6M8.6 15.4h5.6M8.6 18.2h3"/>`,
    candy: `<path ${pen} d="M8.1 12 4.2 9.5v5L8.1 12z"/><rect x="7.8" y="8.6" width="8.4" height="6.8" rx="3.4" ${pen}/><path ${pen} d="M15.9 12 19.8 9.5v5L15.9 12z"/>`,
    pelican: `<circle cx="7.2" cy="17.2" r="2.25" ${pen}/><circle cx="16.8" cy="17.2" r="2.25" ${pen}/><path ${pen} d="M7.2 17.2 11 11.4h3.4L16.8 17.2M11 11.4 12.8 17.2"/><circle cx="14.8" cy="9.4" r="1.35" ${pen}/><path ${pen} d="M16.1 9.4h2.2"/>`,
    prompts: `<rect x="4.4" y="7" width="9.6" height="11.6" rx="1.6" ${pen}/><rect x="8.4" y="3.6" width="11" height="12.6" rx="1.7" ${pen}/><path ${pen} d="M11.2 8h5.2M11.2 10.8h5.2M11.2 13.6h3"/>`,
    works: `<path ${pen} d="M6.6 3.6h6.4l4.6 4.6v11.2a1.2 1.2 0 0 1-1.2 1.2H6.6a1.2 1.2 0 0 1-1.2-1.2V4.8a1.2 1.2 0 0 1 1.2-1.2z"/><path ${pen} d="M12.8 3.8V8.2h4.6M9.2 13.4 7.1 15.5l2.1 2.1M14.6 13.4l2.1 2.1-2.1 2.1"/>`,
    relay: `<circle cx="12" cy="12" r="7.2" ${pen}/><path ${pen} d="m12 5.6 1.8 5.2L12 9.6 10.2 10.8Z"/><path ${pen} d="m12 18.4-1.8-5.2L12 14.4l1.8-1.2Z"/>`,
    target: `<g ${pen}><path d="M12 16.4c.1-1.8-.2-3-.2-4.2"/><path d="M9.7 15.6c-.3-1.8.4-3.4 1.5-4.4"/><path d="M14.3 15.6c.3-1.8-.4-3.4-1.5-4.4"/><path d="M8.2 13.8c-.4-2 .5-3.8 2-5"/><path d="M15.8 13.8c.4-2-.5-3.8-2-5"/><path d="M10.6 7.8c.4-.3.9-.5 1.4-.5s1 .2 1.4.5"/></g>`
  };
  const body = marks[name] || marks.detect;
  return `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
function featureGrid(cards) {
  return `<section class="grid-4">${cards.map((card) => {
    const external = /^https?:\/\//i.test(card.href);
    const extra = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<article class="card feature">
    <span class="ico-box tone-${card.mark}">${featureMark(card.mark)}</span>
    <h3>${card.title}</h3>
    <p>${card.desc}</p>
    <a class="btn btn-block ${card.primary ? "btn-primary" : "btn-ghost"}" href="${card.href}"${extra}>${card.cta}</a>
  </article>`;
  }).join("")}</section>`;
}
function pager(page, pages, hrefFor) {
  if (pages <= 1) return "";
  const buttons = [];
  for (let i = 1; i <= pages; i++) {
    buttons.push(`<button type="button" class="${i === page ? "active" : ""}" data-action="go" data-href="${hrefFor(i)}">${i}</button>`);
  }
  return `<div class="pager">${buttons.join("")}</div>`;
}
function specTable() {
  return `<table class="spec">${DATA.spec.map((row) => `<tr><th>${UI.esc(row[0])}</th><td>${UI.esc(row[1])}</td></tr>`).join("")}</table>`;
}
function diffStock(kind) {
  const all = DATA.bank.filter((item) => item.kind === kind);
  const n = (level) => all.filter((item) => item.difficulty === level).length;
  return `简单 ${n("easy")} 题，中等 ${n("medium")} 题，困难 ${n("hard")} 题。只出选中的那一档。这一档不够时，做到用完为止，不会拿其他难度来凑，也不会重复出题。`;
}
function wrongSummary(items) {
  const list = items || [];
  const wrong = list.filter((item) => item.correct === false);
  const unread = list.filter((item) => item.choice == null && item.correct !== true);
  if (!list.length) return "";
  if (!wrong.length && !unread.length) return `<p class="note">这 ${list.length} 题都答对了。</p>`;
  const lines = wrong.map((item) => {
    const stem = item.stem.length > 46 ? item.stem.slice(0, 46) + "…" : item.stem;
    return `<li>第 ${list.indexOf(item) + 1} 题 ${UI.esc(stem)}</li>`;
  }).join("");
  const extra = unread.length ? `<p class="note">另有 ${unread.length} 题没有识别出 A、B、C、D。</p>` : "";
  return `<div class="wrong-note"><p>答错 ${wrong.length} 题，答对 ${list.filter((item) => item.correct).length} 题。</p>${lines ? `<ul>${lines}</ul>` : ""}${extra}</div>`;
}
function compareMark(item) {
  if (!item) return `<span class="badge idle"><i></i>没出这题</span>`;
  if (item.correct === true) return `<span class="badge ok"><i></i>答对</span>`;
  if (item.choice == null) return `<span class="badge idle"><i></i>未识别</span>`;
  return `<span class="badge bad"><i></i>答错</span>`;
}
function compareTable(tasks) {
  const map = new Map();
  tasks.forEach((task, index) => {
    (task.items || []).forEach((item) => {
      const key = item.qid || item.stem;
      if (!map.has(key)) map.set(key, { stem: item.stem || "这一题", cells: tasks.map(() => null) });
      map.get(key).cells[index] = item;
    });
  });
  const rows = Array.from(map.values());
  const splitRank = (row) => {
    const present = row.cells.filter(Boolean);
    const wrong = present.filter((item) => item.correct !== true).length;
    const right = present.filter((item) => item.correct === true).length;
    if (wrong && right) return 0;
    if (present.length > 1 && wrong === present.length) return 1;
    if (wrong) return 2;
    return 3;
  };
  rows.sort((a, b) => splitRank(a) - splitRank(b));
  let split = 0;
  let allWrong = 0;
  rows.forEach((row) => {
    const rank = splitRank(row);
    if (rank === 0) split += 1;
    if (rank === 1) allWrong += 1;
  });
  const summary = rows.length
    ? `结果不一致的有 ${split} 道，都答错的有 ${allWrong} 道。`
    : "这几条记录没有可对照的选择题。";
  const head = tasks.map((task) => `<th>${UI.esc(task.modelName)}<br>${task.score == null ? "—" : task.score}</th>`).join("");
  const body = rows.map((row) => `<tr><td>${UI.esc(row.stem)}</td>${row.cells.map((item) => `<td>${compareMark(item)}</td>`).join("")}</tr>`).join("");
  return `<p class="note">${summary}</p><div class="table-wrap"><table class="grid compare-q"><thead><tr><th>题目</th>${head}</tr></thead><tbody>${body || `<tr><td colspan="${tasks.length + 1}">没有可对照的题目</td></tr>`}</tbody></table></div>`;
}
function questionBlock(item, index, opened) {
  const letters = "ABCD";
  const options = item.options.map((opt, i) => {
    let cls = "";
    let tag = letters[i];
    if (i === item.answer && i === item.choice) { cls = "right"; tag = "模型答对"; }
    else if (i === item.answer) { cls = "right"; tag = "标准答案"; }
    else if (i === item.choice) { cls = "wrong"; tag = "模型选择"; }
    return `<div class="opt ${cls}"><span class="tag">${tag}</span>${UI.esc(opt)}</div>`;
  }).join("");
  const code = item.code ? `<pre class="code">${UI.esc(item.code)}</pre>` : "";
  return `<div class="q-item ${opened ? "open" : ""}">
    <button type="button" class="q-toggle" data-action="toggle-q">
      <span class="q-no">${String(index + 1).padStart(2, "0")}</span>
      <span class="q-stem">${UI.esc(item.stem)}</span>
      ${item.correct ? UI.statusBadge("done").replace("已完成", "答对") : (item.choice == null ? '<span class="badge idle"><i></i>未识别</span>' : '<span class="badge bad"><i></i>答错</span>')}
    </button>
    <div class="q-detail">${code}${options}<div class="explain">${UI.esc(item.explain)}</div>${item.reply ? `<div class="explain">模型原文：${UI.esc(item.reply)}</div>` : ""}</div>
  </div>`;
}
function artworkResult(task) {
  const active = "pelican";
  const mode = DATA.pelicanModes.find((item) => item.id === task.pelicanMode);
  const info = Api.artworkInfo(task.score);
  const artReport = typeof Poster === "undefined" ? null : Poster.fromTask(task);
  const artShare = shareHead(artReport);
  return UI.shell(active, `
    <div class="${artShare[0]}" data-share>
      <div>
        <div class="crumb"><a href="pelican.html">鹈鹕骑车测试页</a> / 作品</div>
        <h1>${UI.esc(task.name)}</h1>
        <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.esc(mode ? mode.name : "鹈鹕骑车")} · ${task.finishedAt || task.createdAt}</p>
      </div>
      ${artShare[1]}
    </div>
    <section class="stat-row">
      <div class="stat"><div class="k">代码结构分</div>${UI.ring(task.score)}</div>
      <div class="stat"><div class="k">结构检查</div><div class="v"><span class="badge ${info.level}"><i></i>${UI.esc(info.label)}</span></div></div>
      <div class="stat"><div class="k">能否展示</div><div class="v">${task.html ? "可以" : "不能"}</div></div>
      <div class="stat"><div class="k">说明</div><div class="v" style="font-size:14px;font-weight:650">看画面，不只看分数</div></div>
    </section>
    <article class="panel mt16">
      <div class="panel-hd"><h3>${UI.icon("car")} 鹈鹕骑车</h3>
        <div class="ops">
          <button class="btn btn-primary btn-sm" type="button" data-action="download-html" data-id="${task.id}" ${task.html || task.reply ? "" : "disabled"}>下载 HTML</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="rerun" data-id="${task.id}">再测一次</button>
        </div>
      </div>
      <div class="panel-bd">
        ${task.html ? `<iframe id="art-frame" class="art-frame" sandbox="allow-scripts" title="鹈鹕骑车预览"></iframe>` : `<div class="empty"><h3>没有提取出可展示的页面</h3><p>${UI.esc(info.desc)}</p></div>`}
        <p class="note mt16">${UI.esc(info.desc)} 长嘴、喉囊和是不是骑在车上，要看上面的画面。</p>
      </div>
    </article>
    <article class="panel mt16">
      <div class="panel-hd"><h3>${UI.icon("code")} 模型原文</h3></div>
      <div class="panel-bd"><pre class="code">${UI.esc(task.reply || task.html || "没有原文")}</pre></div>
    </article>`);
}
function stageHtml(task) {
  if (task && task.pelicanMode && task.status === "running" && !task.html) {
    const mode = DATA.pelicanModes.find((item) => item.id === task.pelicanMode) || DATA.pelicanModes[1];
    return `<div class="note">${UI.esc(mode.name)}</div><h2 style="margin:12px 0 8px;font-size:18px">正在生成鹈鹕骑车</h2><p>${UI.esc(mode.prompt)}</p><div class="think"><span class="dots">${App.runError ? "" : "模型正在写 HTML"}</span></div>${App.runError ? `<div class="explain" style="color:#ef5d5d">${UI.esc(App.runError)}</div><button type="button" class="btn btn-primary btn-sm" data-action="retry-run">重试</button>` : ""}`;
  }
  if (!task || task.status !== "running") {
    return `<div class="empty"><h3>这道测试不在进行中</h3><a class="btn btn-primary" href="${task ? taskLink(task) : "index.html"}">返回</a></div>`;
  }
  if (task.cursor >= task.items.length) {
    return `<div class="empty"><h3>题目已经跑完</h3><p>正在整理报告。</p></div>`;
  }
  const item = task.items[task.cursor];
  const show = App.phase === "show";
  const letters = "ABCD";
  const options = item.options.map((opt, i) => {
    let cls = "opt";
    if (show && i === item.choice && i === item.answer) cls += " right";
    else if (show && i === item.choice) cls += " wrong";
    else if (show && i === item.answer) cls += " right";
    return `<div class="${cls}"><span class="tag">${letters[i]}</span>${UI.esc(opt)}</div>`;
  }).join("");
  const code = item.code ? `<pre class="code">${UI.esc(item.code)}</pre>` : "";
  const reply = item.reply ? `<div class="explain">模型原文：${UI.esc(item.reply)}</div>` : "";
  const think = App.runError
    ? `<div class="explain" style="color:#ef5d5d">${UI.esc(App.runError)}</div><button type="button" class="btn btn-primary btn-sm" data-action="retry-run">重试这一题</button>`
    : show
    ? `<div class="think">${item.correct ? "本题目答对" : (item.choice == null ? "没有识别出选项字母，记为答错" : "本题目答错")}</div><div class="explain">${UI.esc(item.explain)}</div>${reply}`
    : `<div class="think"><span class="dots">${task.source === "live" ? "正在调用接口" : "模型作答中"}</span></div>`;
  const round = task.kind === "pelican" ? `<div class="note">第 ${item.round} 轮 · ${DATA.dims[item.dimension] || ""}</div>` : `<div class="note">${DATA.dims[item.dimension] || "综合"} · ${UI.diffLabel(item.difficulty)}</div>`;
  return `${round}<h2 style="margin:12px 0 8px;font-size:18px">第 ${task.cursor + 1} 题</h2><p style="margin:0 0 8px">${UI.esc(item.stem)}</p>${code}${options}${think}`;
}
function revealedCorrect(task) {
  const end = App.phase === "show" ? task.cursor + 1 : task.cursor;
  const slice = task.items.slice(0, end);
  return { ok: slice.filter((item) => item.correct).length, n: slice.length };
}

function safeWorkFile(file) {
  return /^works\/[A-Za-z0-9._-]+\.html$/.test(String(file || "")) ? String(file) : "";
}
function safeWorkUrl(url) {
  const text = String(url || "").trim();
  if (!/^https:\/\/\S+$/i.test(text)) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch (err) {
    return "";
  }
}
function workCatalog() {
  const listed = (typeof WORKS === "undefined" ? [] : WORKS).map((item) => {
    const file = safeWorkFile(item && item.file);
    const url = safeWorkUrl(item && item.url);
    if (!item || (!file && !url)) return null;
    const category = item.category || "互动";
    return {
      id: String(item.id || file || url),
      title: item.title || file || url,
      description: item.description || "",
      category,
      tags: Array.isArray(item.tags) && item.tags.length ? item.tags : [category],
      date: item.date || "",
      source: item.source || "",
      sourceUrl: item.sourceUrl || "",
      license: item.license || "",
      file,
      url,
      embed: !!url && item.embed !== false,
      heavy: !!(item.heavy || url)
    };
  }).filter(Boolean);
  return listed;
}
function findWork(id) {
  return workCatalog().find((item) => item.id === id) || null;
}
function downloadName(item) {
  const name = String(item.title || "work").replace(/[\\/:*?"<>|]/g, "").trim() || "work";
  return name + ".html";
}
function safeWorkCover(file) {
  return /^assets\/work-covers\/[A-Za-z0-9._-]+\.jpe?g$/.test(String(file || "")) ? String(file) : "";
}
function workCover(item) {
  const listed = typeof WORK_COVERS === "undefined" ? "" : WORK_COVERS[item.id];
  const shot = safeWorkCover(listed);
  if (shot) return `<img class="work-shot" src="${UI.esc(shot)}" alt="" loading="lazy" decoding="async">`;
  if (item.file && !item.heavy) {
    return `<iframe sandbox="allow-scripts" loading="lazy" src="${UI.esc(item.file)}" title="" tabindex="-1"></iframe>`;
  }
  return `<div class="work-poster"><span>${UI.esc(item.category || "在线")}</span><strong>${UI.esc(item.title)}</strong></div>`;
}
function workAction(item) {
  if (item.file) return `<a href="${UI.esc(item.file)}" download="${UI.esc(downloadName(item))}">下载</a>`;
  if (item.url) return `<a href="${UI.esc(item.url)}" target="_blank" rel="noreferrer">打开原页</a>`;
  return `<button type="button" class="linkish" data-action="download-html" data-id="${UI.esc(item.taskId)}">下载</button>`;
}
function workFrame(item) {
  if (item.file) {
    return `<iframe id="art-frame" class="art-frame" sandbox="allow-scripts" src="${UI.esc(item.file)}" title="${UI.esc(item.title)}"></iframe>`;
  }
  if (item.url && item.embed) {
    return `<iframe id="art-frame" class="art-frame" src="${UI.esc(item.url)}" title="${UI.esc(item.title)}" referrerpolicy="no-referrer" allow="fullscreen; pointer-lock; autoplay"></iframe>`;
  }
  if (item.url) {
    return `<div class="empty"><h3>这个网站不允许嵌在本页里</h3><p>到原网站打开。那个页面读不到本站的接口密钥。</p><a class="btn btn-primary" href="${UI.esc(item.url)}" target="_blank" rel="noreferrer">打开原页</a></div>`;
  }
  return `<iframe id="art-frame" class="art-frame" sandbox="allow-scripts" data-work-task="${UI.esc(item.taskId)}" title="${UI.esc(item.title)}"></iframe>`;
}
function workCard(item) {
  const href = "work.html?id=" + encodeURIComponent(item.id);
  const cover = workCover(item);
  const download = workAction(item);
  const tags = item.tags.map((tag) => `<span>${UI.esc(tag)}</span>`).join("");
  return `<article class="card work-card">
    <div class="work-cover">${cover}<a href="${href}" aria-label="在线查看 ${UI.esc(item.title)}"></a></div>
    <div class="work-body">
      <h2><a href="${href}">${UI.esc(item.title)}</a></h2>
      <p>${UI.esc(item.description)}</p>
      <div class="work-tags">${tags}</div>
      <div class="work-meta">${item.sourceUrl ? `<a href="${UI.esc(item.sourceUrl)}" target="_blank" rel="noreferrer">${UI.esc(item.source || "来源")}</a>` : `<time>${UI.icon("clock")} ${UI.esc(item.date || "")}</time>`}<span class="work-actions"><a href="${href}">在线查看</a>${download}</span></div>
    </div>
  </article>`;
}
function paintWorkFrames() {
  document.querySelectorAll("iframe[data-work-task]").forEach((frame) => {
    if (frame.getAttribute("src")) return;
    const task = Store.task(frame.dataset.workTask);
    if (!task || !task.html) return;
    frame.src = URL.createObjectURL(new Blob([task.html], { type: "text/html" }));
  });
}
function promptDiffLabel(key) {
  return { easy: "简单", medium: "中等", hard: "困难" }[key] || "";
}
function promptModelLabel(key) {
  return { general: "通用大模型", code: "代码模型", vision: "多模态模型" }[key] || "";
}
function promptCatLabel(key) {
  const row = PROMPT_CATS.find((item) => item[0] === key);
  return row ? row[1] : "";
}
function promptCatShort(key) {
  return { general: "通用", reason: "推理", code: "代码", math: "数学", doc: "文档", vision: "多模态", candy: "糖果", html: "HTML" }[key] || "";
}
function setPromptQuery(patch) {
  const params = new URLSearchParams(location.search);
  Object.keys(patch).forEach((key) => {
    if (patch[key]) params.set(key, patch[key]);
    else params.delete(key);
  });
  const text = params.toString();
  history.replaceState(null, "", "prompts.html" + (text ? "?" + text : ""));
}
function promptFiltered() {
  const query = qs();
  const text = (query.q || "").trim().toLowerCase();
  return PROMPTS.filter((item) => {
    if (query.cat && item.category !== query.cat) return false;
    if (query.diff && item.difficulty !== query.diff) return false;
    if (query.type && item.model !== query.type) return false;
    if (query.tag && !item.tags.includes(query.tag)) return false;
    if (query.pick === "featured" && !item.featured) return false;
    if (!text) return true;
    const hay = (item.title + " " + item.summary + " " + item.prompt + " " + item.tags.join(" ")).toLowerCase();
    return hay.includes(text);
  });
}
function promptCard(item) {
  const tone = PROMPT_TONES[item.category] || ["#3b5ffa", "#eef2ff"];
  const tags = item.tags.map((tag) => `<button type="button" class="prompt-tag" data-action="prompt-filter" data-key="tag" data-value="${UI.esc(tag)}" style="color:${tone[0]};background:${tone[1]}">${UI.esc(tag)}</button>`).join("");
  return `<article class="prompt-card" data-action="prompt-open" data-id="${UI.esc(item.id)}" style="--tone:${tone[0]};--tone-bg:${tone[1]}">
    <span class="prompt-ico">${promptIcon(item.category)}</span>
    <div class="prompt-body">
      <h2>${UI.esc(item.title)}</h2>
      <p>${UI.esc(item.summary)}</p>
      <div class="prompt-tags">${tags}</div>
    </div>
    <button type="button" class="prompt-go" data-action="prompt-open" data-id="${UI.esc(item.id)}" aria-label="查看${UI.esc(item.title)}">${UI.icon("chevron")}</button>
  </article>`;
}
function promptBoard() {
  const list = promptFiltered();
  const query = qs();
  const bits = [];
  if (query.cat) bits.push(promptCatLabel(query.cat));
  if (query.diff) bits.push(promptDiffLabel(query.diff));
  if (query.type) bits.push(promptModelLabel(query.type));
  if (query.tag) bits.push(query.tag);
  if (query.pick === "featured") bits.push("精选");
  if ((query.q || "").trim()) bits.push(query.q.trim());
  const summary = bits.length ? bits.map((bit) => UI.esc(bit)).join(" · ") + " · " + list.length + " 条" : "全部 " + PROMPTS.length + " 条";
  const clear = bits.length ? `<button type="button" class="linkish" data-action="prompt-reset">清除筛选</button>` : "";
  if (!list.length) {
    return `<div class="prompt-count"><span>${summary}</span>${clear}</div><div class="card"><div class="empty"><h3>没有符合这些条件的提示词</h3><p>换一个分类、难度或关键词。</p></div></div>`;
  }
  return `<div class="prompt-count"><span>${summary}</span>${clear}</div><div class="prompt-grid">${list.map(promptCard).join("")}</div>`;
}
function promptSide() {
  const query = qs();
  const counts = {};
  PROMPTS.forEach((item) => { counts[item.category] = (counts[item.category] || 0) + 1; });
  const cats = PROMPT_CATS.map(([id, name]) => `<button type="button" class="prompt-cat${query.cat === id ? " active" : ""}" data-action="prompt-filter" data-key="cat" data-value="${id}"><span>${promptIcon(id)}<b>${name}</b></span><em>${counts[id] || 0}</em></button>`).join("");
  const pills = (rows, key, current) => rows.map(([id, name]) => `<button type="button" class="prompt-pill${(current || "") === id ? " active" : ""}" data-action="prompt-filter" data-key="${key}" data-value="${id}">${name}</button>`).join("");
  return `<aside class="prompt-side">
    <section><h2>分类筛选</h2><div class="prompt-cats">${cats}</div></section>
    <section><h2>难度等级</h2><div class="prompt-pills">${pills(PROMPT_DIFFS, "diff", query.diff)}</div></section>
    <section><h2>模型类型</h2><div class="prompt-pills">${pills(PROMPT_MODELS, "type", query.type)}</div></section>
  </aside>`;
}
function promptHot() {
  const query = qs();
  const hot = PROMPTS.filter((item) => item.hot).sort((a, b) => a.hot - b.hot).map((item) => `<button type="button" class="hot-row" data-action="prompt-open" data-id="${UI.esc(item.id)}"><i class="rank r${item.hot}">${item.hot}</i><span>${UI.esc(item.title)}</span><em>${promptCatShort(item.category)}</em></button>`).join("");
  const tags = PROMPT_TAGS.map((tag) => `<button type="button" class="hot-tag${query.tag === tag ? " active" : ""}" data-action="prompt-filter" data-key="tag" data-value="${UI.esc(tag)}">${UI.esc(tag)}</button>`).join("");
  const flame = `<svg class="hot-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#ef5d5d" d="M12 2s.8 3.2-.6 5.2C10 9 9 8.6 9 7.2 7.2 8.6 6 11 6 13.4 6 17.2 8.8 20 12 20s6-2.8 6-6.6c0-3.2-1.6-5.2-3.2-6.6.2 1.6-.6 2.6-1.6 2.6C14.6 6.6 13.4 4 12 2z"/></svg>`;
  const ticket = `<svg class="hot-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#3b5ffa" d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/></svg>`;
  const star = `<svg class="hot-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#3b5ffa" d="m12 3.2 2.2 4.8 5.2.5-4 3.4 1.2 5.1L12 14.6 7.4 17l1.2-5.1-4-3.4 5.2-.5z"/></svg>`;
  return `<aside class="prompt-hot">
    <section><h2>${flame}热门提示词</h2><div class="hot-list">${hot}</div></section>
    <section><h2>${ticket}热门标签</h2><div class="hot-tags">${tags}</div></section>
    <button type="button" class="hot-feature${query.pick === "featured" ? " active" : ""}" data-action="prompt-filter" data-key="pick" data-value="featured">${star}<span><b>精选推荐</b><small>从库里挑出的一组提示词，点开可以复制或试跑</small></span>${UI.icon("chevron")}</button>
  </aside>`;
}
function latestReport(pred) {
  if (typeof Poster === "undefined") return null;
  const task = Store.latestDone((item) => pred(item) && item.source !== "demo" && Number.isFinite(Number(item.score)));
  return task ? Poster.fromTask(task) : null;
}
function placeShare(report, hint) {
  if (!report || typeof Poster === "undefined") return "";
  const shared = Poster.fromLocation();
  Poster.live = shared && shared.kind === report.kind ? shared : report;
  return `<div class="share-bar" data-share>${hint ? `<span class="hint">${hint}</span>` : ""}${Poster.buttons()}</div>`;
}
function sharedTaskPage(report) {
  const meta = (DATA.kinds && DATA.kinds[report.test]) || { label: "测试" };
  const active = meta.group === "basic" ? "basic" : (report.test || "basic");
  const parent = active === "basic" ? "basic.html" : report.test + ".html";
  Poster.live = report;
  const correct = report.correct == null ? "—" : report.correct + " / " + (report.total == null ? "—" : report.total);
  const rate = report.correct == null || !report.total ? "—" : Math.round(100 * report.correct / report.total) + "%";
  const artwork = report.test === "pelican" && (report.mode || report.html);
  const note = report.html
    ? "这是一份分享结果。打开这条链接就能看到作品。海报上的二维码放不下整页 HTML，扫码只能看到分数。链接里没有密钥，也没有题目。"
    : "这是一份分享结果。链接和海报里只有分数和结论，没有题目、作品和密钥。";
  const art = report.html ? `<article class="panel mt16"><div class="panel-hd"><h3>${UI.icon("car")} 鹈鹕骑车</h3><div class="ops"><button class="btn btn-ghost btn-sm" type="button" data-action="open-shared-html">新标签页打开</button><button class="btn btn-primary btn-sm" type="button" data-action="download-shared-html">${UI.icon("download")} 下载 HTML</button></div></div><div class="panel-bd"><iframe id="art-frame" class="art-frame" sandbox="allow-scripts" title="鹈鹕骑车预览"></iframe></div></article>` : "";
  return UI.shell(active, `
    <div class="page-head relay-head" data-share>
      <div>
        <div class="crumb"><a href="${parent}">返回</a> / 分享结果</div>
        <h1>${UI.esc(report.name || meta.label)}</h1>
        <p>${UI.esc(report.modelName || report.modelId || "")} · ${UI.esc(report.time || "")}</p>
      </div>
      ${Poster.buttons()}
    </div>
    <p class="note">${note}</p>
    <section class="stat-row">
      <div class="stat" style="display:flex;justify-content:center">${UI.ring(report.score)}</div>
      <div class="stat"><div class="k">${artwork ? "代码结构分" : "判定"}</div><div class="v">${artwork ? UI.esc(Api.artworkInfo(report.score).label) : UI.levelBadge(report.score, report.test === "pelican" ? "pelican" : "detect")}</div></div>
      <div class="stat"><div class="k">答对</div><div class="v">${correct}</div></div>
      <div class="stat"><div class="k">题目正确率</div><div class="v">${rate}</div></div>
    </section>
    <article class="panel"><div class="panel-bd"><p class="lead">${UI.esc(report.summary || "")}</p></div></article>
    ${art}`);
}
function shareHead(report) {
  if (!report || typeof Poster === "undefined") return ["page-head", ""];
  Poster.live = report;
  return ["page-head relay-head", Poster.buttons()];
}
function relayLevel(level) {
  return level === "bad" || level === "warn" || level === "ok" ? level : "unknown";
}
function relayPublicDetail(item) {
  const shareReport = typeof Poster === "undefined" ? null : Poster.fromPublic(item);
  if (shareReport) Poster.live = shareReport;
  const localShare = typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const names = (item.findings || []).map((name) => `<li>${UI.esc(name)}</li>`).join("");
  const checks = item.checks || [];
  const abnormal = checks.filter((check) => check.status === "fail" || check.status === "warn").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const date = RelayDirectory.day(item), domain = RelayDirectory.domain(item);
  const site = typeof PublicData !== "undefined" && PublicData.live ? PublicData.stations.find((station) => station.domain === domain) : null;
  const stationName = site?.name || item.stationName || domain;
  const relaySection = (item.sections || []).find((section) => section.kind === "relay");
  const summary = relaySection?.summary || item.summary || "请结合下方逐项检测结果与复测记录判断。";
  const scoreLabel = item.demo ? "模拟检测分" : item.suite === "server-v1" ? "协议检查分" : "本次检测分";
  const reportType = item.test_name || "中转站检测";
  const level = relayLevel(item.level);
  const statuses = { pass: ["ok", "通过"], warn: ["warn", "需核对"], fail: ["bad", "未通过"], skip: ["", "不支持"], miss: ["", "未命中"], unknown: ["", "无法确认"] };
  return UI.shell("relay-public", `
    <div class="page-head report-head">
      <div class="crumb"><a href="relays.html">中转检测日报</a> / <a href="${RelayDirectory.url({ station: domain, date })}">${UI.esc(stationName || "中转站")}</a> / 报告详情</div>
      <div class="report-identity">${RelayDirectory.stationMark({ domain, name: stationName })}<div><span class="report-eyebrow">公开检测报告</span><h1>${UI.esc(stationName)}</h1><p class="report-domain">${UI.esc(domain)}</p></div></div>
      <div class="report-actions">${shareReport ? Poster.buttons() : ""}${RelayDirectory.stationVisit(item, true)}<a class="report-action" href="${RelayDirectory.url({ station: domain, date })}">${UI.icon("list")}该站当天报告</a><a class="report-action" href="${RelayDirectory.url({ date }, "#daily-reports")}">${UI.icon("chart")}全部中转日报</a></div>
    </div>
    <div class="report-body">
    ${localShare ? '<p class="note">当前为本地预览：分享链接和海报二维码指向本机地址，其他设备暂时无法访问；不会上传报告或发布到线上。</p>' : ""}
    ${item.demo ? `<p class="demo-notice"><strong>演示数据</strong> 域名、检测时间、分数和结果均为虚构，仅供预览页面效果，不代表实际服务。</p>` : ""}
    <section class="panel report-overview report-tone-${level}" aria-labelledby="report-verdict-title">
      <div class="report-overview-main"><div class="report-verdict"><span class="report-verdict-icon">${UI.icon(level === "ok" ? "shield" : "info")}</span><div><p class="report-kicker">${UI.esc(reportType)}${item.demo ? " · 演示" : ""}</p><h2 id="report-verdict-title">${UI.esc(item.title || "检测已完成")}</h2><p class="report-summary">${UI.esc(summary)}</p></div></div><div class="report-score"><span>${scoreLabel}</span><strong>${item.score == null ? "—" : UI.esc(item.score)}${item.score == null ? "" : "<small>/ 100</small>"}</strong>${item.score == null ? '<small>本次未进行协议评分</small>' : ""}</div></div>
      <div class="report-metrics"><div>${UI.icon("list")}<span>检查项目</span><strong>${checks.length}<small>项</small></strong></div><div>${UI.icon("check")}<span>通过项目</span><strong>${passed}<small>项</small></strong></div><div class="${abnormal ? "report-metric-attention" : ""}">${UI.icon("info")}<span>异常或需核对</span><strong>${abnormal}<small>项</small></strong></div><div>${UI.icon("refresh")}<span>检测次数</span><strong>${UI.esc(item.runs || 1)}<small>次</small></strong></div></div>
    </section>
    <section class="panel report-information" aria-labelledby="report-info-title"><div class="report-section-heading"><h2 id="report-info-title">检测信息</h2><span>参数与结果一同留档</span></div><dl class="report-info-grid"><div><dt>${UI.icon("target")}宣称模型</dt><dd>${UI.modelChip(item.model || "")}</dd></div><div><dt>${UI.icon("clock")}检测时间</dt><dd><time>${UI.esc(item.time || "未提供")}</time></dd></div><div><dt>${UI.icon("doc")}检测类型</dt><dd>${UI.esc(reportType)}</dd></div><div class="report-conditions"><dt>${UI.icon("code")}测试条件</dt><dd>${UI.esc(item.conditions || "该记录未提供补充参数，请结合检测时间与项目判断。")}</dd></div></dl>${names ? `<div class="report-findings"><span>结果摘要</span><ul>${names}</ul></div>` : ""}<details class="report-method"><summary>${UI.icon("info")}检测说明与复测建议${UI.icon("chevron")}</summary><div>${item.summary && item.summary !== summary ? `<p>${UI.esc(item.summary)}</p>` : ""}<p>${item.protocol_tested === false ? "本次未选择中转站测试，不据能力、指纹或作品判断协议是否掺水。" : "中转站结论沿用本站原版测试，请结合逐项依据复核。"}</p><p>${UI.esc(item.retest || "这份记录只代表这一次检测。复测时保持相同接口、模型 ID 和设置，再对照逐项结果。")}</p></div></details></section>
    ${(item.sections || []).some((section) => section.kind !== "pelican") ? '<div class="report-section-label"><h2>各项测试表现</h2><span>不同测试独立展示结果</span></div>' : ""}
    ${typeof SiteReport === "undefined" ? "" : SiteReport.render(item.sections || [], UI.esc)}
    ${item.artwork?.available ? `<div class="entry-actions"><a class="btn btn-ghost" href="/api/public/reports/${encodeURIComponent(item.id)}/artwork" target="_blank" rel="noopener noreferrer">新标签页打开作品</a></div>` : ""}
    ${item.artwork ? `<article class="panel"><div class="panel-hd"><h2>鹈鹕骑车 · ${UI.esc(item.artwork.mode_name)}</h2><span>代码结构分 ${UI.esc(item.artwork.score)} / 100</span></div><div class="panel-bd"><p class="note">结构分只检查代码特征，不识别画面，不代表模型身份或是否降智。请观察长嘴、喉囊、车架和骑行关系。</p>${item.artwork.available ? `<iframe class="art-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/api/public/reports/${encodeURIComponent(item.id)}/artwork" title="鹈鹕骑车作品预览"></iframe>` : '<p>本次没有生成完整作品。</p>'}<ul class="example-checks">${item.artwork.checks.map((c) => `<li><span>${c.passed ? "✓" : "—"} ${UI.esc(c.name)}</span><b>${c.passed ? "+" + c.points : "0"}</b></li>`).join("")}</ul></div></article>` : ""}
    ${checks.length ? `<article class="panel relay-public report-checks mt16"><div class="panel-hd"><div><h2>逐项检测结果${item.demo ? " · 模拟" : ""}</h2><p>保留每个检查项的结果与判断依据</p></div><span>共 ${checks.length} 项</span></div><div class="table-wrap"><table class="grid"><thead><tr><th>检查项目</th><th>结果</th><th>依据说明</th></tr></thead><tbody>${checks.map((check) => { const status = statuses[check.status] || ["", "待核对"]; return `<tr><td>${UI.esc(check.name)}</td><td><span class="badge ${status[0]}">${status[1]}</span></td><td class="finding-names">${UI.esc(check.detail)}</td></tr>`; }).join("")}</tbody></table></div></article>` : ""}
    ${RelayDirectory.reportContext(item)}
    <div class="share-actions">
      <a class="btn btn-ghost" href="relays.html">返回列表</a>
      <a class="btn btn-primary" href="relay.html">去测中转站</a>
    </div></div>`);
}
const Pages = {
  publicOverview() {
    if (typeof PublicData !== "undefined") {
      if (PublicData.loading) return '<section class="panel"><div class="panel-bd" role="status" aria-live="polite">正在加载公开检测数据…</div></section>';
      if (PublicData.failed) return '<section class="panel"><div class="panel-bd" role="status">公开检测数据暂时无法加载，请稍后刷新。</div></section>';
    }
    return typeof RelayDirectory === "undefined" ? "" : RelayDirectory.overview();
  },
  home() {
    const recentIcons = { detect: "shield", basic: "doc", candy: "candy", pelican: "car", relay: "target" };
    const rows = Store.get().recent.map((row) => `<a class="row" href="${row.href}">
      <span class="row-name"><span class="ico-box sm">${UI.icon(recentIcons[row.kind] || "doc")}</span>${UI.esc(row.name)}</span>
      ${UI.statusBadge(row.status)}
      <time>${UI.esc(row.time || "")}</time>
    </a>`).join("") || `<div class="empty">还没有使用记录</div>`;
    return UI.shell("home", `
      <section class="hero home-entry"><div class="hero-copy"><span class="entry-kicker">模型能力 · 接口协议 · 行为指纹</span><h1>你买的模型，<br>实际表现对得上吗？</h1><p class="sub">检查 API 的回答与协议表现。先看公开案例，也可以免填密钥，手动检测你正在用的模型。</p><div class="entry-actions"><a class="btn btn-primary" href="relay.html">${UI.icon("target")} 检查我的 API</a><a class="btn btn-ghost" href="examples.html">先看检测案例</a><a class="entry-text-link" href="trace.html?mode=manual">免填密钥，手动检测 →</a></div><p class="entry-footnote">API 检测使用你自己的额度；手动模式可在自己的客户端作答。</p></div>${UI.veridropCard()}</section>
      <div id="home-public-overview">${Pages.publicOverview()}</div>
      <section class="home-tools-layout"><div class="home-tools-main"><div class="section-intro"><h2>选择检测工具</h2><a href="guide.html">如何选择 →</a></div>
      ${featureGrid([
        { mark: "detect", title: "模型检测页", desc: "综合多项测试结果，评估模型是否存在降智问题。", href: "detect.html", cta: "进入检测 →", primary: true },
        { mark: "target", title: "模型指纹检测", desc: "自动检测或手动粘贴回答，对照指纹库查看最接近的候选。", href: "trace.html", cta: "开始检测 →" },
        { mark: "basic", title: "基础测试页", desc: "通过基础能力测试，评估模型的核心能力表现。", href: "basic.html", cta: "开始测试 →" },
        { mark: "candy", title: "糖果测试页", desc: "使用更具迷惑性的测试题目，识别模型是否出现降智。", href: "candy.html", cta: "开始测试 →" },
        { mark: "pelican", title: "鹈鹕骑车测试页", desc: "让模型写出一只鹈鹕骑自行车的 HTML，打开就能看到画面。", href: "pelican.html", cta: "开始测试 →" },
        { mark: "prompts", title: "提示词库", desc: "按分类查看评测提示词，可以复制，也可以用当前接口试跑。", href: "prompts.html", cta: "打开提示词库 →" },
        { mark: "works", title: "HTML 作品", desc: "公开的 HTML 作品目录。列表用静图，详情页再打开可玩页面。", href: "works.html", cta: "查看作品 →" },
        { mark: "relay", title: "中转导航", desc: "去 API 中转导航站挑选接口，再回到这里填写地址和密钥。", href: "https://www.veridrop.cn", cta: "打开导航 →" }
      ])}</div><aside class="home-utilities" aria-label="检测辅助信息"><section class="panel home-privacy" aria-labelledby="home-privacy-title"><h2 id="home-privacy-title">${UI.icon("info")} 密钥只留在当前浏览器</h2><div><p>接口密钥填写后，只保存在你正在用的这个浏览器里。这里不提供访客账号，也不会把你填写的个人密钥存到服务器。</p><p>写入浏览器之前，密钥会用 AES-GCM 加密。浏览器里留下的是密文，解开用的钥匙同样只在这台浏览器中，不会放进导出的报告。</p><p>开始测试时，页面在本地解开密钥，${UI.forwardNote()}转发时用一下，不另存一份。换一个浏览器、换一个网址，或清掉本站数据之后，需要重新填写。</p></div></section></aside></section>
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("clock")} 最近使用</h3></div>
          <div class="rows">${rows}</div>
        </article>
        <article class="panel tips-card">
          <div class="panel-hd"><h3>${UI.icon("bulb")} 使用小贴士</h3></div>
          <div class="panel-bd">
            ${checks(["建议在不同场景下多次测试，获取更准确的结果", "关注模型在复杂问题下的表现", "结合多个测试维度进行综合判断"])}
            <a class="btn btn-ghost btn-pill" href="guide.html#tips">查看详细说明 →</a>
          </div>
        </article>
      </section>`, { officialTicker: true });
  },
  status() {
    return UI.shell("home", `
      <section class="official-bar" id="official-bar" aria-label="官方模型实况">
        <strong class="official-label">官方模型实况</strong>
        <span class="official-sync" id="official-sync">正在同步官方状态…</span>
        <button type="button" class="official-refresh" id="official-refresh">刷新</button>
        <div class="official-pills" id="official-pills"></div>
      </section>
      <div id="official-detail"><div class="empty"><h3>正在读取官方状态</h3></div></div>`);
  },
  detect() {
    ensureSelect("detect-model", defaultModelId());
    ensureSelect("detect-count", "3");
    ensureSelect("detect-candy-count", "3");
    const sharedDetect = typeof Poster === "undefined" ? null : Poster.fromLocation();
    const localSnap = Store.get().snapshot;
    const localReport = typeof Poster === "undefined" ? null : Poster.fromDetect(localSnap);
    const report = sharedDetect && sharedDetect.kind === "detect" ? sharedDetect : localReport;
    if (report) Poster.live = report;
    const snap = report && report.snap ? report.snap : localSnap;
    const info = Engine.judgeText(snap.score, "detect");
    const tone = info.level === "ok" ? "ok" : info.level === "warn" ? "warn" : info.level === "bad" ? "bad" : "idle";
    const cfg = Store.api();
    const configured = !!(cfg.baseUrl && cfg.apiKey);
    const anyPart = Store.tasks().some((item) => item.status === "done" && item.source !== "demo" && Number.isFinite(Number(item.score)));
    let desc = info.desc;
    let side = info.side;
    if (info.level === "none") {
      if (!configured && !anyPart) {
        desc = "接口还没配置，也没有已完成的测试。这里不会自己打分，也不会判定降智。";
        side = "选好模型和题量后点一次测完。基础四项、糖果和鹈鹕会按顺序跑。四项基础都完成，并且和糖果、鹈鹕是同一个模型，才会汇总。";
      } else if (snap.hold === "mixed") {
        desc = "能力、逻辑、代码、问答、糖果和鹈鹕最近一次不是同一个模型。综合分先留空。";
        side = "用同一个模型把这几项都测完，再点重新检测。缺的项不会记成 0。";
      } else if (!anyPart) {
        desc = "接口已保存，但还没有已完成的测试。完成后再来看综合结果。";
        side = "没有真实作答记录时，综合分保持未检测。";
      } else {
        desc = "已有部分测试结果。能力、逻辑、代码、问答四项都完成，并且和糖果、鹈鹕是同一个模型，才会计算综合分。";
        side = "缺任何一项都不会当成 0 分，也不会写成降智。";
      }
    }
    if (sharedDetect && sharedDetect.kind === "detect") {
      desc = (snap.score == null ? "分享的是一项还没汇总完的检测。" : info.desc) + " 这是一份分享结果，链接和海报里没有密钥。";
      side = "链接里只有各项分数和结论。";
    }
    const shareHead = report ? `<div class="panel-hd" data-share><h3>${sharedDetect && sharedDetect.kind === "detect" ? "分享的检测结果" : "检测结果"}</h3>${Poster.buttons()}</div>` : "";
    const parts = [
      ["meta", "detect", "模型检测", "综合多项测试结果，评估模型是否存在降智问题。", "guide.html#score"],
      ["basic", "basic", "基础测试", "通过基础能力测试，评估模型的核心能力表现。", "basic.html"],
      ["candy", "candy", "糖果测试", "使用更具迷惑性的测试题目，识别模型是否出现降智。", "candy.html"],
      ["pelican", "pelican", "鹈鹕骑车", "让模型生成鹈鹕骑自行车的 HTML，并直接预览画面。", "pelican.html"]
    ];
    const metrics = parts.map(([key, mark, name]) => {
      const part = snap.parts[key];
      const score = part.score == null ? "—" : part.score;
      return `<article class="metric"><span class="ico-box line-ico tone-${mark}">${featureMark(mark)}</span><div class="name">${name}</div><div class="score">${score}<span>分</span></div>${UI.levelBadge(part.score, "detect")}</article>`;
    }).join("");
    const detail = parts.map(([key, mark, name, text, href]) => {
      const part = snap.parts[key];
      return `<tr>
        <td><div class="td-title"><span class="ico-box line-ico sm tone-${mark}">${featureMark(mark)}</span><span>${name}<span class="td-sub">${text}</span></span></div></td>
        <td><b>${part.score == null ? "—" : part.score + " /100"}</b></td>
        <td>${UI.levelBadge(part.score, "detect")}</td>
        <td>${part.time || "—"}</td>
        <td><a class="linkish" href="${href}">查看详情</a></td>
      </tr>`;
    }).join("");
    const when = snap.time ? `检测时间：${UI.esc(snap.time)}` : "检测时间：尚未检测";
    const model = snap.modelName ? `模型版本：${UI.esc(snap.modelName)}` : "模型版本：尚未检测";
    return UI.shell("detect", `
      ${hero({ icon: "shield", title: "模型检测页", sub: "汇总各项测试结果，评估模型是否存在降智问题。" })}
      ${!anyPart && !(sharedDetect && sharedDetect.kind === "detect") ? entryInvite() : ""}
      <a class="relay-entry" href="trace.html">
        <div>
          <div class="relay-kicker">支持自动检测和手动检测</div>
          <h3>模型指纹检测</h3>
          <p>三道数字题，对照指纹库看回答更接近哪个候选。可以用 API 自动作答，也可以复制到自己的客户端运行。</p>
        </div>
        <span class="btn btn-primary">开始检测 →</span>
      </a>
      <section class="panel">
        ${shareHead}
        <div class="summary">
        <div class="summary-main">
          ${UI.ring(snap.score)}
          <div class="summary-copy">
            <h2>${info.level === "none" ? "" : `<span class="mini-${tone}">${UI.icon("mark")}</span>`}${UI.esc(info.title)}</h2>
            <p>${UI.esc(desc)}</p>
            <div class="summary-meta"><span>${UI.icon("clock")} ${when}</span><span>${model}</span></div>
          </div>
        </div>
        <div class="summary-metrics">${metrics}</div>
        </div>
      </section>
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("doc")} 各项测试详情</h3></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>测试项目</th><th>得分</th><th>状态</th><th>检测时间</th><th></th></tr></thead>
            <tbody>${detail}</tbody>
          </table></div>
        </article>
        <article class="panel judge-card">
          <div class="panel-hd"><h3>${UI.icon("target")} 综合评估结果</h3></div>
          <div class="panel-bd judge">
            <span class="ico-box lg ${tone}">${UI.icon(info.level === "none" ? "info" : "mark")}</span>
            <h3>${UI.esc(info.title)}</h3>
            <p>${UI.esc(side)}</p>
            <div class="suite-box">
              ${UI.field("选择模型", UI.select("detect-model", Form.get("detect-model"), modelOptions()))}
              ${activeSuiteTask() ? "" : `<div class="suite-counts">
                ${UI.field("基础每项", UI.select("detect-count", Form.get("detect-count"), QUESTION_COUNTS))}
                ${UI.field("糖果题量", UI.select("detect-candy-count", Form.get("detect-candy-count"), QUESTION_COUNTS))}
              </div>`}
              <p class="note">${suiteNote()}</p>
              <button class="btn btn-primary btn-block" type="button" data-action="start-suite">${UI.icon("play")} ${activeSuiteTask() ? "继续未测完的项目" : "一次测完"}</button>
            </div>
            <button class="btn btn-ghost btn-block" type="button" data-action="recheck">${UI.icon("refresh")} 重新检测</button>
          </div>
        </article>
      </section>`);
  },
  basic() {
    const tasks = Store.tasks().filter((item) => Engine.moduleOf(item.kind) === "basic").sort(byTime);
    const body = tasks.map((task) => `<tr>
      <td><div class="td-title"><span class="ico-box sm">${UI.icon(kindIcon(task.kind))}</span>${UI.esc(task.name)}</div></td>
      <td>${DATA.kinds[task.kind].typeName}</td>
      <td>${UI.esc(task.modelName)}</td>
      <td>${UI.statusBadge(task.status)}</td>
      <td>${task.createdAt}</td>
      <td><button class="linkish" type="button" data-action="open-task" data-id="${task.id}">${opLabel(task)}</button></td>
    </tr>`).join("") || `<tr><td colspan="6"><div class="empty">还没有能力测试记录</div></td></tr>`;
    return UI.shell("basic", `
      ${hero({ title: "基础测试页", sub: "通过基础能力测试，评估模型的核心能力表现。", bar: true })}
      ${placeShare(latestReport((item) => Engine.moduleOf(item.kind) === "basic"), "分享最近一次基础测试。链接和海报里没有密钥。")}
      <a class="relay-entry" href="relay.html">
        <div>
          <div class="relay-kicker">优先测试</div>
          <h3>中转站测试</h3>
          <p>测这条中转站有没有偷换模型、吞掉指令、假流式或掺水。点进去单独测试，测完给出分数和掺水报告。</p>
        </div>
        <span class="btn btn-primary">进入测试 →</span>
      </a>
      ${featureGrid([
        { icon: "doc", title: "模型能力测试", desc: "通过多维度的能力测试，评估模型在理解、推理、生成等方面的表现。", href: "setup.html?type=ability", cta: "开始测试 →", primary: true },
        { icon: "chat", title: "逻辑推理测试", desc: "测试模型的逻辑思维能力，评估其在复杂推理任务中的表现。", href: "setup.html?type=logic", cta: "开始测试 →" },
        { icon: "code", title: "代码能力测试", desc: "评估模型在代码生成、代码理解和代码修复等方面的能力。", href: "setup.html?type=code", cta: "开始测试 →" },
        { icon: "doc", title: "知识问答测试", desc: "测试模型的知识储备和事实性回答能力，评估其准确性和可靠性。", href: "setup.html?type=qa", cta: "开始测试 →" }
      ])}
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("list")} 我的测试任务</h3><a class="more" href="tasks.html">全部任务 →</a></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>任务名称</th><th>测试类型</th><th>模型名称</th><th>状态</th><th>开始时间</th><th>操作</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>
        </article>
        <div class="stack">
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("bulb")} 测试说明</h3></div>
            <div class="panel-bd">
              ${checks(["每个测试任务包含多种题型，全面评估模型能力", "测试结果将生成详细报告，包含各项能力评分", "支持多种主流模型，持续更新测试题库", "建议在稳定的网络环境下进行测试"])}
              <a class="btn btn-ghost btn-pill" href="guide.html#basic">查看详细说明 →</a>
            </div>
          </article>
          <article class="panel tips-card">
            <div class="panel-hd"><h3>${UI.icon("shield")} 测试小贴士</h3></div>
            <div class="panel-bd"><p class="lead">建议使用最新版本的模型进行测试，以获得更准确的结果。</p></div>
          </article>
        </div>
      </section>`);
  },
  relays() { return RelayDirectory.page(); },
  stations() { return RelayDirectory.stationsPage(); },
  relay() {
    ensureSelect("basic-model", defaultModelId());
    const shared = typeof Poster === "undefined" ? null : Poster.fromLocation();
    const relayShared = shared && (!shared.kind || shared.kind === "relay") ? shared : null;
    const report = relayShared || Store.basicReport();
    if (typeof Poster !== "undefined" && report && report.score != null) Poster.live = report;
    const share = report && report.score != null && typeof Poster !== "undefined" ? Poster.buttons() : "";
    return UI.shell("basic", `
      <div class="page-head relay-head">
        <div>
          <div class="crumb"><a href="basic.html">基础测试页</a> / 中转站测试</div>
          <h1>中转站测试</h1>
          <p>测的是中转站有没有把请求改掉、把模型换成更便宜的，或把协议能力弄丢。模型会不会做题，看上面的四项能力测试。想看回答更像哪一个 GPT 或 Claude，用<a href="trace.html">模型指纹检测</a>。测完可以生成分享海报和链接，里面没有密钥。<a href="relays.html">已公开的检测</a>可查看完整报告，模拟案例会标注演示数据。</p>
        </div>
        ${share}
      </div>
      ${!report ? entryInvite() : ""}
      <article class="panel">
        <div class="panel-bd">
          <div class="form-row" style="grid-template-columns: 1.4fr auto">
            ${UI.field("选择模型", UI.select("basic-model", Form.get("basic-model"), modelOptions()))}
            <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="button" data-action="start-basic-probe">${UI.icon("play")} 开始测试</button></div>
          </div>
          ${apiHint()}
        </div>
      </article>
      <div id="relay-report">${report && report.summary ? Probe.reportHtml(report) : ""}</div>
      <article class="panel mt16">
        <div class="panel-hd"><h3>各项测试详情</h3></div>
        <table class="probe-table">
          <tbody>${typeof Probe === "undefined" ? "" : Probe.rows(report)}</tbody>
        </table>
      </article>`);
  },
  candy() {
    ensureSelect("candy-model", defaultModelId());
    ensureSelect("candy-count", "20");
    ensureSelect("candy-diff", "medium");
    const preview = Store.tasks().filter((item) => item.kind === "candy").sort(byTime).slice(0, 4);
    const stats = Store.candyStats();
    const rows = preview.map((task) => `<tr>
      <td>${UI.esc(task.name)}</td>
      <td>${UI.modelChip(task.modelId, task.modelName)}</td>
      <td>${task.count}</td>
      <td>${UI.diffLabel(task.difficulty)}</td>
      <td>${task.createdAt}</td>
      <td>${UI.statusBadge(task.status)}</td>
      <td><div class="ops"><button class="linkish" type="button" data-action="open-task" data-id="${task.id}">${task.status === "done" ? "查看结果" : opLabel(task)}</button><button class="linkish" type="button" data-action="more" data-id="${task.id}" aria-label="更多">${UI.icon("more")}</button></div></td>
    </tr>`).join("");
    return UI.shell("candy", `
      ${hero({ icon: "candy", title: "糖果测试页", sub: "使用更具迷惑性的测试题目，识别模型是否出现降智。" })}
      ${placeShare(latestReport((item) => item.kind === "candy"), "分享最近一次糖果测试。链接和海报里没有密钥。")}
      <section class="grid-side">
        <div class="stack">
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("doc")} 测试任务</h3></div>
            <div class="panel-bd">
              <p class="lead">选择模型并设置测试参数，开始糖果测试。</p>
              <p class="note">${diffStock("candy")}</p>
              <div class="form-row">
                ${UI.field("选择模型", UI.select("candy-model", Form.get("candy-model"), modelOptions()))}
                ${UI.field("测试题目数量", UI.select("candy-count", Form.get("candy-count"), QUESTION_COUNTS))}
                ${UI.field("难度等级", UI.select("candy-diff", Form.get("candy-diff"), [{ value: "easy", label: "简单" }, { value: "medium", label: "中等" }, { value: "hard", label: "困难" }]))}
                <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="button" data-action="start-candy">${UI.icon("play")} 开始测试</button></div>
              </div>
              ${apiHint()}
            </div>
          </article>
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("clock")} 测试记录</h3></div>
            <div class="table-wrap"><table class="grid">
              <thead><tr><th>任务名称</th><th>模型</th><th>题目数量</th><th>难度等级</th><th>测试时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="7"><div class="empty">还没有糖果测试记录</div></td></tr>`}</tbody>
            </table></div>
          </article>
        </div>
        <div class="stack">
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("target")} 测试说明</h3></div>
            <div class="panel-bd">
              <p class="lead">糖果测试通过具有迷惑性的题目，评估模型在复杂场景下的真实理解能力，帮助识别模型是否出现降智。</p>
              ${checks(["包含多种迷惑性题目类型", "覆盖逻辑推理、常识判断等场景", "支持多模型对比测试"])}
            </div>
          </article>
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("chart")} 测试概览</h3></div>
            <div class="panel-bd">
              <div class="overview">
                <div class="ov ov-blue"><b>${stats.total}</b><span>总任务数</span></div>
                <div class="ov ov-green"><b>${stats.done}</b><span>已完成</span></div>
                <div class="ov ov-orange"><b>${stats.running}</b><span>进行中</span></div>
              </div>
              <a class="btn btn-ghost btn-block mt16" href="records.html?kind=candy">${UI.icon("list")} 查看全部测试记录 →</a>
            </div>
          </article>
        </div>
      </section>`);
  },
  pelican() {
    ensureSelect("pel-model", defaultModelId());
    ensureSelect("pel-variant", "html2d");
    const variantName = (task) => (DATA.pelicanModes.find((item) => item.id === task.pelicanMode) || {}).name || "—";
    const rows = Store.tasks().filter((item) => item.kind === "pelican").sort(byTime).slice(0, 6).map((task) => `<tr>
      <td>${task.createdAt}</td>
      <td>${UI.esc(task.modelName)}</td>
      <td>${UI.esc(variantName(task))}</td>
      <td>${task.html ? "可预览" : (task.score == null ? "—" : "无作品")}</td>
      <td>${task.score == null ? UI.statusBadge(task.status) : `<span class="badge ${Engine.judge(task.score)}"><i></i>结构分 ${task.score}</span>`}</td>
      <td><div class="ops"><button class="btn btn-ghost btn-sm" type="button" data-action="open-task" data-id="${task.id}">${task.html ? "查看作品" : opLabel(task)}</button>${task.html ? `<button class="btn btn-ghost btn-sm" type="button" data-action="download-html" data-id="${task.id}">下载 HTML</button>` : ""}</div></td>
    </tr>`).join("") || `<tr><td colspan="6"><div class="empty">还没有鹈鹕骑车记录</div></td></tr>`;
    const back = `<a class="back-btn" href="index.html" aria-label="返回首页">${UI.icon("back")}</a>`;
    return UI.shell("pelican", `
      ${hero({ back, title: "鹈鹕骑车测试页", sub: "让模型写一只正在骑自行车的鹈鹕，测完直接看画面，并下载 HTML。", bar: true })}
      ${Store.tasks().some((item) => item.kind === "pelican" && item.status === "done") ? "" : entryInvite()}
      ${placeShare(latestReport((item) => item.kind === "pelican"), "分享最近一次鹈鹕骑车。有作品时，打开链接就能看到画面；海报二维码只放分数。链接里没有密钥。")}
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("doc")} 测试设置</h3></div>
          <div class="panel-bd">
            <div class="form-row" style="grid-template-columns: 1.4fr 1fr auto">
              ${UI.field("选择模型", UI.select("pel-model", Form.get("pel-model"), modelOptions()))}
              ${UI.field("作品类型", UI.select("pel-variant", Form.get("pel-variant"), DATA.pelicanModes.map((item) => ({ value: item.id, label: item.name }))))}
              <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="button" data-action="start-pelican">${UI.icon("play")} 开始测试</button></div>
            </div>
            ${apiHint()}
          </div>
        </article>
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("info")} 测试说明</h3></div>
          <div class="panel-bd">
            <p class="lead">这不是汽车问答题。它来自 Simon Willison 的鹈鹕骑车测试：让模型自己写出画面，看长嘴、喉囊、两个车轮和“骑在车上”是否成立。</p>
            ${checks(["经典 SVG：一句提示词，生成鹈鹕骑自行车的矢量图", "2D 动画 HTML：车轮会转的单文件页面", "3D 动画 HTML：用 Three.js 做一只会骑车的鹈鹕", "测完可以在页面里看，也可以下载 HTML"])}
            <a class="btn btn-ghost btn-block mt16" href="works.html">打开 HTML 作品列表</a>
          </div>
        </article>
      </section>
      <article class="panel mt16">
        <div class="panel-hd"><h3>${UI.icon("doc")} 测试记录</h3><span class="ops"><a class="more" href="works.html">HTML 作品列表 →</a><a class="more" href="records.html?kind=pelican">全部记录 →</a></span></div>
        <div class="table-wrap"><table class="grid">
            <thead><tr><th>测试时间</th><th>使用模型</th><th>作品类型</th><th>作品</th><th>代码结构分</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </article>`);
  },
  works() {
    const q = (qs().q || "").trim();
    const cat = qs().cat || "";
    const page = Math.max(1, Number(qs().page) || 1);
    const all = workCatalog();
    const categories = Array.from(new Set(all.map((item) => item.category).filter(Boolean)));
    const filtered = all.filter((item) => {
      const hay = (item.title + " " + item.description + " " + item.tags.join(" ")).toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (cat && item.category !== cat) return false;
      return true;
    });
    const size = 8;
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    const current = Math.min(page, pages);
    const slice = filtered.slice((current - 1) * size, current * size);
    const cards = slice.map((item, index) => workCard(item, index)).join("");
    const options = categories.map((name) => `<option value="${UI.esc(name)}" ${name === cat ? "selected" : ""}>${UI.esc(name)}</option>`).join("");
    const hrefFor = (i) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cat) params.set("cat", cat);
      if (i > 1) params.set("page", String(i));
      const text = params.toString();
      return "works.html" + (text ? "?" + text : "");
    };
    const empty = all.length
      ? `<div class="card"><div class="empty"><h3>没有匹配的作品</h3><p>换一个关键词或分类。</p></div></div>`
      : `<div class="card"><div class="empty"><h3>还没有 HTML 作品</h3><p>公开页面登记在 js/works.js。</p></div></div>`;
    return UI.shell("works", `
      ${UI.veridropBanner()}
      <div class="works-bar">
        <div class="works-intro">
          <span class="ico-box">${UI.icon("doc")}</span>
          <div>
            <h1>作品列表</h1>
            <p>公开 HTML 作品：静态 SVG、2D、3D 和在线小游戏。本站文件可下载，外部页面在原网站打开。大家看到的是同一份列表。</p>
          </div>
        </div>
        <form class="works-tools" method="get" action="works.html">
          <label class="search-wrap">${UI.icon("search")}<input class="search" type="search" name="q" value="${UI.esc(q)}" placeholder="搜索作品名称或描述..." aria-label="搜索作品"></label>
          <select class="select-native" name="cat" aria-label="全部分类" onchange="this.form.submit()">
            <option value="">全部分类</option>
            ${options}
          </select>
        </form>
      </div>
      ${cards ? `<section class="work-grid">${cards}</section>` : empty}
      <div class="works-pager">${pager(current, filtered.length ? pages : 0, hrefFor)}</div>`);
  },
  work() {
    const item = findWork(qs().id || "");
    if (!item) {
      return UI.shell("works", `<div class="page-head"><div class="crumb"><a href="works.html">作品列表</a> / 作品</div><h1>没有这个作品</h1><p>它可能还没登记。回到列表可以看现有的 HTML。</p><a class="btn btn-primary" href="works.html">返回作品列表</a></div>`);
    }
    const frame = workFrame(item);
    const download = item.file
      ? `<a class="btn btn-primary btn-sm" href="${UI.esc(item.file)}" download="${UI.esc(downloadName(item))}">${UI.icon("download")} 下载 HTML</a>`
      : item.url
      ? `<a class="btn btn-primary btn-sm" href="${UI.esc(item.url)}" target="_blank" rel="noreferrer">打开原页</a>`
      : `<button class="btn btn-primary btn-sm" type="button" data-action="download-html" data-id="${UI.esc(item.taskId)}">${UI.icon("download")} 下载 HTML</button>`;
    const tags = item.tags.map((tag) => `<span>${UI.esc(tag)}</span>`).join("");
    const notes = [];
    if (item.sourceUrl) notes.push(`来源：<a href="${UI.esc(item.sourceUrl)}" target="_blank" rel="noreferrer">${UI.esc(item.source || "原页面")}</a>`);
    if (item.license) notes.push("许可 " + UI.esc(item.license));
    notes.push(item.url ? "在线页面跑在对方网站上，读不到本站密钥" : "预览与本站密钥隔离");
    return UI.shell("works", `
      <div class="page-head">
        <div class="crumb"><a href="works.html">作品列表</a> / 在线查看</div>
        <h1>${UI.esc(item.title)}</h1>
        <p>${UI.esc(item.description)}</p>
      </div>
      <article class="panel">
        <div class="panel-hd">
          <h3>${UI.icon("car")} HTML 预览</h3>
          <div class="ops">${download}<a class="btn btn-ghost btn-sm" href="works.html">返回列表</a></div>
        </div>
        <div class="panel-bd">
          ${frame}
          <div class="work-tags mt16">${tags}</div>
          <p class="note mt16">${notes.join("。")}。</p>
        </div>
      </article>`);
  },
  login() {
    return UI.shell("", `
      <div class="page-head">
        <div class="crumb"><a href="index.html">首页</a> / 无需登录</div>
        <h1>不需要登录</h1>
        <p>大模型降智检测不需要注册账号。接口密钥和测试记录只留在当前浏览器。</p>
      </div>
      <a class="btn btn-primary" href="index.html">返回首页</a>`);
  },
  guide() {
    return UI.shell("", `
      <div class="page-head"><div class="crumb"><a href="index.html">首页</a> / 评测说明</div><h1>大模型评测说明</h1><p>评分规则、热门模型，以及降智检测的常见问题。</p></div>
      <section class="guide">
        <aside class="panel toc">
          <a href="#intro">平台做什么</a>
          <a href="#score">分数和降智判定</a>
          <a href="#detect">模型检测</a>
          <a href="#basic">基础测试</a>
          <a href="#candy">糖果测试</a>
          <a href="#pelican">鹈鹕骑车测试</a>
          <a href="#models">热门模型</a>
          <a href="#faq">常见问题</a>
          <a href="#tips">使用建议</a>
        </aside>
        <article class="panel article">
          <h2 id="intro">平台做什么</h2>
          <p>大模型降智检测把同一套题目发给 GPT、Claude、DeepSeek、Kimi、通义千问等模型，看能力、迷惑题和绘图有没有变差。检测、基础能力、糖果题、鹈鹕骑车和中转站检测的入口都在首页。</p>
          <p>新开的测试会把题目发给你填写的接口。${UI.siteIsLocal() ? "本机双击 <code>start.bat</code>，打开 <code>http://127.0.0.1:8766/index.html</code>。请求由这台电脑转发。" : "请求由当前网站转发。生成特别长、超过 300 秒时，线上这次函数会被平台停掉，那不是上游超时；需要一直等到上游返回，再用本机 start.bat。"}这样不会被浏览器跨域拦住。地址仍是 OpenAI 兼容根路径，模型 ID 放进 <code>model</code> 字段。网关名字不一样时，在接口设置里覆盖模型 ID。</p>
          <p>密钥只写在这台浏览器的本地存储里，不会放进导出的报告。</p>
          <p>打开页面时没有预置分数。只有接口返回并完成的测试才会记入记录，检测页才据此汇总。</p>
          <h2 id="score">分数和降智判定</h2>
          <p>单题只有对错。模块得分是百分制正确率，四舍五入。</p>
          <ul>
            <li>85 分及以上：正常 / 未降智</li>
            <li>70 到 84 分：轻微异常 / 轻微降智</li>
            <li>70 分以下：明显异常 / 明显降智</li>
          </ul>
          <p>模型检测页的综合分 = 基础测试 × 0.4 + 糖果测试 × 0.35 + 鹈鹕骑车 × 0.25。基础分要能力、逻辑、代码、问答四项都完成，而且这四项是同一个模型。再加上糖果和鹈鹕，六项最近一次也必须是这个模型，才写出综合分。缺一项，或者最近一次换成了另一个模型，综合分是「—」，不会记成 0 分，也不会把两个模型的名字拼在一起。「重新检测」只按已有记录重算，没有记录时不会访问模型，也不会编造分数。</p>
          <p>鹈鹕骑车的正确率再拆一层：综合正确率 = 题目正确率 × 90% + 稳定性 × 10%。稳定性看各轮正确率是否接近，波动越大扣得越多。</p>
          <h2 id="detect">模型检测</h2>
          <p>检测页汇总基础、糖果、鹈鹕三类结果。右侧选定模型后点「一次测完」，会按顺序跑能力、逻辑、代码、问答、糖果和一幅 2D 鹈鹕骑车，难度都是中等。基础四项共用一个题量，糖果单独选，都可以选 3、5、10、20 或 30 题，默认都是 3 题。一项结束后自动开始下一项，全部测完回到这一页。四项基础、糖果、鹈鹕都完成且是同一个模型之后，「模型检测」卡上的分数就是上面的综合分。</p>
          <h2 id="basic">基础测试</h2>
          <p>基础测试仍包含四项模型能力题：</p>
          <ul>
            <li>模型能力：阅读理解、指令遵循、摘要是否加戏、类比和排除。</li>
            <li>逻辑推理：三段论、真假条件、数列、抽屉原理和约束题。</li>
            <li>代码能力：阅读 JavaScript 片段、判断输出、指出循环边界错误。</li>
            <li>知识问答：稳定的科学和常识事实，外加一道必须拒绝编造的问题。</li>
          </ul>
          <p>任务列表里，已完成可以看报告，进行中可以接着看进度，未开始会按原定模型开跑。报告按维度给条形分，题目可以展开看模型选项和解析。</p>
          <p>中转站测试在基础测试页的第一个入口，点进去单独测。它看的是中转有没有偷换模型、吞掉系统指令、丢掉上下文、假流式或不给用量。测完给出诚信分和掺水报告。不支持某项能力会单独标明，不算偷偷掺水。这一项不代替上面的模型能力分。</p>
          <h2 id="candy">糖果测试</h2>
          <p>糖果测试专门放「看起来像某道熟题，但数字或人名被换过」的题目。默认中等、20 题。代表性的一题是黑袋糖果：</p>
          <p>苹果圆形 7、五角星 7，桃子圆形 9、五角星 6，西瓜圆形 8、五角星 4。要保证拿到「圆形苹果 + 五角星桃子」或「五角星苹果 + 圆形桃子」。</p>
          <p>形状能靠手感分开，可以按形状拿 9 颗圆形和 12 颗五角星，一共 21 颗。圆形里西瓜只有 8 颗，9 颗圆形里一定有苹果或桃子。12 颗五角星里一定同时有五角星苹果和五角星桃子。圆形那边是苹果就配五角星桃子，是桃子就配五角星苹果。不许挑形状时要 29 颗；这道题能分辨形状，答案是 21。</p>
          <p>多条已完成记录可以在全部记录里勾选，做最多 4 个模型的对比。</p>
          <h2 id="pelican">鹈鹕骑车</h2>
          <p>这道题不是问汽车。2024 年 10 月 Simon Willison 用同一句提示词比较模型：Generate an SVG of a pelican riding a bicycle。中文社区后来把它收成「生成一只正在骑自行车的鹈鹕」，以及「创建一个 HTML，用 SVG 画鹈鹕骑自行车的 2D 动画」。降智时，常见情况是鹈鹕和车拆开、轮子不圆、长嘴消失，或者页面打不开。</p>
          <p>测完后页面里直接预览模型写出的 HTML，也可以下载这个文件到本地打开。结构分只看代码里有没有 SVG、车轮和动画，真正判断还是看画面。</p>
          <h2 id="models">支持评测的热门模型</h2>
          <p>下面这些是搜索和调用都比较常见的模型。接口兼容 OpenAI 的写法时，在接口设置里填写地址和密钥，再选对应的模型 ID。</p>
          <h3 id="gpt">GPT 评测</h3>
          <p>GPT 是 OpenAI 的系列模型。可以用同一套能力题、迷惑题和鹈鹕骑车，对照不同 GPT 版本有没有降智。</p>
          <h3 id="claude">Claude 评测</h3>
          <p>Claude 是 Anthropic 的系列模型。除了能力分，也可以用中转站检测看系统提示和长指令有没有被丢掉。</p>
          <h3 id="deepseek">DeepSeek 评测</h3>
          <p>DeepSeek 是深度求索的对话和推理模型，适合对照中文题目、代码题和绘图结果。</p>
          <h3 id="kimi">Kimi 评测</h3>
          <p>Kimi 是月之暗面的模型，适合看长题干下的回答是否稳定，以及上下文有没有被截断。</p>
          <h3 id="qwen">通义千问评测</h3>
          <p>通义千问是阿里的 Qwen 系列。只要接口兼容 OpenAI 的写法，就可以选对应模型 ID 做评测。</p>
          <h3 id="doubao">豆包评测</h3>
          <p>豆包是字节的大模型。可以和 GPT、DeepSeek 用同一套题做模型对比。</p>
          <h3 id="gemini">Gemini 评测</h3>
          <p>Gemini 是 Google 的系列模型，适合放进同一套降智检测里做横向对比。</p>
          <h3 id="grok">Grok 评测</h3>
          <p>Grok 是 xAI 的系列模型。接口兼容时可以直接选择模型 ID，跑能力、迷惑题和绘图测试。</p>
          <h2 id="faq">常见问题</h2>
          <h3>大模型降智检测是做什么的？</h3>
          <p>把同一套题目发给 GPT、Claude、DeepSeek、Kimi、通义千问等模型，看能力、迷惑题和绘图有没有变差。检测页只汇总已经完成的真实测试，没有配置接口、也没有完成记录时，不会显示降智结论。</p>
          <h3>综合分怎么计算？</h3>
          <p>基础测试占 40%，糖果测试占 35%，鹈鹕骑车占 25%。基础分要能力、逻辑、代码、问答四项都完成，而且和糖果、鹈鹕是同一个模型，才计算综合分。少一项，或者最近一次换成了另一个模型，综合分显示未检测，不会当成 0 分。</p>
          <h3>中转站检测和能力测试是一回事吗？</h3>
          <p>不是一回事。中转站检测看接口有没有偷换模型、丢掉系统提示、截断上下文、假流式或不返回用量。不支持某项会标明不支持，不直接算作掺水。它不代替模型能力分。</p>
          <h3>鹈鹕骑车测的是汽车问答吗？</h3>
          <p>不是。它让模型写出一只鹈鹕骑自行车的 SVG 或 HTML，并在页面里预览和下载，用来看绘图是否稳定。</p>
          <h3>接口密钥会上传吗？</h3>
          <p>不会。接口地址和密钥只保存在当前浏览器，导出的报告不含密钥。</p>
          <h2 id="tips">使用建议</h2>
          ${checks(["建议在不同场景下多次测试，获取更准确的结果", "关注模型在复杂问题下的表现", "结合多个测试维度进行综合判断"])}
          <p>同一模型在简单档和困难档的分数不会一样。困难档会压低画像里的正确率，用来观察抗干扰。基础测试建议优先跑当前常用的模型版本。</p>
        </article>
      </section>`);
  },
  cooperate() {
    const arrow = UI.icon("arrow");
    const row = (icon, label, value, action) => `<li class="coop-row">
      <span class="coop-ico">${UI.icon(icon)}</span>
      <span class="coop-id"><small>${label}</small><strong>${value}</strong></span>
      ${action}
    </li>`;
    return UI.shell("", `
      <div class="coop">
        <section class="coop-hero">
          <div class="coop-intro">
            <p class="coop-kicker"><i></i>合作与联系</p>
            <h1>商务合作</h1>
            <p>广告投放、内容合作、中转站收录，以及其他与大模型服务相关的合作。请通过以下任一方式联系我们，并附上品牌或站点名称、合作方向和相关链接。</p>
          </div>
          <div class="coop-stage">
            <aside class="coop-card" aria-label="联系方式">
              <div class="coop-card-hd">
                <h2>联系<br>方式</h2>
                <span>任选一种即可</span>
              </div>
              <ul>
                ${row("mail", "邮箱", "2201219073@qq.com", `<a class="btn btn-primary btn-pill btn-sm" href="mailto:2201219073@qq.com">发邮件 ${arrow}</a>`)}
                ${row("chat", "QQ", "2201219073", `<button type="button" class="btn btn-quiet btn-pill btn-sm" data-action="copy-text" data-copy="2201219073">复制</button>`)}
                ${row("send", "Telegram", "@asAnnie1", `<a class="btn btn-primary btn-pill btn-sm" href="https://t.me/asAnnie1" target="_blank" rel="noopener noreferrer">打开 ${arrow}</a>`)}
              </ul>
            </aside>
          </div>
        </section>
        <section class="coop-ways" aria-labelledby="coop-ways-title">
          <h2 id="coop-ways-title">可以怎么合作</h2>
          <div class="coop-board">
            <p class="coop-side">合作方式</p>
            <ol>
              <li><span>01 / 03</span><strong>广告投放</strong><p>面向正在比较中转站、模型和 API 服务的用户进行品牌展示。广告内容会标明赞助。</p></li>
              <li><span>02 / 03</span><strong>站点收录</strong><p>提交你的中转站，补充模型、价格和支付方式。收录不收取影响排名的费用。</p></li>
              <li><span>03 / 03</span><strong>数据与内容</strong><p>方法说明、榜单摘录和模型监测，适合写进文档或社区帖。请保留出处。</p></li>
            </ol>
          </div>
        </section>
      </div>`);
  },
  tasks() {
    const query = qs();
    const kind = query.kind || "";
    const status = query.status || "";
    const q = (query.q || "").trim();
    const page = Math.max(1, Number(query.page) || 1);
    let list = Store.tasks().filter((item) => Engine.moduleOf(item.kind) === "basic");
    if (kind) list = list.filter((item) => item.kind === kind);
    if (status) list = list.filter((item) => item.status === status);
    if (q) list = list.filter((item) => (item.name + item.modelName).toLowerCase().includes(q.toLowerCase()));
    list.sort(byTime);
    const size = 8;
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(page, pages);
    const slice = list.slice((current - 1) * size, current * size);
    const rows = slice.map((task) => `<tr>
      <td><input type="checkbox" data-compare value="${task.id}" ${task.status === "done" ? "" : "disabled"}></td>
      <td><div class="td-title"><span class="ico-box sm">${UI.icon(kindIcon(task.kind))}</span>${UI.esc(task.name)}</div></td>
      <td>${DATA.kinds[task.kind].typeName}</td>
      <td>${UI.modelChip(task.modelId, task.modelName)}</td>
      <td>${UI.diffLabel(task.difficulty)}</td>
      <td>${task.count} 题</td>
      <td>${UI.statusBadge(task.status)}</td>
      <td>${task.score == null ? "—" : task.score}</td>
      <td>${task.createdAt}</td>
      <td><button class="linkish" type="button" data-action="open-task" data-id="${task.id}">${opLabel(task)}</button></td>
    </tr>`).join("");
    const hrefFor = (i) => `tasks.html?${new URLSearchParams({ kind, status, q, page: String(i) })}`;
    return UI.shell("basic", `
      <div class="page-head"><div class="crumb"><a href="basic.html">基础测试页</a> / 全部任务</div><h1>全部任务</h1><p>筛选基础测试记录。勾选同一种测试里 2 到 4 条已完成记录，可以对照各自错了哪几题。</p></div>
      <article class="panel">
        <form class="filters" style="padding:16px 16px 0" method="get" action="tasks.html">
          <input class="search" name="q" value="${UI.esc(q)}" placeholder="搜索任务或模型">
          <select class="select-native" name="kind">
            <option value="">全部类型</option>
            ${["ability", "logic", "code", "qa"].map((key) => `<option value="${key}" ${kind === key ? "selected" : ""}>${DATA.kinds[key].typeName}</option>`).join("")}
          </select>
          <select class="select-native" name="status">
            <option value="">全部状态</option>
            ${[["done", "已完成"], ["running", "进行中"], ["pending", "未开始"], ["stopped", "已终止"]].map(([key, label]) => `<option value="${key}" ${status === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm" type="submit">筛选</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="compare-go" data-kind="${UI.esc(kind || "ability")}">对比所选</button>
          <a class="btn btn-ghost btn-sm" href="setup.html?type=ability">新建测试</a>
        </form>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th></th><th>任务名称</th><th>类型</th><th>模型</th><th>难度</th><th>题量</th><th>状态</th><th>得分</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="10"><div class="empty"><h3>没有匹配的任务</h3><p>换一个筛选条件，或新建一次基础测试。</p></div></td></tr>`}</tbody>
        </table></div>
        ${pager(current, pages, hrefFor)}
      </article>`);
  },
  records() {
    const query = qs();
    const kind = query.kind === "pelican" ? "pelican" : "candy";
    const status = query.status || "";
    const q = (query.q || "").trim();
    const page = Math.max(1, Number(query.page) || 1);
    let list = Store.tasks().filter((item) => item.kind === kind);
    if (status) list = list.filter((item) => item.status === status);
    if (q) list = list.filter((item) => (item.name + item.modelName).toLowerCase().includes(q.toLowerCase()));
    list.sort(byTime);
    const size = 8;
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(page, pages);
    const slice = list.slice((current - 1) * size, current * size);
    const rows = slice.map((task) => kind === "candy"
      ? `<tr>
          <td><input type="checkbox" data-compare value="${task.id}" ${task.status === "done" ? "" : "disabled"}></td>
          <td>${UI.esc(task.name)}</td>
          <td>${UI.modelChip(task.modelId, task.modelName)}</td>
          <td>${task.count}</td>
          <td>${UI.diffLabel(task.difficulty)}</td>
          <td>${task.createdAt}</td>
          <td>${task.score == null ? "—" : task.score}</td>
          <td>${UI.statusBadge(task.status)}</td>
          <td><div class="ops"><button class="linkish" type="button" data-action="open-task" data-id="${task.id}">${opLabel(task)}</button><button class="linkish" type="button" data-action="more" data-id="${task.id}" aria-label="更多">${UI.icon("more")}</button></div></td>
        </tr>`
      : `<tr>
          <td><input type="checkbox" data-compare value="${task.id}" ${task.status === "done" ? "" : "disabled"}></td>
          <td>${task.createdAt}</td>
          <td>${UI.esc(task.modelName)}</td>
          <td>${task.pelicanMode ? UI.esc((DATA.pelicanModes.find((item) => item.id === task.pelicanMode) || {}).name || task.pelicanMode) : (task.rounds || Math.round((task.count || 0) / 4)) + " 轮"}</td>
          <td>${task.score == null ? "—" : task.score + "%"}</td>
          <td>${task.score == null ? UI.statusBadge(task.status) : UI.levelBadge(task.score, "pelican")}</td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-action="open-task" data-id="${task.id}">${opLabel(task)}</button></td>
        </tr>`).join("");
    const head = kind === "candy"
      ? "<th></th><th>任务名称</th><th>模型</th><th>题量</th><th>难度</th><th>时间</th><th>得分</th><th>状态</th><th>操作</th>"
      : "<th></th><th>测试时间</th><th>使用模型</th><th>作品类型</th><th>结构分</th><th>是否降智</th><th>操作</th>";
    const back = kind === "candy" ? "candy.html" : "pelican.html";
    const hrefFor = (i) => `records.html?${new URLSearchParams({ kind, status, q, page: String(i) })}`;
    return UI.shell(kind, `
      <div class="page-head"><div class="crumb"><a href="${back}">${kind === "candy" ? "糖果测试页" : "鹈鹕骑车测试页"}</a> / 全部记录</div><h1>${kind === "candy" ? "全部糖果测试记录" : "全部鹈鹕骑车记录"}</h1><p>勾选 2 到 4 条已完成记录，可以对照各自错了哪几题。</p></div>
      <article class="panel">
        <form class="filters" style="padding:16px 16px 0" method="get" action="records.html">
          <input type="hidden" name="kind" value="${kind}">
          <input class="search" name="q" value="${UI.esc(q)}" placeholder="搜索任务或模型">
          <select class="select-native" name="status">
            <option value="">全部状态</option>
            ${[["done", "已完成"], ["running", "进行中"], ["stopped", "已终止"]].map(([key, label]) => `<option value="${key}" ${status === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm" type="submit">筛选</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="compare-go" data-kind="${kind}">对比所选</button>
        </form>
        <div class="table-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="9"><div class="empty"><h3>没有记录</h3></div></td></tr>`}</tbody></table></div>
        ${pager(current, pages, hrefFor)}
      </article>`);
  },
  setup() {
    const type = qs().type;
    const meta = DATA.kinds[type];
    if (!meta || meta.group !== "basic") {
      return UI.shell("basic", `<div class="empty"><h3>没有这个测试类型</h3><a href="basic.html">返回基础测试</a></div>`);
    }
    ensureSelect("setup-model", defaultModelId());
    ensureSelect("setup-count", "10");
    ensureSelect("setup-diff", "medium");
    const pending = qs().task;
    return UI.shell("basic", `
      <div class="page-head">
        <div class="crumb"><a href="basic.html">基础测试页</a> / ${meta.label}</div>
        <h1>${meta.label}</h1>
        <p>${meta.desc}</p>
      </div>
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon(kindIcon(type))} 测试设置</h3></div>
          <div class="panel-bd">
            <p class="lead">${pending ? "将开始列表中的未开始任务。" : "选择模型、题量和难度。开始后可以在进度页看到逐题作答。"}</p>
            <p class="note">${diffStock(type)}</p>
            <div class="form-row">
              ${UI.field("选择模型", UI.select("setup-model", Form.get("setup-model"), modelOptions()))}
              ${UI.field("测试题目数量", UI.select("setup-count", Form.get("setup-count"), QUESTION_COUNTS))}
              ${UI.field("难度等级", UI.select("setup-diff", Form.get("setup-diff"), [{ value: "easy", label: "简单" }, { value: "medium", label: "中等" }, { value: "hard", label: "困难" }]))}
              <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="button" data-action="start-setup" data-type="${type}" data-id="${UI.esc(pending || "")}">${UI.icon("play")} 开始测试</button></div>
            </div>
            ${apiHint()}
          </div>
        </article>
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("info")} 这一项看什么</h3></div>
          <div class="panel-bd">${checks(["报告按维度拆开，而不只给一个总分", "答错的题可以展开看标准答案和解析", "中途离开后，可以从任务列表接着看进度"])}</div>
        </article>
      </section>`);
  },
  run() {
    const task = Store.task(qs().id || "");
    if (!task) return UI.shell("", `<div class="empty"><h3>找不到这场测试</h3><a href="index.html">回首页</a></div>`);
    const parent = task.suiteId ? "detect.html" : (Engine.moduleOf(task.kind) === "basic" ? "basic.html" : task.kind + ".html");
    const parentName = task.suiteId ? "模型检测页" : (Engine.moduleOf(task.kind) === "basic" ? "基础测试页" : DATA.kinds[task.kind].label + "页");
    const active = task.suiteId ? "detect" : Engine.moduleOf(task.kind);
    const amount = task.pelicanMode ? "生成 1 幅 HTML" : `共 ${task.items.length} 题`;
    const suiteLine = task.suiteTotal ? `<p class="note">第 ${task.suiteStep} / ${task.suiteTotal} 项。这一项结束后自动开始下一项，全部测完回到模型检测页。</p>` : "";
    return UI.shell(active, `
      <div class="page-head">
        <div class="crumb"><a href="${parent}">${parentName}</a> / ${task.suiteTotal ? "第 " + task.suiteStep + " 项" : "测试进行中"}</div>
        <h1>${UI.esc(task.name)}</h1>
        <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.diffLabel(task.difficulty)} · ${amount}</p>
        ${suiteLine}
        <div class="progress"><span id="run-bar" style="width:0"></span></div>
        <div id="run-meta" style="color:#8b97ad;font-size:13px"></div>
      </div>
      <section class="run-layout">
        <article class="panel"><div class="panel-bd" id="stage"></div>
          <div class="panel-bd" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" type="button" data-action="pause-run" id="pause-btn">暂停</button>
            <button class="btn btn-primary btn-sm" type="button" data-action="finish-now" data-id="${task.id}">${task.suiteId ? "做完这一项并继续" : "直接完成并出报告"}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="stop-run" data-id="${task.id}">终止测试</button>
          </div>
        </article>
        <div class="stack">
          <article class="panel side-card"><div class="panel-hd"><h3>${UI.icon("chart")} 当前统计</h3></div><div class="panel-bd" id="live-side"></div></article>
          ${task.pelicanMode ? `<article class="panel"><div class="panel-hd"><h3>${UI.icon("car")} 提示词</h3></div><div class="panel-bd"><p class="lead">${UI.esc((DATA.pelicanModes.find((item) => item.id === task.pelicanMode) || {}).prompt || "")}</p></div></article>` : ""}
        </div>
      </section>`);
  },
  result() {
    const sharedTask = typeof Poster === "undefined" ? null : Poster.fromLocation();
    if (sharedTask && sharedTask.kind === "task" && !qs().id) return sharedTaskPage(sharedTask);
    const task = Store.task(qs().id || "");
    if (!task) return UI.shell("", `<div class="empty"><h3>找不到这份报告</h3><a href="index.html">回首页</a></div>`);
    if (task.status === "running") {
      location.href = "run.html?id=" + encodeURIComponent(task.id);
      return UI.shell("", `<div class="empty"><h3>测试还在进行</h3></div>`);
    }
    if (task.pelicanMode || task.html) return artworkResult(task);
    const active = Engine.moduleOf(task.kind);
    const parent = active === "basic" ? "basic.html" : task.kind + ".html";
    const info = Engine.judgeText(task.score, task.kind === "pelican" ? "pelican" : "detect");
    const items = task.items || [];
    const shown = items.filter((item) => App.show === "all" || (App.show === "right" ? item.correct : !item.correct));
    const list = shown.map((item, index) => questionBlock(item, items.indexOf(item), !item.correct && App.show !== "right")).join("");
    const stability = task.kind === "pelican" ? `<div class="stat"><div class="k">稳定性</div><div class="v">${task.stability}</div></div>` : "";
    const taskReport = typeof Poster === "undefined" ? null : Poster.fromTask(task);
    const taskShare = shareHead(taskReport);
    return UI.shell(active, `
      <div class="${taskShare[0]}" data-share>
        <div>
          <div class="crumb"><a href="${parent}">返回列表</a> / 测试报告</div>
          <h1>${UI.esc(task.name)}</h1>
          <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.diffLabel(task.difficulty)} · ${task.finishedAt || task.createdAt}</p>
        </div>
        ${taskShare[1]}
      </div>
      <section class="stat-row">
        <div class="stat" style="display:flex;justify-content:center">${UI.ring(task.score)}</div>
        <div class="stat"><div class="k">判定</div><div class="v">${UI.levelBadge(task.score, task.kind === "pelican" ? "pelican" : "detect")}</div></div>
        <div class="stat"><div class="k">答对</div><div class="v">${Engine.correctCount(items)} / ${items.length}</div></div>
        <div class="stat"><div class="k">题目正确率</div><div class="v">${items.length ? Math.round(100 * Engine.correctCount(items) / items.length) : 0}%</div></div>
        ${stability}
      </section>
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("list")} 题目明细</h3>
            <div class="chips">
              <button type="button" class="chip ${App.show === "all" ? "active" : ""}" data-action="filter-q" data-show="all">全部</button>
              <button type="button" class="chip ${App.show === "wrong" ? "active" : ""}" data-action="filter-q" data-show="wrong">只看答错</button>
              <button type="button" class="chip ${App.show === "right" ? "active" : ""}" data-action="filter-q" data-show="right">只看答对</button>
            </div>
          </div>
          ${wrongSummary(items)}
          <div id="q-list">${list || `<div class="empty">这一组里没有题目</div>`}</div>
        </article>
        <div class="stack">
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("chart")} 维度得分</h3></div>
            <div class="panel-bd bars" id="bars">${dimensionBars(items)}</div>
          </article>
          <article class="panel">
            <div class="panel-bd">
              <p class="lead">${UI.esc(info.desc)}</p>
              ${task.kind === "pelican" ? `<p class="note">综合正确率 = 题目正确率 × 90% + 稳定性 × 10%。</p>` : ""}
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                <button class="btn btn-primary btn-sm" type="button" data-action="rerun" data-id="${task.id}">再测一次</button>
                <button class="btn btn-ghost btn-sm" type="button" data-action="export" data-id="${task.id}">导出 JSON</button>
              </div>
            </div>
          </article>
          ${task.kind === "pelican" ? `<article class="panel"><div class="panel-hd"><h3>资料卡</h3></div><div class="panel-bd">${specTable()}</div></article>` : ""}
        </div>
      </section>`);
  },
  compare() {
    const query = qs();
    const ids = (query.ids || "").split(",").filter(Boolean).slice(0, 4);
    const tasks = ids.map((id) => Store.task(id)).filter((task) => task && task.status === "done");
    const kind = tasks[0] ? tasks[0].kind : (query.kind || "candy");
    const active = Engine.moduleOf(kind);
    const back = active === "basic" ? `tasks.html?kind=${encodeURIComponent(kind)}` : `records.html?kind=${kind === "pelican" ? "pelican" : "candy"}`;
    const max = 100;
    const cols = tasks.map((task) => `<div class="col"><i style="height:${Math.max(8, (task.score || 0) / max * 120)}px"></i><span>${UI.esc(task.modelName)}<br>${task.score == null ? "—" : task.score}</span></div>`).join("");
    const rows = tasks.map((task) => `<tr><td>${UI.esc(task.name)}</td><td>${UI.esc(task.modelName)}</td><td>${task.score == null ? "—" : task.score}</td><td>${UI.levelBadge(task.score, kind === "pelican" ? "pelican" : "detect")}</td><td>${UI.diffLabel(task.difficulty)}</td><td><a href="result.html?id=${task.id}">查看报告</a></td></tr>`).join("");
    const pelicanNote = tasks.some((task) => task.pelicanMode) ? `<p class="note">鹈鹕骑车比的是生成出来的画面。下面的表只对照记录里的题目，画面要打开各自的报告看。</p>` : "";
    return UI.shell(active, `
      <div class="page-head"><div class="crumb"><a href="${back}">全部记录</a> / 对比</div><h1>模型对比</h1><p>同一道题并排列出谁答对、谁答错。结果不一致的排在前面。</p></div>
      <article class="panel"><div class="hbar">${cols || ""}</div>
        <div class="table-wrap"><table class="grid"><thead><tr><th>记录</th><th>模型</th><th>得分</th><th>判定</th><th>难度</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="empty">没有可对比的已完成记录</div></td></tr>`}</tbody></table></div>
        ${pelicanNote}
        ${tasks.length ? compareTable(tasks) : ""}
      </article>`);
  },
  prompts() {
    const query = qs();
    return UI.shell("prompts", `
      <section class="prompt-hero">
        <div>
          <h1>测试模型质量的提示词</h1>
          <p class="sub">从多维度设计提示词，全面评估大模型在理解、生成、推理等方面的表现。</p>
          <div class="accent"></div>
        </div>
        ${UI.veridropCard()}
      </section>
      <div class="prompt-layout">
        ${promptSide()}
        <div class="prompt-main">
          <label class="prompt-search">${UI.icon("search")}<input id="prompt-q" type="search" value="${UI.esc(query.q || "")}" placeholder="搜索提示词..." aria-label="搜索提示词"></label>
          <div id="prompt-board">${promptBoard()}</div>
        </div>
        ${promptHot()}
      </div>`);
  },
  examples() { return Examples.page(); },
  trace() {
    ensureSelect("trace-model", defaultModelId());
    const sharedTrace = typeof Poster === "undefined" ? null : Poster.fromLocation();
    const remembered = typeof Trace === "undefined" ? null : Trace.remembered();
    const opened = sharedTrace && sharedTrace.kind === "trace" ? sharedTrace : null;
    const report = opened || (remembered && typeof Poster !== "undefined" ? Poster.fromTrace(remembered) : null);
    if (report) Poster.live = report;
    const shown = opened ? opened.view : remembered;
    const manualMode = qs().mode === "manual";
    return UI.shell("trace", `
      ${UI.veridropBanner()}
      <div class="page-head relay-head" data-share>
        <div>
          <div class="crumb"><a href="index.html">首页</a> / 指纹检测</div>
          <h1>模型指纹检测</h1>
          <p>用三道数字题比较回答的行为特征。可用自己的 API 自动检测，也可复制题目，在自己的客户端作答后粘贴回来。结果在这台浏览器里对照指纹库。</p>
        </div>
        ${report ? Poster.buttons() : ""}
      </div>
      <div class="trace-modes" role="group" aria-label="选择检测方式"><button class="${manualMode ? "" : "active"}" type="button" data-action="trace-mode" data-mode="api" aria-pressed="${!manualMode}"><strong>API 自动检测</strong><span>使用已配置的接口和密钥</span></button><button class="${manualMode ? "active" : ""}" type="button" data-action="trace-mode" data-mode="manual" aria-pressed="${manualMode}"><strong>手动检测 · 免填密钥</strong><span>复制题目，粘贴模型回答</span></button></div>
      <article class="panel" id="trace-api" ${manualMode ? "hidden" : ""}>
        <div class="panel-bd">
          <div class="form-row" style="grid-template-columns: 1.4fr auto">
            ${UI.field("选择模型", UI.select("trace-model", Form.get("trace-model"), modelOptions()))}
            <div class="field"><span>&nbsp;</span><button class="btn btn-primary" type="button" data-action="start-trace">${UI.icon("play")} 开始检测</button></div>
          </div>
          ${apiHint()}
          <p class="note">指纹库目前有 19 个模型，分别是 GPT-5.4、GPT-5.5、GPT-5.6 的 luna / terra / sol、GPT-6 的 astra / sol / luna、GPT-6.1 Sol，以及 Claude Haiku、Sonnet、Opus 的一批版本。库外模型也会被归到最像的一项。请求不额外设置温度，也不加系统提示词。</p>
        </div>
      </article>
      <article class="panel" id="trace-manual" ${manualMode ? "" : "hidden"}>${Trace.manualHtml()}</article>
      <div id="trace-live" aria-live="polite"></div>
      <div id="trace-result">${shown && typeof Trace !== "undefined" ? Trace.resultHtml(shown) : ""}</div>`);
  },
  mount: {
    relays() { RelayDirectory.mountArtworkPreviews(); },
    examples() { Examples.mount(); },
    home() { if (typeof Official !== "undefined") Official.load(false); },
    relay() {
      if (location.hash.indexOf("preview=1") < 0 || typeof Poster === "undefined") return;
      const report = Poster.current();
      if (report) Poster.open(report);
    },
    detect() {
      if (location.hash.indexOf("preview=1") >= 0 && typeof Poster !== "undefined" && Poster.live && Poster.live.kind === "detect") Poster.open(Poster.live);
      if (qs().suite !== "done" || App.suiteNoted) return;
      App.suiteNoted = true;
      const score = Store.get().snapshot.score;
      UI.toast(score == null ? "这套测试已结束，还有项目没有分数，综合分先留空" : "六项都测完了，综合得分 " + score);
      history.replaceState(null, "", "detect.html");
    },
    status() { if (typeof Official !== "undefined") Official.load(false); },
    works() { paintWorkFrames(); },
    trace() {
      if (typeof Trace !== "undefined") Trace.loadBank().catch(() => {});
      Trace.bindManual();
      if (location.hash.indexOf("preview=1") >= 0 && typeof Poster !== "undefined" && Poster.live && Poster.live.kind === "trace") Poster.open(Poster.live);
    },
    prompts() {
      const input = document.getElementById("prompt-q");
      if (!input) return;
      input.addEventListener("input", () => {
        setPromptQuery({ q: input.value });
        const board = document.getElementById("prompt-board");
        if (board) board.innerHTML = promptBoard();
      });
    },
    work() { paintWorkFrames(); },
    guide() {
      const id = location.hash;
      if (id) document.querySelector(id)?.scrollIntoView();
    },
    result() {
      if (location.hash.indexOf("preview=1") >= 0 && typeof Poster !== "undefined" && Poster.live && Poster.live.kind === "task") Poster.open(Poster.live);
      const task = Store.task(qs().id || "");
      const frame = document.getElementById("art-frame");
      const html = (task && task.html) || (typeof Poster !== "undefined" && Poster.live && Poster.live.html) || "";
      if (!html || !frame) return;
      frame.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    },
    login() {
      const submit = () => Actions["login-submit"]();
      document.getElementById("password")?.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
      document.getElementById("account")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); document.getElementById("password").focus(); }
      });
    },
    run() {
      const id = qs().id;
      const task = Store.task(id);
      if (!task) return;
      if (task.status === "done") { location.href = "result.html?id=" + encodeURIComponent(id); return; }
      if (task.status === "pending") {
        if (!ensureApi()) return;
        Store.startPending(id);
      }
      const token = App.runToken;
      const paint = () => {
        if (App.runToken !== token) return;
        const current = Store.task(id);
        const stage = document.getElementById("stage");
        if (!current || !stage) return;
        stage.innerHTML = stageHtml(current);
        const live = revealedCorrect(current);
        const side = document.getElementById("live-side");
        if (side) {
          side.innerHTML = `<div class="kv"><span>已揭示</span><b>${live.n} / ${current.items.length}</b></div>
            <div class="kv"><span>当前答对</span><b>${live.ok}</b></div>
            <div class="kv"><span>状态</span><b>${App.runError ? "等待重试" : App.paused ? "已暂停" : "进行中"}</b></div>`;
        }
        const bar = document.getElementById("run-bar");
        const meta = document.getElementById("run-meta");
        const shown = App.phase === "show" ? current.cursor + 1 : current.cursor;
        if (bar) bar.style.width = (current.items.length ? shown / current.items.length * 100 : 0) + "%";
        if (meta) meta.textContent = `进度 ${shown} / ${current.items.length}`;
      };
      const finishLive = () => {
        const finished = Store.finish(id);
        paint();
        if (suiteFollow(finished)) return;
        UI.toast("测试完成，正在打开报告");
        setTimeout(() => {
          if (App.runToken === token) location.href = "result.html?id=" + encodeURIComponent(id);
        }, 600);
      };
      const liveLoop = async () => {
        if (App.runToken !== token || App.busy) return;
        const current = Store.task(id);
        if (!current || current.status !== "running") return;
        if (current.pelicanMode && !current.html) {
          if (App.paused) return;
          const mode = DATA.pelicanModes.find((item) => item.id === current.pelicanMode) || DATA.pelicanModes[1];
          App.phase = "think";
          App.runError = "";
          App.busy = true;
          paint();
          try {
            const cfg = Store.api();
            const content = await Api.complete({
              baseUrl: cfg.baseUrl,
              apiKey: cfg.apiKey,
              model: current.requestedModel || cfg.modelOverride || current.modelId,
              system: mode.system,
              user: mode.prompt,
              long: true
            });
            if (App.runToken !== token) return;
            current.reply = content;
            current.html = Api.extractArtwork(content);
            current.score = Api.scoreArtwork(current.html);
            current.cursor = 1;
            current.items = [{
              stem: mode.prompt,
              options: ["已生成作品"],
              answer: 0,
              choice: current.html ? 0 : null,
              correct: Boolean(current.html),
              reply: content,
              explain: current.html ? "已从模型回复里取出可预览的 HTML。" : "回复里没有找到完整的 HTML 或 SVG。",
              dimension: "generate",
              difficulty: "medium"
            }];
            Store.save();
            App.busy = false;
            if (!current.html) {
              App.paused = true;
              App.runError = "模型有回复，但没有找出可展示的 HTML 或 SVG。可以在报告里看原文。";
              Store.finish(id);
              location.href = "result.html?id=" + encodeURIComponent(id);
              return;
            }
            const finished = Store.finish(id);
            if (!suiteFollow(finished)) location.href = "result.html?id=" + encodeURIComponent(id);
          } catch (err) {
            if (App.runToken !== token) return;
            App.busy = false;
            App.paused = true;
            App.runError = err.message || "请求失败";
            paint();
          }
          return;
        }
        if (current.cursor >= current.items.length) { finishLive(); return; }
        if (App.paused) return;
        const item = current.items[current.cursor];
        if (item.reply) {
          const next = current.cursor + 1;
          Store.saveCursor(id, next);
          if (next >= current.items.length) finishLive();
          else liveLoop();
          return;
        }
        App.phase = "think";
        App.runError = "";
        App.busy = true;
        paint();
        try {
          const result = await Api.ask(item, current.requestedModel || current.modelId);
          if (App.runToken !== token) return;
          item.reply = result.content;
          item.choice = result.choice;
          item.correct = result.choice === item.answer;
          Store.save();
          App.phase = "show";
          App.busy = false;
          paint();
          if (!App.rush) await new Promise((resolve) => setTimeout(resolve, 700));
          if (App.runToken !== token || App.paused) return;
          const next = current.cursor + 1;
          Store.saveCursor(id, next);
          if (next >= current.items.length) finishLive();
          else { App.phase = "think"; liveLoop(); }
        } catch (err) {
          if (App.runToken !== token) return;
          App.busy = false;
          App.paused = true;
          App.rush = false;
          App.runError = err.message || "请求失败";
          paint();
        }
      };
      App.liveLoop = liveLoop;
      if (task.source === "live" || Store.task(id).source === "live") {
        paint();
        liveLoop();
        return;
      }
      const tick = () => {
        const current = Store.task(id);
        if (!current || current.status !== "running" || App.paused) return;
        if (App.phase === "think") { App.phase = "show"; paint(); return; }
        const next = current.cursor + 1;
        if (next >= current.items.length) {
          Store.finish(id);
          clearInterval(App.timer);
          App.timer = null;
          paint();
          UI.toast("测试完成，正在打开报告");
          setTimeout(() => { location.href = "result.html?id=" + encodeURIComponent(id); }, 700);
          return;
        }
        Store.saveCursor(id, next);
        App.phase = "think";
        paint();
      };
      paint();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      App.timer = setInterval(tick, reduce ? 40 : 720);
    }
  }
};

function dimensionBars(items) {
  const map = {};
  items.forEach((item) => {
    const key = item.dimension || "other";
    if (!map[key]) map[key] = { ok: 0, n: 0 };
    map[key].n += 1;
    if (item.correct) map[key].ok += 1;
  });
  return Object.entries(map).map(([key, value]) => {
    const pct = Math.round(100 * value.ok / value.n);
    return `<div class="bar-line"><span>${UI.esc(DATA.dims[key] || key)}</span><div class="bar-track"><span style="width:${pct}%"></span></div><b>${pct}</b></div>`;
  }).join("") || `<div class="empty">完成后显示维度</div>`;
}

Actions.theme = (el) => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("modeltool-theme", next); } catch (err) {}
  const label = next === "dark" ? "切换浅色" : "切换深色";
  el.setAttribute("aria-label", label);
  el.setAttribute("title", label);
  el.innerHTML = UI.icon(next === "dark" ? "sun" : "moon");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#0c111b" : "#3B5FFA");
};
Actions.nav = () => document.getElementById("nav")?.classList.toggle("open");
Actions["user-menu"] = (el, event) => {
  event.stopPropagation();
  UI.closeFloaters();
  const rect = el.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "menu-pop";
  menu.innerHTML = `<button type="button" data-action="go" data-href="guide.html">使用说明</button>
    <button type="button" data-action="reset-demo">恢复初始演示数据</button>
    <button type="button" data-action="logout">退出登录</button>`;
  menu.style.top = (rect.bottom + 8) + "px";
  menu.style.left = Math.max(8, rect.right - 168) + "px";
  document.body.appendChild(menu);
};
Actions.go = (el) => { location.href = el.dataset.href; };
Actions.logout = () => { Store.logout(); location.href = "index.html"; };
Actions["reset-demo"] = () => {
  UI.modal({
    title: "恢复初始演示数据",
    body: "本机的测试记录会回到页面稿里的初始状态。接口地址和密钥会保留。",
    okText: "恢复",
    onOk() { Store.reset(); location.href = "index.html"; }
  });
};
Actions["toggle-select"] = (el, event) => {
  event.stopPropagation();
  const wrap = el.closest(".select");
  const opened = wrap.classList.contains("open");
  UI.closeFloaters();
  if (!opened) {
    wrap.classList.add("open");
    const filter = wrap.querySelector(".select-filter");
    if (filter) setTimeout(() => filter.focus(), 0);
  }
};
Actions.pick = (el, event) => {
  event.stopPropagation();
  Form.set(el.dataset.select, el.dataset.value);
  const wrap = el.closest(".select");
  wrap.querySelector(".select-label").innerHTML = el.innerHTML;
  wrap.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === el));
  wrap.classList.remove("open");
};
function traceBusy(busy) {
  App.traceBusy = busy;
  document.querySelectorAll('[data-action="trace-mode"]').forEach((node) => { node.disabled = busy; });
  ["trace-api", "trace-manual"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.inert = busy;
  });
}
function showTraceResult(payload) {
  const result = document.getElementById("trace-result");
  if (result) result.innerHTML = Trace.resultHtml(payload);
  if (typeof Poster !== "undefined") {
    Poster.live = Poster.fromTrace(payload);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    Poster.ensureButtons();
  }
}
Actions["trace-mode"] = (el) => {
  if (App.traceBusy) return;
  const manual = el.dataset.mode === "manual";
  document.getElementById("trace-api").hidden = manual;
  document.getElementById("trace-manual").hidden = !manual;
  document.querySelectorAll('[data-action="trace-mode"]').forEach((node) => {
    const active = node === el;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
  const url = new URL(location.href);
  if (manual) url.searchParams.set("mode", "manual"); else url.searchParams.delete("mode");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
};
Actions["copy-manual-prompt"] = async (el) => {
  const challenge = Trace.manual().challenges[Number(el.dataset.index)];
  if (challenge) await Actions["copy-text"]({ dataset: { copy: challenge.prompt } });
};
Actions["analyze-manual"] = async (el) => {
  if (App.traceBusy) return;
  traceBusy(true);
  const original = el.textContent;
  el.textContent = "正在分析…";
  const error = document.getElementById("manual-error");
  if (error) error.textContent = "";
  try {
    const payload = await Trace.analyzeManual();
    showTraceResult(payload);
    document.getElementById("trace-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    UI.toast("手动指纹分析完成");
  } catch (err) {
    if (error) error.textContent = err.message || "分析失败，请稍后重试";
  } finally {
    el.textContent = original;
    traceBusy(false);
  }
};
Actions["reset-manual"] = () => {
  if (App.traceBusy) return;
  const reset = () => {
    Trace.resetManual();
    Trace.clearResult();
    document.getElementById("trace-result").innerHTML = "";
    document.querySelectorAll("[data-share] .share-actions").forEach((node) => node.remove());
    if (typeof Poster !== "undefined") Poster.live = null;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    document.querySelector('[data-action="trace-mode"][data-mode="manual"]')?.click();
    document.getElementById("trace-manual")?.scrollIntoView({ behavior: "smooth", block: "start" });
    UI.toast("已换一组新题目");
  };
  if (Trace.manual().answers.some((answer) => answer.trim())) {
    UI.modal({ title: "换一组题目", body: "当前粘贴的回答会清空。请把新题目分别发到新的对话中，保持同一个模型和设置。", okText: "清空并换题", onOk: reset });
  } else reset();
};
Actions["retest-trace"] = () => {
  document.querySelector('[data-action="trace-mode"][data-mode="api"]')?.click();
  document.querySelector('[data-action="start-trace"]')?.click();
};
Actions["start-trace"] = async (el) => {
  if (App.traceBusy) return;
  if (!ensureApi()) return;
  if (typeof Trace === "undefined") { UI.toast("指纹脚本没有加载"); return; }
  const live = document.getElementById("trace-live");
  const result = document.getElementById("trace-result");
  traceBusy(true);
  el.disabled = true;
  const old = el.innerHTML;
  el.textContent = "检测中…";
  const paint = (progress) => {
    if (!live) return;
    const width = Math.round((progress.valid / progress.target) * 100);
    live.innerHTML = `<article class="panel mt16"><div class="panel-bd">
      <p class="think"><span class="dots">正在请求第 ${progress.index + 1} 题</span></p>
      <div class="progress"><span style="width:${width}%"></span></div>
      <p class="note">有效回答 ${progress.valid}/${progress.target}。数字不够会自动再出一题，最多 6 次。</p>
    </div></article>`;
  };
  try {
    const payload = await Trace.run(Form.get("trace-model", defaultModelId()), paint);
    if (live) live.innerHTML = "";
    showTraceResult(payload);
    UI.toast("指纹检测完成");
  } catch (error) {
    if (live) live.innerHTML = `<article class="panel mt16"><div class="panel-bd"><p class="note">${UI.esc(error && error.message ? error.message : "检测失败")}</p></div></article>`;
  } finally {
    traceBusy(false);
    el.disabled = false;
    el.innerHTML = old;
  }
};
Actions["share-poster"] = () => {
  const report = typeof Poster === "undefined" ? null : Poster.current();
  if (!report) { UI.toast("还没有可分享的检测结果"); return; }
  Poster.open(report);
};
Actions["share-link"] = () => {
  const report = typeof Poster === "undefined" ? null : Poster.current();
  if (!report) { UI.toast("还没有可分享的检测结果"); return; }
  Poster.copy(report);
};
Actions["start-basic-probe"] = async (el) => {
  if (!ensureApi()) return;
  if (typeof Probe === "undefined") { UI.toast("基础测试脚本没有加载"); return; }
  el.disabled = true;
  const old = el.innerHTML;
  el.textContent = "测试中…";
  try {
    await Probe.run(Form.get("basic-model", defaultModelId()));
    UI.toast("基础测试完成");
  } finally {
    el.disabled = false;
    el.innerHTML = old;
  }
};
Actions["retry-probe"] = () => {
  const button = document.querySelector('[data-action="start-basic-probe"]');
  if (button && !button.disabled) button.click();
};
Actions["start-candy"] = () => launchTask("candy", { modelId: Form.get("candy-model", defaultModelId()), count: Number(Form.get("candy-count", "20")), difficulty: Form.get("candy-diff", "medium"), rounds: 5 });
Actions["start-pelican"] = () => launchTask("pelican", { modelId: Form.get("pel-model", defaultModelId()), variant: Form.get("pel-variant", "html2d"), count: 1, difficulty: "medium", rounds: 1 });
Actions["start-setup"] = (el) => {
  const type = el.dataset.type;
  const pendingId = el.dataset.id;
  if (pendingId) {
    if (!ensureApi()) return;
    const pending = Store.task(pendingId);
    if (pending) {
      const picked = DATA.model(Form.get("setup-model", pending.modelId));
      const requested = (Store.api().modelOverride || picked.id).trim();
      pending.modelId = picked.id;
      pending.modelName = Store.api().modelOverride ? picked.name + "（" + requested + "）" : picked.name;
      pending.requestedModel = requested;
      pending.difficulty = Form.get("setup-diff", pending.difficulty);
      pending.count = Number(Form.get("setup-count", String(pending.count || 10)));
      pending.items = [];
      Store.startPending(pendingId);
      location.href = "run.html?id=" + encodeURIComponent(pendingId);
      return;
    }
  }
  launchTask(type, { modelId: Form.get("setup-model", defaultModelId()), count: Number(Form.get("setup-count", "10")), difficulty: Form.get("setup-diff", "medium"), rounds: 5 });
};
Actions["open-task"] = (el) => {
  const task = Store.task(el.dataset.id);
  if (!task) return;
  if (task.status === "pending") {
    if (!ensureApi()) return;
    if (task.suiteId) {
      const active = Store.tasks()
        .filter((item) => item.suiteId === task.suiteId && (item.status === "running" || item.status === "pending"))
        .sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || a.suiteStep - b.suiteStep)[0];
      location.href = "run.html?id=" + encodeURIComponent((active || task).id);
      return;
    }
    if (!task.items.length && Engine.moduleOf(task.kind) === "basic") {
      location.href = "setup.html?type=" + task.kind + "&task=" + encodeURIComponent(task.id);
      return;
    }
    Store.startPending(task.id);
    location.href = "run.html?id=" + encodeURIComponent(task.id);
    return;
  }
  location.href = taskLink(task);
};
Actions.more = (el, event) => {
  event.stopPropagation();
  UI.closeFloaters();
  const task = Store.task(el.dataset.id);
  if (!task) return;
  const rect = el.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "menu-pop";
  const primary = task.status === "running" ? "查看进度" : task.status === "pending" ? "开始测试" : "查看结果";
  menu.innerHTML = `<button type="button" data-action="open-task" data-id="${task.id}">${primary}</button>
    <button type="button" data-action="rerun" data-id="${task.id}">再测一次</button>
    <button type="button" data-action="export" data-id="${task.id}">导出报告</button>
    <button type="button" class="danger" data-action="remove-task" data-id="${task.id}">删除记录</button>`;
  menu.style.top = Math.min(rect.bottom + 6, window.innerHeight - 190) + "px";
  menu.style.left = Math.max(8, rect.right - 168) + "px";
  document.body.appendChild(menu);
};
Actions.rerun = (el) => {
  const task = Store.task(el.dataset.id);
  if (!task) return;
  launchTask(task.kind, { modelId: task.modelId, variant: task.pelicanMode || "html2d", count: task.kind === "pelican" ? 1 : task.count, difficulty: task.difficulty, rounds: task.pelicanMode ? 1 : (task.rounds || 5) });
};
Actions.export = (el) => {
  const task = Store.task(el.dataset.id);
  if (!task) return;
  UI.download(task.name + ".json", { name: task.name, model: task.modelName, difficulty: task.difficulty, score: task.score, stability: task.stability, finishedAt: task.finishedAt, items: task.items });
  UI.toast("报告已导出");
};
Actions["remove-task"] = (el) => {
  const id = el.dataset.id;
  UI.modal({
    title: "删除这条记录",
    body: "删除后不能恢复。已经写入模型检测页的汇总，要等下次重新检测才会跟着变。",
    okText: "删除",
    onOk() { Store.remove(id); UI.toast("已删除"); App.refresh(); }
  });
};
Actions.recheck = () => {
  const snap = Store.recalc();
  App.refresh();
  if (snap.score == null) {
    const cfg = Store.api();
    const done = Store.tasks().some((item) => item.status === "done" && item.source !== "demo" && Number.isFinite(Number(item.score)));
    if (!(cfg.baseUrl && cfg.apiKey) && !done) UI.toast("还没配置接口，不能凭空给出检测结果");
    else if (snap.hold === "mixed") UI.toast("最近一次不是同一个模型，综合分先留空");
    else if (!done) UI.toast("还没有已完成的测试");
    else UI.toast("四项基础、糖果和鹈鹕还没到齐，暂不判定降智");
    return;
  }
  UI.toast("已根据完成记录汇总，综合得分 " + snap.score);
};
Actions["pause-run"] = (el) => {
  App.paused = !App.paused;
  el.textContent = App.paused ? "继续" : "暂停";
  if (!App.paused && !App.busy && App.liveLoop) App.liveLoop();
  const id = qs().id;
  const current = Store.task(id);
  const side = document.getElementById("live-side");
  if (current && side) {
    const live = revealedCorrect(current);
    side.innerHTML = `<div class="kv"><span>已揭示</span><b>${live.n} / ${current.items.length}</b></div><div class="kv"><span>当前答对</span><b>${live.ok}</b></div><div class="kv"><span>状态</span><b>${App.paused ? "已暂停" : "进行中"}</b></div>`;
  }
};
Actions["finish-now"] = (el) => {
  const id = el.dataset.id;
  const task = Store.task(id);
  if (task && task.source === "live") {
    App.rush = true;
    App.paused = false;
    App.runError = "";
    el.disabled = true;
    el.textContent = "正在请求剩余题目…";
    if (!App.busy && App.liveLoop) App.liveLoop();
    return;
  }
  if (App.timer) clearInterval(App.timer);
  Store.finish(id);
  location.href = "result.html?id=" + encodeURIComponent(id);
};
Actions["download-html"] = (el) => {
  const task = Store.task(el.dataset.id);
  if (!task) return;
  const html = task.html || task.reply || "";
  if (!html) { UI.toast("这次没有可下载的 HTML"); return; }
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = (task.name || "pelican") + ".html";
  link.click();
  URL.revokeObjectURL(link.href);
};
function sharedArtwork() {
  const report = typeof Poster !== "undefined" ? Poster.live : null;
  return report && report.html ? report : null;
}
function artworkFileName(report) {
  const name = String(report.name || "pelican").replace(/[\\/:*?"<>|]/g, "").trim();
  return (name || "pelican") + ".html";
}
Actions["open-shared-html"] = () => {
  const report = sharedArtwork();
  if (!report) { UI.toast("这次没有可打开的作品"); return; }
  const url = URL.createObjectURL(new Blob([report.html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
Actions["download-shared-html"] = () => {
  const report = sharedArtwork();
  if (!report) { UI.toast("这次没有可下载的 HTML"); return; }
  const url = URL.createObjectURL(new Blob([report.html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = artworkFileName(report);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
Actions["retry-run"] = () => {
  App.paused = false;
  App.runError = "";
  App.rush = false;
  if (!App.busy && App.liveLoop) App.liveLoop();
};
Actions["copy-text"] = async (el) => {
  const text = el.dataset.copy || "";
  if (!text) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (err) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand("copy");
      area.remove();
    } catch (err2) {
      ok = false;
    }
  }
  UI.toast(ok ? "已复制" : "复制失败，请手动选择");
};
Actions["show-qq"] = () => {
  document.querySelector(".modal-mask")?.remove();
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal qq-pop" role="dialog" aria-modal="true" aria-labelledby="qq-title">
    <button type="button" class="qq-close" data-modal="cancel" aria-label="关闭">${UI.icon("close")}</button>
    <h3 id="qq-title">工具群</h3>
    <img src="assets/qq-group.jpg" alt="工具群二维码，群号 1082521332">
    <p class="qq-meta">扫一扫二维码加入群聊，群号 <b>1082521332</b></p>
  </div>`;
  mask.addEventListener("click", (event) => {
    if (event.target === mask || event.target.closest("[data-modal='cancel']")) mask.remove();
  });
  document.body.appendChild(mask);
  mask.querySelector(".qq-close")?.focus();
};
Actions["open-api"] = () => {
  const cfg = Store.api();
  document.querySelector(".modal-mask")?.remove();
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true">
    <h3>接口设置</h3>
    <p>填写 OpenAI 兼容接口。${UI.forwardNote()}模型 ID 会作为 model 发送。密钥会加密后只留在当前浏览器，本站不会在后台保存你填写的个人密钥。</p>
    <div class="api-grid">
      <label class="field"><span>接口地址</span><input class="text-input" id="api-url" placeholder="https://api.openai.com/v1" value="${UI.esc(cfg.baseUrl)}"></label>
      <label class="field"><span>密钥</span><input class="text-input" id="api-key" type="password" autocomplete="off" placeholder="sk-..." value="${UI.esc(cfg.apiKey)}"></label>
      <label class="field"><span>模型 ID 覆盖（可选）</span><input class="text-input" id="api-model" placeholder="留空则用测试页选中的模型" value="${UI.esc(cfg.modelOverride)}"></label>
      <div class="form-error" id="api-error"></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="test-api">测试连接</button>
      <button type="button" class="btn btn-ghost btn-sm" data-modal="cancel">取消</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="save-api">保存</button>
    </div>
  </div>`;
  mask.addEventListener("click", (event) => {
    if (event.target === mask || event.target.closest("[data-modal='cancel']")) mask.remove();
  });
  document.body.appendChild(mask);
  document.getElementById("api-url")?.focus();
};
Actions["save-api"] = async () => {
  const baseUrl = document.getElementById("api-url").value.trim();
  const apiKey = document.getElementById("api-key").value.trim();
  const modelOverride = document.getElementById("api-model").value.trim();
  const error = document.getElementById("api-error");
  if (!/^https?:\/\//i.test(baseUrl)) { error.textContent = "接口地址需要以 http:// 或 https:// 开头"; return; }
  if (!apiKey) { error.textContent = "请填写密钥"; return; }
  try {
    await Store.saveApi({ baseUrl, apiKey, modelOverride });
  } catch (err) {
    error.textContent = err.message || "密钥没能加密保存";
    return;
  }
  document.querySelector(".modal-mask")?.remove();
  UI.toast("接口已保存");
  App.refresh();
};
Actions["test-api"] = async (el) => {
  const error = document.getElementById("api-error");
  el.disabled = true;
  error.textContent = "正在测试连接…";
  try {
    const content = await Api.complete({
      baseUrl: document.getElementById("api-url").value,
      apiKey: document.getElementById("api-key").value,
      model: document.getElementById("api-model").value.trim() || defaultModelId(),
      system: "只回复 OK",
      user: "回复 OK"
    });
    error.textContent = "连接成功：" + content.slice(0, 80);
  } catch (err) {
    error.textContent = err.message;
  }
  el.disabled = false;
};
Actions["start-suite"] = () => {
  if (App.suiteStarting) return;
  const active = activeSuiteTask();
  if (active) {
    location.href = "run.html?id=" + encodeURIComponent(active.id);
    return;
  }
  if (!ensureApi()) return;
  App.suiteStarting = true;
  const modelId = Form.get("detect-model", defaultModelId());
  const basicCount = suiteCount("detect-count");
  const candyCount = suiteCount("detect-candy-count");
  const suiteId = "s" + Date.now().toString(36);
  const suiteAt = Date.now();
  const steps = [
    { kind: "ability", count: basicCount, difficulty: "medium" },
    { kind: "logic", count: basicCount, difficulty: "medium" },
    { kind: "code", count: basicCount, difficulty: "medium" },
    { kind: "qa", count: basicCount, difficulty: "medium" },
    { kind: "candy", count: candyCount, difficulty: "medium" },
    { kind: "pelican", variant: "html2d", count: 1, difficulty: "medium" }
  ];
  const tasks = steps.map((step, index) => createLiveTask(step.kind, Object.assign({}, step, {
    modelId,
    status: "pending",
    suiteId,
    suiteAt,
    suiteStep: index + 1,
    suiteTotal: steps.length
  })));
  if (!tasks[0] || tasks.some((item) => !item)) {
    App.suiteStarting = false;
    return;
  }
  location.href = "run.html?id=" + encodeURIComponent(tasks[0].id);
};
Actions["stop-run"] = (el) => {
  const task = Store.task(el.dataset.id);
  UI.modal({
    title: "终止这次测试",
    body: task && task.suiteId
      ? "这一项停在这里。后面还没开始的项目会去掉，已经测完的成绩保留。综合分仍只取各项最近一次完成的记录。"
      : "未完成的部分不会进入模型检测汇总。已揭示的题目会留在记录里。",
    okText: "终止",
    onOk() {
      App.runToken = {};
      App.paused = true;
      if (App.timer) clearInterval(App.timer);
      const current = Store.task(el.dataset.id);
      if (current && current.suiteId) discardPendingSuite(current.suiteId, current.id);
      Store.stop(el.dataset.id);
      if (current && current.suiteId) {
        location.href = "detect.html";
        return;
      }
      location.href = Engine.moduleOf(current.kind) === "basic" ? "basic.html" : current.kind + ".html";
    }
  });
};
Actions["toggle-q"] = (el) => el.closest(".q-item")?.classList.toggle("open");
Actions["filter-q"] = (el) => { App.show = el.dataset.show; App.refresh(); };
Actions["login-submit"] = () => {
  const account = document.getElementById("account").value.trim();
  const password = document.getElementById("password").value;
  const remember = document.getElementById("remember").checked;
  const error = document.getElementById("login-error");
  if (account.length < 2) { error.textContent = "账号至少 2 个字符"; return; }
  if (password.length < 4) { error.textContent = "密码至少 4 位"; return; }
  if (account === "demo" && password !== "demo123") { error.textContent = "体验账号的密码是 demo123"; return; }
  Store.setUser(account, remember);
  location.href = UI.safeNext(document.getElementById("next").value);
};
Actions["prompt-filter"] = (el) => {
  const key = el.dataset.key;
  const value = el.dataset.value || "";
  const current = qs()[key] || "";
  setPromptQuery({ [key]: current === value ? "" : value });
  App.refresh();
};
Actions["prompt-reset"] = () => {
  history.replaceState(null, "", "prompts.html");
  App.refresh();
};
Actions["prompt-open"] = (el) => {
  const item = PROMPTS.find((row) => row.id === el.dataset.id);
  if (!item) return;
  document.querySelector(".modal-mask")?.remove();
  const cfg = Store.api();
  const model = (cfg.modelOverride || "").trim() || defaultModelId();
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal prompt-pop" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
    <button type="button" class="qq-close" data-modal="cancel" aria-label="关闭">${UI.icon("close")}</button>
    <h3 id="prompt-title">${UI.esc(item.title)}</h3>
    <p class="prompt-meta">${UI.esc(promptCatLabel(item.category))} · ${UI.esc(promptDiffLabel(item.difficulty))} · ${UI.esc(promptModelLabel(item.model))}</p>
    <pre class="prompt-text">${UI.esc(item.prompt)}</pre>
    <p class="note">核对要点：${UI.esc(item.check)} 试跑只把这段文字发给你自己的接口，不计入检测分数。当前模型 ${UI.esc(model)}。</p>
    ${item.href ? `<p><a href="${UI.esc(item.href)}">${item.category === "candy" ? "去糖果测试" : item.category === "html" ? "打开对应页面" : "打开相关页面"}</a></p>` : ""}
    <div class="prompt-reply" id="prompt-reply">试跑结果会出现在这里。</div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="prompt-copy" data-id="${UI.esc(item.id)}">复制提示词</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="prompt-run" data-id="${UI.esc(item.id)}">试跑</button>
    </div>
  </div>`;
  mask.addEventListener("click", (event) => {
    if (event.target === mask || event.target.closest("[data-modal='cancel']")) mask.remove();
  });
  document.body.appendChild(mask);
  mask.querySelector(".qq-close")?.focus();
};
Actions["prompt-copy"] = async (el) => {
  const item = PROMPTS.find((row) => row.id === el.dataset.id);
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.prompt);
  } catch (err) {
    const area = document.createElement("textarea");
    area.value = item.prompt;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  UI.toast("提示词已复制");
};
Actions["prompt-run"] = async (el) => {
  const item = PROMPTS.find((row) => row.id === el.dataset.id);
  const reply = document.getElementById("prompt-reply");
  if (!item || !reply) return;
  const cfg = Store.api();
  if (!cfg.baseUrl || !cfg.apiKey) {
    reply.textContent = "先在接口设置里填写地址和密钥。";
    return;
  }
  el.disabled = true;
  reply.textContent = "正在请求…";
  try {
    const content = await Api.complete({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: (cfg.modelOverride || "").trim() || defaultModelId(),
      system: item.system || "按用户给出的提示词作答。看不清图片或材料不足时直接说明，不要编造。",
      user: item.user || item.prompt,
      long: item.category === "html"
    });
    reply.textContent = content || "接口没有返回文字。";
  } catch (err) {
    reply.textContent = err.message || "请求失败";
  }
  el.disabled = false;
};
Actions["compare-go"] = (el) => {
  const ids = Array.from(document.querySelectorAll("[data-compare]:checked")).map((node) => node.value);
  if (ids.length < 2) { UI.toast("至少选择 2 条已完成记录"); return; }
  if (ids.length > 4) { UI.toast("最多对比 4 条记录"); return; }
  const picked = ids.map((id) => Store.task(id)).filter(Boolean);
  const kinds = new Set(picked.map((task) => task.kind));
  if (kinds.size > 1) { UI.toast("请选择同一种测试再对比"); return; }
  location.href = `compare.html?kind=${picked[0].kind}&ids=${ids.join(",")}`;
};
