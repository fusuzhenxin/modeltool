/* Ad reports: each campaign, physical slot and source page remains independent. */
const AdminAdAnalytics = {
  esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  number(value) { return Number(value || 0).toLocaleString("zh-CN"); },
  rate(row) { return !row.impressions && row.clicks ? "—" : row.ctr.toFixed(2) + "%"; },
  day(offset = 0) { return new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10); },
  filters: null, sequence: 0,
  sponsorMode: false,
  endpoint() { return this.sponsorMode ? "sponsor/analytics" : "admin/advertising/analytics"; },
  initFilters() {
    this.filters ||= { start: this.day(-29), end: this.day(), ad_id: "", placement: "", page: "", traffic: "clean" };
    if (this.sponsorMode) this.filters.traffic = "clean";
    return this.filters;
  },
  query() { return new URLSearchParams(this.initFilters()).toString(); },
  open(adId) {
    this.initFilters(); this.filters.ad_id = adId; this.filters.page = ""; this.filters.placement = "";
    location.hash = "ad-analytics";
  },
  metric(label, value, hint) { return `<section class="card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></section>`; },
  render(data) {
    this.data = data;
    const E = this.esc, N = this.number, f = this.initFilters(), summary = data.summary;
    const options = (entries, value, all) => `<option value="">${all}</option>` + entries.map(([key, label]) => `<option value="${E(key)}" ${value === key ? "selected" : ""}>${E(label)}</option>`).join("");
    const trafficLabels = { clean: "过滤后流量", all: "全部流量", automated: "已识别 AI / 自动化", internal: "管理员访问", unknown: "未识别客户端" };
    const started = new Date(data.started_at * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const zeroNote = summary.impressions || summary.clicks ? "" : `<div class="adstats-empty">当前筛选下暂无统计。广告需实际进入可视区域才记录曝光。${this.sponsorMode ? '' : '管理员与已识别自动化访问请切换对应口径查看。'}</div>`;
    return `<div class="adstats"><div class="adops-top"><div><span class="adops-eyebrow">ADVERTISING ANALYTICS</span><h1>${this.sponsorMode ? "我的投放效果" : "广告流量分析"}</h1><p>每条广告独立统计，按实际展示位置和所在页面查看投放效果。</p></div>${this.sponsorMode ? "" : '<a class="btn" href="#ads">管理广告投放</a>'}</div>
      <form class="card adstats-filter" data-stats-form><div class="adstats-fields">
        <label>广告 / 订单<select name="ad_id" aria-label="选择统计广告">${options(data.options.ads.map(ad => [ad.id, (ad.name || ad.title) + (ad.deleted ? "（已移除）" : "")]), f.ad_id, "全部广告")}</select></label>
        <label>开始日期<input type="date" name="start" value="${E(data.start)}" required></label><label>结束日期（含当天）<input type="date" name="end" value="${E(data.end)}" required></label>
        <label>展示位置<select name="placement" aria-label="统计展示位置">${options(Object.entries(data.options.placements), f.placement, "全部位置")}</select></label>
        <label>所在页面<select name="page" aria-label="统计所在页面">${options(Object.entries(data.options.pages), f.page, "全部页面")}</select></label>
        ${this.sponsorMode ? '' : `<label>统计口径<select name="traffic" aria-label="选择流量口径">${Object.entries(trafficLabels).map(([key, label]) => `<option value="${key}" ${f.traffic === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>`}
      </div><div class="adstats-controls"><button class="btn primary" type="submit">查询 / 刷新</button><button class="btn" type="button" data-stats-days="1">今天</button><button class="btn" type="button" data-stats-days="7">近 7 天</button><button class="btn" type="button" data-stats-days="30">近 30 天</button><button class="text-btn" type="button" data-stats-reset>重置筛选</button><span>北京时间 · 最多 366 天</span><button class="btn" type="button" data-stats-export>导出明细 CSV</button></div><div class="error-box" role="alert"></div></form>
      <p class="adstats-scope"><b>${trafficLabels[data.traffic]}</b> · ${E(data.start)} 至 ${E(data.end)} · ${f.ad_id ? E(data.options.ads.find(ad => ad.id === f.ad_id)?.name || "所选广告") : "全部广告"} · ${E(data.options.pages[f.page] || "全部页面")} · ${E(data.options.placements[f.placement] || "全部位置")}</p>
      <div class="adops-metrics adstats-metrics">${this.metric("可视曝光次数", N(summary.impressions), "至少 50% 面积持续可见 1 秒")}${this.metric("跳转官网点击", N(summary.clicks), "每次页面访问，每条广告每个位置最多一次")}${this.metric("点击率", this.rate(summary), "点击次数 ÷ 可视曝光次数")}${this.metric("独立访客", N(summary.visitors), "所选范围内按匿名浏览器标识去重")}</div>
      ${this.sponsorMode ? '' : `<div class="adstats-classification"><span>全部：${N(data.raw.impressions)} 曝光 / ${N(data.raw.clicks)} 点击</span><span>AI / 自动化：${N(data.classes.automated.impressions)} / ${N(data.classes.automated.clicks)}</span><span>管理员：${N(data.classes.internal.impressions)} / ${N(data.classes.internal.clicks)}</span><span>未识别客户端：${N(data.classes.unknown.impressions)} / ${N(data.classes.unknown.clicks)}</span></div>`}${zeroNote}
      <section class="card adstats-trend"><div class="card-head"><h2>每日趋势 <small>曝光 / 点击，独立纵轴</small></h2><span class="muted">${data.trend.length} 天 · 仅启用后数据</span></div>${this.chart(data.trend)}</section>
      <section class="card"><div class="card-head"><h2>流量来自哪个页面</h2>${f.page ? '<button class="text-btn" data-stats-page="">查看全部页面</button>' : '<span class="muted">点击页面卡片查看具体广告位</span>'}</div><div class="adstats-pages">${data.pages.map(page => `<button class="adstats-page ${f.page === page.page ? "active" : ""}" data-stats-page="${E(page.page)}"><strong>${E(page.label)}</strong><code>${E(page.page)}</code><span><b>${N(page.impressions)}</b> 曝光 <i> / </i> <b>${N(page.clicks)}</b> 点击</span><small>CTR ${this.rate(page)} · ${N(page.visitors)} 位访客</small></button>`).join("") || '<p class="adstats-empty">暂无页面流量记录</p>'}</div></section>
      <section class="card adstats-campaigns"><div class="card-head"><h2>每条广告的效果</h2><small>独立订单；套餐含多处展示，访客数去重</small></div><div class="adops-scroll"><table><thead><tr><th>广告 / 订单</th><th>曝光次数</th><th>官网点击</th><th>独立访客</th><th>点击率</th><th>操作</th></tr></thead><tbody>${data.ads.map(ad => `<tr><td><strong>${E(ad.title)}</strong><span class="sub">${E(ad.name)} · ${E(ad.id)}</span></td><td>${N(ad.impressions)}</td><td>${N(ad.clicks)}</td><td>${N(ad.visitors)}</td><td>${this.rate(ad)}</td><td><button class="text-btn" data-stats-ad="${E(ad.id)}">查看页面与位置</button></td></tr>`).join("") || '<tr><td colspan="6" class="adstats-empty">暂无广告</td></tr>'}</tbody></table></div></section>
      <section class="card adstats-details"><div class="card-head"><h2>页面 × 位置 × 广告明细</h2><small>${data.details.length} 组记录</small></div><div class="adops-scroll"><table><thead><tr><th>所在页面</th><th>具体展示位置</th><th>广告</th><th>曝光次数</th><th>官网点击</th><th>独立访客</th><th>点击率</th></tr></thead><tbody>${data.details.map(row => `<tr><td><strong>${E(data.options.pages[row.page] || row.page)}</strong><span class="sub">${E(row.page)}</span></td><td>${E(data.options.placements[row.placement])}</td><td>${E(data.options.ads.find(ad => ad.id === row.ad_id)?.title || "已移除广告")}<span class="sub">${E(row.ad_id)}</span></td><td>${N(row.impressions)}</td><td>${N(row.clicks)}</td><td>${N(row.visitors)}</td><td>${this.rate(row)}</td></tr>`).join("") || '<tr><td colspan="7" class="adstats-empty">当前范围暂无明细</td></tr>'}</tbody></table></div></section>
      <details class="card adstats-rules"><summary>统计口径与启用时间</summary><p>统计从 ${E(started)}（北京时间）启用，不回填历史曝光或点击。仅统计后台生效的广告；商务合作入口、站内导航和后台素材预览不计入。</p><p>曝光需页面处于前台、广告至少 50% 面积持续可见 1 秒。每次页面访问，对同一广告在同一位置的曝光和官网点击分别最多记录一次；刷新或重新打开页面属于新访问。套餐各位置独立计数，因此合计曝光不是页面 PV。</p><p>过滤后流量排除已识别 AI、爬虫、自动化、管理员与未识别客户端。规则不能识别全部机器人，也不能证明剩余访问均为真人。点击可能发生在满 1 秒之前；点击率不等同于注册或付费转化率。</p><p>独立访客按第一方匿名浏览器标识去重，跨设备、清除 Cookie 或阻止 Cookie 会影响结果；不等同于人数。不保存原始 IP、原始 User-Agent、页面查询参数或用户填写的接口密钥。不同分组的独立访客数不可直接相加。</p></details></div>`;
  },
  chart(rows) {
    if (!rows.length) return '<p class="adstats-empty">该日期范围尚未启用统计，暂无历史趋势。</p>';
    const E = this.esc;
    return `<div class="adstats-charts">${[["impressions", "曝光", "#5269db"], ["clicks", "点击", "#26a18e"]].map(([key, label, color]) => {
      const peak = Math.max(1, ...rows.map(row => row[key]));
      const points = rows.map((row, i) => `${rows.length === 1 ? 300 : 12 + i / (rows.length - 1) * 576},${110 - row[key] / peak * 90}`).join(" ");
      return `<div><strong>${label} <small>峰值 ${this.number(peak === 1 && !rows.some(row => row[key]) ? 0 : peak)}</small></strong><svg viewBox="0 0 600 130" role="img" aria-label="每日${label}趋势"><line x1="12" y1="110" x2="588" y2="110" stroke="#e5e9f3"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>${rows.map((row, i) => `<circle cx="${rows.length === 1 ? 300 : 12 + i / (rows.length - 1) * 576}" cy="${110 - row[key] / peak * 90}" r="3" fill="${color}"><title>${E(row.day)} · ${row[key]} ${label}</title></circle>`).join("")}</svg><div class="adstats-axis"><span>${E(rows[0]?.day)}</span><span>${E(rows.at(-1)?.day)}</span></div></div>`;
    }).join("")}</div>`;
  },
  mount(root, api) {
    this.root = root; this.api = api;
    if (typeof AdminSelect !== "undefined") AdminSelect.enhance(root.querySelector('.adstats'));
    const form = root.querySelector('[data-stats-form]');
    form.addEventListener("submit", event => { event.preventDefault(); this.readForm(); this.refresh(); });
    root.querySelector('.adstats').addEventListener("click", event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-stats-export')) return this.export();
      if (button.hasAttribute('data-stats-reset')) { this.filters = null; this.initFilters(); return this.refresh(); }
      if (button.hasAttribute('data-stats-days')) { this.readForm(); this.filters.start = this.day(1 - Number(button.dataset.statsDays)); this.filters.end = this.day(); return this.refresh(); }
      if (button.hasAttribute('data-stats-page')) { this.filters.page = button.dataset.statsPage; return this.refresh(); }
      if (button.hasAttribute('data-stats-ad')) { this.filters.ad_id = button.dataset.statsAd; return this.refresh(); }
    });
  },
  readForm() { this.filters = Object.fromEntries(new FormData(this.root.querySelector('[data-stats-form]'))); this.initFilters(); },
  async refresh() {
    const sequence = ++this.sequence, root = this.root;
    const error = root.querySelector('[data-stats-form] .error-box'); error.textContent = "";
    root.querySelectorAll('.adstats button').forEach(button => { button.disabled = true; });
    try {
      const data = await this.api(this.endpoint() + "?" + this.query());
      if (sequence !== this.sequence || (!this.sponsorMode && location.hash !== "#ad-analytics")) return;
      root.querySelector('.adstats').outerHTML = this.render(data); this.mount(root, this.api);
    } catch (e) { if (error.isConnected) error.textContent = e.message; }
    finally { root.querySelectorAll('.adstats button').forEach(button => { button.disabled = false; }); }
  },
  export() {
    if (this.sponsorMode) {
      const link = document.createElement('a'); link.href = '/api/sponsor/report.csv?' + this.query(); link.download = ''; link.click(); return;
    }
    const data = this.data;
    const escape = value => '"' + String(value ?? "").replace(/^([\s]*[=+@-])/, "'$1").replace(/"/g, '""') + '"';
    const rows = [["开始日期", "结束日期", "流量口径", "广告ID", "广告标题", "所在页面", "页面路径", "展示位置", "曝光次数", "官网点击", "独立访客", "点击率%"], ...data.details.map(row => [data.start, data.end, data.traffic, row.ad_id, data.options.ads.find(ad => ad.id === row.ad_id)?.title, data.options.pages[row.page], row.page, data.options.placements[row.placement], row.impressions, row.clicks, row.visitors, row.ctr])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(row => row.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement('a'); link.href = url; link.download = `广告流量-${data.start}-${data.end}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
