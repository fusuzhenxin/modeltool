const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function card(id = 'station-a', placement = 'daily_card', zone = false) {
  return { dataset: { relayId: id, relayPlacement: placement }, isConnected: true,
    closest: selector => selector === '[data-ad-zone]' && zone ? {} : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }), checkVisibility: () => true };
}
function client() {
  let time = 0, serial = 0, observer;
  const timers = new Map(), calls = [], nodes = [], listeners = {};
  const ctx = vm.createContext({
    crypto: { randomUUID: () => 'station-pageview-123456' }, URLSearchParams, Date, Map, Set, Blob,
    innerWidth: 1000, innerHeight: 800, location: { pathname: '/relays.html', search: '' }, navigator: { webdriver: false },
    document: { readyState: 'loading', visibilityState: 'visible', addEventListener: (name, fn) => { listeners[name] = fn; },
      querySelectorAll: () => nodes, getElementById: () => null }, window: { addEventListener() {} },
    setTimeout: (fn, delay) => { timers.set(++serial, { fn, at: time + delay }); return serial; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { timers.set(++serial, { fn, at: time }); return serial; },
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
    fetch: async (url, spec) => { calls.push({ url, spec }); return { ok: true, status: 200,
      json: async () => ({ tokens: Object.fromEntries(JSON.parse(spec.body).station_ids?.map(id => [id, 'token-for-' + id]) || []) }) }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/station-traffic.js'), 'utf8'), ctx);
  const collector = vm.runInContext('StationTraffic', ctx);
  return { ctx, collector, calls, nodes, listeners,
    visible: (element, ratio = 1) => observer([{ target: element, isIntersecting: ratio > 0, intersectionRatio: ratio }]),
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await Promise.resolve();
      }
      time = end; await Promise.resolve();
    }
  };
}

test('可视面积达到一半并持续一秒才记录，离屏和后台标签不产生曝光', async () => {
  const c = client(), element = card(); c.nodes.push(element); await c.collector.scan();
  c.visible(element, .4); await c.advance(1100);
  assert.equal(c.calls.length, 1);
  c.visible(element, .5); await c.advance(999);
  assert.equal(c.collector.queue.length, 0);
  c.visible(element, 0); await c.advance(100);
  assert.equal(c.collector.queue.length, 0);
  c.visible(element); c.ctx.document.visibilityState = 'hidden'; await c.advance(1100);
  assert.equal(c.calls.length, 1);
  c.ctx.document.visibilityState = 'visible'; c.visible(element); await c.advance(1050);
  const events = JSON.parse(c.calls.at(-1).spec.body).events;
  assert.equal(events[0].kind, 'impression');
  assert.equal(c.calls.at(-1).url, '/api/public/station-traffic/events');
});

test('重复渲染不累加同一站点曝光，不同展示位置独立记录', async () => {
  const c = client(), first = card(); c.nodes.push(first); await c.collector.scan();
  c.visible(first); await c.advance(1050);
  const second = card(); c.nodes.splice(0, 1, second); await c.collector.scan();
  c.visible(second); await c.advance(1050);
  assert.equal(c.calls.filter(r => r.url.endsWith('/events')).length, 1);
  c.ctx.location.search = '?view=stability';
  const ranked = card('station-a', 'stability_ranked'), observing = card('station-a', 'stability_observing');
  c.nodes.splice(0, 1, ranked, observing); await c.collector.scan();
  c.visible(ranked); c.visible(observing); await c.advance(1050);
  const events = c.calls.filter(r => r.url.endsWith('/events')).flatMap(r => JSON.parse(r.spec.body).events);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(r => r.placement), ['daily_card', 'stability_ranked', 'stability_observing']);
});

test('广告容器永不参与本站点采集，也不调用广告统计接口', async () => {
  const c = client(), sponsored = card('station-a', 'daily_card', true);
  c.nodes.push(sponsored); await c.collector.scan();
  c.collector.record(sponsored, 'outbound'); await c.advance(1100);
  assert.equal(c.calls.length, 0);
  assert.equal(c.collector.eligible(sponsored), false);
});

test('可信官网点击和站内查看分别计数，程序点击、右键和收起详情不计数', async () => {
  const c = client(), element = card(); c.nodes.push(element); await c.collector.scan();
  let open = false;
  const link = kind => ({ tagName: 'A', dataset: { relayClick: kind }, closest: selector => selector === 'details' ? { open } : element });
  const event = (kind, extra = {}) => ({ isTrusted: true, type: 'click', button: 0, target: { closest: () => link(kind) }, ...extra });
  c.collector.click(event('outbound', { isTrusted: false }));
  c.collector.click(event('outbound', { button: 2 }));
  c.collector.click(event('outbound'));
  c.collector.click(event('outbound'));
  c.collector.click(event('profile'));
  c.collector.click(event('report', { type: 'auxclick', button: 1 }));
  open = true; c.collector.click(event('details'));
  open = false; c.collector.click(event('details'));
  await c.advance(100);
  const events = c.calls.filter(r => r.url.endsWith('/events')).flatMap(r => JSON.parse(r.spec.body).events);
  assert.deepEqual(events.map(r => r.kind), ['outbound', 'profile', 'report', 'details']);
});

test('浏览器重试只使用本站点接口，服务器失败保留有界重试', async () => {
  const c = client(), element = card(); c.nodes.push(element); await c.collector.scan();
  let failures = 0;
  c.ctx.fetch = async url => { assert.equal(url, '/api/public/station-traffic/events'); failures++; throw new Error('offline'); };
  c.collector.record(element, 'outbound');
  await c.advance(50); await c.advance(2000); await c.advance(2000); await c.advance(2000);
  assert.equal(failures, 3);
  assert.equal(c.collector.queue.length, 0);
});

test('后台报表使用独立接口并展示页面、位置、不同点击，不出现广告容器', () => {
  const ctx = vm.createContext({ Date, URLSearchParams });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin/station-traffic.js'), 'utf8'), ctx);
  const ui = vm.runInContext('AdminStationTraffic', ctx);
  const metrics = { impressions: 3, visitors: 2, outbound: 1, internal_clicks: 2, profile: 1, report: 0, details: 1, ctr: 33.33 };
  const html = ui.render({ start: '2026-11-27', end: '2026-11-27', traffic: 'clean', started_at: 1,
    summary: metrics, raw: metrics, classes: {}, trend: [{ day: '2026-11-27', ...metrics }],
    stations: [{ station_id: 's', ...metrics }], pages: [{ page: 'daily', ...metrics }], placements: [], details: [],
    options: { stations: [{ id: 's', name: '<script>站点</script>', domain: 'example.com' }], pages: { daily: '中转日报' }, placements: {} } });
  for (const text of ['中转站流量统计', '独立统计自然展示流量', '官网外跳点击率', '流量来自哪个页面', '哪个位置带来访问']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /class="(?:adops|adstats)"|<script>站点/);
  assert.match(html, /&lt;script&gt;站点/);
  assert.ok(!ui.query().includes('ad_id'));
});
