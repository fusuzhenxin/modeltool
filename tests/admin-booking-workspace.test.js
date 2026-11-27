const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('广告管理工作台不使用 EasyList 隐藏容器，仍保留订单、定价和排期入口', () => {
  const context = vm.createContext({ AdminAds: { placements: [] } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin/ad-ops.js'), 'utf8'), context);
  const workspace = vm.runInContext('AdminAdOps', context);
  const html = workspace.render({ start: '2026-11-27T00:00:00+08:00', end: '2026-12-27T00:00:00+08:00',
    slots: [{ key: 'hero', label: '顶部赞助位', capacity: 5, remaining: 4, spec: '宣传卡片', accepting: true }],
    records: [{ id: 'existing-order' }], packages: [], calendar: [], audit: [], events: [],
    totals: { capacity: 5, remaining: 4, expiring: 0, contract_cents: 0, received_cents: 0 } });
  assert.match(html, /^<div class="booking-workspace">/);
  assert.doesNotMatch(html, /class="adops(?:\s|")/);
  for (const label of ['新建广告订单', '定价 / 设置', '排期日历', '广告订单与素材', '1 条记录']) assert.ok(html.includes(label));
  const css = fs.readFileSync(path.join(__dirname, '../admin/admin.css'), 'utf8');
  assert.match(css, /\.booking-workspace\s*\{/);
});
