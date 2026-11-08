const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.join(__dirname, "..");
const bank = JSON.parse(fs.readFileSync(path.join(root, "data/trace-bank.json"), "utf8"));

function client() {
  const storage = new Map();
  const requests = [];
  const context = vm.createContext({
    crypto: webcrypto, Uint32Array, URLSearchParams,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async (url) => {
      requests.push(url);
      assert.equal(url, "data/trace-bank.json", "手动分析不得请求模型转发接口");
      return { ok: true, json: async () => bank };
    },
    btoa: (text) => Buffer.from(text, "binary").toString("base64"),
    atob: (text) => Buffer.from(text, "base64").toString("binary"),
    escape, unescape,
    document: { getElementById: () => null },
    Store: { api: () => ({ baseUrl: "https://example.invalid/v1", apiKey: "test-only", modelOverride: "" }) },
    UI: { diffLabel: (value) => value, esc: (text) => String(text ?? "").replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[value])), icon: () => "" }
  });
  for (const file of ["data", "engine", "trace", "poster"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js/" + file + ".js"), "utf8"), context, { filename: file + ".js" });
  }
  return { ...vm.runInContext("({ Trace, Api, Poster })", context), requests, storage };
}

// 人工构造的数字仅用于验证流程，不作为模型实测或公开案例。
function answer(seed = 0) {
  return Array.from({ length: 330 }, (_, index) => ((index * 73 + seed * 41) % 355) + 1).join(", ");
}

test("空白、拒答和过短回答被拒绝，不请求 API、不保存结果", async () => {
  const { Trace, requests, storage } = client();
  Trace.manual().answers = ["", "我不能回答", "1,2,3"];
  await assert.rejects(Trace.analyzeManual(), /至少一道有效回答/);
  assert.equal(requests.length, 0);
  assert.equal(storage.size, 0);
});

test("手动三题复用原分析算法，只读取指纹库并保存摘要", async () => {
  const { Trace, requests, storage } = client();
  const draft = Trace.manual();
  draft.answers = [answer(1), answer(2), answer(3)];
  draft.claimed = bank.models[0].id;
  const expected = Trace.analyze(draft.challenges.map((item, index) => ({ expected_count: item.expected_count, text: draft.answers[index] })), bank);
  const result = await Trace.analyzeManual();
  assert.equal(result.prediction, expected.prediction);
  assert.equal(result.probability, expected.probability);
  assert.equal(result.used_outputs, 3);
  assert.equal(result.method, "manual");
  assert.equal(result.known, true);
  assert.equal(result.model_count, bank.models.length);
  assert.deepEqual(requests, ["data/trace-bank.json"]);
  const saved = [...storage.values()].join("");
  assert.ok(!saved.includes(draft.answers[0]), "原始回答不得写入会话存储");
  assert.ok(!saved.includes(draft.challenges[0].prompt), "题目不得写入结果摘要");
});

test("只计入有效回答，未知型号仍明确标记为库外", async () => {
  const { Trace } = client();
  Trace.manual().answers = [answer(), "拒答", ""];
  Trace.manual().claimed = "unlisted-model";
  const result = await Trace.analyzeManual();
  assert.equal(result.used_outputs, 1);
  assert.equal(result.known, false);
  assert.equal(result.diagnostics[1].accepted, false);
  assert.equal(result.diagnostics[2].accepted, false);
  const html = Trace.resultHtml(result);
  assert.match(html, /建议补足三题/);
  assert.match(html, /未核验其来源/);
});

test("手动来源标识穿过分享链接，旧版指纹链接仍可读取", async () => {
  const { Trace, Poster } = client();
  Trace.manual().answers[0] = answer();
  const payload = await Trace.analyzeManual();
  const report = Poster.fromTrace(payload);
  const token = Poster.pack(report);
  const shared = Poster.unpack(token);
  assert.equal(shared.method, "manual");
  assert.equal(shared.view.method, "manual");
  assert.equal(shared.view.shared, true);
  assert.equal(shared.modelCount, bank.models.length);
  assert.equal(shared.prediction, payload.prediction);
  assert.ok(!Poster.decode(token).join("|").includes(Trace.manual().answers[0]));
  const old = Poster.encode(Poster.decode(token).slice(0, 11));
  assert.equal(Poster.unpack(old).method, "api");
});

test("作品评分拆解保持原有分数，不把结构分称为降智结论", () => {
  const { Api } = client();
  assert.equal(Api.scoreArtwork(""), 0);
  assert.equal(Api.scoreArtwork("<svg><circle/><path/></svg>"), 65);
  assert.equal(Api.scoreArtwork("<svg><circle/><path/><animate/></svg>" + "x".repeat(801)), 90);
  assert.ok(!Api.artworkInfo(90).label.includes("降智"));
  for (const id of ["claude-opus-5", "gpt-5.6-sol", "glm-5.2"]) {
    const html = fs.readFileSync(path.join(root, "works/" + id + ".html"), "utf8");
    const checks = Api.artworkChecks(html);
    assert.equal(Api.scoreArtwork(html), checks.reduce((total, check) => total + (check.passed ? check.points : 0), 0));
  }
});

test("结果摘要中的用户文本经过转义，清理结果不清除题目", async () => {
  const { Trace, storage } = client();
  Trace.manual().answers[0] = answer();
  Trace.manual().claimed = '<img src=x onerror="alert(1)">';
  const payload = await Trace.analyzeManual();
  assert.ok(!Trace.resultHtml(payload).includes('<img src=x'));
  Trace.clearResult();
  assert.equal(storage.size, 0);
  assert.equal(Trace.manual().answers[0], answer());
});

test("自动模式仍收集三份有效回答，并正确标注来源", async () => {
  const { Trace, Api } = client();
  const calls = [];
  Api.complete = async (options) => { calls.push(options); return answer(calls.length); };
  const result = await Trace.run(bank.models[0].id);
  assert.equal(result.method, "api");
  assert.equal(result.used_outputs, 3);
  assert.equal(result.known, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((item) => item.bare && item.model === bank.models[0].id));
});

test("换题清空回答并保留所填模型，作品分享保持结构评分表述", () => {
  const { Trace, Poster } = client();
  Trace.manual().claimed = "gpt-6.1-sol";
  Trace.manual().answers[0] = answer();
  const original = Trace.manual().challenges[0].id;
  Trace.resetManual();
  assert.notEqual(Trace.manual().challenges[0].id, original);
  assert.equal(Trace.manual().claimed, "gpt-6.1-sol");
  assert.ok(Trace.manual().answers.every((value) => value === ""));
  const report = Poster.fromTask({ status: "done", kind: "pelican", pelicanMode: "svg", score: 75, modelId: "gpt-5.6-sol", items: [], difficulty: "medium" });
  const shared = Poster.unpack(Poster.pack(report));
  assert.equal(shared.title, "包含部分结构特征");
  assert.ok(!shared.title.includes("降智"));
});
