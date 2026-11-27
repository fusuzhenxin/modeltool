/* Private organic discovery report; independent of campaign analytics. */
const AdminStationTraffic = {
  filters: null,
  esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  n(value) { return Number(value || 0).toLocaleString('zh-CN'); },
  rate(value) { return value == null ? '—' : Number(value).toFixed(2) + '%'; },
  day(offset = 0) { return new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10); },
  query() {
    this.filters ||= { start: this.day(-29), end: this.day(), station_id: '', page: '', placement: '', traffic: 'clean' };
    return new URLSearchParams(this.filters).toString();
  },
  chart(rows) {
    const max = Math.max(1, ...rows.flatMap(r => [r.impressions, r.outbound]));
    return `<div class="relay-metrics-chart" role="img" aria-label="每日可视曝光与官网外跳点击趋势">${rows.map((r, i) => `<div class="relay-metrics-day" title="${this.esc(r.day)}：曝光 ${r.impressions}，官网点击 ${r.outbound}"><div><i style="height:${r.impressions / max * 100}%"></i><b style="height:${r.outbound / max * 100}%"></b></div><small>${i % Math.max(1, Math.ceil(rows.length / 10)) ? '' : r.day.slice(5)}</small></div>`).join('')}</div>`;
  },
  render(data) {
    this.data = data; this.query();
    const E = this.esc, N = this.n, f = this.filters, s = data.summary;
    const trafficNames = { clean: '过滤后访客', all: '全部流量', automated: '已识别 AI / 自动化', internal: '管理员访问', unknown: '未识别客户端' };
    const option = (rows, selected, all) => `<option value="">${all}</option>` + rows.map(([key, label]) => `<option value="${E(key)}" ${key === selected ? 'selected' : ''}>${E(label)}</option>`).join('');
    const station = id => data.options.stations.find(s => s.id === id) || { name: '已移除站点', domain: id };
    const metric = (label, value, hint) => `<section class="card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></section>`;
    const table = (headers, rows, columns) => `<div class="relay-metrics-scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${columns}" class="relay-metrics-empty">当前筛选下暂无记录</td></tr>`}</tbody></table></div>`;
    const traffic = r => `<td>${N(r.impressions)}</td><td>${N(r.visitors)}</td><td><strong>${N(r.outbound)}</strong></td><td>${this.rate(r.ctr)}</td><td>${N(r.internal_clicks)}</td>`;
    const groupRows = (rows, key, labels) => rows.map(r => `<tr><td>${E(labels[r[key]] || r[key])}</td>${traffic(r)}</tr>`);
    return `<div class="relay-metrics"><header class="relay-metrics-heading"><div><span>STATION DISCOVERY</span><h1>中转站流量统计</h1><p>了解日报和稳定性榜单为各中转站带来了多少关注与访问。</p></div><button class="btn" type="button" data-relay-export>导出明细 CSV</button></header>
      <div class="relay-metrics-notice"><b>独立统计自然展示流量</b><span>本模块单独记录，不计入广告曝光、广告点击或站长广告报表。</span></div>
      <form class="card relay-metrics-filter" data-relay-stats-form><div>
        <label>中转站<select name="station_id" aria-label="选择统计中转站">${option(data.options.stations.map(s => [s.id, s.name + (s.hidden ? '（已隐藏 / 移除）' : '')]), f.station_id, '全部中转站')}</select></label>
        <label>开始日期<input type="date" name="start" value="${E(data.start)}" required></label><label>结束日期（含当天）<input type="date" name="end" value="${E(data.end)}" required></label>
        <label>所在页面<select name="page" aria-label="选择来源页面">${option(Object.entries(data.options.pages), f.page, '全部页面')}</select></label>
        <label>展示位置<select name="placement" aria-label="选择展示位置">${option(Object.entries(data.options.placements), f.placement, '全部位置')}</select></label>
        <label>流量口径<select name="traffic" aria-label="选择流量口径">${Object.entries(trafficNames).map(([key, label]) => `<option value="${key}" ${f.traffic === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><footer><button class="btn primary" type="submit">查询 / 刷新</button>${[1, 7, 30].map(n => `<button class="btn" type="button" data-relay-days="${n}">${n === 1 ? '今天' : '近 ' + n + ' 天'}</button>`).join('')}<button class="text-btn" type="button" data-relay-reset>重置筛选</button><span>北京时间 · 最多 366 天</span></footer><p class="error-box" role="alert"></p></form>
      <p class="relay-metrics-scope">${E(trafficNames[data.traffic])} · ${E(data.start)} 至 ${E(data.end)} · ${E(data.options.pages[f.page] || '全部页面')} · ${E(data.options.placements[f.placement] || '全部位置')}</p>
      <div class="relay-metrics-totals">${metric('可视曝光', N(s.impressions), '至少一半面积持续可见 1 秒')}${metric('曝光独立访客', N(s.visitors), '所选范围内匿名浏览器去重')}${metric('访问中转站官网', N(s.outbound), '只记录官网箭头和访问链接')}${metric('官网外跳点击率', this.rate(s.ctr), '官网点击 ÷ 可视曝光')}${metric('站内查看', N(s.internal_clicks), `档案 ${N(s.profile)} · 报告 ${N(s.report)} · 展开详情 ${N(s.details)}`)}</div>
      <p class="relay-metrics-classes">全部流量：曝光 ${N(data.raw.impressions)} / 官网点击 ${N(data.raw.outbound)}${Object.entries(data.classes).map(([key, r]) => `　${E(trafficNames[key] || key)}：${N(r.impressions)} / ${N(r.outbound)}`).join('')}</p>
      <section class="card relay-metrics-trend"><div class="card-head"><h2>每日曝光与官网点击</h2><span><i></i> 曝光 <b></b> 官网点击</span></div>${this.chart(data.trend)}</section>
      <section class="card"><div class="card-head"><h2>各中转站表现</h2><span>${data.stations.length} 家</span></div>${table(['中转站', '曝光', '曝光人数', '官网点击', '外跳点击率', '站内查看'], data.stations.map(r => { const s = station(r.station_id); return `<tr><td><strong>${E(s.name)}</strong><span class="sub">${E(s.domain)}</span></td>${traffic(r)}</tr>`; }), 6)}</section>
      <div class="relay-metrics-groups"><section class="card"><div class="card-head"><h2>流量来自哪个页面</h2></div>${table(['页面', '曝光', '曝光人数', '官网点击', '外跳点击率', '站内查看'], groupRows(data.pages, 'page', data.options.pages), 6)}</section><section class="card"><div class="card-head"><h2>哪个位置带来访问</h2></div>${table(['位置', '曝光', '曝光人数', '官网点击', '外跳点击率', '站内查看'], groupRows(data.placements, 'placement', data.options.placements), 6)}</section></div>
      <section class="card"><div class="card-head"><h2>中转站 × 页面 × 位置明细</h2></div>${table(['中转站', '页面', '位置', '曝光', '官网点击', '站点档案', '查看报告', '展开详情'], data.details.map(r => `<tr><td>${E(station(r.station_id).name)}</td><td>${E(data.options.pages[r.page])}</td><td>${E(data.options.placements[r.placement])}</td><td>${N(r.impressions)}</td><td>${N(r.outbound)}</td><td>${N(r.profile)}</td><td>${N(r.report)}</td><td>${N(r.details)}</td></tr>`), 8)}</section>
      <details class="card relay-metrics-method" open><summary>统计口径与起始时间</summary><p>开始记录于 ${E(new Date(data.started_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}，历史访问不补算。默认展示未识别为自动化的访客；管理员、已识别 AI / 自动化和未识别客户端可单独查看。匿名浏览器标识仅用于统计去重，不保存原始 IP 或完整访问参数。</p><p>同一次页面访问，同一中转站在同一位置的曝光及各类点击各计一次；重新筛选、重复渲染不会反复累计。独立访客跨位置去重，不直接相加。快速点击可能发生在达到可视曝光门槛之前，因此零曝光时不计算点击率。浏览器拦截和自动化识别存在边界，数据用于观察趋势。</p></details></div>`;
  },
  mount(root, context) {
    const form = root.querySelector('[data-relay-stats-form]');
    const apply = async () => {
      this.filters = Object.fromEntries(new FormData(form));
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      try { await context.refresh(); } catch (error) { form.querySelector('.error-box').textContent = error.message; }
      finally { button.disabled = false; }
    };
    form.addEventListener('submit', event => { event.preventDefault(); apply(); });
    root.querySelectorAll('[data-relay-days]').forEach(button => button.addEventListener('click', () => {
      form.elements.start.value = this.day(1 - Number(button.dataset.relayDays)); form.elements.end.value = this.day(); apply();
    }));
    root.querySelector('[data-relay-reset]').addEventListener('click', () => { this.filters = null; context.refresh(); });
    root.querySelector('[data-relay-export]').addEventListener('click', () => { location.href = '/api/admin/station-traffic/report.csv?' + this.query(); });
  }
};
