const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../js/public-data.js"), "utf8");

async function load(fetch, backend = true) {
  const ctx = vm.createContext({ fetch, AbortController, setTimeout: () => 1, clearTimeout: () => {}, document: { querySelector: () => backend ? {} : null } });
  vm.runInContext(source, ctx);
  await vm.runInContext("PublicData.load()", ctx);
  return vm.runInContext("PublicData", ctx);
}
test("静态预览 404 保留演示模式，真实后台故障进入明确空状态", async () => {
  const staticData = await load(async () => ({ status: 404 }), false);
  assert.equal(staticData.live, false);
  const unavailable = await load(async () => ({ status: 500, ok: false }));
  assert.equal(unavailable.live, true);
  assert.equal(unavailable.failed, true);
  assert.equal(unavailable.reports.length, 0);
});
test("后台的空数组是有效数据，不能用模拟报告补齐", async () => {
  const data = await load(async () => ({ status: 200, ok: true, json: async () => ({ mode: "live", reports: [], stations: [], announcements: [], ads: [] }) }));
  assert.equal(data.live, true);
  assert.equal(data.failed, false);
  assert.equal(data.reports.length, 0);
});

test("概览请求使用精简数据，默认请求仍保留完整报告", async () => {
  for (const summary of [false, true]) {
    let url;
    const ctx = vm.createContext({ fetch: async (value) => { url = value; return { ok: true, json: async () => ({ mode: "live", reports: [], stations: [] }) }; }, AbortController, setTimeout: () => 1, clearTimeout() {}, document: { querySelector: () => ({}) } });
    vm.runInContext(source, ctx);
    await vm.runInContext(`PublicData.load(${summary})`, ctx);
    assert.equal(url, "/api/public/bootstrap" + (summary ? "?summary=true" : ""));
  }
});

test("请求未完成时明确标记加载中，禁止回退演示报告", async () => {
  let resolve;
  let calls = 0;
  const ctx = vm.createContext({ fetch: () => { calls++; return new Promise((done) => { resolve = done; }); }, AbortController, setTimeout: () => 1, clearTimeout: () => {}, document: { querySelector: () => ({}) } });
  vm.runInContext(source, ctx);
  const pending = vm.runInContext("PublicData.load()", ctx);
  const same = vm.runInContext("PublicData.load()", ctx);
  const data = vm.runInContext("PublicData", ctx);
  assert.equal(data.loading, true);
  assert.equal(data.live, true);
  assert.equal(data.failed, false);
  assert.equal(data.reports.length, 0);
  assert.equal(calls, 1);
  resolve({ status: 200, ok: true, json: async () => ({ mode: "live", reports: [], stations: [] }) });
  await Promise.all([pending, same]);
  assert.equal(data.loading, false);
});

test("请求失败和静态预览 404 均结束加载状态", async () => {
  const failed = await load(async () => { throw new Error("offline"); });
  assert.equal(failed.loading, false);
  assert.equal(failed.live, true);
  assert.equal(failed.failed, true);
  const preview = await load(async () => ({ status: 404 }), false);
  assert.equal(preview.loading, false);
  assert.equal(preview.live, false);
});

test("滚动公告保留展示范围、转义文本和颜色边界，重复内容不进入朗读与键盘导航", () => {
  const ctx = vm.createContext({ UI: {
    icon: () => "",
    esc: (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
  } });
  vm.runInContext(source, ctx);
  const data = vm.runInContext("PublicData", ctx);
  data.announcements = [
    { title: "首页专用", content: "仅首页", placement: "home", tone: "info" },
    { title: "<script>", content: "a & b", link: "https://example.com", placement: "all", tone: "success", background_color: "#aabbcc", text_color: 'red;\" onclick=\"bad' }
  ];
  const other = data.notices(false);
  assert.doesNotMatch(other, /首页专用|<script>|onclick/);
  assert.match(other, /--announcement-bg:#aabbcc/);
  assert.match(other, /&lt;script&gt;/);
  assert.match(other, /a &amp; b/);
  assert.match(other, /aria-hidden="true"/);
  assert.match(other, /tabindex="-1"/);
  assert.match(other, /type="checkbox"/);
  assert.match(data.notices(true), /首页专用/);
});
