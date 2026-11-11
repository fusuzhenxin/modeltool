const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const turn = () => new Promise(setImmediate);

function client({ live = true, failLoad = false, failSave = false } = {}) {
  const box = { dataset: { artworkVotes: "report-1" }, innerHTML: "", appendChild(node) { this.retry = node; } };
  const calls = [];
  let state = { real: 2, fake: 1, choice: null };
  let fail = failSave;
  const ctx = vm.createContext({
    UI: { esc: (v) => String(v).replaceAll("<", "&lt;") }, PublicData: { live },
    document: { querySelectorAll: () => [box], createElement: () => ({}) },
    AbortController, setTimeout, clearTimeout, URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failLoad) throw new Error("offline");
      if (url.endsWith("proposal-session")) return { ok: true, json: async () => ({ csrf: "participation-token" }) };
      if (options.method === "PUT") {
        if (fail) { fail = false; return { ok: false, json: async () => ({ detail: "提交失败，请重试" }) }; }
        const choice = JSON.parse(options.body).choice;
        state = { real: 2 + (choice === "real" ? 1 : 0), fake: 1 + (choice === "fake" ? 1 : 0), choice };
        return { ok: true, json: async () => state };
      }
      return { ok: true, json: async () => ({ items: { "report-1": state } }) };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../js/artwork-votes.js"), "utf8"), ctx);
  const votes = vm.runInContext("ArtworkVotes", ctx);
  return { box, calls, votes, click: (choice) => box.onclick({ target: { closest: () => ({ dataset: { artworkChoice: choice } }) } }) };
}

test("加载真实票数，点击判真后改判假，再点击撤回，使用同站参与凭据", async () => {
  const c = client(); await c.votes.mount();
  assert.match(c.box.innerHTML, /判真<b>2<\/b>/);
  assert.match(c.box.innerHTML, /判假<b>1<\/b>/);
  await c.click("real");
  assert.match(c.box.innerHTML, /data-artwork-choice="real" aria-pressed="true"/);
  assert.match(c.box.innerHTML, /判真<b>3<\/b>/);
  await c.click("fake"); await c.click("fake");
  const writes = c.calls.filter((c) => c.options.method === "PUT");
  assert.deepEqual(writes.map((c) => JSON.parse(c.options.body).choice), ["real", "fake", null]);
  assert.equal(writes[0].options.headers["X-Proposal-CSRF"], "participation-token");
  assert.equal(writes[0].options.credentials, "same-origin");
  assert.match(c.box.innerHTML, /已撤回/);
});

test("提交失败保留原票数和选择，允许重试，不显示虚假成功", async () => {
  const c = client({ failSave: true }); await c.votes.mount(); await c.click("real");
  assert.match(c.box.innerHTML, /提交失败/);
  assert.match(c.box.innerHTML, /判真<b>2<\/b>/);
  assert.doesNotMatch(c.box.innerHTML, /aria-pressed="true"/);
  await c.click("real"); assert.match(c.box.innerHTML, /判真<b>3<\/b>/);
});

test("接口加载失败显示未知票数及重试，静态预览不提供无效投票", async () => {
  const failed = client({ failLoad: true }); await failed.votes.mount();
  assert.match(failed.box.innerHTML, /offline/);
  assert.match(failed.box.innerHTML, /<b>—<\/b>/);
  assert.equal(failed.box.retry.textContent, "重试");
  const staticPage = client({ live: false }); await staticPage.votes.mount();
  assert.equal(staticPage.calls.length, 0);
  assert.match(staticPage.box.innerHTML, /连接运营后台/);
});

test("保存期间忽略连续点击，不重复请求", async () => {
  const c = client(); await c.votes.mount();
  const first = c.click("real"), second = c.click("real");
  await Promise.all([first, second]); await turn();
  assert.equal(c.calls.filter((c) => c.options.method === "PUT").length, 1);
});


test("旧后台返回 404 时说明需要更新服务，不把缺失接口显示为零票", async () => {
  const ctx = vm.createContext({
    AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ status: 404, ok: false, json: async () => ({ detail: "Not Found" }) })
  });
  vm.runInContext(fs.readFileSync(require.resolve("../js/artwork-votes.js"), "utf8"), ctx);
  const votes = vm.runInContext("ArtworkVotes", ctx);
  await assert.rejects(votes.api("/api/public/artwork-votes?ids=test"), /投票接口尚未更新/);
});
