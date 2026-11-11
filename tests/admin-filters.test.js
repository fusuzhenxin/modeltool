const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const handlers = {};
  const list = { innerHTML: "" };
  const app = { addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } };
  const context = vm.createContext({
    document: {
      getElementById(id) { return id === "admin-app" ? app : id === "list-content" ? list : id === "bulk-count" ? null : { addEventListener() {} }; },
      addEventListener(type, handler) { handlers[type] = handler; }
    },
    window: { addEventListener() {} }, setInterval() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../admin/bulk.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(__dirname, "../admin/admin.js"), "utf8");
  const patched = source.replace(/  start\(\);\s+return \{ refresh: loadPage \};/, "  return { state, visibleRows, testFilters, listContent, listPage };");
  assert.notEqual(patched, source);
  vm.runInContext(patched, context);
  const admin = vm.runInContext("Admin", context);
  admin.handlers = handlers;
  admin.renderedList = list;
  admin.state.tests = [{ id: "site_relay", label: "中转站测试" }, { id: "site_pelican", label: "骑车测试" }];
  admin.state.stations = [{ id: "s", name: "目标站点" }, { id: "other", name: "其他站点" }];
  admin.state.rows = [
    { id: "a", station_id: "s", model: "m", kind: "site_relay", status: "draft", enabled: true },
    { id: "b", station_id: "s", model: "m-extra", kind: "site_relay", status: "draft", enabled: true },
    { id: "c", station_id: "s", model: "m", kind: "site_pelican", status: "draft", enabled: true },
    { id: "d", station_id: "s", model: "m", kind: "site_relay", status: "published", enabled: false },
    { id: "e", station_id: "other", model: "m", kind: "site_relay", status: "draft", enabled: true }
  ];
  return admin;
}

test("三个页面支持模型、测试项、状态和搜索取交集，模型精确匹配", () => {
  for (const route of ["jobs", "schedules", "reports"]) {
    const admin = setup();
    Object.assign(admin.state, { route, modelFilter: "m", testFilter: "site_relay", search: "目标", filter: route === "schedules" ? "enabled" : "draft" });
    assert.equal(JSON.stringify(admin.visibleRows().map(row => row.id)), '["a"]', route);
    const html = admin.testFilters();
    assert.match(html, /id="model-filter"/);
    assert.match(html, /id="test-filter"/);
    assert.match(html, /value="m" selected/);
    assert.match(html, /value="site_relay" selected/);
  }
});

test("其他模块不显示或应用模型、测试项筛选", () => {
  const admin = setup();
  Object.assign(admin.state, { route: "stations", modelFilter: "missing", testFilter: "missing" });
  assert.equal(admin.visibleRows().length, 5);
  assert.equal(admin.testFilters(), "");
});

test("历史测试和旧骑车报告可分别筛选，明确 kind 优先", () => {
  const admin = setup();
  Object.assign(admin.state, { route: "reports", rows: [
    { id: "legacy" }, { id: "old-art", artwork: { mode: "svg" } },
    { id: "new-art", kind: "site_pelican", artwork: { mode: "svg" } }
  ] });
  for (const [kind, expected] of [["legacy", "legacy"], ["pelican", "old-art"], ["site_pelican", "new-art"]]) {
    admin.state.testFilter = kind;
    assert.equal(JSON.stringify(admin.visibleRows().map(row => row.id)), JSON.stringify([expected]));
  }
  assert.match(admin.testFilters(), /历史测试（未标注项目）/);
});

test("选项去重、转义，并保留刷新后暂时无记录的已选模型和测试项", () => {
  const admin = setup();
  Object.assign(admin.state, { route: "jobs", modelFilter: 'missing"<img>', testFilter: "retired", rows: [{ model: "m", kind: "retired" }, { model: "m", kind: "retired" }] });
  const html = admin.testFilters();
  assert.equal((html.match(/value="m"/g) || []).length, 1);
  assert.equal((html.match(/value="retired"/g) || []).length, 1);
  assert.match(html, /value="missing&quot;&lt;img&gt;" selected/);
  assert.doesNotMatch(html, /<img>/);
  assert.equal(admin.visibleRows().length, 0);
  assert.match(admin.listContent(), /没有符合条件的记录/);
});

test("过滤发生在分页之前，批量条数使用筛选结果", () => {
  const admin = setup();
  Object.assign(admin.state, { route: "jobs", modelFilter: "m", rows: Array.from({ length: 30 }, (_, i) => ({ id: "r" + i, station_id: "s", model: i % 2 ? "other" : "m", kind: "site_relay", status: "queued" })) });
  let html = admin.listContent();
  assert.equal((html.match(/data-bulk-id=/g) || []).length, 12);
  assert.doesNotMatch(html, /data-bulk-id="r1"/);
  admin.state.page = 2;
  html = admin.listContent();
  assert.equal((html.match(/data-bulk-id=/g) || []).length, 3);
  assert.match(html, /data-bulk-id="r24"/);
  assert.equal(admin.visibleRows().length, 15);
});

test("实际 change 事件更新筛选、回到首页并清空旧选择与批量结果", async () => {
  for (const route of ["jobs", "schedules", "reports"]) {
    for (const [id, key, value] of [["model-filter", "modelFilter", "m"], ["test-filter", "testFilter", "site_relay"], ["filter", "filter", route === "schedules" ? "enabled" : "draft"]]) {
      const admin = setup();
      Object.assign(admin.state, { route, page: 4, bulkResult: { count: 1 } });
      admin.state.selected.add("b");
      await admin.handlers.change({ target: { id, value, dataset: {}, hasAttribute() { return false; } } });
      assert.equal(admin.state[key], value);
      assert.equal(admin.state.page, 1);
      assert.equal(admin.state.selected.size, 0);
      assert.equal(admin.state.bulkResult, null);
      assert.match(admin.renderedList.innerHTML, /共 \d+ 条记录/);
    }
  }
});

test("搜索事件保留模型与测试项条件，并重置分页和旧选择", () => {
  for (const route of ["jobs", "schedules", "reports"]) {
    const admin = setup();
    Object.assign(admin.state, { route, modelFilter: "m", testFilter: "site_relay", page: 3, bulkResult: { count: 1 } });
    admin.state.selected.add("b");
    admin.handlers.input({ target: { id: "search", value: "目标" } });
    assert.equal(admin.state.search, "目标");
    assert.equal(admin.state.modelFilter, "m");
    assert.equal(admin.state.testFilter, "site_relay");
    assert.equal(admin.state.page, 1);
    assert.equal(admin.state.selected.size, 0);
    assert.equal(admin.state.bulkResult, null);
    assert.equal(JSON.stringify(admin.visibleRows().map(row => row.id)), '["a","d"]');
    assert.match(admin.renderedList.innerHTML, /共 2 条记录/);
  }
});

test("全选筛选结果跨页且仅选择匹配记录，翻页保留筛选与勾选", async () => {
  for (const route of ["jobs", "schedules", "reports"]) {
    const admin = setup();
    Object.assign(admin.state, { route, modelFilter: "m", testFilter: "site_relay", rows: Array.from({ length: 50 }, (_, i) => ({ id: "r" + i, station_id: "s", model: i % 2 ? "other" : "m", kind: "site_relay", status: "draft" })) });
    const click = async (action) => {
      const button = { dataset: { action } };
      await admin.handlers.click({ target: { closest() { return button; } } });
    };
    admin.state.selected.add("r1");
    await click("bulk-filter");
    assert.equal(JSON.stringify([...admin.state.selected]), JSON.stringify(Array.from({ length: 25 }, (_, i) => "r" + i * 2)));
    await click("next");
    assert.equal(admin.state.page, 2);
    assert.equal(admin.state.modelFilter, "m");
    assert.equal(admin.state.testFilter, "site_relay");
    assert.equal((admin.renderedList.innerHTML.match(/data-bulk-id=/g) || []).length, 12);
    assert.match(admin.renderedList.innerHTML, /data-bulk-id="r24"[^>]*checked/);
    assert.doesNotMatch(admin.renderedList.innerHTML, /data-bulk-id="r1"/);
    await click("prev");
    assert.equal(admin.state.page, 1);
    assert.match(admin.renderedList.innerHTML, /data-bulk-id="r0"[^>]*checked/);
    assert.equal(admin.state.selected.size, 25);
  }
});

test("三个页面的完整工具栏包含两个筛选，重新渲染保留已选条件", () => {
  for (const route of ["jobs", "schedules", "reports"]) {
    const admin = setup();
    Object.assign(admin.state, { route, modelFilter: "m", testFilter: "site_relay", rows: [] });
    const html = admin.listPage();
    assert.match(html, /test-filter-toolbar/);
    assert.match(html, /id="model-filter"/);
    assert.match(html, /id="test-filter"/);
    assert.match(html, /value="m" selected/);
    assert.match(html, /value="site_relay" selected/);
  }
});
