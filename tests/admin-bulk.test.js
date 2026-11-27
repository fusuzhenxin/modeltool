const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../admin/bulk.js"), "utf8"), context);
const bulk = vm.runInContext("AdminBulk", context);
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

test("批量计划修改只提交填写项，校验时间间隔并转义模型", () => {
  const form = (values) => ({ get: (key) => values[key] });
  assert.equal(JSON.stringify(bulk.scheduleChanges(form({ change_model: "m2" }))), JSON.stringify({ model: "m2" }));
  assert.equal(JSON.stringify(bulk.scheduleChanges(form({ change_interval: "360" }))), JSON.stringify({ interval_minutes: 360 }));
  const changes = bulk.scheduleChanges(form({ change_next_run: "2099-11-13T20:30" }));
  assert.equal(changes.next_run, new Date("2099-11-13T20:30").toISOString());
  for (const values of [{}, { change_interval: "0" }, { change_interval: "1.5" }, { change_next_run: "2000-01-01T00:00" }]) assert.throws(() => bulk.scheduleChanges(form(values)));
  const html = bulk.scheduleFields([{ station_id: "a" }], [{ id: "a", models: ['<script>'] }], esc);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /change_next_run/);
  assert.ok(bulk.actions.schedules.some(([action]) => action === "edit"));
});

test("批量立即执行入口说明费用与计划时间，批量时间按选择的方式提交", () => {
  assert.ok(bulk.actions.schedules.some(([action]) => action === "run"));
  assert.match(bulk.explanation("schedules", "run"), /不改变计划启停状态和下次执行时间/);
  const form = (values) => ({ get: (name) => values[name] });
  const daily = bulk.scheduleChanges(form({ change_mode: "daily", change_daily_time: "19:30", change_interval: "bad", change_next_run: "bad" }));
  assert.deepEqual(JSON.parse(JSON.stringify(daily)), { schedule_mode: "daily", daily_time: "19:30" });
  const once = bulk.scheduleChanges(form({ change_mode: "once", change_next_run: "2099-01-01T20:00", change_interval: "bad" }));
  assert.equal(once.schedule_mode, "once"); assert.ok(once.next_run); assert.equal(once.interval_minutes, undefined);
  assert.throws(() => bulk.scheduleChanges(form({ change_mode: "once" })), /日期和时间/);
  assert.throws(() => bulk.scheduleChanges(form({ change_mode: "daily", change_daily_time: "24:00" })), /时刻/);
});

test("跨页勾选、取消本页和刷新剔除失效记录", () => {
  const chosen = new Set();
  bulk.choose(chosen, ["page1-a", "page1-b"], true);
  bulk.choose(chosen, ["page2-a"], true);
  bulk.choose(chosen, ["page1-a", "page1-b"], false);
  assert.deepEqual([...chosen], ["page2-a"]);
  bulk.choose(chosen, ["removed"], true);
  bulk.prune(chosen, [{ id: "page2-a" }]);
  assert.deepEqual([...chosen], ["page2-a"]);
});

test("超过 100 条拒绝整次追加，已有选择不变", () => {
  const chosen = new Set(Array.from({ length: 99 }, (_, i) => String(i)));
  assert.throws(() => bulk.choose(chosen, ["a", "b"], true), /100/);
  assert.equal(chosen.size, 99);
  assert.equal(chosen.has("a"), false);
  bulk.choose(chosen, ["99"], true);
  bulk.choose(chosen, ["99"], true);
  assert.equal(chosen.size, 100);
});

test("勾选列正确关联当前行，并转义可见名称和 ID", () => {
  const render = (head, rows) => `<thead>${head.join("|")}</thead><tbody>${rows.join("")}</tbody>`;
  const rows = [{ id: 'a"x', name: '<img src=x>' }, { id: "b", model: "m" }];
  const chosen = new Set(['a"x']);
  const html = bulk.table(["名称"], ["<tr><td>A</td></tr>", "<tr><td>B</td></tr>"], rows, chosen, esc, render);
  assert.match(html, /data-bulk-id="a&quot;x"/);
  assert.match(html, /aria-label="选择&lt;img src=x>"/);
  assert.match(html, /<tr class="bulk-selected">/);
  assert.equal((html.match(/ checked/g) || []).length, 1);
  bulk.choose(chosen, ["b"], true);
  const all = bulk.table([], ["<tr></tr>", "<tr></tr>"], rows, chosen, esc, render);
  assert.equal((all.match(/ checked/g) || []).length, 3);
});

test("所有列表模块有批量入口，空选择禁用并说明筛选上限", () => {
  for (const kind of ["reports", "stations", "schedules", "jobs", "announcements", "ads", "proposals"]) {
    const empty = bulk.toolbar(kind, new Set(), 101);
    assert.match(empty, /选择筛选结果前 100 条/);
    const buttons = empty.match(/<button[^>]*data-action="bulk-open"[^>]*>/g);
    assert.ok(buttons.length);
    assert.ok(buttons.every((html) => html.includes("disabled")));
    const selected = bulk.toolbar(kind, new Set(["x"]), 5);
    assert.match(selected, /全选筛选结果/);
    assert.ok((selected.match(/<button[^>]*data-action="bulk-open"[^>]*>/g)).every((html) => !html.includes("disabled")));
  }
  assert.ok(bulk.actions.stations.some(([action]) => action === "run"));
});

test("批量结果显示可处理数及每条跳过原因，内容按文本输出", () => {
  const html = bulk.result({ label: "批量通过并公开", count: 2, skipped: [{ label: '<img src=x>', reason: '<script>bad</script>' }] }, esc);
  assert.match(html, /已处理 2 条，跳过 1 条/);
  assert.match(html, /查看跳过原因/);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.equal(bulk.result(null, esc), "");
});

test("真实列表渲染在七个模块都含逐行勾选，并在翻页后保留选择", () => {
  const ui = vm.createContext({
    document: { getElementById() { return { addEventListener() {} }; }, addEventListener() {} },
    window: { addEventListener() {} }, setInterval() {}, AdminBulk: bulk
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/report-quality.js"), "utf8"), ui);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../admin/schedules.js"), "utf8"), ui);
  const source = fs.readFileSync(path.join(__dirname, "../admin/admin.js"), "utf8")
    .replace(/  start\(\);\s+return \{ refresh: loadPage \};/, "  return { state, listContent };");
  vm.runInContext(source, ui);
  const admin = vm.runInContext("Admin", ui);
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: "row" + i, station_id: "site", name: "记录" + i, domain: "relay.example", model: "m", models: ["m"], tests: [], title: "标题", kind: "site_relay", status: "draft", time: "2026-11-10", enabled: true, visible: true, placement: "hero" }));
  admin.state.stations = [{ id: "site", name: "中转站" }];
  admin.state.rows = rows;
  rows[0].status = "done";
  rows[0].report_id = "report0";
  rows[0].scores = [{ label: "中转站", value: 0 }, { label: "能力", value: 85 }];
  rows[1].status = "done";
  rows[1].report_id = "report1";
  admin.state.selected.add("row0");
  admin.state.selected.add("row12");
  for (const kind of Object.keys(bulk.actions)) {
    admin.state.route = kind;
    admin.state.page = 1;
    const first = admin.listContent();
    assert.equal((first.match(/data-bulk-id=/g) || []).length, 12, kind);
    assert.match(first, /data-bulk-id="row0"[^>]*checked/);
    if (kind === "jobs") {
      assert.match(first, /<th>检测分数<\/th>/);
      assert.match(first, /中转站<\/small><strong>0<\/strong>/);
      assert.match(first, /能力<\/small><strong>85<\/strong>/);
      assert.match(first, /未计分/);
      assert.match(first, /class="muted">—/);
    }
    admin.state.page = 2;
    const second = admin.listContent();
    assert.match(second, /data-bulk-id="row12"[^>]*checked/);
    assert.doesNotMatch(second, /data-bulk-id="row0"/);
    assert.equal(admin.state.selected.size, 2);
  }
});


test("批量仅修改发布方式时保留模型和时间配置", () => {
  const changes = bulk.scheduleChanges({get:name => name === "change_publish_mode" ? "auto" : ""});
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), {publish_mode:"auto"});
  assert.match(bulk.scheduleFields([],[],esc), /name="change_publish_mode"/);
});

test("排除失败样本须选择已核实原因和填写证据，支持恢复", () => {
  assert.ok(bulk.actions.jobs.some(([action]) => action === "exclude"));
  assert.ok(bulk.actions.jobs.some(([action]) => action === "restore"));
  const form = values => ({get:name => values[name]});
  assert.throws(() => bulk.exclusionChanges(form({})), /核查依据/);
  assert.throws(() => bulk.exclusionChanges(form({exclusion_reason:"group_unavailable",exclusion_note:"可能吧"})), /核查依据/);
  assert.deepEqual(JSON.parse(JSON.stringify(bulk.exclusionChanges(form({exclusion_reason:"group_unavailable",exclusion_note:"已向商家确认分组删除"})))), {exclusion_reason:"group_unavailable",note:"已向商家确认分组删除"});
  assert.match(bulk.jobExclusion({exclusion:{active:true,reason:"group_unavailable",note:'<script>private</script>'}},esc), /已排除统计/);
  assert.doesNotMatch(bulk.jobExclusion({exclusion:{active:true,note:'<script>private</script>'}},esc), /<script>/);
  assert.match(bulk.explanation("jobs","exclude"), /原记录保留/);
});
