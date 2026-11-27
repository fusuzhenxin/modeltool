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
  assert.match(models, /统一选择模型（可多选）/);
  assert.match(models, /统一检测模型/);
  assert.match(models, /shared（2\/2 家已登记）/);
  assert.match(models, /only-a（1\/2 家已登记）/);
  assert.match(models, /id="schedule-station-models"[^>]* hidden/);
  const mixed = schedules.modelFields(stations, ["a", "c"], { shared: "shared", models: { a: "only-a" } }, select, esc);
  assert.match(mixed, /站点 C：未登记统一模型 shared/);
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
  assert.throws(() => schedules.build(spec, stations, ["a", "b"], selection), /站点 A：未登记统一模型 only-c；站点 B：未登记统一模型 only-c/);
  assert.throws(() => schedules.build(spec, stations, ["a"], { ...selection, shared: "" }), /至少一个/);
  assert.match(schedules.modelHint(stations, ["a", "b"], "shared", esc), /2<\/strong> 家中转站，将创建 <strong>2/);
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
  assert.deepEqual(JSON.parse(JSON.stringify(batch.runs[1])), { ...spec, station_id: "b", model: "only-b", models:["only-b"], kinds:[spec.kind] });
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

test("一站多模型和多站多模型按组合创建，保留各项检测与时间设置", () => {
  const sites = stations.slice(0,2).map(s => ({...s, models:["gpt","claude","extra"]}));
  const plans = schedules.build({...spec,schedule_mode:"daily",daily_time:"09:00"},sites,["a","b"],{mode:"shared",shared:["gpt","claude","extra"]}).schedules;
  assert.equal(plans.length,2);
  assert.deepEqual(Array.from(plans,p => `${p.station_id}/${p.model}`), ["a/gpt","b/gpt"]);
  assert.equal(new Set(plans.map(p=>p.name)).size,2);
  assert.deepEqual(Array.from(plans[0].models),["gpt","claude","extra"]);
  assert.ok(plans.every(p=>p.daily_time==="09:00" && p.kind===spec.kind && p.count===10));
  const separate = schedules.build(spec,sites,["a","b"],{mode:"separate",shared:[],models:{a:["gpt","claude"],b:["extra"]}}).schedules;
  assert.equal(separate.length,2);
  assert.equal(separate[1].model,"extra");
  const hint = schedules.selectionHint(sites,["a","b"],{mode:"shared",shared:["gpt","claude","extra"]},esc);
  assert.match(hint,/将创建 <strong>2/);
});

test("去重所选模型，空模型、未登记组合与超出 100 条都禁止整批提交", () => {
  assert.equal(schedules.build(spec,stations,["a"],{mode:"shared",shared:["shared","shared","only-a"]}).schedules.length,1);
  assert.throws(()=>schedules.build(spec,stations,["a"],{mode:"separate",models:{a:[]}}),/至少一个/);
  assert.throws(()=>schedules.build(spec,stations,["a","b"],{mode:"shared",shared:["shared","only-a"]}),/站点 B/);
  const sites = Array.from({length:101},(_,i)=>({...stations[0],id:String(i)}));
  assert.throws(()=>schedules.build(spec,sites,sites.map(s=>s.id),{mode:"shared",shared:["shared","only-a"]}),/1–100/);
  assert.equal(schedules.build(spec,sites.slice(0,50),sites.slice(0,50).map(s=>s.id),{mode:"shared",shared:["shared","only-a"]}).schedules.length,50);
});

test("重建多选控件保留明确清空的选择，失效模型显示警告而不自动换模型", () => {
  const empty = schedules.modelFields(stations,["a"],{mode:"shared",shared:[],models:{a:[]}},select,esc);
  assert.match(empty,/multiple required/);
  assert.doesNotMatch(empty,/value="shared" selected>shared/);
  assert.match(empty,/请选择至少一个/);
  const old = schedules.modelFields(stations,["a"],{mode:"shared",shared:["removed"],models:{}},select,esc);
  assert.match(old,/value="removed" selected/);
  assert.match(old,/未登记统一模型 removed/);
});

test("批量手动检测按站点合并，保留模型和测试数组", () => {
  const runs = schedules.buildRuns({kind:"site_candy",count:3},stations,["a"],{mode:"shared",shared:["shared","only-a"]}).runs;
  assert.equal(runs.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(runs)),[{kind:"site_candy",count:3,station_id:"a",model:"shared",models:["shared","only-a"],kinds:["site_candy"]}]);
});

test("切换模型设置停用隐藏必填多选框，并保留两种模式的所选值", () => {
  const groups={"#schedule-shared-model":{},"#schedule-station-models":{}};
  const fields={schedule_model_mode:{value:"separate"},schedule_model:{selectedOptions:[{value:"shared"},{value:"only-a"}]},station_model_a:{selectedOptions:[{value:"only-a"}]}};
  const form={elements:{namedItem:n=>fields[n]},querySelector:n=>groups[n]};
  schedules.updateModelMode(form);
  assert.equal(groups["#schedule-shared-model"].disabled,true);
  assert.equal(groups["#schedule-station-models"].disabled,false);
  const selected=schedules.selection(form,stations);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.shared)),["shared","only-a"]);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.models.a)),["only-a"]);
});

test("发布方式默认待审核并在批量模型展开后保留直接公开", () => {
  const html = schedules.publicationField({}, select);
  assert.match(html, /value="review" selected/);
  assert.match(html, /完成后直接公开/);
  assert.equal(schedules.publicationLabel({publish_mode:"auto"}), "完成后直接公开");
  const plans = schedules.build({...spec,publish_mode:"auto"},stations,["a","b"],{mode:"shared",shared:["shared"]});
  assert.ok(plans.schedules.every(p => p.publish_mode === "auto"));
  const runs = schedules.buildRuns({...spec,publish_mode:"review"},stations,["a"],{mode:"shared",shared:["shared","only-a"]});
  assert.ok(runs.runs.every(p => p.publish_mode === "review"));
});
