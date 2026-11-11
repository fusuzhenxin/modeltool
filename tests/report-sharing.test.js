const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

function client() {
  const texts = [], copied = [], qrLinks = [];
  const context2d = new Proxy({
    fillText: (text) => texts.push(String(text)),
    measureText: (text) => ({ width: String(text).length * 7 })
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  const canvas = { getContext: () => context2d };
  const page = vm.createContext({
    URL, URLSearchParams, Date,
    location: { href: "http://127.0.0.1:8767/relays.html?id=old&secret=do-not-share#old", hostname: "127.0.0.1" },
    document: { createElement: (tag) => { assert.equal(tag, "canvas"); return canvas; } },
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    QR: { matrix: (link) => { qrLinks.push(link); return [[true, false], [false, true]]; } }
  });
  for (const file of ["data", "ui", "relay-public", "relay-directory", "site-report", "poster"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", file + ".js"), "utf8"), page);
  }
  vm.runInContext("UI.shell = (_, body) => body; UI.toast = () => {}; Poster.logo = async () => null;", page);
  const source = fs.readFileSync(path.join(root, "js/pages.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("function relayLevel("), source.indexOf("const Pages =")), page);
  return { page, poster: vm.runInContext("Poster", page), texts, copied, qrLinks, canvas };
}

function sample(extra = {}) {
  return {
    id: "report-1", stationName: "测试站", domain: "relay.example", model: "test-model",
    time: "2026-11-10 12:00", test_name: "组合测试", score: null, title: "测试完成",
    sections: [{ kind: "basic", name: "基础能力", score: 85 }, { kind: "trace", name: "模型指纹", prediction_name: "候选模型", probability: 0.75, used_outputs: 3, known: false, results: [] }],
    artwork: { available: true, score: 90, mode_name: "2D 动画 HTML", checks: [] },
    ...extra
  };
}

test("公开报告分享地址保留本地来源，只含报告 ID，不携带旧参数或摘要正文", async () => {
  const { poster, copied } = client();
  const report = poster.fromPublic(sample({ id: "a/b?x#中文" }));
  const link = new URL(poster.link(report, true));
  assert.equal(link.origin, "http://127.0.0.1:8767");
  assert.equal(link.pathname, "/relays.html");
  assert.equal(link.searchParams.get("id"), "a/b?x#中文");
  assert.equal(link.searchParams.size, 1);
  assert.equal(link.hash, "");
  assert.equal(poster.qrTarget(report).link, link.href);
  await poster.copy(report);
  assert.equal(copied[0], link.href);
});

test("分享数据只提取展示字段，不保留密钥、内部备注、原始回答或作品源码", () => {
  const { poster } = client();
  const report = poster.fromPublic(sample({
    apiKey: "private-key", note: "internal-note", raw: ["raw-answer"],
    artwork: { score: 90, mode_name: "SVG", html: "private-html" },
    sections: [{ kind: "basic", name: "基础能力", score: 0, raw: "private-raw", items: [{ reply: "private-reply" }] }]
  }));
  assert.doesNotMatch(JSON.stringify(report), /private-|internal-note|raw-answer/);
  assert.equal(report.sections[0].score, 0);
  assert.equal(report.score, null);
});

test("海报实际调用 Canvas 绘制独立项目、作品结构分和报告二维码，不把未测协议记为零分", async () => {
  const { poster, texts, qrLinks, canvas } = client();
  const result = await poster.draw(poster.fromPublic(sample()));
  assert.equal(result, canvas);
  assert.equal(canvas.width, 1520);
  const content = texts.join("\n");
  assert.match(content, /基础能力：85 \/ 100/);
  assert.match(content, /模型指纹：候选：候选模型/);
  assert.match(content, /作品结构分 · 2D 动画 HTML：90 \/ 100/);
  assert.doesNotMatch(content, /协议检查分：0/);
  assert.match(content, /test-model/);
  assert.deepEqual(qrLinks, ["http://127.0.0.1:8767/relays.html?id=report-1"]);
});

test("空项目和演示海报保留未评分及演示标识", async () => {
  const { poster, texts } = client();
  await poster.draw(poster.fromPublic(sample({ sections: [], artwork: null, demo: true })));
  assert.match(texts.join("\n"), /本次未评分/);
  assert.match(texts.join("\n"), /演示数据，不代表实际服务/);
});

test("公开报告接入分享按钮和隔离预览新标签页链接，缺少作品则不展示入口", () => {
  const { page, poster } = client();
  const html = page.relayPublicDetail(sample());
  assert.match(html, /data-action="share-poster"/);
  assert.match(html, /data-action="share-link"/);
  assert.match(html, /href="\/api\/public\/reports\/report-1\/artwork" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /当前为本地预览/);
  assert.equal(poster.current().id, "report-1");
  const missing = page.relayPublicDetail(sample({ artwork: { available: false, checks: [] } }));
  assert.doesNotMatch(missing, /新标签页打开作品/);
});

test("页面正确加载分享依赖；后台分享遵循已公开状态且作品预览使用后台权限接口", () => {
  const html = fs.readFileSync(path.join(root, "relays.html"), "utf8");
  assert.ok(html.indexOf('src="js/qr.js"') < html.indexOf('src="js/poster.js'));
  assert.ok(html.indexOf('src="js/poster.js') < html.indexOf('src="js/pages.js'));
  const admin = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
  assert.match(admin, /const shareEntry = r.status === "published"/);
  assert.match(admin, /href="\/api\/admin\/reports\/\$\{encodeURIComponent\(id\)\}\/artwork" target="_blank" rel="noopener noreferrer"/);
});
