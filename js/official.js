const Official = {
  order: ["openai", "anthropic", "gemini", "deepseek", "moonshot", "xai"],
  async load(fresh) {
    const sync = document.getElementById("official-sync");
    const pills = document.getElementById("official-pills");
    if (!pills) return;
    if (sync) sync.textContent = "正在同步官方状态…";
    const refresh = document.getElementById("official-refresh");
    if (refresh) refresh.disabled = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch("/api/status" + (fresh ? "?fresh=1" : ""), { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      Official.paint(data);
    } catch (err) {
      if (sync) sync.textContent = "官方状态没有返回";
      if (!pills.children.length) pills.innerHTML = "";
    } finally {
      clearTimeout(timer);
      if (refresh) refresh.disabled = false;
    }
  },
  paint(data) {
    const sync = document.getElementById("official-sync");
    const pills = document.getElementById("official-pills");
    const byId = {};
    (data.vendors || []).forEach((item) => { byId[item.id] = item; });
    const current = (typeof qs === "function" ? qs().id : "") || "";
    pills.innerHTML = Official.order.map((id) => {
      const item = byId[id] || { id: id, name: id, level: "idle", levelText: "未获取", percent: null };
      const pct = item.percent == null ? "" : `<strong>${Number(item.percent).toFixed(2)}%</strong>`;
      const active = current === id ? " active" : "";
      return `<a class="official-pill ${UI.esc(item.level || "idle")}${active}" href="status.html?id=${UI.esc(id)}"><i class="dot"></i><span>${UI.esc(item.name || id)}</span>${pct}<em>${UI.esc(item.levelText || "未获取")}</em></a>`;
    }).join("");
    if (sync) {
      const stamp = data.fetchedAt ? data.fetchedAt.replace("T", " ").replace("Z", " UTC") : "";
      sync.textContent = stamp ? "已同步官方状态 · " + stamp : "已同步官方状态";
    }
    document.querySelectorAll(".seo-only-h1").forEach((node) => node.remove());
    const detail = document.getElementById("official-detail");
    if (detail) Official.detail(byId[current] || byId.openai || null);
  },
  detail(item) {
    const detail = document.getElementById("official-detail");
    if (!detail) return;
    if (!item) {
      detail.innerHTML = `<div class="empty"><h3>没有这家的官方状态</h3></div>`;
      return;
    }
    const error = item.ok ? "" : `<p class="explain">这一家的官方状态页这次没有取到。${UI.esc(item.error || "")}</p>`;
    const bannerTitle = item.bannerTitle || (item.level === "ok" ? "We're fully operational" : item.levelText || "");
    const bannerBody = item.bannerBody || item.description || "";
    const groups = item.groups || [];
    const body = groups.length ? Official.groups(item) : Official.components(item);
    detail.innerHTML = `
      <div class="page-head">
        <div class="crumb"><a href="index.html">首页</a> / 官方状态</div>
        <h1>${UI.esc(item.name)} 官方状态</h1>
      </div>
      <section class="status-official">
        ${error}
        <div class="status-banner ${UI.esc(item.level || "idle")}">
          <strong>${UI.esc(bannerTitle)}</strong>
          ${bannerBody ? `<p>${UI.esc(bannerBody)}</p>` : ""}
        </div>
        ${body}
        ${Official.incidentSheet(item)}
      </section>`;
  },
  incidentSheet(item) {
    const rows = (item.incidents || []).map((row) => `<article class="status-incident"><h3>${UI.esc(row.name)}</h3><p class="note">${UI.esc(row.statusText || "")}${row.time ? " · " + UI.esc(row.time) : ""}</p>${row.body ? `<p>${UI.esc(row.body)}</p>` : ""}</article>`).join("");
    const body = rows || `<p class="note">官方最近没有公布事件。</p>`;
    return `<div class="status-sheet status-incidents"><div class="status-sheet-hd"><h2>近期事件</h2></div>${body}</div>`;
  },
  bars(list) {
    return `<div class="uptime-bars">${(list || []).map((kind) => {
      const value = String(kind || "empty");
      if (value.charAt(0) === "#") return `<i style="background:${UI.esc(value)}"></i>`;
      return `<i class="${UI.esc(value)}"></i>`;
    }).join("")}</div>`;
  },
  groups(item) {
    const rows = (item.groups || []).map((group) => {
      const pct = group.uptime == null ? "" : `<span class="uptime-pct">${Number(group.uptime)}% uptime</span>`;
      const kids = (group.children || []).map((child) => `<div class="uptime-child"><div class="uptime-head"><strong>${UI.esc(child.name)}</strong>${child.uptime == null ? "" : `<span class="uptime-pct">${Number(child.uptime)}% uptime</span>`}</div>${Official.bars(child.bars)}</div>`).join("");
      const count = `${UI.esc(String(group.count))} component${Number(group.count) === 1 ? "" : "s"}`;
      const nested = kids ? `<details class="uptime-nested"><summary>${count}</summary>${kids}</details>` : (Number(group.count) ? `<span class="uptime-count">${count}</span>` : "");
      return `<article class="uptime-row">
        <div class="uptime-head">
          <i class="uptime-mark ${UI.esc(item.level || "ok")}"></i>
          <strong>${UI.esc(group.name)}</strong>
          ${nested}
          ${pct}
        </div>
        ${Official.bars(group.bars)}
      </article>`;
    }).join("");
    return `<div class="status-sheet">
      <div class="status-sheet-hd"><h2>System status</h2><span>${UI.esc(item.period || "")}</span></div>
      ${rows}
      <p class="status-history"><a href="${UI.esc(item.history || item.source || "#")}" target="_blank" rel="noreferrer">View history</a></p>
    </div>`;
  },
  components(item) {
    const rows = (item.components || []).map((row) => `<div class="status-item"><span>${UI.esc(row.name)}</span><em class="${UI.esc(row.status === "operational" ? "ok" : "warn")}">${UI.esc(row.statusText || row.status || "")}</em></div>`).join("");
    return `<div class="status-sheet">
      <div class="status-sheet-hd"><h2>System status</h2><a href="${UI.esc(item.source || "#")}" target="_blank" rel="noreferrer">打开官方状态页</a></div>
      ${rows ? `<div class="status-list">${rows}</div>` : `<p class="note">这家官方源没有按组件公布每日可用率。</p>`}
    </div>`;
  }
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("#official-refresh");
  if (!button) return;
  event.preventDefault();
  Official.load(true);
});
