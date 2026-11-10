const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function directory(search = "", publicData) {
  const context = vm.createContext({
    URL, URLSearchParams, Date, PublicData: publicData,
    location: { search },
    UI: {
      icon: () => "",
      esc: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
      shell: (_, html) => html
    },
    relayPublicDetail: (row) => "detail:" + row.id
  });
  for (const file of ["relay-public", "relay-directory"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", file + ".js"), "utf8"), context);
  return vm.runInContext("({ directory: RelayDirectory, reports: RELAY_PUBLIC })", context);
}

test("后台排序先于最近检测时间生效，首页、日报和分页目录一致且不改变报告顺序", () => {
  const stations = Array.from({ length: 8 }, (_, i) => ({ domain: `station-${i}.example`, name: `站点${i}`, models: ["m"], order: 0 }));
  stations[0].order = 20;
  stations[6].order = -10;
  stations[7].order = -20;
  const reports = stations.slice(0, 7).map((site, i) => ({ id: `report-${i}`, domain: site.domain, stationName: site.name, time: `2026-11-09 1${6-i}:00`, model: "m", level: "ok", title: "未见掺水" }));
  const data = { live: true, stations, reports };
  const { directory: d } = directory("?date=2026-11-09", data);
  d.today = () => "2026-11-09";
  const listing = d.stationsPage();
  const cards = listing.split('class="relay-station-grid"')[1].split('</section>')[0];
  assert.ok(cards.indexOf("站点7") < cards.indexOf("站点6"), "未测站点也能排在最前");
  assert.ok(cards.indexOf("站点6") < cards.indexOf("站点1"));
  assert.doesNotMatch(cards, /站点0/);
  const second = directory("?date=2026-11-09&page=2", data).directory.stationsPage();
  assert.match(second, /站点0/);
  assert.equal(d.rows()[0].id, "report-0", "报告仍按检测时间排列");
  for (const html of [d.overview().split('class="home-watch-reports"')[1], d.page().split('class="relay-station-grid"')[1].split('</section>')[0]]) {
    assert.ok(html.indexOf("站点6") < html.indexOf("站点1"));
    assert.doesNotMatch(html, /站点0/);
  }
  const filtered = directory("?date=2026-11-09&category=ok", data).directory.stationsPage();
  const filteredCards = filtered.split('class="relay-station-grid"')[1].split('</section>')[0];
  assert.doesNotMatch(filteredCards, /站点7/);
  assert.ok(filteredCards.indexOf("站点6") < filteredCards.indexOf("站点1"));
});

test("旧站点默认排序为零，同序号仍按最近检测排序，空报告安全处理", () => {
  const data = { live: true, stations: [{ domain: "a.example" }, { domain: "b.example", order: 0 }], reports: [] };
  const { directory: d } = directory("", data);
  const a = { domain: "a.example", reports: [{ time: "2026-11-09 09:00" }] };
  const b = { domain: "b.example", reports: [{ time: "2026-11-09 10:00" }] };
  assert.ok(d.compareStations(a, b) > 0);
  assert.ok(d.compareStations(a, { domain: "c.example", reports: [] }) < 0);
  data.stations[0].order = -1;
  assert.ok(d.compareStations(a, b) < 0);
});

test("站点简介按 Unicode 字符截取 100 字，短文直接显示，长文可展开且安全转义", () => {
  const { directory: d } = directory();
  assert.equal(d.stationIntro("  "), "");
  assert.doesNotMatch(d.stationIntro("简".repeat(100)), /<details/);
  const intro = "🌟".repeat(100) + '<img src=x onerror="bad()">更多简介';
  const html = d.stationIntro(intro);
  assert.match(html, /<details class="relay-station-intro-more">/);
  const preview = /class="relay-station-intro-preview">([^<]*)<\/span>/.exec(html)[1];
  assert.equal(preview, "🌟".repeat(100) + "…");
  assert.match(html, /展开全文/);
  assert.match(html, /收起简介/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;更多简介/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("有报告和未测站点都在站名旁展示访问按钮及后台简介", () => {
  const site = { domain: "profile.example", name: "档案站", website_url: "https://profile.example/join", description: "来自后台的站点简介", models: [] };
  const { directory: d } = directory("", { live: true, stations: [site], reports: [] });
  const report = { id: "profile-report", domain: site.domain, stationName: "历史名称", time: "2026-11-09 12:00", model: "test", level: "ok", title: "未见掺水" };
  for (const rows of [[], [report]]) {
    const html = d.stationPage(rows, site.domain, "2026-11-09");
    assert.match(html, /class="relay-station-title-row"><h1>档案站<\/h1><a class="relay-station-visit relay-station-visit-button"/);
    assert.match(html, /href="https:\/\/profile.example\/join" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /站点简介/);
    assert.match(html, /来自后台的站点简介/);
    assert.doesNotMatch(html, /class="entry-actions"/);
  }
});

test("同站多报告按完整域名去重，能力与协议分别分类", () => {
  const { directory: d, reports } = directory();
  const rows = reports.filter((row) => d.day(row) === "2026-11-08");
  const groups = d.group(rows);
  assert.equal(rows.length, 20);
  assert.equal(groups.length, 9);
  assert.equal(groups.filter((group) => d.matches(group, "degraded")).length, 4);
  for (const level of ["bad", "warn", "ok"]) assert.equal(groups.filter((group) => d.matches(group, level)).length, 3);
  const cloud = groups.find((group) => group.domain === "gateway.cloudbridge.example");
  assert.equal(cloud.reports.length, 3);
  assert.equal(cloud.level, "warn", "同站存在正常报告也不能覆盖更严重的结论");
});

test("作品与原版非协议测试不覆盖既有协议结论，未测能力不计入降智统计", () => {
  const { directory: d } = directory();
  const group = d.group([
    { domain: "relay.example", time: "2026-11-09 12:00", kind: "pelican", level: "unknown", artwork: { score: 0 } },
    { domain: "relay.example", time: "2026-11-09 12:10", kind: "site_trace", level: "unknown", protocol_tested: false },
    { domain: "relay.example", time: "2026-11-09 12:20", kind: "site_pelican", level: "unknown", protocol_tested: false },
    { domain: "relay.example", time: "2026-11-09 11:00", kind: "protocol", level: "ok" }
  ])[0];
  assert.equal(group.level, "ok");
  assert.equal(group.abilityCount, 0);
  assert.equal(group.degraded, false);
  assert.equal(d.group([group.reports[0]])[0].level, "unknown");
});

test("首页观察面板每站只取当天最新报告，保留统计与演示标识", () => {
  const { directory: d } = directory();
  d.today = () => "2026-11-08";
  const html = d.overview();
  assert.equal((html.match(/class="home-watch-report"/g) || []).length, 3);
  assert.match(html, /id=demo-caution-retest/);
  assert.match(html, /id=demo-alert-retest/);
  assert.doesNotMatch(html, /id=demo-clear-yesterday/);
  assert.equal((html.match(/class="relay-bar-row/g) || []).length, 4);
  assert.match(html, /演示数据/);
  d.today = () => "2026-11-01";
  assert.match(d.overview(), /今天还没有公开报告/);
});

test("没有能力测试不视为正常或降智，未知协议不进入未见掺水", () => {
  const { directory: d } = directory();
  const group = d.group([
    { domain: "API.EXAMPLE", level: "ok", time: "2026-11-08 10:00" },
    { domain: "api.example", time: "2026-11-08 12:00" }
  ])[0];
  assert.equal(group.domain, "api.example");
  assert.equal(group.level, "unknown");
  assert.equal(group.degraded, false);
  assert.equal(group.abilityCount, 0);
  assert.match(d.abilityBadge({ level: "bad" }), /未测能力/);
});

test("切换日期只显示当天报告，日期无数据有空状态", () => {
  const { directory: d } = directory("?date=2026-11-07");
  const html = d.page();
  assert.match(html, /3 家中转站 · 3 份报告/);
  assert.match(html, /id=demo-clear-yesterday/);
  assert.doesNotMatch(html, /id=demo-clear-noon/);
  const empty = directory("?date=2026-11-01").directory.page();
  assert.match(empty, /0 家中转站 · 0 份报告/);
  assert.match(empty, /这一天还没有公开报告/);
});

test("筛选站点分类不隐藏当天全部报告，图表和站点都可跳转", () => {
  const { directory: d } = directory("?date=2026-11-08&category=bad");
  const html = d.page();
  assert.match(html, /明显掺水的中转站/);
  assert.equal((html.match(/class="panel relay-station-card"/g) || []).length, 3);
  assert.match(html, /id=demo-caution-gpt/);
  assert.match(html, /全部报告/);
  const chart = d.chart(d.group(d.rows().filter((row) => d.day(row) === "2026-11-08")), "2026-11-08");
  assert.match(chart, /category=degraded#relay-stations/);
  assert.match(chart, /station=gateway.cloudbridge.example/);
});

test("站点档案按日期保留多模型和历史，详情可返回同站与当天全部报告", () => {
  const { directory: d, reports } = directory("?station=gateway.cloudbridge.example&date=2026-11-08");
  const html = d.page();
  assert.match(html, /历史共 4 份 · 当日 2 个模型/);
  assert.match(html, /id=demo-caution-retest/);
  assert.match(html, /id=demo-caution-gpt/);
  assert.match(html, /date=2026-11-07/);
  const context = d.reportContext(reports.find((row) => row.id === "demo-caution"));
  assert.match(context, /同条件参考基线/);
  assert.match(context, /date=2026-11-08#daily-reports/);
  assert.match(context, /id=demo-caution-retest/);
  assert.doesNotMatch(context, /id=demo-caution"/);
  assert.equal(directory("?id=demo-caution").directory.page(), "detail:demo-caution");
});

test("非法日期与未知站点安全处理，名称与用户输入正确转义", () => {
  const { directory: d } = directory();
  assert.equal(d.validDay("2026-02-30"), false);
  assert.equal(d.validDay("2028-02-29"), true);
  assert.equal(d.validDay('<script>'), false);
  assert.match(directory("?station=unknown.example").directory.page(), /还没有这个中转站的公开报告/);
  assert.match(directory("?id=unknown").directory.page(), /没有找到这份公开记录/);
  const html = d.stationCard(d.group([{ domain: "bad.example", stationName: '<img src=x onerror=alert(1)>', level: "ok", model: "test", time: "2026-11-08 12:00", id: "bad&id" }])[0], "2026-11-08");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /bad%26id/);
});

test("日报只预览三家并链接到独立目录，首页与站点卡片都有图标", () => {
  const { directory: d } = directory("?date=2026-11-08&category=warn");
  const html = d.page();
  assert.match(html, /stations\.html\?date=2026-11-08&category=warn/);
  assert.match(html, /查看更多中转站/);
  assert.equal((html.match(/class="relay-station-logo"/g) || []).length, 3);
  const daily = directory("?date=2026-11-08").directory.page();
  assert.equal((daily.match(/class="panel relay-station-card"/g) || []).length, 3);
  assert.match(daily, /这里展示 3 家，共 9 家/);
  assert.match(daily, /全部报告<\/h2><span>20 份/);
  d.today = () => "2026-11-08";
  const home = d.overview();
  assert.equal((home.match(/class="relay-station-logo"/g) || []).length, 3);
  assert.match(home, /stations\.html\?date=2026-11-08/);
});

test("完整目录分页覆盖九家站点，分页保留日期、搜索与分类", () => {
  const first = directory("?date=2026-11-08").directory.stationsPage();
  const second = directory("?date=2026-11-08&page=2").directory.stationsPage();
  assert.equal((first.match(/class="panel relay-station-card"/g) || []).length, 6);
  assert.equal((second.match(/class="panel relay-station-card"/g) || []).length, 3);
  assert.match(first, /显示 1–6 \/ 9 家/);
  assert.match(second, /显示 7–9 \/ 9 家/);
  assert.match(first, /page=2#station-results/);
  assert.match(second, /page=1#station-results/);
  assert.match(first, /aria-label="第 1 页"/);
  const { directory: d } = directory("?date=2026-11-08&q=example&category=ok");
  // 为筛选后的分页构造更多同类记录，确认下一页不会丢失筛选。
  const rows = d.rows();
  const base = rows.find((row) => row.level === "ok" && d.day(row) === "2026-11-08");
  d.rows = () => rows.concat(Array.from({ length: 5 }, (_, i) => ({ ...base, domain: `extra-${i}.example`, stationName: `额外 ${i}` })));
  const filtered = d.stationsPage();
  assert.match(filtered, /category=ok&q=example&page=2/);
  assert.match(filtered, /显示 1–6 \/ 8 家/);
});

test("目录支持名称与域名搜索，空结果、历史日期和非法页码安全处理", () => {
  const found = directory("?date=2026-11-08&q=clearstream").directory.stationsPage();
  assert.equal((found.match(/class="panel relay-station-card"/g) || []).length, 1);
  assert.match(found, /清流 API/);
  const name = directory("?date=2026-11-08&q=" + encodeURIComponent("星港")).directory.stationsPage();
  assert.equal((name.match(/class="panel relay-station-card"/g) || []).length, 1);
  assert.match(name, /api\.starport\.example/);
  const empty = directory("?date=2026-11-08&q=" + encodeURIComponent('<img src=x>')).directory.stationsPage();
  assert.match(empty, /没有符合条件的中转站/);
  assert.match(empty, /&lt;img src=x&gt;/);
  assert.doesNotMatch(empty, /<img src=x>/);
  assert.match(directory("?date=2026-11-07").directory.stationsPage(), /已登记 3 家 · 当日 3 家有公开报告 \/ 3 份报告/);
  assert.match(directory("?date=2026-11-08&page=999").directory.stationsPage(), /显示 7–9 \/ 9 家/);
  assert.match(directory("?date=2026-11-08&page=-1").directory.stationsPage(), /显示 1–6 \/ 9 家/);
  assert.doesNotMatch(directory().directory.stationMark({ domain: "custom.example", name: '<script>' }), /<script>/);
});
test("后台空报告不回退演示，目录仍展示已登记的未测站点", () => {
  const data = { live: true, reports: [], stations: [{ id: "real-site", domain: "new.example", name: "新站", models: ["m"], description: "", logo: "/media/logo.webp" }] };
  const { directory: d } = directory("?q=new", data);
  assert.equal(d.rows().length, 0);
  const page = d.stationsPage();
  assert.match(page, /新站/);
  assert.match(page, /结论不足/);
  assert.doesNotMatch(page, /api\.clearstream\.example/);
  assert.match(page, /\/media\/logo.webp/);
  assert.match(d.stationPage([], "new.example", "2026-11-08"), /还没有公开报告/);
});

test("访问中转站链接与站内报告链接并存，空站点档案也可访问，清空后移除入口", () => {
  const site = {domain:"relay.example", name:"跳转站点", models:["m"], website_url:'https://console.example/register?a=1&b="quoted"'};
  const data = {live:true, stations:[site], reports:[{id:"r",domain:site.domain,stationName:site.name,time:"2026-11-09 10:00",model:"m",level:"ok",title:"已测"}]};
  const {directory:d} = directory("?date=2026-11-09",data);
  const card = d.stationCard(d.group(data.reports)[0],"2026-11-09");
  assert.match(card,/访问中转站/);
  assert.match(card,/target="_blank" rel="noopener noreferrer"/);
  assert.match(card,/a=1&amp;b=&quot;quoted&quot;/);
  assert.match(card,/查看该中转站的全部报告/);
  assert.match(d.stationPage(data.reports,site.domain,"2026-11-09"),/访问中转站/);
  assert.match(d.stationPage([],site.domain,"2026-11-09"),/访问中转站/);
  for (const value of ["", "javascript:alert(1)", "https://user:password@example.com/"]) {
    site.website_url=value;
    assert.equal(d.stationVisit(site),"");
    assert.doesNotMatch(d.stationCard(d.group(data.reports)[0],"2026-11-09"),/访问中转站/);
  }
});

test("已测能力但没有基线时保留分数，不伪装为未测或正常", () => {
  const { directory: d } = directory();
  const row = { id: "r", domain: "measured.example", time: "2026-11-08 10:00", level: "unknown", ability: { score: 80, baseline: null, questions: 5, level: "unknown" } };
  assert.match(d.abilityBadge(row), /能力 80 分 · 未设基线/);
  const group = d.group([row])[0];
  assert.equal(group.abilityCount, 1);
  assert.equal(group.degraded, false);
  assert.match(d.reportContext(row), /未设定/);
  assert.doesNotMatch(d.reportContext(row), /这份报告没有模型能力测试/);
});
