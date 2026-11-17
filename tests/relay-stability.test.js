const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/relay-stability.js'), 'utf8');
const esc = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function client(fetch) {
  const ctx = vm.createContext({ URL, URLSearchParams, Date, Intl, AbortController, setTimeout, clearTimeout, fetch, UI: { esc, shell: (_, html) => html } });
  vm.runInContext(source, ctx);
  return vm.runInContext('RelayStability', ctx);
}
function bucket(n = 10, rate = 90) { return { samples: n, rate: n ? rate : null, completed: Math.round(n * rate / 100), failed: n - Math.round(n * rate / 100) }; }
function row(name = '甲站', eligible = true) {
  return { station: { name, domain: 'a.example' }, ...bucket(20), eligible, rank: eligible ? 1 : null,
    covered_days: 7, pending: 0, excluded: { local: 2, configuration: 1, unknown: 1 },
    periods: { day: bucket(), evening: bucket(5, 60), night: bucket(0) },
    days: { '2026-11-09': bucket(), '2026-11-10': bucket(0) }, failure_streak: 2, recoveries: 1,
    last_outcome: 'failed', last_sample: 1794736800, ineligible_reasons: ['有效样本不足 20 次'] };
}
function data(rows = [row()]) {
  return { stations: rows, models: ['m'], tests: [{ id: 'test', label: '鹈鹕骑车 · 2D' }], selected_model: 'm', selected_test: 'test',
    start: '2026-11-09', end: '2026-11-15', generated_at: 1794736800, thresholds: { samples: 20, days: 3, period_samples: 3, fresh_hours: 24 } };
}
function root() { return { innerHTML: '', isConnected: true, setAttribute() {}, removeAttribute() {} }; }

test('中转站显示已上传图标，缺失或非法图片地址保留文字占位', () => {
  const c = client();
  const html = c.stationMark({ name: '甲站', logo: '/media/0123456789abcdef01234567.webp' });
  assert.ok(html.includes('data-stability-logo'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
  assert.ok(html.includes('<span>甲</span>'));
  assert.ok(c.stationMark({ name: '站', logo: 'https://example.com/logo.webp' }).includes('data-stability-logo'));
  for (const logo of ['', 'javascript:alert(1)', '//example.com/logo.webp', 'https://user:secret@example.com/logo.webp']) {
    assert.ok(!c.stationMark({ name: '<站', logo }).includes('<img'));
  }
  assert.ok(c.stationMark({ name: '<站' }).includes('&lt;'));
});
test('异常结论放在前面，百分比与统计口径收到详情', () => {
  const c = client(), html = c.render(data(), new URLSearchParams());
  for (const text of ['任务完成率', '白天', '晚间', '凌晨', '最近连败 2 次', '覆盖 7/7 天', '失败未记录详细原因', '失败后完成 1 次', '不是单次请求成功率', '不推算持续故障', '至少 20 次有效样本']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('stability-rate'));
  assert.ok(html.includes('stability-card-conclusion'));
  assert.ok(html.includes('relays.html?station=a.example'));
  assert.ok(c.page().includes('采样观察，不是全天在线率'));
});
test('无样本使用破折号，不以百分比冒充检测结果', () => {
  const r = row('无样本站', false);
  Object.assign(r, bucket(0));
  r.periods = { day: bucket(0), evening: bucket(0), night: bucket(0) };
  r.last_outcome = null;
  r.excluded.unknown = 0;
  const html = client().row(r);
  assert.ok(html.includes('还没有可判断的检测记录'));
  assert.ok(html.includes('未测，不能判断'));
  assert.ok(!html.includes('>0%') && !html.includes('>100%') && !html.includes('eligible"'));
});
test('默认把存在异常的站点提前，搜索内容和站点信息安全转义', () => {
  const c = client(), a = row('<img src=x onerror=alert(1)>'), b = row('乙站', false);
  b.station.domain = 'b.example'; b.periods.evening.rate = 100;
  b.failed = 0; b.excluded.unknown = 0; b.failure_streak = 0;
  let html = c.render(data([a, b]), new URLSearchParams());
  assert.ok(html.indexOf('&lt;img') < html.indexOf('乙站'));
  assert.ok(!html.includes('<img src=x'));
  html = c.render(data([a, b]), new URLSearchParams('q=乙'));
  assert.ok(html.includes('乙站')); assert.ok(!html.includes('&lt;img'));
  html = c.render(data(), new URLSearchParams('q=%22%3E%3Cscript%3E'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('暂无符合条件的中转站'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
});
test('独立读取聚合接口、不下载报告，失败可重试且不回退演示数据', async () => {
  const requests = [], c = client(async (url, options) => { requests.push([url, options]); return { ok: false }; }), r = root();
  await c.load(r, new URLSearchParams('model=m&test=t&q=private'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/public/stability?model=m&test=t');
  assert.equal(requests[0][1].cache, 'no-store');
  assert.ok(r.innerHTML.includes('数据暂时无法加载'));
  assert.ok(r.innerHTML.includes('data-stability-retry'));
  assert.equal(c.data, null);
});
test('较旧请求不能覆盖较新筛选结果', async () => {
  const pending = [], c = client(() => new Promise(resolve => pending.push(resolve))), r = root();
  const first = c.load(r, new URLSearchParams('model=old'));
  const second = c.load(r, new URLSearchParams('model=new'));
  pending[1]({ ok: true, json: async () => data([row('新站')]) });
  await second;
  pending[0]({ ok: true, json: async () => data([row('旧站')]) });
  await first;
  assert.ok(r.innerHTML.includes('新站')); assert.ok(!r.innerHTML.includes('旧站'));
});
test('非法响应显示读取错误，不冒充空结果', async () => {
  const c = client(async () => ({ ok: true, json: async () => ({}) })), r = root();
  await c.load(r, new URLSearchParams());
  assert.ok(r.innerHTML.includes('数据暂时无法加载'));
});

test('白天少量全通过不会被标为全天稳定，旧记录不冒充实时状态', () => {
  const c = client(), r = row('白天站', false), now = data().generated_at;
  Object.assign(r, bucket(6, 100), { last_sample: now - 60, last_outcome: 'completed', excluded: { local: 0, configuration: 0, unknown: 0 } });
  r.periods = { day: bucket(6, 100), evening: bucket(0), night: bucket(0) };
  assert.equal(c.assess(r, now).title, '夜间表现还没有验证');
  assert.equal(c.assess(r, now).tone, 'unobserved');
  r.last_sample = now - 3 * 86400;
  assert.equal(c.assess(r, now).title, '记录较旧，当前表现待复测');
  assert.ok(c.row(r, now).includes('最近有效记录已超过 24 小时'));
});

test('原因不明的错误不可被全通过和排名资格掩盖', () => {
  const c = client(), r = row(), now = data().generated_at;
  Object.assign(r, bucket(30, 100), { last_sample: now - 60, last_outcome: 'completed' });
  r.periods = { day: bucket(10, 100), evening: bucket(10, 100), night: bucket(10, 100) };
  assert.equal(c.assess(r, now).title, '检测失败，详细原因未记录');
  assert.notEqual(c.assess(r, now).tone, 'good');
});

test('晚间更差的结论要求足够对照数据，少量失败不放大', () => {
  const c = client(), r = row(), now = data().generated_at;
  r.periods = { day: bucket(10, 100), evening: bucket(5, 40), night: bucket(0) };
  assert.equal(c.assess(r, now).title, '已有记录中，晚间失败比例更高');
  r.periods.evening = bucket(1, 0);
  assert.equal(c.assess(r, now).eveningDrop, false);
});

test('色块同时保留成功、失败和未明错误，未测不会变绿', () => {
  const c = client(), r = row();
  r.calendar = { '2026-11-09': { day: { completed: 1, failed: 1, unknown: 1, configuration: 0 } } };
  const html = c.calendar(r);
  assert.ok(html.includes('stability-cell warn'));
  assert.ok(html.includes('1 次详细原因未记录'));
  assert.ok(html.includes('stability-cell unobserved'));
  assert.ok(html.includes('data-stability-cell'));
  assert.ok(!html.includes('stability-cell good'));
});

test('耗时趋势用实际时间和零起点，失败标签只使用白名单代码', () => {
  const c = client(), r = row();
  r.failure_types = { http_502: 2 };
  r.timing = { samples: 5, median_ms: 10000, max_ms: 50000, slow_count: 1, points: [{ at: 1794736000, ms: 10000 }, { at: 1794736800, ms: 50000 }] };
  const html = c.row(r);
  assert.ok(html.includes('HTTP 502 · 上游网关错误 × 2'));
  assert.ok(html.includes('非首字响应速度'));
  assert.ok(html.includes('纵轴从零开始'));
  assert.ok(html.includes('polyline points='));
  assert.equal(c.duration(50000), '50 秒');
  assert.equal(c.duration(125000), '2 分 5 秒');
  assert.equal(c.cause('Authorization secret'), '未分类');
});

test('问题分类只显示对应站点，清空筛选后不会伪造统计', () => {
  const c = client(), a = row('失败站'), b = row('未知站'), d = row('普通站');
  a.excluded.unknown = 0; b.failed = 0; d.failed = 0; d.excluded.unknown = 0;
  let html = c.render(data([a, b, d]), new URLSearchParams('focus=issues'));
  assert.ok(html.includes('失败站')); assert.ok(!html.includes('未知站'));
  html = c.render(data([a, b, d]), new URLSearchParams('focus=unknown'));
  assert.ok(html.includes('未知站')); assert.ok(!html.includes('失败站'));
});

test('余额和额度问题单独筛选，不提升故障排序，不显示为接口失败', () => {
  const c = client(), r = row('余额不足站', false);
  Object.assign(r, bucket(0), { last_sample: null, last_outcome: null, failure_streak: 0 });
  r.periods = { day: bucket(0), evening: bucket(0), night: bucket(0) };
  r.excluded = { local: 0, configuration: 0, unknown: 0, billing: 2 };
  r.diagnostic_types = { billing: 2 };
  assert.equal(c.risk(r), 0);
  assert.equal(c.assess(r, data().generated_at).title, '账户额度不足，检测已跳过');
  const html = c.render(data([r]), new URLSearchParams('focus=billing'));
  assert.ok(html.includes('余额不足站'));
  assert.ok(html.includes('余额不足 / 额度用尽（不计失败）'));
  r.calendar = { '2026-11-09': { day: { completed: 0, failed: 0, unknown: 0, configuration: 0, billing: 2 } } };
  const calendar = c.calendar(r);
  assert.ok(calendar.includes('stability-cell skipped'));
  assert.ok(!calendar.includes('stability-cell bad'));
});

test('鉴权显示为配置问题，检测程序异常也不伪装成未测或接口故障', () => {
  const c = client(), r = row();
  r.diagnostic_types = { http_401: 1, billing: 1, internal: 1 };
  r.calendar = { '2026-11-09': { day: { completed: 0, failed: 0, unknown: 0, configuration: 0, local: 1 } } };
  assert.ok(!c.row(r).includes('stability-issue-tag'));
  assert.ok(c.row(r).includes('stability-uncertain-tag'));
  const calendar = c.calendar(r);
  assert.ok(calendar.includes('stability-cell skipped'));
  assert.ok(calendar.includes('1 次检测程序异常（均不计失败）'));
});

test('检测完成不冒充未见掺水或未见降智，未测和结论不足明确展示', () => {
  const c = client(), r = row();
  Object.assign(r, bucket(20, 100));
  const summary = c.qualitySummary(r);
  assert.ok(summary.includes('未测协议'));
  assert.ok(summary.includes('未测能力'));
  assert.ok(!summary.includes('未见信号'));
  r.quality = { protocol: { status: 'inconclusive', reports: 1, flagged: 0 } };
  assert.ok(c.qualitySummary(r).includes('结论不足'));
});

test('公开质量信号分别着色并关联依据，范围和记录时间可见', () => {
  const c = client(), r = row();
  r.quality = {
    protocol: { status: 'warn', reports: 3, flagged: 1, inconclusive: 0, evidence: { id: 'public&report', at: 1794736800 } },
    ability: { status: 'degraded', reports: 2, flagged: 1, inconclusive: 0, evidence: { id: '<secret>', at: 1794736800 } }
  };
  const html = c.row(r, data().generated_at);
  for (const text of ['疑似掺水', '出现降智信号', '1/3 份', '1/2 份', '不同测试配置', '保留窗口内最严重信号', 'relays.html?id=public%26report', 'relays.html?id=%3Csecret%3E']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<secret>'));
  assert.ok(html.includes('stability-quality-chip warn'));
  assert.ok(html.includes('stability-quality-chip uncertain'));
});

test('质量信号进入异常优先排序，但不改变接口成功失败计数', () => {
  const c = client(), flagged = row('质量异常站'), normal = row('普通站');
  flagged.quality = { protocol: { status: 'bad', reports: 1, flagged: 1 }, ability: { status: 'degraded', reports: 1, flagged: 1 } };
  const before = JSON.stringify(flagged);
  const html = c.render(data([normal, flagged]), new URLSearchParams('sort=quality'));
  assert.ok(html.indexOf('质量异常站') < html.indexOf('普通站'));
  assert.equal(JSON.stringify(flagged), before);
});

test('记录明细显示真实分数、耗时、检查项和依据，未公开评分不冒充零分', () => {
  const c = client(), r = row();
  r.history = [{ at: 1794736700, cause: 'completed', outcome: 'completed', duration_ms: 85000,
    test: '中转站测试', report: { id: 'published', protocol: 0, ability: 92, passed: 3, attention: 1 } },
    { at: 1794736800, cause: 'completed', outcome: 'completed', duration_ms: 10000 }];
  const html = c.records(r);
  for (const value of ['协议分 /100', '能力分 /100', '>0</td>', '>92</td>', '3 项通过 · 1 项需核对', '1 分 25 秒', 'relays.html?id=published', '评分未公开']) assert.ok(html.includes(value), value);
  assert.ok(html.includes('stability-record-score">—</td>'));
});

test('分数趋势仅比较同配置，固定零至百分并明确单份和多配置', () => {
  const c = client(), r = row(), g = {label:'中转站测试',count:2,min:70,max:90,first:90,latest:70,delta:-20,
    points:[{at:1794736700,score:90},{at:1794736800,score:70}]};
  r.quality = {protocol:{scores:[g]}};
  assert.ok(c.metrics(r).includes('70<small>/100'));
  assert.ok(c.scoreDetails(r.quality.protocol).includes('下降 20 分'));
  assert.ok(c.scoreTrend(g).includes('纵轴 0 到 100 分'));
  assert.ok(c.scoreTrend({...g,points:g.points.slice(0,1)}).includes('只有 1 次评分'));
  r.quality.protocol.scores.push({...g,latest:100});
  assert.ok(c.metrics(r).includes('多个配置，见下方分别比较'));
  assert.ok(!c.metrics(r).includes('100<small>/100'));
});
