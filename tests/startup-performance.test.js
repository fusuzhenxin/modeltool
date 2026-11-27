const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const pages = fs.readFileSync(path.join(root, "js/pages.js"), "utf8");
const publicSource = fs.readFileSync(path.join(root, "js/public-data.js"), "utf8");
const turn = () => new Promise(setImmediate);

function client({ manualContent = false } = {}) {
  let resolve, resolveContent;
  const writes = [], mounted = [];
  const overview = { innerHTML: "loading" }, notices = {};
  const element = { set innerHTML(value) { writes.push(value); } };
  const ctx = vm.createContext({
    window: { __vdVisit: true }, Store: { init: async () => {} },
    UI: { bind() {}, shell: (page, body) => `navigation:${page}:${body}` },
    document: {
      querySelector: (selector) => selector.includes("modeltool-backend") ? {} : null,
      getElementById: (id) => ({ app: element, "home-public-overview": overview, "public-notices": notices })[id] || null
    },
    URLSearchParams, fetch: (url) => url.includes("content_only=true")
      ? manualContent ? new Promise(done => { resolveContent = done; }) : Promise.resolve({ ok: true, json: async () => ({ mode: "live", ads: [], announcements: [] }) })
      : new Promise((done) => { resolve = done; }),
    AbortController, setTimeout: () => 1, clearTimeout() {}, clearInterval() {}, applyHead() {}
  });
  vm.runInContext(publicSource, ctx);
  vm.runInContext(pages.slice(0, pages.indexOf("function qs()")), ctx);
  vm.runInContext(pages.slice(pages.indexOf("const Pages = {"), pages.indexOf("  home() {")) + "};", ctx);
  const realPages = vm.runInContext("Pages", ctx);
  Object.assign(realPages, {
    home: () => `homepage:${vm.runInContext("PublicData.loading", ctx) ? "loading" : "ready"}`,
    setup: () => "editable form", relays: () => "reports:ready",
    mount: Object.fromEntries(["home", "setup", "relays"].map((page) => [page, () => mounted.push(page)]))
  });
  ctx.RelayDirectory = { overview: () => "real public overview" };
  return { ctx, writes, mounted, overview, notices,
    finishContent: response => resolveContent(response || { ok: true, json: async () => ({ mode: "live", ads: [], announcements: [] }) }),
    finish: (response) => resolve(response || { status: 200, ok: true, json: async () => ({ mode: "live", reports: [], stations: [] }) }) };
}

test("稳定性观察先挂载统计，赞助配置返回后独立展示且不重建页面", async () => {
  const c = client({ manualContent: true });
  c.ctx.location = { search: "?view=stability" };
  const ads = [];
  c.ctx.Ads = { mount: () => ads.push(vm.runInContext("PublicData.ads.length", c.ctx)) };
  const startup = vm.runInContext('App.start("relays")', c.ctx);
  await turn();
  assert.deepEqual(c.writes, ["reports:ready"]);
  assert.deepEqual(c.mounted, ["relays"]);
  assert.deepEqual(ads, [0]);
  c.finishContent({ ok: true, json: async () => ({ mode: "live", reports: [], stations: [], announcements: [], ads: [{ placement: "hero" }, { placement: "footer" }] }) });
  await startup;
  assert.deepEqual(ads, [0, 2]);
  assert.deepEqual(c.writes, ["reports:ready"]);
  assert.deepEqual(c.mounted, ["relays"]);
});

test("慢接口未返回时首页与状态组件已经挂载，数据返回仅更新统计", async () => {
  const c = client();
  const startup = vm.runInContext('App.start("home")', c.ctx);
  await turn();
  assert.deepEqual(c.writes, ["homepage:loading"]);
  assert.deepEqual(c.mounted, ["home"]);
  assert.match(vm.runInContext("Pages.publicOverview()", c.ctx), /正在加载公开检测数据/);
  c.finish(); await startup;
  assert.deepEqual(c.writes, ["homepage:loading"]);
  assert.equal(c.overview.innerHTML, "real public overview");
  assert.deepEqual(c.mounted, ["home"]);
});

test("表单先可操作，后台返回不会重建表单或重复挂载", async () => {
  const c = client();
  const startup = vm.runInContext('App.start("setup")', c.ctx);
  await turn();
  assert.deepEqual(c.writes, ["editable form"]);
  assert.deepEqual(c.mounted, ["setup"]);
  c.finish(); await startup;
  assert.deepEqual(c.writes, ["editable form"]);
  assert.deepEqual(c.mounted, ["setup"]);
});

test("数据页先显示可用导航，返回前不渲染任何报告", async () => {
  const c = client();
  const startup = vm.runInContext('App.start("relays")', c.ctx);
  await turn();
  assert.equal(c.writes.length, 1);
  assert.match(c.writes[0], /navigation:relays:.*正在加载页面数据/);
  assert.deepEqual(c.mounted, []);
  c.finish(); await startup;
  assert.equal(c.writes[1], "reports:ready");
  assert.deepEqual(c.mounted, ["relays"]);
});

test("较早启动的慢请求不能覆盖随后选择的页面", async () => {
  const c = client();
  const home = vm.runInContext('App.start("home")', c.ctx);
  await turn();
  const relays = vm.runInContext('App.start("relays")', c.ctx);
  await turn();
  c.finish(); await Promise.all([home, relays]);
  assert.equal(c.writes.at(-1), "reports:ready");
  assert.deepEqual(c.mounted, ["home", "relays"]);
  assert.equal(c.overview.innerHTML, "loading");
});

test("接口失败保留可用首页，并显示失败提示而非零统计", async () => {
  const c = client();
  const startup = vm.runInContext('App.start("home")', c.ctx);
  await turn(); c.finish({ status: 503, ok: false }); await startup;
  assert.equal(c.writes.length, 1);
  assert.equal(vm.runInContext("PublicData.failed && PublicData.live && !PublicData.loading", c.ctx), true);
  assert.match(c.overview.innerHTML, /暂时无法加载/);
  assert.match(c.notices.innerHTML, /当前不显示检测统计/);
  assert.doesNotMatch(c.overview.innerHTML, /real public overview/);
});

test("广告先于慢报告显示，报告完成不会清空或重新挂载广告", async () => {
  const c = client({ manualContent: true });
  const ads = [];
  c.ctx.Ads = { mount: () => ads.push(vm.runInContext("PublicData.ads.length", c.ctx)) };
  const startup = vm.runInContext('App.start("home")', c.ctx);
  await turn();
  c.finishContent({ ok: true, json: async () => ({ mode: "live", ads: [{ placement: "hero" }], announcements: [] }) });
  await turn();
  assert.equal(vm.runInContext("PublicData.loading", c.ctx), true);
  assert.deepEqual(ads, [0, 1]);
  assert.deepEqual(c.writes, ["homepage:loading"]);
  c.finish(); await startup;
  assert.deepEqual(ads, [0, 1]);
  assert.equal(vm.runInContext("PublicData.ads.length", c.ctx), 1);
  assert.equal(c.overview.innerHTML, "real public overview");
});

test("报告故障不阻止广告和公告独立显示，表单不重建", async () => {
  const c = client({ manualContent: true });
  const ads = [];
  c.ctx.Ads = { mount: () => ads.push(vm.runInContext("PublicData.ads.length", c.ctx)) };
  const startup = vm.runInContext('App.start("setup")', c.ctx);
  await turn();
  c.finish({ status: 503, ok: false });
  await turn();
  c.finishContent({ ok: true, json: async () => ({ mode: "live", ads: [{ placement: "hero" }], announcements: [] }) });
  await startup;
  assert.deepEqual(c.writes, ["editable form"]);
  assert.deepEqual(ads, [0, 1]);
  assert.equal(vm.runInContext("PublicData.contentReady && PublicData.failed", c.ctx), true);
});
