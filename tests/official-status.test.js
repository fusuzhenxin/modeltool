const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function statusView(ticker) {
  const sync = {};
  const pills = { innerHTML: "", closest: () => ticker ? {} : null };
  const context = vm.createContext({ document: {
    addEventListener() {},
    getElementById: (id) => ({ "official-sync": sync, "official-pills": pills })[id] || null,
    querySelectorAll: () => []
  } });
  for (const file of ["ui", "official"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", file + ".js"), "utf8"), context);
  const official = vm.runInContext("Official", context);
  return { official, sync, pills };
}

test("六家官方入口都有图标和可访问名称，未知可用率不伪装成零", () => {
  const { official, pills } = statusView(true);
  official.paint({ vendors: [{ id: "openai", name: "OpenAI", percent: 99.7, level: "ok", levelText: "正常" }] });
  assert.equal((pills.innerHTML.match(/class="official-brand /g) || []).length, 6);
  assert.equal((pills.innerHTML.match(/aria-label=/g) || []).length, 6);
  assert.match(pills.innerHTML, /99\.70%/);
  assert.match(pills.innerHTML, /aria-label="Gemini · 未获取"/);
  assert.doesNotMatch(pills.innerHTML, />0\.00%|NaN/);
});

test("顶部状态横条显示短时间，详情页保留完整同步时间", () => {
  for (const ticker of [true, false]) {
    const { official, sync } = statusView(ticker);
    official.paint({ fetchedAt: "2026-11-08T05:42:31Z" });
    assert.equal(sync.textContent, ticker ? "11-08 05:42 UTC" : "已同步官方状态 · 2026-11-08 05:42:31 UTC");
    assert.match(sync.title, /2026-11-08 05:42:31 UTC/);
  }
});

test("异常状态保留并转义源数据，非法可用率不显示", () => {
  const { official, pills } = statusView(true);
  official.paint({ vendors: [{ id: "anthropic", name: 'Claude "API"', percent: "invalid", level: "warn", levelText: "降级" }] });
  assert.match(pills.innerHTML, /official-pill warn/);
  assert.match(pills.innerHTML, /Claude &quot;API&quot; · 降级/);
  assert.match(pills.innerHTML, /href="status.html\?id=anthropic"/);
  assert.doesNotMatch(pills.innerHTML, /NaN|invalid/);
});
