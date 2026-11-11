/* Run the site's actual browser test functions. Python owns credentials and HTTP. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const readline = require("node:readline");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const messages = lines[Symbol.asyncIterator]();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
async function receive() {
  const row = await messages.next();
  if (row.done) throw new Error("检测进程通信已关闭");
  return JSON.parse(row.value);
}
async function main() {
  const init = await receive();
  let serial = 0;
  const raw = [];
  const rpc = async (mode, payload) => {
    const id = ++serial;
    send({ type: "request", id, mode, payload });
    const response = await receive();
    if (response.id !== id || response.type !== "response") throw new Error("检测进程通信不匹配");
    raw.push({ name: mode === "probe" ? "中转站请求 " + id : "模型请求 " + id, payload, response: response.result });
    return response.result;
  };
  const storage = new Map();
  const context = vm.createContext({
    crypto: webcrypto, Uint32Array, URL, URLSearchParams, btoa, atob, escape, unescape,
    location: { protocol: "http:", origin: "http://site-engine.invalid", search: "", hash: "" },
    document: { getElementById: () => null, querySelector: () => null },
    sessionStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    Store: { api: () => ({ baseUrl: init.endpoint, apiKey: "worker-credential-placeholder", modelOverride: init.model }), saveBasicReport: () => {} },
    fetch: async (url, options) => {
      if (url === "data/trace-bank.json") return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, url), "utf8")) };
      if (url !== "http://site-engine.invalid/api/chat") throw new Error("禁止检测脚本直接访问网络");
      const response = await rpc("chat", JSON.parse(options.body).payload);
      return { ok: response.status >= 200 && response.status < 300, status: response.status, headers: { get: (key) => response.headers?.[key.toLowerCase()] || null }, text: async () => response.text };
    }
  });
  for (const name of ["data", "engine", "ui", "poster", "probe", "trace"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", name + ".js"), "utf8"), context, { filename: name + ".js" });
  }
  const { DATA, Engine, Api, Probe, Trace, Poster } = vm.runInContext("({DATA,Engine,Api,Probe,Trace,Poster})", context);
  Probe.call = (payload) => rpc("probe", payload);
  Probe.paint = () => {};
  Poster.ensureButtons = () => {};
  const labels = {
    site_basic: "基础测试（四项能力）", site_ability: DATA.kinds.ability.label,
    site_logic: DATA.kinds.logic.label, site_code: DATA.kinds.code.label,
    site_qa: DATA.kinds.qa.label, site_candy: DATA.kinds.candy.label,
    site_relay: "中转站测试", site_trace: "模型指纹检测", site_pelican: "鹈鹕骑车测试",
    site_all: "全部测试"
  };
  const descriptions = {
    site_basic: "依次运行网站基础测试页的模型能力、逻辑推理、代码能力、知识问答四项。",
    site_ability: DATA.kinds.ability.desc, site_logic: DATA.kinds.logic.desc,
    site_code: DATA.kinds.code.desc, site_qa: DATA.kinds.qa.desc, site_candy: DATA.kinds.candy.desc,
    site_relay: "网站中转站测试原版：协议、响应结构、模型回显、协议指纹、流式、输出控制、上下文、系统指令、工具、多模态、推理参数、用量、提示词缓存、缓存与重放，共 14 项。",
    site_trace: "网站模型指纹检测原版：数字序列挑战、相同数字解析器和指纹库。收集 3 份有效回答，最多请求 6 次。",
    site_pelican: DATA.kinds.pelican.desc,
    site_all: "依次运行四项基础能力、糖果、中转站、指纹、鹈鹕骑车；每个项目保留独立结果。"
  };
  const kindsOf = (kind) => kind === "site_all" ? ["ability", "logic", "code", "qa", "candy", "relay", "trace", "pelican"] : kind === "site_basic" ? ["ability", "logic", "code", "qa"] : [kind.replace(/^site_/, "")];
  function plan(config) {
    return kindsOf(config.kind).map((kind) => ({ kind, count: ["ability", "logic", "code", "qa", "candy"].includes(kind) ? Engine.pool(kind, config.difficulty || "medium").length : null }));
  }
  if (init.action === "catalog") {
    send({ type: "result", result: Object.entries(labels).map(([id, label]) => ({
      id, label, description: descriptions[id], questions: kindsOf(id).some((kind) => ["ability", "logic", "code", "qa", "candy"].includes(kind)),
      candy_count: id === "site_all", artwork: ["site_pelican", "site_all"].includes(id),
      pools: Object.fromEntries(["easy", "medium", "hard"].map((difficulty) => [difficulty, plan({kind: id, difficulty})]))
    })) });
    return;
  }
  const config = init.config;
  if (!labels[config.kind]) throw new Error("请选择网站现有的检测项目");
  const sections = [];
  for (const kind of kindsOf(config.kind)) {
    if (["ability", "logic", "code", "qa", "candy"].includes(kind)) {
      const requested = kind === "candy" && config.kind === "site_all" ? config.candy_count : config.count;
      const items = Engine.makeItems({kind, difficulty: config.difficulty, count: requested, modelId: init.model, seed: init.seed + ":" + kind, live: true});
      if (!items.length) throw new Error(DATA.kinds[kind].label + "在此难度下没有题目，请更换难度");
      for (const item of items) {
        const result = await Api.ask(item, init.model);
        item.reply = result.content; item.choice = result.choice; item.correct = result.choice === item.answer;
      }
      const score = Engine.scoreOf({kind, items});
      sections.push({kind, name: DATA.kinds[kind].label, score, requested_count: requested, count: items.length, difficulty: config.difficulty, judgement: Engine.judgeText(score, "detect"), items});
    } else if (kind === "relay") {
      const report = await Probe.run(init.model);
      sections.push({kind, name: labels.site_relay, ...report, checks: Probe.checks.map((c) => ({...c, ...report.items[c.id]}))});
    } else if (kind === "trace") {
      const result = await Trace.run(init.model);
      sections.push({kind, name: labels.site_trace, ...result});
    } else if (kind === "pelican") {
      const mode = DATA.pelicanModes.find((m) => m.id === config.pelican_mode);
      const content = await Api.complete({baseUrl: init.endpoint, apiKey: "worker-credential-placeholder", model: init.model, system: mode.system, user: mode.prompt, long: true});
      const html = Api.extractArtwork(content);
      sections.push({kind, name: labels.site_pelican, mode: mode.id, mode_name: mode.name, score: Api.scoreArtwork(html), checks: Api.artworkChecks(html), html, available: Boolean(html)});
    }
  }
  const abilitySections = sections.filter((s) => ["ability", "logic", "code", "qa"].includes(s.kind));
  const scored = abilitySections.length ? abilitySections : sections.filter((s) => s.kind === "candy");
  const abilityScore = scored.length ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length) : null;
  send({ type: "result", result: { name: labels[config.kind], sections, raw, calls: serial,
    ability: abilityScore == null ? null : {score: abilityScore, questions: scored.reduce((sum, s) => sum + s.count, 0), judgement: Engine.judgeText(abilityScore, "detect")}
  } });
}
main().catch(() => { send({type:"error", message:"本站检测执行失败，请检查题目范围、接口响应或指纹有效回答数量；原始明细未公开。"}); process.exitCode=1; }).finally(() => lines.close());
