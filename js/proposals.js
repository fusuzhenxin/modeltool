"use strict";

const Proposals = (() => {
  const state = { csrf: "", tests: {}, statuses: {}, data: null, detail: null, ticket: 0, commentPage: 1 };
  const esc = UI.esc;
  const modelGroups = { openai: "OpenAI", anthropic: "Claude · Anthropic", gemini: "Gemini · Google", deepseek: "DeepSeek", kimi: "Kimi · 月之暗面", qwen: "通义千问 · Qwen", zhipu: "智谱 · GLM", grok: "Grok · xAI", minimax: "MiniMax", doubao: "豆包", xiaomi: "小米 · MiMo", meta: "Meta · Llama", mistral: "Mistral" };
  const modelIds = (value) => [...new Set(String(value || "").split(/[\n,，、]+/).map((s) => s.trim()).filter(Boolean))];
  function modelOptions(selected = [], search = "") {
    const needle = search.trim().toLowerCase();
    return Object.entries(modelGroups).map(([brand, label]) => {
      const models = DATA.models.filter((m) => modelBrand(m.id) === brand && `${label} ${m.name} ${m.id}`.toLowerCase().includes(needle));
      if (!models.length) return "";
      return `<section class="proposal-model-group"><h3>${esc(label)}</h3>${models.map((m) => `<label class="proposal-model-option">${UI.modelMark(m)}<span><strong>${esc(m.name)}</strong><small>${esc(m.id)}</small></span><input type="checkbox" value="${esc(m.id)}" aria-label="${esc(m.name)}" ${selected.includes(m.id) ? "checked" : ""}></label>`).join("")}</section>`;
    }).join("") || '<p class="proposal-model-empty">没有匹配的模型，可在下方添加模型 ID。</p>';
  }
  function modelPicker() {
    return `<div class="proposal-model-field"><span id="proposal-model-label">希望测试的模型</span><input type="hidden" name="models" value=""><details class="proposal-model-picker"><summary aria-labelledby="proposal-model-label proposal-model-count">${UI.icon("list")}<span id="proposal-model-count">选择模型，可多选</span>${UI.icon("chevron")}</summary><div class="proposal-model-panel"><label class="proposal-model-search">${UI.icon("search")}<input type="search" id="proposal-model-search" aria-label="搜索模型名称或 ID" placeholder="搜索模型、厂商或输入模型 ID" maxlength="150" autocomplete="off"></label><div class="proposal-model-options">${modelOptions()}</div><button type="button" class="proposal-model-custom" data-proposal-action="model-add" hidden></button><div class="proposal-model-panel-footer"><span>可多选，最多 30 个模型</span><button type="button" data-proposal-action="model-done">完成</button></div></div></details><div class="proposal-model-selected" aria-live="polite"></div></div>`;
  }
  function refreshModelOptions() {
    const field = document.querySelector(".proposal-model-field");
    if (!field) return;
    const selected = modelIds(field.querySelector('[name="models"]').value), search = field.querySelector('[type="search"]').value.trim();
    field.querySelector(".proposal-model-options").innerHTML = modelOptions(selected, search);
    const custom = field.querySelector(".proposal-model-custom");
    custom.hidden = !search || DATA.models.some((m) => m.id.toLowerCase() === search.toLowerCase()) || selected.includes(search);
    custom.textContent = `＋ 添加模型 ID：${search}`;
  }
  function refreshModelSelection() {
    const field = document.querySelector(".proposal-model-field");
    if (!field) return;
    const selected = modelIds(field.querySelector('[name="models"]').value);
    field.querySelector("#proposal-model-count").textContent = selected.length ? `已选择 ${selected.length} 个模型` : "选择模型，可多选";
    field.querySelector(".proposal-model-selected").innerHTML = selected.map((id) => `<span class="proposal-model-chip">${UI.modelMark(DATA.model(id))}<span title="${esc(id)}">${esc(DATA.model(id).name)}</span><button type="button" data-proposal-action="model-remove" data-model="${esc(id)}" aria-label="移除 ${esc(id)}">×</button></span>`).join("");
  }
  function updateModels(id, add) {
    const input = document.querySelector('#proposal-form [name="models"]'), selected = modelIds(input.value);
    if (add && !selected.includes(id) && selected.length >= 30) { refreshModelOptions(); UI.toast("最多选择 30 个模型"); return; }
    input.value = (add ? [...new Set([...selected, id])] : selected.filter((m) => m !== id)).join("\n");
    refreshModelSelection();
    document.querySelectorAll('.proposal-model-options input[type="checkbox"]').forEach((box) => { box.checked = modelIds(input.value).includes(box.value); });
  }
  const time = (value) => new Date(value * 1000).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  const query = () => new URLSearchParams(location.search);
  const url = (values = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value && !(key === "page" && value === "1")) params.set(key, value);
    return "proposals.html" + (params.size ? "?" + params : "");
  };
  async function api(path, method = "GET", data) {
    const res = await fetch("/api/" + path, { method, credentials: "same-origin", headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-Proposal-CSRF": state.csrf }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.errors?.map((e) => e.message.replace(/^Value error, /, "")).join("；") || (typeof body.detail === "string" ? body.detail : "暂时无法操作，请稍后重试"));
    return body;
  }
  const status = (p) => `<span class="proposal-status ${esc(p.status)}">${esc(state.statuses[p.status] || p.status)}</span>`;
  const tags = (p) => p.tests.map((id) => `<span class="proposal-test">${UI.icon(id === "site_trace" ? "target" : id === "site_pelican" ? "car" : id === "site_candy" ? "candy" : "chart")}${esc(state.tests[id] || id)}</span>`).join("");
  const visit = (p) => `<a class="proposal-visit" href="${esc(p.website_url)}" target="_blank" rel="noopener noreferrer nofollow ugc">访问中转站 <strong>${esc(p.domain)}</strong>${UI.icon("out")}</a>`;
  const vote = (p) => `<button class="proposal-vote ${p.supported ? "supported" : ""}" type="button" data-proposal-action="vote" data-id="${esc(p.id)}" aria-pressed="${p.supported}" aria-label="${p.supported ? "取消支持" : "支持提案"}：${esc(p.name)}"><span>↑</span><b>${p.votes}</b><small>${p.supported ? "已支持" : "想看测评"}</small></button>`;
  function card(p, detail = false) {
    return `<article class="proposal-card" data-proposal-id="${esc(p.id)}">${vote(p)}<div class="proposal-card-main"><div class="proposal-card-title"><div class="proposal-identity"><span class="proposal-avatar">${esc(Array.from(p.name)[0])}</span><div>${detail ? `<h2>${esc(p.name)}</h2>` : `<h2><a href="${url({ id: p.id })}">${esc(p.name)}</a></h2>`}${visit(p)}</div></div><div>${p.pinned ? '<span class="proposal-pin">置顶</span>' : ""}${status(p)}</div></div>${p.description ? `<p class="proposal-description ${detail ? "expanded" : ""}">${esc(p.description)}</p>` : ""}<div class="proposal-models"><span>想测模型</span>${p.models.map((m) => `<code>${UI.modelMark(DATA.model(m))}${esc(m)}</code>`).join("")}</div><div class="proposal-tests"><span>希望测试</span>${tags(p)}</div>${p.admin_note ? `<div class="proposal-update"><strong>处理进展</strong><p>${esc(p.admin_note)}</p></div>` : ""}${p.report_id ? `<a class="proposal-report" href="relays.html?id=${encodeURIComponent(p.report_id)}">${UI.icon("doc")}查看已公开的检测报告 →</a>` : ""}<footer><span>${esc(p.author)} · ${time(p.created)} 提交</span><a href="${url({ id: p.id })}#discussion">${UI.icon("chat")}${p.comment_count ? p.comment_count + " 条评论" : "参与讨论"}</a></footer></div></article>`;
  }
  function form() {
    return `<aside class="proposal-submit card" id="submit-proposal"><div class="proposal-submit-title"><span>＋</span><div><h2>你想看哪一站？</h2><p>提名中转站，也能补充想测的模型</p></div></div><form id="proposal-form"><label>中转站名称<input name="name" required maxlength="80" placeholder="例如：某某 API" autocomplete="organization"></label><label>公开网址<input name="website_url" type="url" required maxlength="500" placeholder="https://example.com" autocomplete="url"></label>${modelPicker()}<fieldset><legend>希望做什么测试？</legend><div class="proposal-test-options">${Object.entries(state.tests).map(([id, label]) => `<label><input type="checkbox" name="tests" value="${esc(id)}" ${["site_basic", "site_relay"].includes(id) ? "checked" : ""}>${UI.icon(id === "site_trace" ? "target" : id === "site_pelican" ? "car" : id === "site_candy" ? "candy" : "chart")}<span>${esc(label)}</span></label>`).join("")}</div></fieldset><label>为什么想收录 / 想重点测什么？（选填）<textarea name="description" maxlength="2000" rows="4" placeholder="介绍使用场景、想核对的模型表现或遇到的问题。"></textarea></label><label>你的昵称（选填）<input name="author" maxlength="40" placeholder="热心访客" autocomplete="nickname"></label><p class="proposal-form-note">只填写公开信息，请勿提交 API Key。同域名已有提案时会进入原讨论。提交提案不会自动发起检测。</p><p class="proposal-error" role="alert"></p><button type="submit" class="btn btn-primary btn-block">${UI.icon("send")}提交收录提案</button><p class="proposal-vote-note">无需注册；每个浏览器可支持一次，也可取消。热度供排期参考，处理进度公开可见。</p></form></aside>`;
  }
  const empty = (message) => `<div class="proposal-empty">${UI.icon("chat")}<h2>${message}</h2><p>留下你想看的中转站和模型，一起选出下一站。</p></div>`;
  function listing(data) {
    const params = query(), selected = params.get("status") || "", sort = params.get("sort") || "popular";
    return `<div class="proposal-stats"><span>${UI.icon("list")}<b>${data.stats.proposals}</b> 个站点提案</span><span>${UI.icon("user")}<b>${data.stats.supporters}</b> 位访客支持</span><span>${UI.icon("check")}<b>${data.stats.completed}</b> 项已完成</span><small>热度供排期参考，处理进度公开可见</small></div><div class="proposal-layout"><section class="proposal-feed"><nav class="proposal-tabs" aria-label="提案进度筛选">${[["", "全部提案"], ...Object.entries(state.statuses)].map(([id, label]) => `<a href="${esc(url({ status: id, sort, q: params.get("q") }))}" data-proposal-action="filter" class="${selected === id ? "active" : ""}" ${selected === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><div class="proposal-toolbar"><label class="proposal-search">${UI.icon("search")}<input id="proposal-search" type="search" aria-label="搜索提案" maxlength="150" placeholder="搜索站点、域名或模型…" value="${esc(params.get("q") || "")}"></label><div class="proposal-sort">${[["popular", "最多人想看"], ["newest", "最新提交"]].map(([id, label]) => `<a href="${esc(url({ status: selected, sort: id, q: params.get("q") }))}" data-proposal-action="filter" class="${sort === id ? "active" : ""}">${label}</a>`).join("")}</div></div><div id="proposal-cards">${data.items.map((p) => card(p)).join("") || empty(params.get("q") || selected ? "没有符合条件的提案" : "还没有收录提案")}</div><nav class="proposal-pagination" aria-label="提案分页"><span>共 ${data.total} 个提案 · ${data.page} / ${data.pages}</span>${data.page > 1 ? `<a class="btn btn-sm btn-ghost" data-proposal-action="filter" href="${esc(url({ status: selected, sort, q: params.get("q"), page: String(data.page - 1) }))}">上一页</a>` : ""}${data.page < data.pages ? `<a class="btn btn-sm btn-ghost" data-proposal-action="filter" href="${esc(url({ status: selected, sort, q: params.get("q"), page: String(data.page + 1) }))}">下一页</a>` : ""}</nav></section>${form()}</div>`;
  }
  function discussion(data) {
    const comments = data.comments;
    return `<section class="card proposal-discussion" id="discussion"><h2>${UI.icon("chat")}讨论 <small>${comments.total} 条</small></h2><form id="proposal-comment-form"><div><input name="author" maxlength="40" placeholder="你的昵称（选填）" aria-label="评论昵称" autocomplete="nickname"><span>围绕站点、模型与测试需求展开讨论</span></div><textarea name="content" required maxlength="1500" rows="3" aria-label="评论内容" placeholder="补充模型 ID、使用体验，或希望重点核对的问题。请勿填写 API Key。"></textarea><p class="proposal-error" role="alert"></p><button class="btn btn-primary btn-sm" type="submit">发表评论</button></form><div class="proposal-comments">${comments.items.map((c) => `<article><span class="proposal-comment-avatar">${UI.icon(c.official ? "shield" : "user")}</span><div><header><strong>${esc(c.author)}</strong>${c.official ? '<span class="proposal-official">官方回复</span>' : ""}<time>${time(c.created)}</time></header><p>${esc(c.content)}</p></div></article>`).join("") || '<p class="proposal-no-comments">还没有评论，来说说你想测什么。</p>'}</div><div class="proposal-pagination"><span>${comments.page} / ${comments.pages}</span>${comments.page > 1 ? '<button type="button" class="btn btn-sm btn-ghost" data-proposal-action="comments-prev">上一页</button>' : ""}${comments.page < comments.pages ? '<button type="button" class="btn btn-sm btn-ghost" data-proposal-action="comments-next">下一页</button>' : ""}</div></section>`;
  }
  function detail(data) {
    const p = data.proposal;
    return `<a href="proposals.html" class="proposal-back">← 全部收录提案</a><div class="proposal-layout"><section>${card(p, true)}${discussion(data)}</section><aside class="card proposal-progress"><h2>提案进度</h2><div class="proposal-current">${status(p)}<p>${({ collecting: "正在收集支持和测试需求。", scheduled: "已纳入检测安排，等待测试。", testing: "正在进行检测，结果审核后公开。", completed: "本次提案已处理完成。", deferred: "当前暂不安排，可查看下方处理说明。" })[p.status]}</p></div><p>${p.admin_note ? esc(p.admin_note) : "管理员处理后，会在这里同步进展。"}</p>${p.report_id ? `<a class="btn btn-primary btn-block" href="relays.html?id=${encodeURIComponent(p.report_id)}">查看检测报告 →</a>` : ""}<hr><small>提案和投票用于收集需求，不会自动触发付费检测。请在评论中补充你希望验证的模型与场景。</small></aside></div>`;
  }
  async function load() {
    const ticket = ++state.ticket, params = query(), id = params.get("id");
    const path = id ? "public/proposals/" + encodeURIComponent(id) + "?page=" + state.commentPage : "public/proposals?" + new URLSearchParams([...params].filter(([key]) => ["status", "sort", "q", "page"].includes(key)));
    const data = await api(path);
    if (ticket !== state.ticket) return;
    const draft = document.getElementById("proposal-form");
    const fields = draft ? new FormData(draft) : null;
    state.data = id ? null : data; state.detail = id ? data : null;
    document.getElementById("proposal-content").innerHTML = id ? detail(data) : listing(data);
    const restored = document.getElementById("proposal-form");
    if (fields && restored) for (const field of restored.elements) {
      if (!field.name) continue;
      if (field.type === "checkbox") field.checked = fields.getAll(field.name).includes(field.value);
      else field.value = fields.get(field.name) || "";
    }
    refreshModelSelection(); refreshModelOptions();
    if (id) document.title = data.proposal.name + " · 收录提案 | 大模型降智检测";
  }
  async function submit(event) {
    const form = event.target;
    if (!["proposal-form", "proposal-comment-form"].includes(form.id)) return;
    event.preventDefault();
    const error = form.querySelector(".proposal-error"), button = form.querySelector('[type="submit"]');
    error.textContent = ""; button.disabled = true;
    const f = new FormData(form), value = (key) => String(f.get(key) || "").trim();
    try {
      if (form.id === "proposal-form") {
        const tests = f.getAll("tests");
        if (!tests.length) throw new Error("请至少选择一个测试项目");
        const models = modelIds(value("models"));
        if (!models.length || models.length > 30) {
          form.querySelector(".proposal-model-picker").open = true;
          form.querySelector("#proposal-model-search").focus();
          throw new Error("请选择 1–30 个想测试的模型");
        }
        const result = await api("public/proposals", "POST", { name: value("name"), website_url: value("website_url"), models, tests, description: value("description"), author: value("author") || "热心访客" });
        location.href = url({ id: result.id }) + (result.duplicate ? "&existing=1" : "");
      } else {
        await api("public/proposals/" + encodeURIComponent(query().get("id")) + "/comments", "POST", { author: value("author") || "热心访客", content: value("content") });
        state.commentPage = 1; await load(); UI.toast("评论已发布");
      }
    } catch (e) { error.textContent = e.message; }
    finally { button.disabled = false; }
  }
  async function click(event) {
    const target = event.target.closest("[data-proposal-action]");
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.proposalAction;
    if (action.startsWith("model-")) {
      if (action === "model-done") document.querySelector(".proposal-model-picker").open = false;
      if (action === "model-remove") { updateModels(target.dataset.model, false); refreshModelOptions(); }
      if (action === "model-add") {
        const search = document.getElementById("proposal-model-search");
        const ids = modelIds(search.value);
        if (ids.length !== 1 || ids[0].length > 150) { UI.toast("请每次添加一个模型 ID，最多 150 字"); return; }
        updateModels(ids[0], true); search.value = ""; refreshModelOptions(); search.focus();
      }
      return;
    }
    if (action === "submit-focus") { document.getElementById("submit-proposal")?.scrollIntoView({ behavior: "smooth", block: "start" }); document.querySelector('#proposal-form [name="name"]')?.focus({ preventScroll: true }); return; }
    target.disabled = true;
    try {
      if (action === "vote") {
        const id = target.dataset.id, item = state.detail?.proposal || state.data?.items.find((p) => p.id === id);
        if (!item) return;
        const result = await api("public/proposals/" + encodeURIComponent(id) + "/vote", "PUT", { supported: !item.supported });
        Object.assign(item, result);
        target.outerHTML = vote(item);
        if (!state.detail) {
          // Keep ranking and supporter statistics in sync with persisted votes.
          await load();
        }
      } else if (action === "filter") {
        history.pushState(null, "", target.href); await load();
      } else if (action.startsWith("comments-")) {
        state.commentPage += action === "comments-next" ? 1 : -1; await load();
        document.getElementById("discussion").scrollIntoView({ block: "start" });
      }
    } catch (e) { UI.toast(e.message); }
    finally { target.disabled = false; }
  }
  async function mount() {
    if (typeof Official !== "undefined") Official.load(false);
    const root = document.getElementById("proposal-root");
    root.addEventListener("submit", submit); root.addEventListener("click", click);
    root.addEventListener("change", (event) => {
      if (event.target.matches('.proposal-model-option input[type="checkbox"]')) updateModels(event.target.value, event.target.checked);
    });
    document.addEventListener("click", (event) => {
      const picker = root.querySelector(".proposal-model-picker");
      if (picker?.open && !picker.contains(event.target) && !event.target.closest(".proposal-model-selected")) picker.open = false;
    });
    root.addEventListener("keydown", (event) => {
      const picker = event.target.closest(".proposal-model-picker");
      if (picker && event.key === "Escape") { event.preventDefault(); picker.open = false; picker.querySelector("summary").focus(); }
      if (event.target.id === "proposal-model-search" && event.key === "Enter") {
        event.preventDefault();
        const first = picker.querySelector('.proposal-model-options input[type="checkbox"]');
        if (first) { updateModels(first.value, !first.checked); refreshModelOptions(); }
        else if (!picker.querySelector(".proposal-model-custom").hidden) picker.querySelector(".proposal-model-custom").click();
      }
    });
    let searchTimer;
    root.addEventListener("input", (event) => {
      if (event.target.id === "proposal-model-search") { refreshModelOptions(); return; }
      if (event.target.id !== "proposal-search") return;
      clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = setTimeout(async () => {
        const params = query(); params.delete("page"); params.set("q", value);
        history.replaceState(null, "", "proposals.html?" + params);
        try { await load(); const input = document.getElementById("proposal-search"); if (input) { input.focus(); } } catch (e) { UI.toast(e.message); }
      }, 350);
    });
    window.addEventListener("popstate", () => { state.commentPage = 1; load().catch((e) => UI.toast(e.message)); });
    try {
      const session = await api("public/proposal-session"); Object.assign(state, session);
      await load();
      if (location.hash === "#discussion") document.getElementById("discussion")?.scrollIntoView({ block: "start" });
      if (query().get("existing")) UI.toast("这个站点已有提案，欢迎在原提案补充模型和测试需求");
    } catch (e) {
      document.getElementById("proposal-content").innerHTML = `<div class="proposal-empty card"><h2>暂时无法加载收录提案</h2><p>${esc(e.message)}</p><p>本地预览请使用完整后台地址 http://127.0.0.1:8767/proposals.html</p><a class="btn btn-ghost" href="proposals.html">重新加载</a></div>`;
    }
  }
  return { mount };
})();

Pages.proposals = () => UI.shell("proposals", `<div id="proposal-root"><section class="proposal-hero"><div><p class="proposal-eyebrow">${UI.icon("chat")}社区共建 · 下一站，由你提名</p><h1>收录提案</h1><p>想看哪家中转站？提名、支持、聊聊想测的模型，一起把下一站选出来。</p>${new URLSearchParams(location.search).has("id") ? "" : '<button type="button" class="btn btn-primary btn-sm" data-proposal-action="submit-focus">＋ 提交提案</button>'}</div>${UI.veridropCard()}</section><div id="proposal-content" aria-live="polite"><div class="proposal-empty">正在加载收录提案…</div></div></div>`, { officialTicker: true });
Pages.mount.proposals = Proposals.mount;
