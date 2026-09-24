const Actions = {};

const App = {
  page: "home",
  timer: null,
  paused: false,
  phase: "think",
  show: "all",
  async start(page) {
    await Store.init();
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
function launchTask(kind, opts) {
  if (!ensureApi()) return;
  const cfg = Store.api();
  const model = DATA.model(opts.modelId);
  const requested = (cfg.modelOverride || model.id).trim();
  const count = kind === "pelican" ? opts.rounds * 4 : opts.count;
  let name = DATA.kinds[kind].label + "-" + UI.diffLabel(opts.difficulty);
  if (kind === "candy") {
    const n = Store.tasks().filter((item) => /^糖果测试-第\d+次$/.test(item.name)).length + 1;
    name = "糖果测试-第" + n + "次";
  }
  if (kind === "pelican") {
    const mode = DATA.pelicanModes.find((item) => item.id === opts.variant) || DATA.pelicanModes[1];
    const n = Store.tasks().filter((item) => item.kind === "pelican" && item.pelicanMode).length + 1;
    name = "鹈鹕骑车-" + mode.short + "-第" + n + "次";
    opts.pelicanMode = mode.id;
    opts.count = 1;
    opts.rounds = 1;
  }
  const task = Store.addTask({
    kind,
    name,
    modelId: model.id,
    modelName: cfg.modelOverride ? model.name + "（" + requested + "）" : model.name,
    requestedModel: requested,
    source: "live",
    pelicanMode: opts.pelicanMode || "",
    difficulty: opts.difficulty,
    count,
    rounds: kind === "pelican" ? opts.rounds : null
  });
  location.href = "run.html?id=" + encodeURIComponent(task.id);
}
function taskLink(task) {
  if (task.status === "running") return `run.html?id=${encodeURIComponent(task.id)}`;
  if (task.status === "pending") return `setup.html?type=${task.kind}&task=${encodeURIComponent(task.id)}`;
  return `result.html?id=${encodeURIComponent(task.id)}`;
}
function opLabel(task) {
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
  const art = opts.art ? `<div class="hero-art"><img src="${opts.art}" alt=""></div>` : "";
  const icon = opts.icon ? `<span class="ico-box">${UI.icon(opts.icon)}</span>` : "";
  const head = (opts.icon || opts.back)
    ? `<div class="hero-title">${opts.back || ""}${icon}<h1>${opts.title}</h1></div>`
    : `<h1>${opts.title}</h1>`;
  return `<section class="hero"><div class="hero-copy">${head}<p class="sub">${opts.sub}</p>${opts.bar ? '<div class="accent"></div>' : ""}</div>${art}</section>`;
}
function featureGrid(cards) {
  return `<section class="grid-4">${cards.map((card) => {
    const external = /^https?:\/\//i.test(card.href);
    const extra = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<article class="card feature">
    <span class="ico-box">${UI.icon(card.icon)}</span>
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
  const info = Engine.judgeText(task.score, "pelican");
  return UI.shell(active, `
    <div class="page-head">
      <div class="crumb"><a href="pelican.html">鹈鹕骑车测试页</a> / 作品</div>
      <h1>${UI.esc(task.name)}</h1>
      <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.esc(mode ? mode.name : "鹈鹕骑车")} · ${task.finishedAt || task.createdAt}</p>
    </div>
    <section class="stat-row">
      <div class="stat" style="display:flex;justify-content:center">${UI.ring(task.score)}</div>
      <div class="stat"><div class="k">画面结构</div><div class="v">${UI.levelBadge(task.score, "pelican")}</div></div>
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
        <p class="note mt16">${UI.esc(info.desc)} 结构分只检查有没有 SVG、车轮和动画。长嘴、喉囊和是不是骑在车上，要看上面的画面。</p>
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
const Pages = {
  home() {
    const recentIcons = { detect: "shield", basic: "doc", candy: "candy", pelican: "car", relay: "target" };
    const rows = Store.get().recent.map((row) => `<a class="row" href="${row.href}">
      <span class="row-name"><span class="ico-box sm">${UI.icon(recentIcons[row.kind] || "doc")}</span>${UI.esc(row.name)}</span>
      ${UI.statusBadge(row.status)}
      <time>${UI.esc(row.time || "")}</time>
    </a>`).join("") || `<div class="empty">还没有使用记录</div>`;
    return UI.shell("home", `
      ${hero({ title: "大模型降智检测", sub: "评测 GPT、Claude、DeepSeek、Kimi 等模型的能力、迷惑题和绘图表现", bar: true, art: "assets/hero-home.png" })}
      <section class="official-bar" id="official-bar" aria-label="官方模型实况">
        <strong class="official-label">官方模型实况</strong>
        <span class="official-sync" id="official-sync">正在同步官方状态…</span>
        <button type="button" class="official-refresh" id="official-refresh">刷新</button>
        <div class="official-pills" id="official-pills"></div>
      </section>
      <article class="panel key-note">
        <h2>${UI.icon("info")} 密钥只留在当前浏览器</h2>
        <p>接口密钥填写后，只保存在你正在用的这个浏览器里。这个站没有后台账号，也不会把密钥存下来。</p>
        <p>写入浏览器之前，密钥会用 AES-GCM 加密。浏览器里留下的是密文，解开用的钥匙同样只在这台浏览器中，不会放进导出的报告。</p>
        <p>开始测试时，页面在本地解开密钥，${UI.forwardNote()}转发时用一下，不另存一份。换一个浏览器、换一个网址，或清掉本站数据之后，需要重新填写。</p>
      </article>
      ${featureGrid([
        { icon: "shield", title: "模型检测页", desc: "综合多项测试结果，评估模型是否存在降智问题。", href: "detect.html", cta: "进入检测 →", primary: true },
        { icon: "doc", title: "基础测试页", desc: "通过基础能力测试，评估模型的核心能力表现。", href: "basic.html", cta: "开始测试 →" },
        { icon: "candy", title: "糖果测试页", desc: "使用更具迷惑性的测试题目，识别模型是否出现降智。", href: "candy.html", cta: "开始测试 →" },
        { icon: "car", title: "鹈鹕骑车测试页", desc: "让模型写出一只鹈鹕骑自行车的 HTML，打开就能看到画面。", href: "pelican.html", cta: "开始测试 →" },
        { icon: "list", title: "提示词库", desc: "按分类查看评测提示词，可以复制，也可以用当前接口试跑。", href: "prompts.html", cta: "打开提示词库 →" },
        { icon: "code", title: "HTML 作品", desc: "公开的 HTML 作品目录。列表用静图，详情页再打开可玩页面。", href: "works.html", cta: "查看作品 →" },
        { icon: "out", title: "中转导航", desc: "去 API 中转导航站挑选接口，再回到这里填写地址和密钥。", href: "https://www.veridrop.cn", cta: "打开导航 →" }
      ])}
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
      </section>`);
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
    const snap = Store.get().snapshot;
    const info = Engine.judgeText(snap.score, "detect");
    const tone = info.level === "ok" ? "ok" : info.level === "warn" ? "warn" : info.level === "bad" ? "bad" : "idle";
    const cfg = Store.api();
    const configured = !!(cfg.baseUrl && cfg.apiKey);
    const anyPart = ["basic", "candy", "pelican"].some((key) => snap.parts[key] && snap.parts[key].score != null);
    let desc = info.desc;
    let side = info.side;
    if (info.level === "none") {
      if (!configured && !anyPart) {
        desc = "接口还没配置，也没有已完成的测试。这里不会自己打分，也不会判定降智。";
        side = "请先在右上角填写接口地址和密钥，再完成基础、糖果和鹈鹕测试。三项都有结果后才会汇总。";
      } else if (!anyPart) {
        desc = "接口已保存，但还没有已完成的测试。完成后再来看综合结果。";
        side = "没有真实作答记录时，综合分保持未检测。";
      } else {
        desc = "已有部分测试结果。基础、糖果、鹈鹕三项都完成后，才会计算综合分。";
        side = "缺任何一项都不会当成 0 分，也不会写成降智。";
      }
    }
    const parts = [
      ["meta", "shield", "模型检测", "综合多项测试结果，评估模型是否存在降智问题。", "guide.html#score"],
      ["basic", "doc", "基础测试", "通过基础能力测试，评估模型的核心能力表现。", "basic.html"],
      ["candy", "candy", "糖果测试", "使用更具迷惑性的测试题目，识别模型是否出现降智。", "candy.html"],
      ["pelican", "car", "鹈鹕骑车", "让模型生成鹈鹕骑自行车的 HTML，并直接预览画面。", "pelican.html"]
    ];
    const metrics = parts.map(([key, icon, name]) => {
      const part = snap.parts[key];
      const score = part.score == null ? "—" : part.score;
      return `<article class="metric"><span class="ico-box">${UI.icon(icon)}</span><div class="name">${name}</div><div class="score">${score}<span>分</span></div>${UI.levelBadge(part.score, "detect")}</article>`;
    }).join("");
    const detail = parts.map(([key, icon, name, text, href]) => {
      const part = snap.parts[key];
      return `<tr>
        <td><div class="td-title"><span class="ico-box sm">${UI.icon(icon)}</span><span>${name}<span class="td-sub">${text}</span></span></div></td>
        <td><b>${part.score == null ? "—" : part.score + " /100"}</b></td>
        <td>${UI.levelBadge(part.score, "detect")}</td>
        <td>${part.time || "—"}</td>
        <td><a class="linkish" href="${href}">查看详情</a></td>
      </tr>`;
    }).join("");
    const when = snap.time ? `检测时间：${UI.esc(snap.time)}` : "检测时间：尚未检测";
    const model = snap.modelName ? `模型版本：${UI.esc(snap.modelName)}` : "模型版本：尚未检测";
    return UI.shell("detect", `
      ${hero({ icon: "shield", title: "模型检测页", sub: "汇总各项测试结果，评估模型是否存在降智问题。", art: "assets/hero-detect.png" })}
      <section class="panel summary">
        <div class="summary-main">
          ${UI.ring(snap.score)}
          <div class="summary-copy">
            <h2>${info.level === "none" ? "" : `<span class="mini-${tone}">${UI.icon("mark")}</span>`}${UI.esc(info.title)}</h2>
            <p>${UI.esc(desc)}</p>
            <div class="summary-meta"><span>${UI.icon("clock")} ${when}</span><span>${model}</span></div>
          </div>
        </div>
        <div class="summary-metrics">${metrics}</div>
      </section>
      <section class="grid-side">
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("doc")} 各项测试详情</h3></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>测试项目</th><th>得分</th><th>状态</th><th>检测时间</th><th></th></tr></thead>
            <tbody>${detail}</tbody>
          </table></div>
        </article>
        <article class="panel">
          <div class="panel-hd"><h3>${UI.icon("target")} 综合评估结果</h3></div>
          <div class="panel-bd judge">
            <span class="ico-box lg ${tone}">${UI.icon(info.level === "none" ? "info" : "mark")}</span>
            <h3>${UI.esc(info.title)}</h3>
            <p>${UI.esc(side)}</p>
            <button class="btn btn-primary btn-block" type="button" data-action="recheck">${UI.icon("refresh")} 重新检测</button>
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
      ${hero({ title: "基础测试页", sub: "通过基础能力测试，评估模型的核心能力表现。", bar: true, art: "assets/hero-basic.png" })}
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
  relay() {
    ensureSelect("basic-model", defaultModelId());
    const report = Store.basicReport();
    return UI.shell("basic", `
      <div class="page-head">
        <div class="crumb"><a href="basic.html">基础测试页</a> / 中转站测试</div>
        <h1>中转站测试</h1>
        <p>测的是中转站有没有把请求改掉、把模型换成更便宜的，或把协议能力弄丢。模型会不会做题，看上面的四项能力测试。</p>
      </div>
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
      ${hero({ icon: "candy", title: "糖果测试页", sub: "使用更具迷惑性的测试题目，识别模型是否出现降智。", art: "assets/hero-candy.png" })}
      <section class="grid-side">
        <div class="stack">
          <article class="panel">
            <div class="panel-hd"><h3>${UI.icon("doc")} 测试任务</h3></div>
            <div class="panel-bd">
              <p class="lead">选择模型并设置测试参数，开始糖果测试。</p>
              <div class="form-row">
                ${UI.field("选择模型", UI.select("candy-model", Form.get("candy-model"), modelOptions()))}
                ${UI.field("测试题目数量", UI.select("candy-count", Form.get("candy-count"), [{ value: "10", label: "10 题" }, { value: "20", label: "20 题" }, { value: "30", label: "30 题" }]))}
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
      <td>${task.score == null ? UI.statusBadge(task.status) : UI.levelBadge(task.score, "pelican")}</td>
      <td><div class="ops"><button class="btn btn-ghost btn-sm" type="button" data-action="open-task" data-id="${task.id}">${task.html ? "查看作品" : opLabel(task)}</button>${task.html ? `<button class="btn btn-ghost btn-sm" type="button" data-action="download-html" data-id="${task.id}">下载 HTML</button>` : ""}</div></td>
    </tr>`).join("") || `<tr><td colspan="6"><div class="empty">还没有鹈鹕骑车记录</div></td></tr>`;
    const back = `<a class="back-btn" href="index.html" aria-label="返回首页">${UI.icon("back")}</a>`;
    return UI.shell("pelican", `
      ${hero({ back, title: "鹈鹕骑车测试页", sub: "让模型写一只正在骑自行车的鹈鹕，测完直接看画面，并下载 HTML。", bar: true, art: "assets/hero-pelican.png" })}
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
          <thead><tr><th>测试时间</th><th>使用模型</th><th>作品类型</th><th>作品</th><th>画面结构</th><th>操作</th></tr></thead>
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
          <p>模型检测页的综合分 = 基础测试 × 0.4 + 糖果测试 × 0.35 + 鹈鹕骑车 × 0.25。基础、糖果、鹈鹕三项都有已完成记录才计算。缺一项时综合分是「—」，不会记成 0 分，也不会判定降智。「重新检测」只按已有记录重算，没有记录时不会访问模型，也不会编造分数。</p>
          <p>鹈鹕骑车的正确率再拆一层：综合正确率 = 题目正确率 × 90% + 稳定性 × 10%。稳定性看各轮正确率是否接近，波动越大扣得越多。</p>
          <h2 id="detect">模型检测</h2>
          <p>检测页本身不单独出题，它汇总基础、糖果、鹈鹕三类结果。三项没齐时，综合分和「模型检测」都显示未检测。三项齐了之后，「模型检测」卡上的分数就是上面的综合分。</p>
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
          <p>最坏情况可以拿走 28 颗仍然不满足：全部圆形苹果、全部圆形桃子和全部西瓜。第 29 颗才会补上缺少的那颗五角星。所以答案是 29，不是流传的 21。</p>
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
          <p>基础测试占 40%，糖果测试占 35%，鹈鹕骑车占 25%。三项都有已完成记录才计算。缺任何一项时综合分显示未检测，不会当成 0 分。</p>
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
      <div class="page-head"><div class="crumb"><a href="basic.html">基础测试页</a> / 全部任务</div><h1>全部任务</h1><p>筛选基础测试里的能力、推理、代码和问答记录。</p></div>
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
          <a class="btn btn-ghost btn-sm" href="setup.html?type=ability">新建测试</a>
        </form>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>任务名称</th><th>类型</th><th>模型</th><th>难度</th><th>题量</th><th>状态</th><th>得分</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="9"><div class="empty"><h3>没有匹配的任务</h3><p>换一个筛选条件，或新建一次基础测试。</p></div></td></tr>`}</tbody>
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
      <div class="page-head"><div class="crumb"><a href="${back}">${kind === "candy" ? "糖果测试页" : "鹈鹕骑车测试页"}</a> / 全部记录</div><h1>${kind === "candy" ? "全部糖果测试记录" : "全部鹈鹕骑车记录"}</h1><p>勾选 2 到 4 条已完成记录，可以对比得分。</p></div>
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
            <div class="form-row">
              ${UI.field("选择模型", UI.select("setup-model", Form.get("setup-model"), modelOptions()))}
              ${UI.field("测试题目数量", UI.select("setup-count", Form.get("setup-count"), [{ value: "10", label: "10 题" }, { value: "20", label: "20 题" }, { value: "30", label: "30 题" }]))}
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
    const parent = Engine.moduleOf(task.kind) === "basic" ? "basic.html" : task.kind + ".html";
    const parentName = Engine.moduleOf(task.kind) === "basic" ? "基础测试页" : DATA.kinds[task.kind].label + "页";
    const active = Engine.moduleOf(task.kind);
    return UI.shell(active, `
      <div class="page-head">
        <div class="crumb"><a href="${parent}">${parentName}</a> / 测试进行中</div>
        <h1>${UI.esc(task.name)}</h1>
        <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.diffLabel(task.difficulty)} · 共 ${task.items.length} 题</p>
        <div class="progress"><span id="run-bar" style="width:0"></span></div>
        <div id="run-meta" style="color:#8b97ad;font-size:13px"></div>
      </div>
      <section class="run-layout">
        <article class="panel"><div class="panel-bd" id="stage"></div>
          <div class="panel-bd" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" type="button" data-action="pause-run" id="pause-btn">暂停</button>
            <button class="btn btn-primary btn-sm" type="button" data-action="finish-now" data-id="${task.id}">直接完成并出报告</button>
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
    return UI.shell(active, `
      <div class="page-head">
        <div class="crumb"><a href="${parent}">返回列表</a> / 测试报告</div>
        <h1>${UI.esc(task.name)}</h1>
        <p>${UI.modelChip(task.modelId, task.modelName)} · ${UI.diffLabel(task.difficulty)} · ${task.finishedAt || task.createdAt}</p>
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
    const kind = query.kind === "pelican" ? "pelican" : "candy";
    const ids = (query.ids || "").split(",").filter(Boolean).slice(0, 4);
    const tasks = ids.map((id) => Store.task(id)).filter((task) => task && task.status === "done");
    const max = 100;
    const cols = tasks.map((task) => `<div class="col"><i style="height:${Math.max(8, (task.score || 0) / max * 120)}px"></i><span>${UI.esc(task.modelName)}<br>${task.score}</span></div>`).join("");
    const rows = tasks.map((task) => `<tr><td>${UI.esc(task.name)}</td><td>${UI.esc(task.modelName)}</td><td>${task.score}</td><td>${UI.levelBadge(task.score, kind === "pelican" ? "pelican" : "detect")}</td><td>${UI.diffLabel(task.difficulty)}</td><td><a href="result.html?id=${task.id}">查看报告</a></td></tr>`).join("");
    return UI.shell(kind, `
      <div class="page-head"><div class="crumb"><a href="records.html?kind=${kind}">全部记录</a> / 对比</div><h1>模型对比</h1><p>同一题库下，最近这些已完成记录的得分。</p></div>
      <article class="panel"><div class="hbar">${cols || ""}</div>
        <div class="table-wrap"><table class="grid"><thead><tr><th>记录</th><th>模型</th><th>得分</th><th>判定</th><th>难度</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="empty">没有可对比的已完成记录</div></td></tr>`}</tbody></table></div>
      </article>`);
  },
  prompts() {
    const query = qs();
    const art = `<div class="prompt-art" aria-hidden="true"><svg viewBox="0 0 320 180"><rect x="150" y="28" width="132" height="92" rx="18" fill="#eef3ff" stroke="#d5e2ff"/><rect x="168" y="48" width="78" height="8" rx="4" fill="#c9d7ff"/><rect x="168" y="66" width="96" height="8" rx="4" fill="#dbe4ff"/><rect x="168" y="84" width="58" height="8" rx="4" fill="#dbe4ff"/><rect x="196" y="62" width="86" height="78" rx="16" fill="#fff" stroke="#d5e2ff"/><circle cx="226" cy="88" r="10" fill="#fff6d8" stroke="#f0a03a" stroke-width="2"/><path d="M222 100h8M223 104h6" stroke="#f0a03a" stroke-width="2" stroke-linecap="round"/><rect x="214" y="112" width="52" height="8" rx="4" fill="#e4ebff"/><path d="M78 46l4 8 8 2-8 2-4 8-4-8-8-2 8-2z" fill="#8eabff"/><path d="M118 34l2 5 5 1-5 1-2 5-2-5-5-1 5-1z" fill="#b9cbff"/><rect x="40" y="108" width="46" height="28" rx="8" fill="#fff" stroke="#d5e2ff"/><path d="M52 122h22M58 116v12" stroke="#3b5ffa" stroke-width="2" stroke-linecap="round"/></svg></div>`;
    return UI.shell("prompts", `
      <section class="prompt-hero">
        <div>
          <h1>测试模型质量的提示词</h1>
          <p class="sub">从多维度设计提示词，全面评估大模型在理解、生成、推理等方面的表现。</p>
          <div class="accent"></div>
        </div>
        ${art}
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
  mount: {
    home() { if (typeof Official !== "undefined") Official.load(false); },
    status() { if (typeof Official !== "undefined") Official.load(false); },
    works() { paintWorkFrames(); },
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
      const task = Store.task(qs().id || "");
      const frame = document.getElementById("art-frame");
      if (!task || !task.html || !frame) return;
      frame.src = URL.createObjectURL(new Blob([task.html], { type: "text/html" }));
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
        Store.finish(id);
        paint();
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
            Store.finish(id);
            location.href = "result.html?id=" + encodeURIComponent(id);
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
  const primary = task.status === "running" ? "查看进度" : "查看结果";
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
    const any = ["basic", "candy", "pelican"].some((key) => snap.parts[key] && snap.parts[key].score != null);
    if (!(cfg.baseUrl && cfg.apiKey) && !any) UI.toast("还没配置接口，不能凭空给出检测结果");
    else if (!any) UI.toast("还没有已完成的测试");
    else UI.toast("三项还没测完，暂不判定降智");
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
Actions["retry-run"] = () => {
  App.paused = false;
  App.runError = "";
  App.rush = false;
  if (!App.busy && App.liveLoop) App.liveLoop();
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
    <p>填写 OpenAI 兼容接口。${UI.forwardNote()}模型 ID 会作为 model 发送。密钥会加密后只留在当前浏览器，本站没有后台存放它。</p>
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
Actions["stop-run"] = (el) => {
  UI.modal({
    title: "终止这次测试",
    body: "未完成的部分不会进入模型检测汇总。已揭示的题目会留在记录里。",
    okText: "终止",
    onOk() {
      App.runToken = {};
      App.paused = true;
      if (App.timer) clearInterval(App.timer);
      Store.stop(el.dataset.id);
      const task = Store.task(el.dataset.id);
      location.href = Engine.moduleOf(task.kind) === "basic" ? "basic.html" : task.kind + ".html";
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
  location.href = `compare.html?kind=${el.dataset.kind}&ids=${ids.join(",")}`;
};
