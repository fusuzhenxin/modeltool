/* 组题，并按 OpenAI 兼容接口请求模型作答。 */
const Engine = {
  hash(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  },
  now(date) {
    const d = date || new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  parseTime(s) {
    return new Date(String(s).replace(" ", "T"));
  },
  judge(score) {
    if (score == null || Number.isNaN(score)) return "none";
    if (score >= 85) return "ok";
    if (score >= 70) return "warn";
    return "bad";
  },
  judgeText(score, scene) {
    const level = Engine.judge(score);
    const table = {
      ok: { detect: "正常", pelican: "未降智", title: "未发现降智问题", desc: "该模型在各项测试中的表现稳定，未检测到明显的降智现象。", side: "该模型在所有测试项目中表现良好，未检测到明显的降智现象。" },
      warn: { detect: "轻微异常", pelican: "轻微降智", title: "发现轻微降智迹象", desc: "部分测试得分偏低，模型在迷惑题或复杂约束上出现波动。", side: "综合结果存在轻微异常，建议换一个模型或提高难度后再测一次。" },
      bad: { detect: "明显异常", pelican: "明显降智", title: "发现明显降智问题", desc: "多项测试得分明显偏低，模型容易被题干里的干扰信息带走。", side: "综合评估未通过，建议更换模型后重新检测。" },
      none: { detect: "未检测", pelican: "未检测", title: "尚无足够结果", desc: "还没有可用的完成记录。", side: "完成各项测试后，可以在这里汇总。" }
    };
    const row = table[level];
    return { level, label: scene === "pelican" ? row.pelican : row.detect, title: row.title, desc: row.desc, side: row.side };
  },
  shuffle(q, salt) {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Engine.hash(salt + ":swap:" + i) * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return {
      qid: q.id,
      kind: q.kind,
      stem: q.stem,
      code: q.code || "",
      options: order.map((i) => q.options[i]),
      answer: order.indexOf(q.answer),
      explain: q.explain,
      dimension: q.dimension,
      difficulty: q.difficulty,
      trap: !!q.trap,
      round: 1
    };
  },
  materialize(q, repeat) {
    const copy = Object.assign({}, q);
    if (repeat > 0 && Array.isArray(q.rumors) && q.rumors.length) {
      const rumor = q.rumors[repeat % q.rumors.length];
      copy.stem = q.stem.replaceAll("{rumor}", rumor);
      copy.id = q.id + "#" + repeat;
    } else if (q.stem.includes("{rumor}")) {
      copy.stem = q.stem.replaceAll("{rumor}", (q.rumors && q.rumors[0]) || "520");
    }
    if (repeat > 0 && !Array.isArray(q.rumors)) {
      const extra = Engine.extra(q.kind, repeat * 17 + q.id.length);
      if (extra) return extra;
      copy.stem = q.stem + "（复核 " + (repeat + 1) + "）";
      copy.id = q.id + "#r" + repeat;
    }
    return copy;
  },
  extra(kind, n) {
    if (kind === "candy" || kind === "logic") {
      const heads = 24 + (n % 17);
      const rabbits = 4 + (n % 8);
      if (rabbits >= heads - 2) return null;
      const chickens = heads - rabbits;
      const feet = chickens * 2 + rabbits * 4;
      const wrongA = rabbits + 1;
      const wrongB = chickens;
      const wrongC = Math.max(1, rabbits - 1);
      const options = [String(rabbits) + " 只", wrongA + " 只", wrongB + " 只", wrongC + " 只"];
      if (new Set(options).size < 4) return null;
      return {
        id: "gen-cage-" + n,
        kind,
        difficulty: n % 2 ? "medium" : "hard",
        dimension: "quantity",
        stem: `鸡兔同笼：头共 ${heads} 个，脚共 ${feet} 只。兔有多少只？`,
        options,
        answer: 0,
        explain: `兔 ${rabbits} 只、鸡 ${chickens} 只时，脚数正好是 ${feet}。`
      };
    }
    if (kind === "code") {
      const a = 2 + (n % 7);
      const b = 3 + (n % 5);
      const c = 4 + (n % 4);
      const value = a + b * c;
      return {
        id: "gen-expr-" + n,
        kind,
        difficulty: "easy",
        dimension: "coderead",
        stem: "按 JavaScript 的运算优先级，表达式的结果是多少？",
        code: `${a} + ${b} * ${c}`,
        options: [String(value), String((a + b) * c), String(a * b + c), String(a + b + c)],
        answer: 0,
        explain: `乘法先做：${b} * ${c} = ${b * c}，再加上 ${a}，得到 ${value}。`
      };
    }
    if (kind === "qa" || kind === "ability") {
      const km = 2 + (n % 9);
      return {
        id: "gen-km-" + n,
        kind,
        difficulty: "easy",
        dimension: kind === "qa" ? "fact" : "follow",
        stem: `${km} 公里等于多少米？只按换算关系回答。`,
        options: [String(km * 1000) + " 米", String(km * 100) + " 米", String(km * 10) + " 米", String(km) + " 米"],
        answer: 0,
        explain: `1 公里 = 1000 米，所以 ${km} 公里 = ${km * 1000} 米。`
      };
    }
    return null;
  },
  pool(kind, difficulty) {
    const rank = { easy: 0, medium: 1, hard: 2 };
    const target = rank[difficulty] ?? 1;
    const all = DATA.bank.filter((q) => q.kind === kind);
    const pins = all.filter((q) => q.pin);
    const rest = all.filter((q) => !q.pin);
    rest.sort((a, b) => Math.abs(rank[a.difficulty] - target) - Math.abs(rank[b.difficulty] - target));
    return pins.concat(rest);
  },
  makeItems({ kind, difficulty, count, modelId, seed, live }) {
    const source = Engine.pool(kind, difficulty);
    const items = [];
    let guard = 0;
    while (items.length < count && guard < count * 8) {
      const repeat = Math.floor(guard / Math.max(source.length, 1));
      const base = source[guard % Math.max(source.length, 1)];
      guard += 1;
      if (!base) break;
      const raw = Engine.materialize(base, repeat);
      if (!raw || !raw.options || new Set(raw.options).size < raw.options.length) continue;
      const item = Engine.shuffle(raw, seed + ":" + items.length + ":" + raw.id);
      if (live) {
        item.choice = null;
        item.correct = null;
        item.reply = "";
      } else {
        Engine.answer(item, modelId, kind, difficulty, seed + ":" + item.qid + ":" + items.length);
      }
      items.push(item);
    }
    if (kind === "pelican") {
      items.forEach((item, i) => { item.round = Math.floor(i / 4) + 1; });
    }
    return items;
  },
  answer(item, modelId, kind, difficulty, key) {
    const model = DATA.model(modelId);
    let p = (model.acc && model.acc[kind]) || 0.75;
    if (difficulty === "easy") p += 0.08;
    if (difficulty === "hard") p -= 0.14;
    if (item.trap) p -= 0.06;
    p = Math.max(0.22, Math.min(0.97, p));
    const pass = Engine.hash(key) < p;
    if (pass) item.choice = item.answer;
    else {
      const wrong = item.options.map((_, i) => i).filter((i) => i !== item.answer);
      item.choice = wrong[Math.floor(Engine.hash(key + ":wrong") * wrong.length)] ?? item.answer;
    }
    item.correct = item.choice === item.answer;
  },
  retarget(items, want) {
    let got = items.filter((item) => item.correct).length;
    for (let i = items.length - 1; i >= 0 && got > want; i--) {
      if (!items[i].correct) continue;
      const wrong = items[i].options.map((_, idx) => idx).filter((idx) => idx !== items[i].answer);
      items[i].choice = wrong[0];
      items[i].correct = false;
      got -= 1;
    }
    for (let i = 0; i < items.length && got < want; i++) {
      if (items[i].correct) continue;
      items[i].choice = items[i].answer;
      items[i].correct = true;
      got += 1;
    }
  },
  correctCount(items) {
    return (items || []).filter((item) => item.correct).length;
  },
  roundStability(items) {
    const groups = new Map();
    items.forEach((item) => {
      const key = item.round || 1;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const accs = Array.from(groups.values()).map((list) => list.filter((item) => item.correct).length / list.length);
    if (!accs.length) return 0;
    if (accs.length === 1) return Math.round(accs[0] * 100);
    const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
    const mad = accs.reduce((a, b) => a + Math.abs(b - mean), 0) / accs.length;
    return Math.max(0, Math.min(100, Math.round(100 - mad * 100)));
  },
  scoreOf(task) {
    const items = task.items || [];
    if (!items.length) return null;
    const ratio = Engine.correctCount(items) / items.length;
    if (task.kind === "pelican") {
      const stability = task.stability == null ? Engine.roundStability(items) : task.stability;
      return Math.round(0.9 * ratio * 100 + 0.1 * stability);
    }
    return Math.round(ratio * 100);
  },
  moduleOf(kind) {
    if (["ability", "logic", "code", "qa"].includes(kind)) return "basic";
    return kind;
  }
};

const Api = {
  endpoint(baseUrl) {
    const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!raw) throw new Error("请填写接口地址");
    if (!/^https?:\/\//i.test(raw)) throw new Error("接口地址需要以 http:// 或 https:// 开头");
    let parsed;
    try { parsed = new URL(raw); } catch (err) { throw new Error("接口地址格式不对"); }
    if (/\/chat\/completions$/i.test(parsed.pathname) || /\/messages$/i.test(parsed.pathname)) return raw;
    if (/anthropic\.com$/i.test(parsed.hostname)) return raw.replace(/\/v1$/, "") + "/v1/messages";
    return raw + "/chat/completions";
  },
  isAnthropic(url) {
    return /anthropic\.com/i.test(url) || /\/v1\/messages$/i.test(url);
  },
  proxyUrl() {
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin + "/api/chat";
    return "http://127.0.0.1:8766/api/chat";
  },
  async complete({ baseUrl, apiKey, model, system, user }) {
    if (!String(apiKey || "").trim()) throw new Error("请填写密钥");
    if (!String(model || "").trim()) throw new Error("请选择模型，或填写模型 ID");
    const url = Api.endpoint(baseUrl);
    const anthropic = Api.isAnthropic(url);
    const limit = arguments[0].long ? 8192 : 256;
    const payload = anthropic
      ? { model: model.trim(), max_tokens: limit, temperature: arguments[0].long ? 0.4 : 0, system, messages: [{ role: "user", content: user }] }
      : { model: model.trim(), temperature: arguments[0].long ? 0.4 : 0, max_tokens: limit, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    let response;
    try {
      response = await fetch(Api.proxyUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, payload })
      });
    } catch (err) {
      throw new Error("连不上本机转发。请先双击项目里的 start.bat，再用 http://127.0.0.1:8766/index.html 打开，不要直接双击 html。");
    }
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || (data && data.message) || text.slice(0, 180) || ("HTTP " + response.status);
      if (String(message).indexOf("1010") >= 0) {
        throw new Error("接口被 Cloudflare 拦截（1010）。请关掉本机转发窗口后重新双击 start.bat，再测一次。地址建议写成 https://域名/v1 。");
      }
      throw new Error("接口返回 " + response.status + "：" + message);
    }
    const content = anthropic
      ? ((data && data.content) || []).map((part) => part.text || "").join("")
      : ((data && data.choices && data.choices[0] && ((data.choices[0].message && data.choices[0].message.content) || data.choices[0].text)) || "");
    if (!String(content).trim()) throw new Error("接口没有返回回答");
    return String(content).trim();
  },
  prompt(item) {
    const letters = "ABCD";
    const lines = item.options.map((opt, index) => letters[index] + ". " + opt).join("\n");
    const spec = item.kind === "pelican"
      ? "鹈鹕骑车资料卡（只根据下面的记载作答）：\n" + DATA.spec.map((row) => row[0] + "：" + row[1]).join("\n") + "\n\n"
      : "";
    const code = item.code ? "\n代码：\n" + item.code + "\n" : "\n";
    return spec + "题目：\n" + item.stem + code + "选项：\n" + lines + "\n\n只回复一个大写字母（A、B、C 或 D）。";
  },
  parseChoice(text, count) {
    const upper = String(text || "").toUpperCase();
    const tagged = upper.match(/(?:答案|选择|选项|ANSWER|CHOICE)\s*[:：]?\s*([A-D])/);
    const plain = upper.match(/\b([A-D])\b/);
    const letter = (tagged && tagged[1]) || (plain && plain[1]);
    if (!letter) return null;
    const index = letter.charCodeAt(0) - 65;
    return index < count ? index : null;
  },
  extractArtwork(text) {
    const raw = String(text || "").trim();
    const fenced = raw.match(/```(?:html|svg|xml)?\s*([\s\S]*?)```/i);
    const body = (fenced ? fenced[1] : raw).trim();
    const htmlDoc = body.match(/<!doctype html[\s\S]*<\/html>/i) || body.match(/<html[\s\S]*<\/html>/i);
    if (htmlDoc) return htmlDoc[0];
    const svg = body.match(/<svg\b[\s\S]*<\/svg>/i);
    if (!svg) return "";
    return "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>鹈鹕骑车</title><style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#f7f8fc}svg{max-width:100%;height:auto}</style></head><body>" + svg[0] + "</body></html>";
  },
  scoreArtwork(html) {
    const text = String(html || "");
    if (!text) return 0;
    let score = 20;
    if (/<svg\b/i.test(text)) score += 20;
    if (/<circle\b/i.test(text)) score += 15;
    if (/<(line|path|polyline|polygon)\b/i.test(text)) score += 10;
    if (text.length > 800) score += 10;
    if (/animate|requestAnimationFrame|@keyframes/i.test(text)) score += 15;
    if (/three/i.test(text) || /canvas/i.test(text)) score += 10;
    return Math.max(0, Math.min(100, score));
  },
  async ask(item, modelId) {
    const cfg = Store.api();
    const model = (cfg.modelOverride || modelId || "").trim();
    const content = await Api.complete({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model,
      system: "你在做单项选择题。只输出一个大写字母 A、B、C 或 D，不要输出解释。",
      user: Api.prompt(item)
    });
    return { content, choice: Api.parseChoice(content, item.options.length) };
  }
};
