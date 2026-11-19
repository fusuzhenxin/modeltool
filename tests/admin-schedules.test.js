const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
context.FormData = function(form) { this.get = (name) => form[name] ?? null; };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../admin/schedules.js"), "utf8"), context);
const schedules = vm.runInContext("AdminSchedules", context);
const stations = [
  { id: "a", name: "站点 A", models: ["shared", "only-a"], has_key: true, enabled: true },
  { id: "b", name: "站点 B", models: ["shared", "only-b"], has_key: true, enabled: true },
  { id: "c", name: "站点 C", models: ["only-c"], has_key: false, enabled: false }
];
const esc = (value) => String(value).replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const select = (name, label, options, value) => `<label>${esc(label)}<select name="${name}">${options.map(([key, title]) => `<option value="${key}"${key === value ? " selected" : ""}>${esc(title)}</option>`).join("")}</select></label>`;
const spec = { name: "每晚检测", station_id: "", model: "", enabled: true, interval_minutes: 60, first_run: null, kind: "site_relay", count: 10 };

test("多选站点默认统一模型，即使没有共同模型也保留统一选择与覆盖提示", () => {
  const html = schedules.stationField(stations, ["a", "b"], esc);
  assert.match(html, /name="station_ids" multiple required/);
  assert.equal((html.match(/ selected/g) || []).length, 2);
  assert.match(html, /未配置密钥/);
  assert.match(html, /已暂停/);
  const models = schedules.modelFields(stations, ["a", "b"], undefined, select, esc);
  assert.match(models, /value="shared" selected/);
  assert.match(models, /统一使用一个模型/);
  assert.match(models, /统一检测模型/);
  assert.match(models, /shared（2\/2 家已登记）/);
  assert.match(models, /only-a（1\/2 家已登记）/);
  assert.match(models, /id="schedule-station-models"[^>]* hidden/);
  const mixed = schedules.modelFields(stations, ["a", "c"], { shared: "shared", models: { a: "only-a" } }, select, esc);
  assert.match(mixed, /站点 C 未登记 shared/);
  assert.match(mixed, /value="shared" selected/);
  assert.match(mixed, /id="schedule-station-models"[^>]* hidden/);
  const separate = schedules.modelFields(stations, ["a", "c"], { mode: "separate", shared: "shared", models: { a: "only-a" } }, select, esc);
  assert.doesNotMatch(separate, /id="schedule-station-models"[^>]* hidden/);
  assert.match(mixed, /value="only-a" selected/);
  assert.match(mixed, /name="station_model_c"/);
});

test("批量计划按站点生成独立名称、模型并共用时间和项目设置", () => {
  const shared = schedules.build(spec, stations, ["a", "b"], { shared: "shared", models: {} }).schedules;
  assert.equal(shared.length, 2);
  assert.equal(shared[0].name, "每晚检测 · 站点 A");
  assert.equal(shared[1].station_id, "b");
  assert.equal(shared[1].model, "shared");
  assert.equal(shared[1].interval_minutes, 60);
  const separate = schedules.build(spec, stations, ["a", "b"], { mode: "separate", shared: "shared", models: { a: "only-a", b: "only-b" } }).schedules;
  assert.equal(separate[0].model, "only-a");
  assert.equal(separate[1].model, "only-b");
  assert.equal(schedules.build(spec, stations, ["a"], { shared: "shared", models: {} }).schedules[0].name, spec.name);
});

test("统一模型不回退到站点默认值，列出所有未登记站点并安全显示提示", () => {
  const selection = { mode: "shared", shared: "only-c", models: { a: "only-a", b: "only-b" } };
  assert.throws(() => schedules.build(spec, stations, ["a", "b"], selection), /站点 A、站点 B：未登记统一模型 only-c/);
  assert.throws(() => schedules.build(spec, stations, ["a"], { ...selection, shared: "" }), /未选择/);
  assert.match(schedules.modelHint(stations, ["a", "b"], "shared", esc), /2<\/strong> 家中转站，统一检测/);
  const unsafe = [{ ...stations[0], name: '<img src=x>', models: [] }];
  const hint = schedules.modelHint(unsafe, ["a"], '<script>', esc);
  assert.doesNotMatch(hint, /<img|<script>/);
  assert.match(hint, /&lt;img/);
});

test("空选择、失效站点、模型不匹配和未配置密钥的启用计划不能提交", () => {
  for (const ids of [[], ["a", "a"], ["missing"], Array(101).fill("a")]) assert.throws(() => schedules.build(spec, stations, ids, { shared: "shared", models: {} }));
  assert.throws(() => schedules.build(spec, stations, ["a", "b"], { shared: "only-a", models: {} }), /站点 B/);
  assert.throws(() => schedules.build(spec, stations, ["c"], { shared: "only-c", models: {} }), /启用站点并配置密钥/);
  assert.equal(schedules.build({ ...spec, enabled: false }, stations, ["c"], { shared: "only-c", models: {} }).schedules.length, 1);
});

test("计划名称附加站点名后不超过 100 字，并保留 Unicode 完整字符", () => {
  const plans = schedules.build({ ...spec, name: "🌟".repeat(100) }, stations, ["a", "b"], { shared: "shared", models: {} }).schedules;
  assert.equal(Array.from(plans[0].name).length, 100);
  assert.match(plans[0].name, / · 站点 A$/);
});

test("批量手动检测复用模型选择，只传检测参数并阻止无密钥站点", () => {
  const spec = { station_id: "", model: "", kind: "site_relay", difficulty: "hard", count: 3, candy_count: 5, pelican_mode: "svg" };
  const batch = schedules.buildRuns(spec, stations, ["a", "b"], { mode: "separate", models: { a: "only-a", b: "only-b" } });
  assert.equal(batch.runs.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(batch.runs[1])), { ...spec, station_id: "b", model: "only-b" });
  assert.throws(() => schedules.buildRuns(spec, stations, ["c"], { shared: "only-c" }), /启用站点并配置密钥/);
  assert.throws(() => schedules.buildRuns(spec, stations, ["a", "b"], { shared: "only-a" }), /站点 B/);
});

test("三种执行方式只提交当前方式的时间字段", () => {
  const dormant = { interval_minutes: "bad", first_run: "bad", execution_at: "bad", daily_time: "bad" };
  const daily = schedules.timing({ ...dormant, schedule_mode: "daily", daily_time: "23:15" });
  assert.deepEqual(JSON.parse(JSON.stringify(daily)), { schedule_mode: "daily", daily_time: "23:15" });
  const once = schedules.timing({ ...dormant, schedule_mode: "once", execution_at: "2099-11-19T20:30" });
  assert.deepEqual(JSON.parse(JSON.stringify(once)), { schedule_mode: "once", first_run: new Date("2099-11-19T20:30").toISOString() });
  const interval = schedules.timing({ ...dormant, schedule_mode: "interval", first_run: "", interval_minutes: "360" });
  assert.deepEqual(JSON.parse(JSON.stringify(interval)), { schedule_mode: "interval", first_run: null, interval_minutes: 360 });
  assert.throws(() => schedules.timing({ schedule_mode: "once" }), /日期和时间/);
});

test("切换方式隐藏并停用其他时间字段，避免隐藏必填项阻止保存", () => {
  const groups = ["interval", "once", "daily"].map((mode) => ({ dataset: { scheduleTiming: mode } }));
  for (const mode of ["once", "daily", "interval"]) {
    schedules.updateTiming({ elements: { namedItem: () => ({ value: mode }) }, querySelectorAll: () => groups });
    for (const group of groups) {
      assert.equal(group.hidden, group.dataset.scheduleTiming !== mode);
      assert.equal(group.disabled, group.hidden);
    }
  }
  assert.equal(schedules.timingLabel({ schedule_mode: "daily", daily_time: "20:00" }), "每天 20:00（北京时间）");
  assert.match(schedules.timingLabel({ schedule_mode: "once" }), /仅一次/);
  assert.equal(schedules.timingLabel({ interval_minutes: 360 }), "每 6 小时");
});
