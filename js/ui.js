const UI = {
  esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },
  icon(name) {
    const paths = {
      shield: '<path fill="currentColor" stroke="none" d="M12 2.4 19.2 5.2v6c0 4.7-3.1 7.9-7.2 9.6-4.1-1.7-7.2-4.9-7.2-9.6V5.2L12 2.4zm-1 10.1 3.3-3.3 1.3 1.3-4.6 4.6-2.5-2.5 1.3-1.3 1.2 1.2z"/>',
      doc: '<path fill="currentColor" stroke="none" d="M7 3h6.4L18 7.6V19.4A1.6 1.6 0 0 1 16.4 21H7.6A1.6 1.6 0 0 1 6 19.4V4.6A1.6 1.6 0 0 1 7.6 3H7z"/><path fill="#fff" stroke="none" d="M8.3 12h7.4v1.5H8.3zm0 3.1h5.1v1.5H8.3z"/>',
      candy: '<path fill="currentColor" stroke="none" d="M3.6 12 8 8.4v7.2zM20.4 12 16 8.4v7.2z"/><rect x="7.6" y="7.6" width="8.8" height="8.8" rx="4.4" fill="currentColor" stroke="none"/>',
      car: '<path fill="currentColor" fill-rule="evenodd" stroke="none" d="M4 15.6h16v2.1a1 1 0 0 1-1 1h-.2a1.7 1.7 0 0 1-3.3 0H8.5a1.7 1.7 0 0 1-3.3 0H5a1 1 0 0 1-1-1v-2.1zm2.3-.9 1.7-4.2c.2-.6.8-1 1.5-1h4.8c.7 0 1.3.4 1.5 1l1.9 4.2H6.3zm2.1-3.1h2.3V13H8.4v-1.4zm4.4 0H15V13h-2.2v-1.4z"/>',
      clock: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/><path stroke="#fff" stroke-width="1.8" d="M12 8v4.4l2.6 1.6"/>',
      bulb: '<path fill="currentColor" stroke="none" d="M9 16.2h6v1.4H9zm.8 2.3h4.4V20H9.8zM12 3.2a5.4 5.4 0 0 0-3.3 9.6c.5.5.9 1.1.9 1.8h4.8c0-.7.4-1.3.9-1.8A5.4 5.4 0 0 0 12 3.2z"/>',
      check: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/><path stroke="#fff" stroke-width="2" d="M8.4 12.2 10.8 14.6 15.7 9.6"/>',
      mark: '<path d="M5.8 12.4 10 16.4 18.2 7.6" stroke="currentColor" stroke-width="2.4" fill="none"/>',
      chat: '<path fill="currentColor" stroke="none" d="M5.4 5.2h12.2A2.2 2.2 0 0 1 19.8 7.4V14a2.2 2.2 0 0 1-2.2 2.2H9.4L5 19.4V7.4a2.2 2.2 0 0 1 2.2-2.2h-1.8z"/>',
      code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
      list: '<path d="M9 7h10M9 12h10M9 17h10"/><path d="M5.5 7h.5M5.5 12h.5M5.5 17h.5"/>',
      play: '<path d="M8 6.5v11l10-5.5-10-5.5z" fill="currentColor" stroke="none"/>',
      refresh: '<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4.5V9h-4.5"/>',
      user: '<circle cx="12" cy="9" r="3.1"/><path d="M6.2 18.5a6 6 0 0 1 11.6 0"/>',
      chevron: '<path d="m7 10 5 5 5-5"/>',
      back: '<path d="M15 6 9 12l6 6"/>',
      more: '<circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
      chart: '<path d="M5 19V5M5 19h14"/><path d="M9 15v-3M13 15V8M17 15v-5"/>',
      info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
      target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 3.5 3.5"/>',
      download: '<path d="M12 5v10"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>',
      trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/>',
      logout: '<path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h6A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 10 18.5V17"/><path d="M4 12h10"/><path d="m11 9 3 3-3 3"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      menu: '<path d="M5 7h14M5 12h14M5 17h14"/>'
    };
    return `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  },
  diffLabel(key) {
    return { easy: "简单", medium: "中等", hard: "困难" }[key] || "中等";
  },
  statusBadge(status) {
    const map = {
      done: ["ok", "已完成"],
      running: ["run", "进行中"],
      pending: ["idle", "未开始"],
      stopped: ["stop", "已终止"]
    };
    const pair = map[status] || map.pending;
    return `<span class="badge ${pair[0]}"><i></i>${pair[1]}</span>`;
  },
  levelBadge(score, scene) {
    const info = Engine.judgeText(score, scene);
    if (info.level === "none") return `<span class="badge idle"><i></i>未检测</span>`;
    const cls = info.level === "ok" ? "ok" : info.level === "warn" ? "warn" : "bad";
    return `<span class="badge ${cls}"><i></i>${UI.esc(info.label)}</span>`;
  },
  modelChip(id, name) {
    const model = DATA.model(id);
    const label = name || model.name;
    return `<span class="model-chip"><span class="m-dot" style="background:${model.color}">${UI.esc(model.short)}</span>${UI.esc(label)}</span>`;
  },
  ring(score, color) {
    const missing = score == null || Number.isNaN(Number(score));
    const shown = missing ? "—" : score;
    const ratio = missing ? 0 : Math.max(0, Math.min(100, Number(score))) / 100;
    const r = 46;
    const c = 2 * Math.PI * r;
    const dash = c * ratio;
    const judged = Engine.judge(missing ? null : Number(score));
    const tone = color || (judged === "bad" ? "#ef5d5d" : judged === "warn" ? "#f0a03a" : judged === "ok" ? "#22c58b" : "#d5deec");
    const arc = ratio > 0
      ? `<circle cx="60" cy="60" r="${r}" stroke="${tone}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${dash} ${c - dash}"></circle>`
      : "";
    return `<div class="ring" aria-label="得分 ${shown}">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" stroke="#e7eef8" stroke-width="10" fill="none"></circle>
        ${arc}
      </svg>
      <div class="num">${shown}<small>/100</small></div>
    </div>`;
  },
  shell(active, body) {
    const nav = [
      ["home", "index.html", "首页"],
      ["detect", "detect.html", "模型检测页"],
      ["basic", "basic.html", "基础测试页"],
      ["candy", "candy.html", "糖果测试页"],
      ["pelican", "pelican.html", "鹈鹕骑车测试页"],
      ["works", "works.html", "HTML鹈鹕作品"]
    ].map(([id, href, label]) => `<a href="${href}" class="${active === id ? "active" : ""}">${label}</a>`).join("");
    const cfg = Store.api();
    let apiLabel = "接口设置";
    if (cfg.baseUrl && cfg.apiKey) {
      try { apiLabel = new URL(cfg.baseUrl).host; } catch (err) { apiLabel = "已配置接口"; }
    }
    const marks = `<div class="marks">
      <button class="mark-btn" type="button" data-action="show-qq" aria-label="QQ群" title="QQ群">
        <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/></svg>
      </button>
      <a class="mark-btn" href="https://github.com/fusuzhenxin/modeltool" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">
        <svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      </a>
    </div>`;
    const account = `${marks}<button class="api-btn" type="button" data-action="open-api" title="${UI.esc(apiLabel)}">${UI.icon("info")}<span>${UI.esc(apiLabel)}</span></button>`;
    return `<header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="index.html"><img class="logo" src="assets/favicon-32.png" width="32" height="32" alt=""><span>大模型降智检测</span></a>
        <nav class="nav" id="nav">${nav}</nav>
        <div class="account">${account}<button class="nav-toggle" type="button" data-action="nav" aria-label="打开菜单">${UI.icon("menu")}</button></div>
      </div>
    </header>
    <main class="page"><div class="container">${body}</div></main>`;
  },
  currentFile() {
    const file = (location.pathname.split("/").pop() || "index.html") + location.search;
    return file || "index.html";
  },
  safeNext(raw) {
    if (!raw) return "index.html";
    let text = raw;
    try { text = decodeURIComponent(raw); } catch (err) { return "index.html"; }
    if (text.startsWith("/") || text.includes("\\") || text.includes("://") || text.includes("..")) return "index.html";
    if (!/^[a-z0-9_.\-]+\.html([?#].*)?$/i.test(text)) return "index.html";
    return text;
  },
  select(id, value, options) {
    const current = options.find((item) => item.value === value) || options[0];
    const menu = options.map((item) => `<button type="button" data-action="pick" data-select="${UI.esc(id)}" data-value="${UI.esc(item.value)}" class="${item.value === current.value ? "active" : ""}">${item.icon || ""}${UI.esc(item.label)}</button>`).join("");
    return `<div class="select" data-select-wrap="${UI.esc(id)}">
      <button type="button" class="select-btn" data-action="toggle-select" data-select="${UI.esc(id)}">
        <span class="select-label">${current.icon || ""}${UI.esc(current.label)}</span>
        ${UI.icon("chevron")}
      </button>
      <div class="select-menu"><input class="select-filter" placeholder="搜索模型或 ID" aria-label="搜索模型">${menu}</div>
    </div>`;
  },
  field(label, control) {
    return `<div class="field"><span>${label}</span>${control}</div>`;
  },
  toast(message) {
    document.querySelectorAll(".toast").forEach((node) => node.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  },
  modal({ title, body, okText, cancelText, onOk }) {
    const mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${UI.esc(title)}</h3>
      <p>${body}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-modal="cancel">${UI.esc(cancelText || "取消")}</button>
        <button type="button" class="btn btn-primary btn-sm" data-modal="ok">${UI.esc(okText || "确定")}</button>
      </div>
    </div>`;
    mask.addEventListener("click", (event) => {
      if (event.target === mask || event.target.closest("[data-modal='cancel']")) mask.remove();
      if (event.target.closest("[data-modal='ok']")) {
        mask.remove();
        onOk?.();
      }
    });
    document.body.appendChild(mask);
  },
  closeFloaters() {
    document.querySelectorAll(".select.open").forEach((node) => node.classList.remove("open"));
    document.querySelectorAll(".menu-pop").forEach((node) => node.remove());
  },
  download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  bind() {
    if (UI.bound) return;
    UI.bound = true;
    document.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) {
        if (!event.target.closest(".select") && !event.target.closest(".menu-pop")) UI.closeFloaters();
        return;
      }
      const action = actionEl.dataset.action;
      if (action !== "toggle-select" && action !== "pick" && action !== "more" && action !== "user-menu") UI.closeFloaters();
      if (Actions[action]) Actions[action](actionEl, event);
    });
    document.addEventListener("input", (event) => {
      const input = event.target.closest(".select-filter");
      if (!input) return;
      const query = input.value.trim().toLowerCase();
      input.parentElement.querySelectorAll("button").forEach((button) => {
        const text = (button.textContent + " " + (button.dataset.value || "")).toLowerCase();
        button.hidden = Boolean(query) && !text.includes(query);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        UI.closeFloaters();
        document.querySelector(".modal-mask")?.remove();
      }
    });
  }
};

const Form = {
  values: {},
  set(id, value) { Form.values[id] = value; },
  get(id, fallback) { return Form.values[id] ?? fallback; }
};
