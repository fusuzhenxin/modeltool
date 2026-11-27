/* Job samples only. Never fabricate online status or substitute fixtures. */
const RelayStability = {
  data: null, controller: null,
  stationVisit(station) {
    const domain = String(station.domain || '').trim();
    const value = station.website_url || (/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i.test(domain) ? `https://${domain}` : '');
    if (!value || /[\x00-\x1f\x7f]/.test(value)) return '';
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      url.searchParams.set('utm_source', 'modeltool.cn');
      return `<a class="stability-site-visit" data-relay-click="outbound" href="${UI.esc(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="${UI.esc('访问中转站：' + (station.name || domain))}" title="访问中转站（新标签页）"><span aria-hidden="true">↗</span></a>`;
    } catch (_) { return ''; }
  },
  stationMark(station) {
    const esc = UI.esc, logo = String(station.logo || '').trim();
    let src = '';
    if (/^\/media\/[a-f0-9]{24}\.webp$/.test(logo)) src = logo;
    else {
      try {
        const url = new URL(logo);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/[\x00-\x1f]/.test(logo)) src = url.href;
      } catch (_) {}
    }
    const initial = Array.from(String(station.name || station.domain || '站'))[0].toUpperCase();
    return `<span class="stability-avatar" aria-hidden="true"><span>${esc(initial)}</span>${src ? `<img data-stability-logo src="${esc(src)}" alt="" width="36" height="36" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  },
  modelIcon(id) {
    const normalized = String(id).trim().replace(/^gpt(?:$|\s)/i, 'gpt-');
    if (typeof UI.modelMark === 'function') return UI.modelMark({ id: normalized, short: '◇', color: 'var(--muted)' });
    return '<span class="stability-model-fallback" aria-hidden="true">◇</span>';
  },
  picker(name, label, options, value, searchable = false) {
    const esc = UI.esc, chosen = options.find(o => o.value === value) || options[0];
    const id = 'stability-picker-' + name;
    const arrow = '<svg class="stability-picker-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return `<div class="stability-filter-field"><span id="${id}-label">${label}</span><div class="stability-picker" data-stability-picker>
      <select name="${name}" hidden aria-hidden="true" tabindex="-1">${options.map(o => `<option value="${esc(o.value)}" ${o === chosen ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <button type="button" class="stability-picker-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list" aria-labelledby="${id}-label ${id}-value" ${!chosen ? 'disabled' : ''}>${searchable && chosen ? RelayStability.modelIcon(chosen.value) : ''}<span id="${id}-value" class="stability-picker-value" title="${esc(chosen?.label || '暂无记录')}">${esc(chosen?.label || '暂无记录')}</span>${arrow}</button>
      <div class="stability-picker-menu" data-stability-picker-menu popover="manual" hidden>
      ${searchable ? `<div class="stability-picker-search-wrap"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" class="stability-picker-search" data-stability-picker-search placeholder="搜索模型名称…" aria-label="搜索检测模型" aria-controls="${id}-list" autocomplete="off" spellcheck="false"></div>` : ''}
      <div class="stability-picker-options" id="${id}-list" role="listbox" aria-labelledby="${id}-label">${options.map(o => `<button type="button" class="stability-picker-option" data-stability-picker-option data-value="${esc(o.value)}" data-label="${esc(o.label)}" role="option" aria-selected="${o === chosen}" tabindex="-1">${searchable ? RelayStability.modelIcon(o.value) : ''}<span class="stability-picker-option-label">${esc(o.label)}</span><svg class="stability-picker-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>
      <p class="stability-picker-empty" data-stability-picker-empty hidden role="status">没有找到匹配的模型</p>
      ${searchable ? `<div class="stability-picker-footer"><span data-stability-picker-count>${options.length} 个模型</span><span>↑ ↓ 选择 · Enter 确认</span></div>` : ''}</div></div></div>`;
  },
  closePickers(root, focus = false) {
    root.querySelectorAll('[data-stability-picker]').forEach(picker => {
      const button = picker.querySelector('[role="combobox"]'), menu = picker.querySelector('[data-stability-picker-menu]');
      if (button.getAttribute('aria-expanded') !== 'true') return;
      if (typeof menu.hidePopover === 'function') menu.hidePopover();
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    });
  },
  openPicker(picker, root) {
    const button = picker.querySelector('[role="combobox"]'), menu = picker.querySelector('[data-stability-picker-menu]');
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    RelayStability.closePickers(root);
    if (wasOpen || button.disabled) return;
    const search = picker.querySelector('[data-stability-picker-search]');
    if (search) { search.value = ''; RelayStability.filterPicker(picker); }
    button.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    if (typeof menu.showPopover === 'function') menu.showPopover();
    const rect = button.getBoundingClientRect(), gap = 7;
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const flip = below < 200 && above > below;
    const maxHeight = Math.max(90, Math.min(360, (flip ? above : below) - gap));
    menu.style.width = Math.min(Math.max(rect.width, search ? 290 : 230), innerWidth - 24) + 'px';
    menu.style.maxHeight = maxHeight + 'px';
    menu.style.left = Math.max(12, Math.min(rect.left, innerWidth - menu.offsetWidth - 12)) + 'px';
    menu.style.top = (flip ? rect.top - menu.offsetHeight - gap : rect.bottom + gap) + 'px';
    const chosen = menu.querySelector('[aria-selected="true"]');
    if (search) search.focus(); else chosen?.focus();
    chosen?.scrollIntoView({ block: 'nearest' });
  },
  filterPicker(picker) {
    const query = (picker.querySelector('[data-stability-picker-search]')?.value || '').trim().toLowerCase();
    let count = 0;
    picker.querySelectorAll('[data-stability-picker-option]').forEach(option => {
      option.hidden = !option.dataset.label.toLowerCase().includes(query);
      if (!option.hidden) count++;
    });
    picker.querySelector('[data-stability-picker-empty]').hidden = count !== 0;
    const footer = picker.querySelector('[data-stability-picker-count]');
    if (footer) footer.textContent = count + ' 个模型';
    picker.querySelector('.stability-picker-options').scrollTop = 0;
  },
  pickerClick(event, root) {
    const button = event.target.closest('.stability-picker-trigger');
    if (button) { RelayStability.openPicker(button.closest('[data-stability-picker]'), root); return true; }
    const option = event.target.closest('[data-stability-picker-option]');
    if (!option) return false;
    const picker = option.closest('[data-stability-picker]'), select = picker.querySelector('select');
    const changed = select.value !== option.dataset.value;
    select.value = option.dataset.value;
    RelayStability.closePickers(root, true);
    if (changed) { RelayStability.focusPicker = select.name; select.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  },
  pickerKey(event, root) {
    const picker = event.target.closest('[data-stability-picker]');
    if (!picker) return;
    const open = picker.querySelector('[role="combobox"]').getAttribute('aria-expanded') === 'true';
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); RelayStability.closePickers(root, true); return; }
    if (event.key === 'Tab' && open) { RelayStability.closePickers(root, true); return; }
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); RelayStability.openPicker(picker, root);
      if (!picker.querySelector('[data-stability-picker-search]')) return;
    } else if (!open) return;
    const options = [...picker.querySelectorAll('[data-stability-picker-option]')].filter(o => !o.hidden);
    const current = options.indexOf(document.activeElement), search = event.target.matches('[data-stability-picker-search]');
    if (event.key === 'Enter' && search) { event.preventDefault(); options[0]?.click(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (search && ['Home', 'End'].includes(event.key))) return;
    event.preventDefault();
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : current + (event.key === 'ArrowDown' ? 1 : -1);
    if (current === -1 && event.key === 'ArrowUp') next = options.length - 1;
    options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
  },
  percent(b) { return b?.rate == null ? '—' : `${Number(b.rate).toFixed(1).replace('.0', '')}%`; },
  tone(b) { return !b?.samples ? 'unobserved' : b.rate >= 95 ? 'good' : b.rate >= 80 ? 'warn' : 'bad'; },
  time(t) { return t ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t * 1000)) : '暂无'; },
  page() {
    return UI.shell('relay-stability', `<div class="page-head stability-head"><div><div class="crumb"><a href="relays.html">中转日报</a><span>/</span>稳定性观察</div><h1>中转站稳定性观察<span class="stability-window">近 7 天</span></h1><p>分别观察接口稳定性、能力表现、模型指纹和接口功能。</p><div class="stability-scope"><span aria-hidden="true">ⓘ</span>采样观察，不是全天在线率<span class="stability-scope-divider">·</span>同模型、同配置比较</div></div></div><section id="relay-stability" aria-label="中转站稳定性统计"><div class="panel stability-loading" role="status">正在读取近 7 天的检测记录…</div></section>`);
  },
  async mount() {
    const root = document.getElementById('relay-stability');
    if (!root) return;
    root.addEventListener('load', event => {
      if (event.target.matches('[data-stability-logo]')) event.target.parentElement.classList.add('has-image');
    }, true);
    root.addEventListener('error', event => {
      if (!event.target.matches('[data-stability-logo]')) return;
      event.target.hidden = true;
      event.target.parentElement.classList.remove('has-image');
    }, true);
    const description = document.querySelector('.page-seo');
    if (description) description.hidden = true;
    root.addEventListener('submit', (event) => {
      if (!event.target.matches('[data-stability-form]')) return;
      event.preventDefault();
      const form = new FormData(event.target), query = new URLSearchParams({ view: 'stability' });
      for (const key of ['model', 'test', 'q', 'sort', 'focus']) if (form.get(key)) query.set(key, form.get(key));
      history.replaceState(null, '', `relays.html?${query}`);
      RelayStability.load(root, query);
    });
    root.addEventListener('change', (event) => {
      if (!event.target.matches('select')) return;
      const form = event.target.form;
      if (event.target.name === 'model') form.elements.test.value = '';
      form.requestSubmit();
    });
    root.addEventListener('click', (event) => {
      if (RelayStability.pickerClick(event, root)) return;
      if (event.target.closest('[data-stability-retry]')) RelayStability.load(root, new URLSearchParams(location.search));
      const cell = event.target.closest('[data-stability-cell]');
      if (cell) cell.closest('article').querySelector('[data-stability-cell-detail]').textContent = cell.title;
      const focus = event.target.closest('[data-stability-focus]');
      if (focus) {
        const form = root.querySelector('[data-stability-form]');
        form.elements.focus.value = focus.dataset.stabilityFocus;
        form.requestSubmit();
      }
    });
    root.addEventListener('keydown', event => RelayStability.pickerKey(event, root));
    root.addEventListener('input', event => {
      if (event.target.matches('[data-stability-picker-search]')) RelayStability.filterPicker(event.target.closest('[data-stability-picker]'));
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-stability-picker]')) RelayStability.closePickers(root);
    });
    window.addEventListener('resize', () => RelayStability.closePickers(root));
    window.addEventListener('scroll', () => RelayStability.closePickers(root));
    await RelayStability.load(root, new URLSearchParams(location.search));
  },
  async load(root, query) {
    if (root.querySelectorAll) RelayStability.closePickers(root);
    const focusPicker = RelayStability.focusPicker;
    RelayStability.focusPicker = null;
    RelayStability.controller?.abort();
    const controller = new AbortController();
    RelayStability.controller = controller;
    const params = new URLSearchParams();
    for (const key of ['model', 'test']) if (query.get(key)) params.set(key, query.get(key));
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<div class="panel stability-loading" role="status">正在读取近 7 天的检测记录…</div>';
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/public/stability?' + params, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Array.isArray(data.stations) || !Array.isArray(data.models) || !Array.isArray(data.tests) || !data.thresholds) throw new Error('Invalid data');
      if (RelayStability.controller !== controller || !root.isConnected) return;
      RelayStability.data = data;
      root.innerHTML = RelayStability.render(data, query);
      if (['model', 'test', 'sort'].includes(focusPicker)) root.querySelector('[name="' + focusPicker + '"]').closest('[data-stability-picker]').querySelector('[role="combobox"]').focus();
    } catch (_) {
      if (RelayStability.controller !== controller || !root.isConnected) return;
      RelayStability.data = null;
      root.innerHTML = '<div class="panel stability-loading" role="status"><h2>稳定性数据暂时无法加载</h2><p>当前无法确认检测情况，请稍后重试。</p><button class="btn btn-primary" type="button" data-stability-retry>重新加载</button></div>';
    } finally { clearTimeout(timer); if (RelayStability.controller === controller) root.removeAttribute('aria-busy'); }
  },
  duration(ms) {
    if (ms == null || !Number.isFinite(ms)) return '暂无';
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ' ' + seconds % 60 + ' 秒' : ''}`;
  },
  cause(code) {
    if (/^http_[0-9]{3}$/.test(code)) {
      const hint = { 401: '密钥无效', 403: '访问权限不足', 429: '请求频率受限', 500: '上游内部错误', 502: '上游网关错误', 503: '上游服务不可用', 504: '上游网关超时' }[Number(code.slice(5))];
      return 'HTTP ' + code.slice(5) + (hint ? ' · ' + hint : '') + (/^http_4[0-9]{2}$/.test(code) && code !== 'http_429' ? '（不计完成率）' : '');
    }
    return ({ group: '分组失效（不计完成率）', manual: '人工排除（不计完成率）', billing: '余额不足 / 额度用尽（不计失败）', timeout: '请求超时', dns: '域名解析失败', connection: '网络连接失败或中断',
      tls: 'TLS 证书或连接异常', invalid_json: '响应不是有效 JSON', invalid_response: '响应结构不正确', empty_response: '未返回文本回答',
      response_limit: '响应超过检测大小限制', internal: '检测程序异常（不计失败）', auth: '密钥无效或权限不足', model: '模型不支持或无权限',
      parameters: '检测参数不兼容', output_limit_required: '接口要求指定输出上限（不计完成率）', output_exhausted: '输出额度耗尽，未生成答案（不计完成率）', completed: '检测完成', unknown: '详细原因未记录', unrecorded: '详细原因未记录',
      configuration: '鉴权或配置问题（不计完成率）' }[code] || '未分类');
  },
  age(t, now) {
    if (!t) return '暂无有效记录';
    const h = Math.max(0, (now - t) / 3600);
    return h >= 24 ? `${Math.floor(h / 24)} 天前的记录` : h >= 1 ? `${Math.floor(h)} 小时前的记录` : '1 小时内的记录';
  },
  missing(row) { return [['evening', '晚间'], ['night', '凌晨']].filter(([k]) => row.periods[k].samples < 3).map(([, label]) => label); },
  qualityState(row, kind) {
    const value = row.quality?.[kind] || { status: 'untested', reports: 0, flagged: 0, inconclusive: 0 };
    const states = kind === 'protocol'
      ? { ok: ['功能正常', 'good'], warn: ['部分功能异常', 'warn'], bad: ['多项异常', 'bad'], untested: ['未测接口功能', 'unobserved'] }
      : kind === 'identity' ? { consistent: ['指纹相符', 'good'], mismatch: ['疑似模型不符', 'warn'], inconclusive: ['暂无法判断', 'unobserved'], untested: ['未测指纹', 'unobserved'] }
      : { normal: ['未见信号', 'good'], degraded: ['出现降智信号', 'uncertain'], untested: ['未测能力', 'unobserved'] };
    const [label, tone] = states[value.status] || ['结论不足', 'unobserved'];
    return { ...value, label, tone };
  },
  qualityRisk(row) { return (row.quality?.identity?.status === 'mismatch' ? 120 : 0) + ({ bad: 120, warn: 80 }[row.quality?.protocol?.status] || 0) + (row.quality?.ability?.status === 'degraded' ? 100 : 0); },
  score(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? String(Math.round(value * 10) / 10) : '—'; },
  metrics(row) {
    const metric = (kind, label) => {
      const groups = row.quality?.[kind]?.scores || [], g = groups.length === 1 ? groups[0] : null;
      return `<div><span>${label} · 最近公开分数</span><strong>${g ? RelayStability.score(g.latest) + '<small>/100</small>' : '—'}</strong><small>${g ? `${g.count} 次评分 · ${g.min === g.max ? '分数相同' : `${RelayStability.score(g.min)}–${RelayStability.score(g.max)} 分`}` : groups.length ? '多个配置，见下方分别比较' : '没有对应评分'}</small></div>`;
    };
    return `<div class="stability-metrics"><div><span>任务完成率 · 当前配置</span><strong>${RelayStability.percent(row)}</strong><small>${row.completed} 完成 / ${row.failed} 明确失败 · ${row.samples} 有效样本</small></div>${metric('protocol', '接口功能')}${metric('ability', '能力')}<div><span>采样覆盖 · 当前配置</span><strong>${row.covered_days}<small>/7 天</small></strong><small>白天 ${row.periods.day.samples} · 晚间 ${row.periods.evening.samples} · 凌晨 ${row.periods.night.samples} 次</small></div></div>`;
  },
  scoreTrend(group) {
    const points = group.points || [], esc = UI.esc;
    if (points.length < 2) return '<p class="stability-score-empty">只有 1 次评分，暂不能判断分数变化。</p>';
    const start = points[0].at, end = points.at(-1).at;
    const coords = points.map((p, i) => ({ x: end === start ? 30 + i * 300 / (points.length - 1) : 30 + (p.at - start) / (end - start) * 300, y: 68 - p.score * .48, ...p }));
    return `<svg class="stability-score-trend" viewBox="0 0 360 93" role="img" aria-label="同配置评分变化，纵轴 0 到 100 分"><path class="stability-chart-grid" d="M30 20H330 M30 44H330 M30 68H330"/><text x="25" y="23" text-anchor="end">100</text><text x="25" y="47" text-anchor="end">50</text><text x="25" y="71" text-anchor="end">0</text><polyline class="stability-chart-line" points="${coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>${coords.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3"><title>${esc(RelayStability.time(p.at))} · ${RelayStability.score(p.score)} 分</title></circle>`).join('')}<text x="30" y="87">${esc(RelayStability.time(start))}</text><text x="330" y="87" text-anchor="end">${esc(RelayStability.time(end))}</text></svg>`;
  },
  scoreDetails(q) {
    return (q.scores || []).map(g => `<div class="stability-score-group"><div class="stability-score-heading"><span>${UI.esc(g.label)} · ${g.count} 次评分</span><b>最近 ${RelayStability.score(g.latest)}<small>/100</small></b></div><p>最低 ${RelayStability.score(g.min)} · 最高 ${RelayStability.score(g.max)}${g.delta == null ? '' : ` · 较窗口首份${g.delta > 0 ? '上升' : g.delta < 0 ? '下降' : '持平'} ${Math.abs(g.delta)} 分`}</p>${RelayStability.scoreTrend(g)}</div>`).join('');
  },
  records(row) {
    const esc = UI.esc, history = (row.history || []).slice().reverse();
    const scoreCell = (r, kind) => `<td class="stability-record-score">${RelayStability.score(r?.[kind])}</td>`;
    const reportCell = r => r ? `<a href="relays.html?id=${esc(encodeURIComponent(r.id))}" target="_blank" rel="noopener">查看报告 ↗</a>` : '<span class="stability-record-muted">无公开报告</span>';
    const skipped = history.filter(e => ['manual', 'configuration', 'billing', 'local'].includes(e.outcome));
    const regular = history.filter(e => !skipped.includes(e));
    const eventRow = e => `<tr><td><time>${esc(RelayStability.time(e.at))}</time><small>${esc(e.test || '检测')}</small></td><td><span class="stability-event-${esc(e.outcome)}">${esc(RelayStability.cause(e.cause))}</span>${e.exclusion_reason ? `<small>${esc(e.exclusion_reason)} · 人工核查标记</small>` : ''}${e.report && e.report.passed + e.report.attention > 0 ? `<small>${e.report.passed} 项通过 · ${e.report.attention} 项需核对</small>` : e.outcome === 'completed' && !e.report ? '<small>评分未公开，不能据此判断质量</small>' : ''}</td>${scoreCell(e.report, 'protocol')}${scoreCell(e.report, 'ability')}<td>${esc(ReportQuality.identityLabels[e.report?.identity] || '未测指纹')}</td><td>${esc(RelayStability.duration(e.duration_ms))}</td><td>${reportCell(e.report)}</td></tr>`;
    const rows = regular.map(eventRow).join('');
    const linked = new Set(history.filter(e => e.report).map(e => e.report.id));
    const extra = (row.quality?.records || []).filter(r => !linked.has(r.id)).slice().reverse().slice(0, 16);
    const extraRows = extra.map(r => `<tr><td><time>${esc(RelayStability.time(r.at))}</time><small>${esc(r.test)}</small></td>${scoreCell(r, 'protocol')}${scoreCell(r, 'ability')}${scoreCell(r, 'artwork')}<td>${r.passed} 通过 / ${r.attention} 需核对</td><td>${reportCell(r)}</td></tr>`).join('');
    return `<section class="stability-records"><header><h3>每次检测记录</h3><span>最近 ${regular.length} 次 · 当前配置 · 分数仅取已公开报告</span></header><div class="stability-record-table-wrap"><table class="stability-record-table"><thead><tr><th>检测时间 / 项目</th><th>结果与检查项</th><th>功能分 /100</th><th>能力分 /100</th><th>模型指纹</th><th>整轮耗时</th><th>依据</th></tr></thead><tbody>${rows || '<tr><td colspan="7">暂无计入完成率的检测记录</td></tr>'}</tbody></table></div>${extra.length ? `<details class="stability-extra-records"><summary>其他公开报告 ${extra.length} 份（其他配置或未关联当前记录）</summary><p>同站点、同模型近 7 天的补充报告；作品结构分不用于判断掺水或降智。</p><div class="stability-record-table-wrap"><table class="stability-record-table"><thead><tr><th>报告时间 / 项目</th><th>功能分 /100</th><th>能力分 /100</th><th>作品结构分 /100</th><th>检查项</th><th>依据</th></tr></thead><tbody>${extraRows}</tbody></table></div></details>` : ''}</section>`;
  },
  qualitySummary(row) {
    return `<span class="stability-quality-summary">${['identity', 'ability', 'protocol'].map(kind => {
      const q = RelayStability.qualityState(row, kind), name = { identity: '模型指纹', ability: '能力表现', protocol: '接口功能' }[kind];
      const hint = q.reports ? `同模型近 7 天公开报告：${q.reports} 份，${q.flagged} 份有信号。未测项目不能判断。` : '同模型近 7 天没有公开的对应检测报告，暂不能判断。';
      const groups = q.scores || [];
      return `<span class="stability-quality-chip ${q.tone}" title="${UI.esc(hint)}"><span>${name}</span><strong>${q.label}</strong>${groups.length === 1 ? `<b>${RelayStability.score(groups[0].latest)}<small>/100</small></b>` : ''}${q.reports ? `<small>${q.flagged ? q.flagged + '/' : ''}${q.reports} 份</small>` : ''}</span>`;
    }).join('')}</span>`;
  },
  qualityDetails(row, now) {
    const esc = UI.esc;
    const cards = ['identity', 'ability', 'protocol'].map(kind => {
      const q = RelayStability.qualityState(row, kind), name = { identity: '模型指纹', ability: '能力表现', protocol: '接口功能' }[kind];
      const explanation = q.reports
        ? `${q.reports} 份公开报告，${q.flagged} 份出现${name}信号${q.inconclusive ? `，${q.inconclusive} 份结论不足` : ''}。${q.status === 'ok' || q.status === 'normal' ? '未见信号仅针对已测项目，不能保证其他时段表现。' : ''}`
        : `同一模型近 7 天没有公开${name}检测报告，暂无法判断。`;
      const source = q.evidence ? `<a href="relays.html?id=${esc(encodeURIComponent(q.evidence.id))}" target="_blank" rel="noopener">查看依据报告 ↗</a><span>${esc(RelayStability.time(q.evidence.at))}${now - q.evidence.at > 86400 ? ' · 记录较旧' : ''}</span>` : '';
      return `<article><h4>${name}检测<span class="stability-quality-chip ${q.tone}"><strong>${q.label}</strong></span></h4><p>${explanation}</p>${kind === 'identity' ? `<p>${ReportQuality.identityNote}</p><p>${ReportQuality.ruleNote}</p>` : RelayStability.scoreDetails(q)}${source ? `<div class="stability-quality-source">${source}</div>` : ''}</article>`;
    }).join('');
    return `<section class="stability-quality-details" aria-label="能力、指纹与接口功能依据"><header><h3>能力、指纹与接口功能</h3><p>同站点、同模型近 7 天已公开报告，涵盖不同测试配置；保留窗口内最严重信号，不代表当前仍异常。</p></header><div>${cards}</div></section>`;
  },
  assess(row, now) {
    const stale = !row.last_sample || now - row.last_sample > 86400;
    const unknown = row.excluded.unknown, slow = row.timing?.slow_count || 0;
    let title, tone;
    if (row.failed) {
      title = row.last_outcome === 'failed' ? (stale ? '最后一次有效检测是失败' : '最近一次有效检测失败') : '出现过接口失败，后续又测通';
      tone = row.last_outcome === 'failed' && !stale ? 'bad' : 'warn';
    } else if (unknown) { title = '检测失败，详细原因未记录'; tone = 'warn'; }
    else if (slow) { title = '整轮检测耗时有明显波动'; tone = 'warn'; }
    else if (!row.samples) { title = row.excluded.billing ? '账户额度不足，检测已跳过' : '还没有可判断的检测记录'; tone = 'unobserved'; }
    else if (stale) { title = '记录较旧，当前表现待复测'; tone = 'unobserved'; }
    else if (row.eligible) { title = '已采样时段内未见接口失败'; tone = 'good'; }
    else if (RelayStability.missing(row).length) { title = '夜间表现还没有验证'; tone = 'unobserved'; }
    else { title = '尚不足以判断长期稳定性'; tone = 'unobserved'; }
    const p = row.periods;
    const eveningDrop = p.day.samples >= 5 && p.evening.samples >= 5 && row.covered_days >= 3 && p.day.rate - p.evening.rate >= 20;
    if (eveningDrop) { title = '已有记录中，晚间失败比例更高'; tone = 'warn'; }
    const evidence = row.failed ? `有 ${row.failed} 次明确接口失败${row.recoveries ? `，失败后再次完成检测 ${row.recoveries} 次` : ''}。`
      : unknown ? `有 ${unknown} 次历史检测失败，但当时未保存详细原因；不能确认是站点故障。`
      : slow ? `${slow} 次整轮耗时超过自身中位数的 2 倍，值得继续观察。`
      : row.samples ? `目前只确认 ${row.completed} 次整轮检测完成，不能据此认定全天稳定。` : row.excluded.billing ? '账户余额不足或额度已用尽，本轮未获得有效检测结果，已从成功和失败统计中排除。' : '需要先有检测记录，才能观察失败和波动。';
    return { title, tone, evidence, stale, eveningDrop };
  },
  risk(r) { return RelayStability.qualityRisk(r) + (r.failed ? 100 + r.failure_streak * 5 : 0) + (r.excluded.unknown ? 40 : 0) + (r.timing?.slow_count ? 20 : 0); },
  compareHealth(a, b, now) {
    // Recent valid observations come first; missing evidence never counts as success.
    const freshness = r => !r.samples || !r.last_sample ? 2 : now - r.last_sample > 86400 ? 1 : 0;
    return freshness(a) - freshness(b)
      || RelayStability.qualityRisk(a) - RelayStability.qualityRisk(b)
      || Number(b.last_outcome === 'completed') - Number(a.last_outcome === 'completed')
      || (b.rate ?? -1) - (a.rate ?? -1)
      || RelayStability.risk(a) - RelayStability.risk(b)
      || Number(b.eligible) - Number(a.eligible)
      || b.covered_days - a.covered_days
      || b.samples - a.samples
      || (b.last_sample || 0) - (a.last_sample || 0)
      || a.station.domain.localeCompare(b.station.domain);
  },
  sampleGroups(rows, data) {
    const t = data.thresholds, now = data.generated_at;
    const ranked = rows.filter(r => r.eligible), observing = rows.filter(r => !r.eligible);
    const group = (kind, title, description, stations, empty) => `<section class="stability-sample-group" aria-label="${title}" data-stability-group="${kind}"><header class="stability-sample-heading"><h2>${title}<span>${stations.length} 家</span></h2><p>${description}</p></header>${stations.length ? stations.map(r => RelayStability.row(r, now)).join('') : `<p class="stability-sample-empty">${empty}</p>`}</section>`;
    return group('ranked', '样本充分榜', `当前模型、当前配置：至少 ${t.samples} 次有效检测、覆盖 ${t.days} 天，白天 / 晚间 / 凌晨各至少 ${t.period_samples} 次，最近 ${t.fresh_hours} 小时有有效记录。达标不代表没有异常，仍需查看检测依据。`, ranked, '当前筛选下暂无采样达标的站点，继续积累检测记录后会自动进入此榜。')
      + group('observing', '新站观察区', '新加入、样本不足或记录较旧的站点在这里展示，暂不参与正式排名；采样达标后自动进入上方榜单。点击站点查看尚缺的采样条件。', observing, '当前筛选下所有站点均已满足采样条件。');
  },
  render(data, query) {
    const esc = UI.esc, search = (query.get('q') || query.get('station') || '').trim().slice(0, 120);
    const focus = ['issues', 'unknown', 'night', 'billing'].includes(query.get('focus')) ? query.get('focus') : 'all';
    const sort = ['health', 'risk', 'evening', 'slow', 'new', 'quality'].includes(query.get('sort')) ? query.get('sort') : 'health';
    const found = data.stations.filter(r => `${r.station.name} ${r.station.domain}`.toLowerCase().includes(search.toLowerCase()));
    const counts = { billing: found.filter(r => r.excluded.billing).length, all: found.length, issues: found.filter(r => r.failed).length, unknown: found.filter(r => r.excluded.unknown).length, night: found.filter(r => RelayStability.missing(r).length).length };
    const rows = found.filter(r => focus === 'all' || (focus === 'issues' ? r.failed : focus === 'unknown' ? r.excluded.unknown : focus === 'billing' ? r.excluded.billing : RelayStability.missing(r).length));
    rows.sort((a, b) => {
      if (sort === 'health') return RelayStability.compareHealth(a, b, data.generated_at);
      if (sort === 'quality') return RelayStability.qualityRisk(b) - RelayStability.qualityRisk(a) || (b.last_sample || 0) - (a.last_sample || 0);
      if (sort === 'new') return (b.last_sample || 0) - (a.last_sample || 0);
      if (sort === 'evening') return (b.periods.evening.rate ?? -1) - (a.periods.evening.rate ?? -1);
      if (sort === 'slow') { const ratio = r => r.timing?.samples >= 5 && r.timing.median_ms > 0 ? r.timing.max_ms / r.timing.median_ms : -1; return ratio(b) - ratio(a); }
      return RelayStability.risk(b) - RelayStability.risk(a) || (b.last_sample || 0) - (a.last_sample || 0);
    });
    const latest = Math.max(0, ...found.map(r => r.last_sample || 0));
    const evening = found.filter(r => r.periods.evening.samples >= 3).length, night = found.filter(r => r.periods.night.samples >= 3).length;
    const title = !latest ? '还没有足够的检测记录' : data.generated_at - latest > 86400 ? '这批记录较旧，不能代表当前状态' : !evening || !night ? '全天稳定性还没有验证' : '先看异常证据，再看跨时段表现';
    const qualityFacts = ['identity', 'ability', 'protocol'].map(kind => {
      const name = { identity: '模型指纹', ability: '能力表现', protocol: '接口功能' }[kind];
      const measured = found.filter(r => r.quality?.[kind]?.reports).length;
      const flagged = found.filter(r => r.quality?.[kind]?.flagged).length;
      return measured ? `${name}信号 ${flagged} 家（${measured} 家有报告）` : `${name}暂无对应报告，不能判断`;
    }).join('；') + '。';
    const facts = `${counts.issues} 家有明确接口失败记录，${counts.unknown} 家有失败记录未保存详细原因。${qualityFacts}晚间至少 3 次记录的有 ${evening} 家，凌晨有 ${night} 家。`;
    const filter = `<form class="stability-filters" data-stability-form action="relays.html" method="get"><input type="hidden" name="view" value="stability"><input type="hidden" name="focus" value="${focus}">${RelayStability.picker('model', '检测模型', data.models.map(m => ({ value: m, label: m })), data.selected_model, true)}${RelayStability.picker('test', '测试配置', data.tests.map(v => ({ value: v.id, label: v.label })), data.selected_test)}<label>查找中转站<input class="text-input" type="search" name="q" value="${esc(search)}" maxlength="120" placeholder="名称或完整域名"></label>${RelayStability.picker('sort', '优先看什么', [['health', '表现好的站点'], ['risk', '有异常的站点'], ['quality', '指纹 / 能力 / 接口功能'], ['evening', '晚间完成率'], ['slow', '耗时波动'], ['new', '最新记录']].map(([value, label]) => ({value, label})), sort)}<button class="btn btn-primary" type="submit">查看</button></form>`;
    const tabs = [['all', '全部站点'], ['issues', '接口失败'], ['unknown', '原因未记录'], ['night', '夜间待验证'], ['billing', '账户额度']].map(([k, label]) => `<button type="button" data-stability-focus="${k}" aria-pressed="${focus === k}">${label}<b>${counts[k]}</b></button>`).join('');
    const t = data.thresholds;
    const cards = rows.length ? (sort === 'health' ? RelayStability.sampleGroups(rows, data) : rows.map(r => RelayStability.row(r, data.generated_at)).join('')) : '<div class="stability-loading"><h3>暂无符合条件的中转站</h3><p>试试其他分类、模型或清除搜索条件。</p><a href="relays.html?view=stability">重置筛选 →</a></div>';
    return `<aside class="stability-verdict"><span class="stability-notice-icon" aria-hidden="true">!</span><div><h2>${title}</h2><p>${latest ? `最近有效记录 ${esc(RelayStability.time(latest))} · ${RelayStability.age(latest, data.generated_at)}。` : ''}${facts}</p></div></aside>
      <div class="panel stability-workspace">${filter}<div class="stability-results-head"><div class="stability-tabs" role="group" aria-label="选择需要观察的站点">${tabs}</div><span>${esc(data.start)} — ${esc(data.end)}<small>北京时间</small></span></div>
      <div class="stability-columns" aria-hidden="true"><span>中转站</span><span>接口表现 · 近 7 天</span><span>质量观察 · 近 7 天</span><span>整轮检测耗时</span><span>最近有效记录</span><span></span></div>
      <div class="stability-cards">${cards}</div><div class="stability-list-foot"><span>当前显示 <b>${rows.length}</b> 家中转站</span><span>点击站点行，展开昼夜记录与耗时趋势</span></div></div>
      <details class="panel stability-method"><summary>统计口径与观察边界</summary><p>默认按采样条件分区：满足门槛的站点进入“样本充分榜”，新加入、样本不足或记录较旧的站点进入“新站观察区”，不与正式榜单混排。无需等满 7 天，采样达标后自动入榜。各区内分别比较模型指纹、能力异常与接口功能信号、最近检测是否完成、任务完成率和异常记录，再看采样覆盖、样本数量和记录时间。未测不视为正常。切换异常优先等其他排序时，合并展示当前筛选下的全部站点。</p><p>糖果计入能力表现；模型身份线索来自指纹；协议只判断接口功能。三项分开展示：仅汇总同站点、同模型近 7 天已公开且非演示的报告，涵盖不同测试配置；保留最严重信号，并提供对应依据报告及检测时间。未测和结论不足不能视为正常，未见信号也不能保证全天质量；这些结论不改变接口完成率。评分按测试项目、版本和条件分组比较，未公开或未测评分显示破折号；分数不是稳定性总分。</p><p>这不是全天在线率，也不是单次请求成功率。每个点是一整次后台检测；完成不代表答对或模型身份真实。限流 HTTP 429、5xx、连接/超时和明确响应格式错误计入接口失败；余额不足、账户额度用尽（包括以 429 返回的额度错误）单独展示，不计成功或失败，也不影响连续失败统计；本地停止、预算、鉴权/配置及详细原因未记录的错误不进入失败率分母，这些记录会单独警示。</p><p>耗时从任务开始到结束，可能包含多次模型调用；只在同模型、同配置下观察整轮耗时。至少 5 次完成记录后才提示“超过自身耗时中位数 2 倍”的波动，不能据此证明接口降速。图中只连接实际观测点，未采样时段不作推断。</p><p>只有覆盖至少 ${t.days} 天、至少 ${t.samples} 次有效样本、各时段至少 ${t.period_samples} 次且最近 ${t.fresh_hours} 小时有记录，才具备基本比较条件。晚间对比白天还要求各至少 5 次记录、覆盖 3 天且完成率相差至少 20 个百分点；只是已有记录的差异，不代表因果。最近连败、失败后完成仅描述相邻有效样本，不推算持续故障或恢复耗时。</p></details>`;
  },
  calendar(row) {
    const esc = UI.esc, dates = Object.keys(row.days);
    const cells = [['day', '白天', '06–18'], ['evening', '晚间', '18–24'], ['night', '凌晨', '00–06']].map(([key, label, time]) => {
      const content = dates.map(date => {
        const b = row.calendar?.[date]?.[key] || { completed: 0, failed: 0, unknown: 0, configuration: 0 };
        const uncertain = b.unknown;
        const manual = b.manual || 0;
        const billing = b.billing || 0;
        const local = b.local || 0;
        const tone = b.failed ? (b.completed ? 'warn' : 'bad') : uncertain ? 'uncertain' : (billing || local || b.configuration || manual) && !b.completed ? 'skipped' : b.completed ? 'good' : 'unobserved';
        const symbol = ({ unobserved: '·', good: '✓', bad: '×', warn: '!', uncertain: '?', skipped: '–' })[tone];
        const detail = `${date} ${label} ${time}：${b.completed} 次完成，${b.failed} 次明确失败，${b.unknown} 次详细原因未记录，${b.configuration} 次鉴权/配置问题（不计失败），${manual} 次人工排除，${billing} 次账户额度不足、${local} 次检测程序异常（均不计失败）。${!b.completed && !b.failed && !uncertain && !billing && !local && !b.configuration && !manual ? '未测，不能判断。' : ''}`;
        return `<button type="button" data-stability-cell class="stability-cell ${tone}" tabindex="0" title="${esc(detail)}" aria-label="${esc(detail)}">${symbol}${uncertain && b.failed ? '<sup>?</sup>' : ''}</button>`;
      }).join('');
      return `<span class="stability-period-label">${label}<small>${time}</small></span>${content}`;
    }).join('');
    return `<div class="stability-calendar" aria-label="七天昼夜检测记录"><span></span>${dates.map(d => `<span class="stability-date">${d.slice(5).replace('-', '/')}</span>`).join('')}${cells}</div>`;
  },
  sparkline(row) {
    const points = row.timing?.points || [], esc = UI.esc;
    if (points.length < 2) return '<p class="stability-chart-empty">完成记录不足 2 次，暂时无法比较耗时波动。</p>';
    const highest = Math.max(1000, ...points.map(p => p.ms)), start = points[0].at, end = points.at(-1).at;
    const coords = points.map((p, i) => ({ x: end === start ? 28 + i * 272 / (points.length - 1) : 28 + (p.at - start) / (end - start) * 272, y: 61 - p.ms / highest * 44, ...p }));
    const line = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = coords.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"><title>${esc(RelayStability.time(p.at))}：${esc(RelayStability.duration(p.ms))}</title></circle>`).join('');
    return `<svg class="stability-sparkline" viewBox="0 0 320 86" role="img" aria-label="最近完成任务的整轮耗时趋势，纵轴从零开始"><title>只连接最近 ${points.length} 次完成记录，不代表空白时段的表现</title><path d="M28 17H300 M28 61H300" class="stability-chart-grid"/><text x="24" y="64" text-anchor="end">0</text><text x="24" y="20" text-anchor="end">${Math.round(highest / 1000)}</text><polyline points="${line}" class="stability-chart-line"/>${dots}<text x="28" y="81">${esc(RelayStability.time(start))}</text><text x="300" y="81" text-anchor="end">${esc(RelayStability.time(end))}</text></svg>`;
  },
  row(row, now = Date.now() / 1000) {
    const esc = UI.esc, a = RelayStability.assess(row, now), missing = RelayStability.missing(row), timing = row.timing || {};
    const href = `relays.html?station=${encodeURIComponent(row.station.domain)}`;
    const causes = Object.entries(row.diagnostic_types || row.failure_types || {}).filter(([code]) => code !== 'manual').map(([code, n]) => {
      const account = ['billing', 'internal', 'manual', 'group'].includes(code);
      const configuration = ['unrecorded', 'unknown', 'configuration', 'auth', 'model', 'parameters', 'response_limit', 'output_limit_required', 'output_exhausted'].includes(code) || (/^http_4[0-9]{2}$/.test(code) && code !== 'http_429');
      const style = account || configuration && !['unrecorded', 'unknown'].includes(code) ? 'stability-account-tag' : configuration ? 'stability-uncertain-tag' : 'stability-issue-tag';
      return `<span class="${style}">${esc(RelayStability.cause(code))} × ${n}</span>`;
    }).join('');
    const why = !row.eligible ? row.ineligible_reasons.map(esc).join('；') : '达到基本采样门槛，但仍不等于全天在线率。';
    const badge = row.failed ? ['warn', row.last_outcome === 'failed' ? '接口失败' : '失败后测通'] : row.excluded.unknown ? ['uncertain', '原因未记录'] : (timing.slow_count || 0) ? ['warn', '耗时波动'] : row.excluded.billing && !row.samples ? ['unobserved', '账户额度不足'] : a.stale ? ['unobserved', '待复测'] : row.eligible ? ['good', '采样内完成'] : ['unobserved', '待观察'];
    const legend = '<div class="stability-legend"><span><i class="good"></i>完成</span><span><i class="bad"></i>失败</span><span><i class="warn"></i>有成功也有失败</span><span><i class="uncertain"></i>原因未记录</span><span><i class="skipped"></i>配置/排除，不计失败</span><span><i class="unobserved"></i>未测，不能判断</span></div>';
    return `<article class="stability-station-card ${a.tone}" ${row.station.id ? `data-relay-id="${esc(row.station.id)}" data-relay-placement="${row.eligible ? 'stability_ranked' : 'stability_observing'}"` : ''}><details class="stability-station-details">
      <summary class="stability-compact-summary" data-relay-click="details"><span class="stability-compact-site">${RelayStability.stationMark(row.station)}<span><span class="stability-site-title"><strong class="stability-site-name">${esc(row.station.name)}</strong>${RelayStability.stationVisit(row.station)}</span><span class="stability-domain">${esc(row.station.domain)}</span></span></span>
      <span class="stability-compact-status"><span class="stability-tags"><span class="stability-state-badge ${badge[0]}"><i aria-hidden="true"></i>${badge[1]}</span>${causes}${(row.excluded.unknown && !row.diagnostic_types?.unrecorded) ? `<span class="stability-uncertain-tag">${row.excluded.unknown} 次原因未记录</span>` : ''}</span><span class="stability-card-conclusion"><strong>${a.title}</strong></span></span>
      ${RelayStability.qualitySummary(row)}
      <span class="stability-compact-timing"><b>${esc(RelayStability.duration(timing.median_ms))}</b><small>最慢 ${esc(RelayStability.duration(timing.max_ms))}</small></span><span class="stability-recency"><strong>${esc(RelayStability.time(row.last_sample))}</strong><small>${esc(RelayStability.age(row.last_sample, now))}</small></span><span class="stability-detail-toggle"><span class="stability-show-label">详情</span><span class="stability-hide-label">收起</span><span class="stability-chevron" aria-hidden="true">⌄</span></span></summary>
      <div class="stability-detail-body"><div class="stability-detail-intro"><p class="stability-evidence">${esc(a.evidence)}${missing.length ? ` ${missing.join('、')}记录不足，暂不能判断夜间稳定性。` : ''}</p><a data-relay-click="profile" href="${esc(href)}">查看站点档案 ↗</a></div>
      ${RelayStability.metrics(row)}
      ${RelayStability.qualityDetails(row, now)}
      <div class="stability-card-evidence"><section><h3>哪天、哪个时段出过问题</h3>${RelayStability.calendar(row)}${legend}<p class="stability-cell-detail" data-stability-cell-detail aria-live="polite">点击色块，查看该时段实际发生了什么。</p></section><section><h3>整轮检测耗时 <small>非首字响应速度</small></h3><div class="stability-timing-numbers"><span>通常 <b>${esc(RelayStability.duration(timing.median_ms))}</b></span><span>最慢 <b>${esc(RelayStability.duration(timing.max_ms))}</b></span></div>${RelayStability.sparkline(row)}</section></div>
      <div class="stability-last-events"><div><span>最近明确接口失败</span><strong>${row.last_failure ? esc(RelayStability.time(row.last_failure)) : '记录中未发现'}</strong></div><div><span>失败后再次完成</span><strong>${row.last_recovery ? esc(RelayStability.time(row.last_recovery)) : '暂无对应记录'}</strong></div></div>
      ${RelayStability.records(row)}
      <details class="stability-record-details"><summary>查看检测经过与统计依据</summary><p>${row.completed} 次完成 / ${row.failed} 次明确接口失败；任务完成率 ${RelayStability.percent(row)}。覆盖 ${row.covered_days}/7 天，共 ${row.samples} 次有效样本。</p><p>另有 ${row.excluded.local} 次本地停止/预算限制、${row.excluded.configuration} 次鉴权/配置问题、${row.excluded.unknown} 次失败未记录详细原因、${row.excluded.billing || 0} 次余额不足/额度用尽、${row.excluded.manual || 0} 次人工排除未进入完成率（均不计接口失败）。当前排队或运行中 ${row.pending} 次。</p><p>最近连败 ${row.failure_streak} 次，窗口内最长连续失败 ${row.max_failure_streak || 0} 次；失败后完成 ${row.recoveries} 次。</p><p>${a.stale ? '最近有效记录已超过 24 小时，无法确认当前状态。' : ''}${why}</p></details></div></details></article>`;
  }
};
