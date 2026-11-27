/* The server scopes every query to the authenticated sponsor account. */
const SponsorPortal = {
  user: null, ticket: 0, loadTicket: 0, campaigns: null, report: null,
  view: 'dashboard', days: 30, metric: 'impressions', campaignFilter: 'all',
  views: { dashboard: ['工作台','查看广告投放表现，掌握近期流量与待关注事项。','grid'], campaigns: ['我的广告','查看广告素材、展示位置与当前投放状态。','ads'], reports: ['效果报告','按广告、日期、页面和位置，查看每一份投放效果。','chart'], schedule: ['投放排期','查看投放时间与到期提醒，提前安排后续投放。','calendar'], account: ['账户信息','查看当前账号资料与可访问的投放范围。','user'], guide: ['统计说明','了解曝光、点击与独立访客的计算方式。','info'] },
  esc: value => AdminAdAnalytics.esc(value),
  async api(path, method = "GET", body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && SponsorPortal.user) headers['X-CSRF-Token'] = SponsorPortal.user.csrf;
    const response = await fetch('/api/' + path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && SponsorPortal.user) SponsorPortal.signOut('登录已过期，请重新登录。');
      throw new Error(data.errors?.map(e => e.message).join('；') || data.detail || '暂时无法加载，请稍后重试');
    }
    return data;
  },
  brand() { return '<a class="sponsor-brand" href="/index.html"><img src="/assets/favicon-32.png" alt=""><span>ModelTool <small>站长工作台</small></span></a>'; },
  icon(name) {
    const paths = {grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',ads:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m6 15 4-4 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1"/>',chart:'<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',logout:'<path d="M9 4H4v16h5m6-12 4 4-4 4m-6-4h10"/>',arrow:'<path d="M7 17 17 7M7 7h10v10"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5m-4-5a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',click:'<path d="m6 3 13 9-6 1-3 6-4-16Z"/>',check:'<path d="m5 12 4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
  },
  signOut(message = '') {
    this.user = null; this.ticket++; this.loadTicket++; AdminAdAnalytics.sequence++;
    this.campaigns = null; this.report = null; this.days = 30; this.campaignFilter = 'all';
    AdminAdAnalytics.filters = null; AdminAdAnalytics.data = null;
    this.login(message);
  },
  login(message = '') {
    const E = this.esc;
    document.getElementById('sponsor-app').innerHTML = `<div class="sponsor-auth"><section class="sponsor-welcome">${this.brand()}<div class="sponsor-welcome-copy"><span class="sponsor-eyebrow">SPONSOR INSIGHTS</span><h1>看见每一份<br>投放的表现。</h1><p>从一次曝光到一次点击，<br>在这里了解你的赞助如何被看见。</p><div class="sponsor-benefits"><span>01 <b>每条广告，独立统计</b></span><span>02 <b>页面与位置，清楚可查</b></span><span>03 <b>排期与趋势，随时掌握</b></span></div></div><small class="sponsor-welcome-foot">大模型降智检测 · ModelTool</small></section><section class="sponsor-signin"><form id="sponsor-login"><span class="sponsor-eyebrow">WELCOME BACK</span><h2>登录站长工作台</h2><p>使用网站管理员为你开通的专属账号。</p><label>用户名<input name="username" autocomplete="username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9_.-]+" placeholder="输入赞助商用户名"></label><label>密码<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128" placeholder="输入账号密码"></label><p class="error-box" role="alert">${E(message)}</p><button type="submit" class="btn primary">登录查看投放数据 <span aria-hidden="true">↗</span></button><small>需要开通账号或重置密码，请联系网站管理员。</small><a href="/index.html" class="sponsor-return">返回网站首页 →</a></form></section></div>`;
    document.getElementById('sponsor-login').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('button'), error = form.querySelector('[role="alert"]');
      button.disabled = true; error.textContent = '';
      try {
        this.user = await this.api('sponsor/login', 'POST', Object.fromEntries(new FormData(form)));
        form.reset(); AdminAdAnalytics.filters = null; await this.load();
      } catch (e) { if (error.isConnected) error.textContent = e.message; }
      finally { if (button.isConnected) button.disabled = false; }
    });
  },
  date(value) { return value ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '不限'; },
  status(row) {
    const states = {live:'投放中',scheduled:'待开始',expired:'已到期',paused:'已暂停',cancelled:'已取消',reserved:'已预订',draft:'待上架',disabled:'已停用'};
    return `<span class="sponsor-status ${row.status === 'live' ? 'live' : row.status === 'scheduled' ? 'scheduled' : ''}"><i></i>${states[row.status] || '待确认'}</span>`;
  },
  expiring(row) { return row.status === 'live' && row.remaining_days !== null && row.remaining_days <= 7; },
  safeLink(value) {
    try { const url = new URL(value, location.origin); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
  },
  campaign(row) {
    const E = this.esc;
    const image = row.image && this.safeLink(row.image), link = row.link && this.safeLink(row.link);
    return `<article class="sponsor-campaign card" data-campaign-card data-status="${E(row.status)}" data-expiring="${this.expiring(row)}" data-search="${E([row.title,row.order_code,...row.placements.map(p=>p.label)].join(' ').toLowerCase())}"><div class="sponsor-campaign-preview">${image ? `<img src="${E(image)}" alt="${E(row.title)}" loading="lazy">` : `<div class="sponsor-creative-fallback">${this.icon('ads')}<span>${E(row.title)}</span></div>`}${this.status(row)}</div><div class="sponsor-campaign-body"><small class="sponsor-order">${E(row.order_code || '赞助投放')}</small><h3 title="${E(row.title)}">${E(row.title)}</h3><p class="sponsor-description">${E(row.description || '该投放暂无补充说明。')}</p><div class="sponsor-positions">${row.placements.map(p=>`<span>${E(p.label)}</span>`).join('')}</div><dl><div><dt>投放时间 · 北京时间</dt><dd>${E(this.date(row.starts_at))}<br>至 ${E(this.date(row.ends_at))}</dd></div><div><dt>${row.status === 'scheduled' ? '投放时长' : '剩余排期'}</dt><dd class="${this.expiring(row) ? 'sponsor-due' : ''}">${row.remaining_days === null ? '长期投放' : E(row.remaining_days) + ' 天'}</dd></div></dl><div class="sponsor-campaign-actions"><button class="btn small" data-campaign="${E(row.id)}">${this.icon('chart')}查看效果</button>${link ? `<a href="${E(link)}" target="_blank" rel="noopener noreferrer">访问站点 ${this.icon('arrow')}</a>` : ''}</div></div></article>`;
  },
  shell() {
    const E = this.esc;
    const nav = keys => keys.map(key=>`<a href="#${key}" data-view="${key}">${this.icon(this.views[key][2])}<span>${this.views[key][0]}</span></a>`).join('');
    document.getElementById('sponsor-app').innerHTML = `<div class="sponsor-console"><button class="sponsor-scrim" data-menu aria-label="关闭导航"></button><aside class="sponsor-sidebar" aria-label="站长导航">${this.brand()}<div class="sponsor-side-intro"><strong>站长工作台</strong><span>管理你的广告投放与效果</span></div><nav><p>投放管理</p>${nav(['dashboard','campaigns','reports','schedule'])}<p>账户服务</p>${nav(['account','guide'])}</nav><div class="sponsor-side-bottom"><a href="#account"><span class="sponsor-avatar">${E(this.user.display_name.slice(0,1))}</span><span><strong>${E(this.user.display_name)}</strong><small>已开通站长账号</small></span></a><button data-logout aria-label="退出登录" title="退出登录">${this.icon('logout')}</button></div></aside><div class="sponsor-workspace"><header class="sponsor-topbar"><div><button class="sponsor-menu" data-menu aria-label="展开导航" aria-expanded="false">${this.icon('menu')}</button><span class="sponsor-breadcrumb">站长工作台 <b>›</b> <span id="sponsor-crumb">工作台</span></span></div><div class="sponsor-top-actions"><a href="/index.html" target="_blank" rel="noopener">访问主站 ${this.icon('arrow')}</a><a href="#account" class="sponsor-avatar" aria-label="账户信息">${E(this.user.display_name.slice(0,1))}</a></div></header><main class="sponsor-main" id="sponsor-view" tabindex="-1"></main><footer class="sponsor-footer">ModelTool 站长工作台 <span>·</span> 数据按北京时间统计</footer></div></div>`;
  },
  heading(view) {
    const E = this.esc, meta = this.views[view];
    return `<div class="sponsor-page-head"><div><h1>${meta[0]}</h1><p>${meta[1]}</p></div><div><button class="btn small" data-refresh>${this.icon('refresh')}刷新数据</button>${view === 'dashboard' ? '<a class="btn small primary" href="#reports">查看效果报告 →</a>' : ''}</div></div>`;
  },
  chart() {
    const E = this.esc, rows = this.report.trend, key = this.metric, label = key === 'clicks' ? '点击' : '曝光';
    if (!rows.length) return '<div class="sponsor-chart-empty">该日期范围尚未记录数据，开始投放后将在这里展示趋势。</div>';
    const peak = Math.max(4,...rows.map(row=>Number(row[key]) || 0));
    const max = Math.ceil(peak / 4) * 4, x = i => rows.length === 1 ? 470 : 60 + i / (rows.length-1) * 820, y = value => 205 - (Number(value) || 0) / max * 165;
    const points = rows.map((row,i)=>`${x(i)},${y(row[key])}`).join(' ');
    const labels = [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])];
    return `<div class="sponsor-chart"><svg viewBox="0 0 920 255" role="img" aria-label="${E(this.report.start)} 至 ${E(this.report.end)}每日${label}趋势"><defs><linearGradient id="sponsor-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5876ef" stop-opacity=".14"/><stop offset="100%" stop-color="#5876ef" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3,4].map(i=>`<line x1="60" x2="880" y1="${205-i*41.25}" y2="${205-i*41.25}" stroke="#e8edf6" stroke-dasharray="3 5"/><text x="45" y="${209-i*41.25}" text-anchor="end">${AdminAdAnalytics.number(max*i/4)}</text>`).join('')}<polygon points="${x(0)},205 ${points} ${x(rows.length-1)},205" fill="url(#sponsor-chart-fill)"/><polyline points="${points}" fill="none" stroke="#5c78ed" stroke-width="2.5" stroke-linejoin="round"/>${rows.map((row,i)=>`<circle cx="${x(i)}" cy="${y(row[key])}" r="3.4" fill="#fff" stroke="#5c78ed" stroke-width="1.8"><title>${E(row.day)} · ${E(row[key])} ${label}</title></circle>`).join('')}${labels.map(i=>`<text x="${x(i)}" y="238" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}">${E(rows[i].day.slice(5).replace('-','/'))}</text>`).join('')}</svg></div>`;
  },
  dashboard() {
    const E = this.esc, N = AdminAdAnalytics.number, r = this.report, rows = this.campaigns, live = rows.filter(row=>row.status==='live'), due = rows.filter(row=>this.expiring(row)), planned = rows.filter(row=>row.status==='scheduled');
    const metric = (label,value,hint,icon) => `<section class="sponsor-kpi card"><div><span>${label}</span><i>${this.icon(icon)}</i></div><strong>${value}</strong><small>${hint}</small></section>`;
    return `${this.heading('dashboard')}<section class="sponsor-greeting card"><div><h2>欢迎回来，${E(this.user.display_name)}</h2><p>你的每一份投放，都值得清楚看见。</p><a href="#campaigns">查看我的广告 ${this.icon('arrow')}</a></div><div class="sponsor-greeting-note"><span>${this.icon('check')}已开通站长账号</span><small>仅展示分配给你的广告与统计</small></div></section><div class="sponsor-range"><div class="sponsor-segment" aria-label="统计日期范围">${[7,30,90].map(days=>`<button data-range="${days}" aria-pressed="${this.days===days}" class="${this.days===days?'active':''}">近 ${days} 天</button>`).join('')}</div><span>${E(r.start)} 至 ${E(r.end)} · 北京时间</span></div><div class="sponsor-kpis">${metric('广告曝光',N(r.summary.impressions),'所选日期内的可视曝光次数','eye')}${metric('官网点击',N(r.summary.clicks),'所选日期内的广告跳转点击','click')}${metric('点击率',AdminAdAnalytics.rate(r.summary),'点击次数 ÷ 可视曝光次数','chart')}${metric('正在投放',N(live.length),`当前共 ${N(rows.length)} 条广告`,'ads')}</div><div class="sponsor-dashboard-grid"><section class="card sponsor-trend"><div class="sponsor-card-head"><div><h2>投放效果趋势</h2><p>过滤后流量 · ${N(r.summary.visitors)} 位独立访客</p></div><div class="sponsor-segment">${[['impressions','曝光'],['clicks','点击']].map(([key,label])=>`<button data-chart="${key}" aria-pressed="${key===this.metric}" class="${key===this.metric?'active':''}">${label}</button>`).join('')}</div></div>${this.chart()}<div class="sponsor-source-head">流量来源页面 <button class="text-btn" data-report>查看全部 →</button></div><div class="sponsor-source-list">${r.pages.slice(0,4).map(page=>`<button data-page-report="${E(page.page)}"><span>${E(page.label)}</span><span><b>${N(page.impressions)}</b> 曝光</span><span><b>${N(page.clicks)}</b> 点击 ${this.icon('arrow')}</span></button>`).join('') || '<p>暂无页面流量记录，广告实际进入可视区域后开始记录。</p>'}</div></section><aside class="sponsor-attention"><section class="card"><div class="sponsor-card-head"><h2>需要关注</h2>${this.icon('clock')}</div><a href="#campaigns" data-filter-link="expiring"><span>7 天内即将到期</span><b class="${due.length?'sponsor-due':''}">${N(due.length)}</b></a><a href="#campaigns" data-filter-link="live"><span>正在投放</span><b>${N(live.length)}</b></a><a href="#campaigns" data-filter-link="scheduled"><span>等待开始</span><b>${N(planned.length)}</b></a><a href="#schedule" class="sponsor-attention-link">查看投放排期 <span>›</span></a><div class="sponsor-tip">${due.length ? '有广告即将到期，可提前联系网站管理员安排续期。' : '当前暂无 7 天内到期的在投广告。素材与排期调整可联系网站管理员。'}</div></section><section class="card sponsor-stat-note"><span class="sponsor-note-icon">${this.icon('info')}</span><h3>每个位置，独立记录</h3><p>按实际展示页面与广告位置统计曝光和点击，套餐中的各位置同样可单独查看。</p><a href="#guide">了解统计口径 →</a></section></aside></div><section class="card sponsor-recent"><div class="sponsor-card-head"><h2>我的广告 <small>${rows.length} 条投放</small></h2><a href="#campaigns">查看全部 →</a></div>${rows.slice(0,3).map(row=>`<div class="sponsor-recent-row"><span class="sponsor-campaign-mark">${E(row.title.slice(0,1))}</span><div><strong title="${E(row.title)}">${E(row.title)}</strong><small>${E(row.placements.map(p=>p.label).join(' · '))}</small></div>${this.status(row)}<button class="text-btn" data-campaign="${E(row.id)}">查看效果 →</button></div>`).join('') || '<div class="sponsor-empty">当前尚未分配广告，请联系网站管理员。已有历史流量可在效果报告中查询。</div>'}</section>`;
  },
  campaignsPage() {
    const E = this.esc;
    return `${this.heading('campaigns')}<section class="sponsor-campaign-toolbar card"><div class="sponsor-filter-tabs">${[['all','全部广告'],['live','投放中'],['scheduled','待开始'],['expiring','即将到期'],['expired','已到期']].map(([key,label])=>`<button data-campaign-filter="${key}" class="${key===this.campaignFilter?'active':''}" aria-pressed="${key===this.campaignFilter}">${label}</button>`).join('')}</div><input type="search" data-campaign-search aria-label="搜索广告" placeholder="搜索广告名称、订单或位置"></section><section class="sponsor-campaigns" aria-label="我的广告投放">${this.campaigns.map(row=>this.campaign(row)).join('')}</section><div class="card sponsor-empty" data-no-campaign hidden>没有符合条件的广告。可以更换状态或搜索词。</div><p class="sponsor-footnote">素材调整、广告上架或续期，请联系网站管理员；这里的素材预览不计入广告曝光。</p>`;
  },
  schedulePage() {
    const E = this.esc, rows = [...this.campaigns].sort((a,b)=>(a.ends_at?new Date(a.ends_at).getTime():Infinity)-(b.ends_at?new Date(b.ends_at).getTime():Infinity));
    return `${this.heading('schedule')}<div class="sponsor-schedule-summary"><section class="card"><span>7 天内到期</span><strong>${rows.filter(row=>this.expiring(row)).length}<small>条广告</small></strong></section><section class="card"><span>等待开始</span><strong>${rows.filter(row=>row.status==='scheduled').length}<small>条广告</small></strong></section><section class="card"><span>长期投放</span><strong>${rows.filter(row=>row.status==='live'&&row.remaining_days===null).length}<small>条广告</small></strong></section></div><section class="card"><div class="sponsor-card-head"><h2>投放排期一览</h2><span>北京时间 · 按结束时间排序</span></div><div class="adops-scroll"><table><thead><tr><th>广告与位置</th><th>投放开始</th><th>投放结束</th><th>当前状态</th><th>剩余排期 / 计划时长</th><th>效果</th></tr></thead><tbody>${rows.map(row=>`<tr><td class="sponsor-schedule-title"><strong>${E(row.title)}</strong><span class="sub">${E(row.placements.map(p=>p.label).join(' · '))}</span></td><td>${E(this.date(row.starts_at))}</td><td>${E(this.date(row.ends_at))}</td><td>${this.status(row)}</td><td class="${this.expiring(row)?'sponsor-due':''}">${row.remaining_days===null?'长期投放':E(row.remaining_days)+' 天'}</td><td><button class="text-btn" data-campaign="${E(row.id)}">查看报告</button></td></tr>`).join('') || '<tr><td colspan="6" class="sponsor-empty">当前尚未分配广告排期。</td></tr>'}</tbody></table></div></section><div class="sponsor-tip">需要续期或调整投放时间，请向网站管理员提供广告订单编号。到期后按后台设置停止展示，历史效果仍可查询。</div>`;
  },
  accountPage() {
    const E = this.esc;
    return `${this.heading('account')}<div class="sponsor-account-grid"><section class="card sponsor-account-card"><span class="sponsor-account-avatar">${E(this.user.display_name.slice(0,1))}</span><h2>${E(this.user.display_name)}</h2><span class="sponsor-status live">已开通站长账号</span><dl><div><dt>登录用户名</dt><dd>${E(this.user.username)}</dd></div><div><dt>账号名称</dt><dd>${E(this.user.display_name)}</dd></div><div><dt>当前分配广告</dt><dd>${this.campaigns.length} 条</dd></div><div><dt>登录有效期</dt><dd>单次会话最长 8 小时</dd></div></dl></section><section class="card sponsor-access"><h2>账户与数据权限</h2><ul><li>查看分配给你的广告素材、展示位置与投放排期。</li><li>查询曝光、点击、独立访客和趋势，导出自己的投放明细。</li><li>素材变更、账号资料修改、续期与密码重置，请联系网站管理员。</li></ul><p>退出后，本机页面会清理已加载的账号与报表数据。</p><button class="btn" data-logout>${this.icon('logout')}退出当前账号</button></section></div>`;
  },
  guidePage() {
    const cards = [['eye','什么算一次曝光？','页面处于前台，广告至少 50% 面积持续可见 1 秒。同一次页面访问中，同一广告在同一位置最多记录一次曝光。'],['click','点击与点击率','鼠标、键盘或中键触发的真实官网跳转计为点击。点击率 = 点击次数 ÷ 曝光次数；点击可能早于曝光计时完成，不等同于注册或付费转化。'],['user','独立访客如何计算？','按第一方匿名浏览器标识去重。跨设备、清除 Cookie 或禁用 Cookie 会影响结果；各页面、位置的独立访客不可直接相加。'],['chart','过滤后流量与全部流量','过滤后流量排除已识别 AI、爬虫、自动化、管理员和未识别客户端。规则无法识别全部机器人，也不代表剩余访问全部为真人。'],['ads','页面与位置分别统计','每条广告独立计算，顶部、底部、侧边与横幅按实际展示位置归因。套餐各位置曝光可相加，结果不等同于网站页面 PV。'],['calendar','统计时间与历史数据','日期按北京时间计算，起止日期均包含当天。统计从模块启用时开始记录，不回填历史曝光；暂停或到期后仍保留已记录的效果。']];
    return `${this.heading('guide')}<section class="sponsor-guide-grid">${cards.map(([icon,title,copy])=>`<article class="card"><span>${this.icon(icon)}</span><h2>${title}</h2><p>${copy}</p></article>`).join('')}</section>`;
  },
  async showView() {
    if (!this.user) return;
    const candidate = location.hash.slice(1);
    this.view = Object.hasOwn(this.views,candidate) ? candidate : 'dashboard';
    const ticket = ++this.ticket; AdminAdAnalytics.sequence++;
    document.querySelector('.sponsor-console')?.classList.remove('sponsor-nav-open');
    document.querySelector('.sponsor-menu')?.setAttribute('aria-expanded','false');
    document.querySelectorAll('[data-view]').forEach(link=>{
      const active = link.dataset.view === this.view;
      link.classList.toggle('active',active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    document.getElementById('sponsor-crumb').textContent = this.views[this.view][0];
    document.title = `${this.views[this.view][0]} · ModelTool 站长工作台`;
    const root = document.getElementById('sponsor-view');
    if (!this.campaigns || !this.report) { root.innerHTML = '<p class="sponsor-loading" role="status">正在加载投放数据…</p>'; return; }
    if (this.view === 'reports') {
      root.innerHTML = this.heading('reports') + '<section id="sponsor-analytics"><p class="sponsor-loading" role="status">正在读取效果报告…</p></section>';
      try {
        const report = await this.api('sponsor/analytics?' + AdminAdAnalytics.query());
        if (ticket !== this.ticket || !this.user) return;
        const analytics = document.getElementById('sponsor-analytics');
        analytics.innerHTML = AdminAdAnalytics.render(report);
        AdminAdAnalytics.mount(analytics, this.api);
      } catch(e) { if (ticket === this.ticket && this.user) this.error(root,e); }
    } else {
      root.innerHTML = ({dashboard:()=>this.dashboard(),campaigns:()=>this.campaignsPage(),schedule:()=>this.schedulePage(),account:()=>this.accountPage(),guide:()=>this.guidePage()})[this.view]();
      if (this.view === 'campaigns') this.filterCampaigns();
    }
  },
  error(root,e) { root.innerHTML = `<div class="card sponsor-empty"><p role="alert">${this.esc(e.message)}</p><button class="btn" data-refresh>重新加载</button></div>`; },
  openReport(adId = '', page = '') {
    AdminAdAnalytics.filters = {start:this.report.start,end:this.report.end,ad_id:adId,page,placement:'',traffic:'clean'};
    if (location.hash === '#reports') this.showView(); else location.hash = 'reports';
  },
  filterCampaigns() {
    const query = (document.querySelector('[data-campaign-search]')?.value || '').trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('[data-campaign-card]').forEach(card=>{
      card.hidden = !(this.campaignFilter === 'all' || (this.campaignFilter === 'expiring' ? card.dataset.expiring === 'true' : card.dataset.status === this.campaignFilter)) || !card.dataset.search.includes(query);
      if (!card.hidden) count++;
    });
    document.querySelectorAll('[data-campaign-filter]').forEach(button=>{ const active = button.dataset.campaignFilter === this.campaignFilter; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    const empty = document.querySelector('[data-no-campaign]'); if(empty) empty.hidden = count > 0;
  },
  bind() {
    const root = document.getElementById('sponsor-app');
    root.addEventListener('click', async event=>{
      const target = event.target.closest('button,a'); if (!target || !this.user) return;
      if (target.hasAttribute('data-menu')) {
        const open = document.querySelector('.sponsor-console').classList.toggle('sponsor-nav-open');
        document.querySelector('.sponsor-menu').setAttribute('aria-expanded',String(open));
      } else if (target.hasAttribute('data-logout')) {
        target.disabled = true;
        try { await this.api('sponsor/logout','POST',{}); this.signOut(); }
        catch(e) { if(this.user) this.error(document.getElementById('sponsor-view'),e); }
        finally { target.disabled = false; }
      } else if (target.hasAttribute('data-refresh')) this.load();
      else if (target.hasAttribute('data-range')) { this.days = Number(target.dataset.range); this.load(); }
      else if (target.hasAttribute('data-chart')) { this.metric = target.dataset.chart; this.showView(); }
      else if (target.hasAttribute('data-campaign')) this.openReport(target.dataset.campaign);
      else if (target.hasAttribute('data-page-report')) this.openReport('',target.dataset.pageReport);
      else if (target.hasAttribute('data-report')) this.openReport();
      else if (target.hasAttribute('data-campaign-filter')) { this.campaignFilter = target.dataset.campaignFilter; this.filterCampaigns(); }
      else if (target.hasAttribute('data-filter-link')) { this.campaignFilter = target.dataset.filterLink; if(location.hash==='#campaigns') this.showView(); }
    });
    root.addEventListener('input',event=>{if(event.target.hasAttribute('data-campaign-search')) this.filterCampaigns();});
    window.addEventListener('hashchange',()=>{if(this.user) this.showView();});
    document.addEventListener('keydown',event=>{ if(event.key==='Escape'){document.querySelector('.sponsor-console')?.classList.remove('sponsor-nav-open');document.querySelector('.sponsor-menu')?.setAttribute('aria-expanded','false');} });
  },
  async load() {
    const ticket = ++this.loadTicket;
    if (!document.getElementById('sponsor-view')) this.shell();
    const root = document.getElementById('sponsor-view');
    root.setAttribute('aria-busy','true');
    if (!this.report) root.innerHTML = '<p class="sponsor-loading" role="status">正在加载你的投放数据…</p>';
    document.querySelectorAll('[data-refresh],[data-range]').forEach(button=>{button.disabled=true;});
    try {
      const query = new URLSearchParams({start:AdminAdAnalytics.day(1-this.days),end:AdminAdAnalytics.day(),traffic:'clean'});
      const [campaigns, report] = await Promise.all([this.api('sponsor/campaigns'), this.api('sponsor/analytics?' + query)]);
      if (ticket !== this.loadTicket || !this.user) return;
      this.campaigns = campaigns.campaigns; this.report = report;
      await this.showView();
    } catch(e) {
      if (ticket === this.loadTicket && this.user) this.error(root,e);
    } finally {
      if (ticket === this.loadTicket && this.user) {
        root.setAttribute('aria-busy','false');
        document.querySelectorAll('[data-refresh],[data-range]').forEach(button=>{button.disabled=false;});
      }
    }
  },
  async start() {
    AdminAdAnalytics.sponsorMode = true;
    this.bind();
    try {
      const state = await this.api('sponsor/session');
      if (state.authenticated) { this.user=state; await this.load(); } else this.login();
    } catch(e) { this.login(e.message); }
  }
};
SponsorPortal.start();
