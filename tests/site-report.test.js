const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/site-report.js"), "utf8"), ctx);
const renderer = vm.runInContext("SiteReport", ctx);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));

test("原版试题明细展示打乱后的选项和正确答案，并转义题干与代码", () => {
  const html = renderer.render([{kind:"code", name:"代码能力测试", score:0, count:1, difficulty:"hard", judgement:{title:"发现明显降智问题"}, items:[{stem:"<img src=x onerror=alert(1)>", code:"<script>code</script>", options:["<b>A</b>","B","C","D"], choice:null, answer:1, correct:false, explain:"比较 < 运算"}]}], esc);
  assert.match(html, /0 \/ 1 题正确 · 困难/);
  assert.match(html, /模型作答：未识别 · 正确答案：B · 错误/);
  assert.match(html, /&lt;script&gt;code&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;A&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<img|<script>/);
});

test("指纹仅展示候选、有效份数和库外提示，不把作品或候选概率算作能力得分", () => {
  const html = renderer.render([{kind:"trace", name:"模型指纹检测", prediction_name:"<model>", probability:.75, used_outputs:2, known:false, built_at:"2026-11-09", model_count:20, results:[{display_name:"<candidate>", probability:.75, profile_similarity:.8}]}, {kind:"pelican", name:"作品", score:100, html:"<script>alert(1)</script>"}], esc);
  assert.match(html, /最接近：<strong>&lt;model&gt;<\/strong> · 75.00%/);
  assert.match(html, /宣称模型不在指纹库内/);
  assert.match(html, /有效回答不足 3 份/);
  assert.match(html, /&lt;candidate&gt;/);
  assert.doesNotMatch(html, /100|<script>|能力表现正常/);
});

function publicReport(item) {
  const page = vm.createContext({ URL, URLSearchParams, Date });
  for (const file of ["data", "ui", "relay-public", "relay-directory", "site-report"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + file + ".js"), "utf8"), page);
  }
  vm.runInContext("UI.shell = (_, body) => body", page);
  const source = fs.readFileSync(path.join(__dirname, "../js/pages.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("function relayLevel("), source.indexOf("const Pages =")), page);
  return page.relayPublicDetail(item);
}

test("公开报告集中展示结论、统计与参数，保留全部检查证据并转义文本", () => {
  const html = publicReport({ id: "qa", domain: "relay.example", stationName: "测试站", model: "gpt-4.1", time: "2026-11-09 15:45", level: "ok", score: 100, runs: 2, title: "未见掺水", conditions: "temperature=0 <script>unsafe</script>", summary: "完整的检测摘要", findings: ["输出控制需要核对"], checks: [{ name: "响应结构", status: "pass", detail: "证据A" }, { name: "输出控制", status: "fail", detail: "证据B <img src=x>" }, { name: "缓存", status: "skip", detail: "没有命中" }], sections: [] });
  assert.match(html, /report-overview report-tone-ok/);
  assert.match(html, /report-score/);
  assert.match(html, /检查项目<\/span><strong>3/);
  assert.match(html, /通过项目<\/span><strong>1/);
  assert.match(html, /异常或需核对<\/span><strong>1/);
  assert.match(html, /检测次数<\/span><strong>2/);
  assert.match(html, /<dl class="report-info-grid">/);
  assert.match(html, /2026-11-09 15:45/);
  assert.match(html, /完整的检测摘要/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /证据B &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x>/);
  assert.match(html, /report-method/);
  assert.match(html, /没有命中/);
  assert.match(html, /该站当天报告/);
  assert.match(html, /全部中转日报/);
});

test("未测协议的作品报告不展示虚构分数，保留作品预览与原有说明", () => {
  const html = publicReport({ id: "art", domain: "relay.example", model: "test", time: "2026-11-09 12:00", title: "作品测试已完成", protocol_tested: false, score: null, checks: [], sections: [], artwork: { mode_name: "SVG", score: 80, available: true, checks: [] } });
  assert.match(html, /本次未进行协议评分/);
  assert.match(html, /本次未选择中转站测试/);
  assert.match(html, /代码结构分 80 \/ 100/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /src="\/api\/public\/reports\/art\/artwork"/);
  assert.doesNotMatch(html, /report-score[^]*?<strong>100/);
});
