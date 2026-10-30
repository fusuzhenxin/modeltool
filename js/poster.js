/* 各项检测的分享链接和海报。链接里没有密钥，也没有题目和模型原文。
   鹈鹕骑车的作品 HTML 放在链接的 h 参数里；海报二维码放不下整页时只带分数。 */
const Poster = {
  titles: { ok: "未见掺水", warn: "疑似掺水", bad: "明显掺水" },
  summaries: {
    ok: "这次没有看到偷换模型或改写协议的证据。",
    warn: "协议大体能通，但有些参数没有按原样生效。",
    bad: "中转站没有把请求原样交给上游。"
  },
  hostOf(baseUrl) {
    const text = String(baseUrl || "").trim();
    if (!text) return "";
    try { return new URL(text).host; } catch (err) { return text.replace(/^[a-z]+:\/\//i, "").split("/")[0]; }
  },
  note(report, result) {
    const stats = report.stats;
    if (!stats) return;
    stats.requests += 1;
    const ms = Number(result && result.elapsedMs) || 0;
    stats.elapsedMs += ms;
    if (stats.firstMs == null) stats.firstMs = ms;
    const usage = result && result.json && result.json.usage;
    if (!usage) return;
    const input = usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens;
    const output = usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens;
    if (input != null) stats.inputTokens += Number(input) || 0;
    if (output != null) stats.outputTokens += Number(output) || 0;
  },
  statusCode(status) {
    return { pass: "p", fail: "f", skip: "s", miss: "m", run: "r", idle: "i" }[status] || "i";
  },
  statusFrom(code) {
    return { p: "pass", f: "fail", s: "skip", m: "miss", r: "idle", i: "idle" }[code] || "idle";
  },
  field(value) {
    return String(value == null ? "" : value).replace(/[|\r\n]/g, " ");
  },
  encode(fields) {
    return btoa(unescape(encodeURIComponent(fields.map((item) => Poster.field(item)).join("|")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  },
  decode(token) {
    const pad = token.replace(/-/g, "+").replace(/_/g, "/");
    const text = decodeURIComponent(escape(atob(pad + "===".slice((pad.length + 3) % 4))));
    return text.split("|");
  },
  num(value) {
    return value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
  },
  named(id) {
    if (!id) return "";
    if (typeof DATA !== "undefined" && DATA.model) return DATA.model(id).name || id;
    return id;
  },
  blankScore(value) {
    return value == null || Number.isNaN(Number(value)) ? "" : String(value);
  },
  scoreText(value) {
    return value == null || Number.isNaN(Number(value)) ? "—" : String(value);
  },
  htmlLimit: 180000,
  htmlToken(html) {
    const text = String(html || "");
    if (!text || text.length > Poster.htmlLimit) return "";
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  },
  htmlText(token) {
    if (!token) return "";
    try {
      const pad = String(token).replace(/-/g, "+").replace(/_/g, "/");
      const text = decodeURIComponent(escape(atob(pad + "===".slice((pad.length + 3) % 4))));
      if (!text || text.length > Poster.htmlLimit) return "";
      return text;
    } catch (err) {
      return "";
    }
  },
  pack(report) {
    if (report.kind === "detect") return Poster.packDetect(report);
    if (report.kind === "trace") return Poster.packTrace(report);
    if (report.kind === "task") return Poster.packTask(report);
    const stats = report.stats || {};
    const codes = (typeof Probe === "undefined" ? [] : Probe.checks).map((item) => Poster.statusCode((report.items[item.id] || {}).status)).join("");
    return Poster.encode([
      "1",
      Poster.blankScore(report.score),
      report.level || "ok",
      report.modelId || report.modelName || "",
      stats.host || "",
      report.time || "",
      stats.requests == null ? "" : String(stats.requests),
      stats.elapsedMs == null ? "" : String(stats.elapsedMs),
      stats.firstMs == null ? "" : String(stats.firstMs),
      stats.inputTokens == null ? "" : String(stats.inputTokens),
      stats.outputTokens == null ? "" : String(stats.outputTokens),
      codes
    ]);
  },
  packDetect(report) {
    const parts = report.parts || {};
    return Poster.encode([
      "2", Poster.blankScore(report.score), report.modelId || report.modelName || "", report.time || "",
      Poster.blankScore(parts.basic), Poster.blankScore(parts.candy), Poster.blankScore(parts.pelican),
      parts.basicTime || "", parts.candyTime || "", parts.pelicanTime || ""
    ]);
  },
  packTrace(report) {
    const top = (report.top || []).slice(0, 5).map((item) => {
      const name = Poster.field(item.name).replace(/[@,]/g, "·");
      const letter = String(item.family || "").indexOf("Claude") >= 0 ? "c" : "g";
      const prob = item.probability == null ? "" : String(Math.round(Number(item.probability) * 1000));
      return name + "@" + prob + "@" + letter;
    }).join(",");
    const digits = (report.digits || []).map((item) => (item.ok ? "" : "!") + (item.n == null ? "0" : String(item.n))).join(",");
    return Poster.encode([
      "3", report.claimed || "", report.known ? "1" : "0", report.prediction || "",
      report.probability == null ? "" : String(Math.round(Number(report.probability) * 1000)),
      report.familyName || "", report.familyProbability == null ? "" : String(Math.round(Number(report.familyProbability) * 1000)),
      report.used == null ? "" : String(report.used), report.time || "", top, digits
    ]);
  },
  packTask(report) {
    return Poster.encode([
      "4", report.test || "", Poster.blankScore(report.score), report.modelId || report.modelName || "", report.time || "",
      report.correct == null ? "" : String(report.correct), report.total == null ? "" : String(report.total),
      report.stability == null ? "" : String(report.stability), report.difficulty || "", Poster.field(report.name).slice(0, 40),
      report.mode || ""
    ]);
  },
  unpack(token) {
    if (!token) return null;
    try {
      const parts = Poster.decode(token);
      if (parts[0] === "2") return Poster.unpackDetect(parts);
      if (parts[0] === "3") return Poster.unpackTrace(parts);
      if (parts[0] === "4") return Poster.unpackTask(parts);
      return Poster.unpackRelay(parts);
    } catch (err) {
      return null;
    }
  },
  unpackRelay(parts) {
    if (parts[0] !== "1" || parts.length < 12) return null;
    const level = Poster.titles[parts[2]] ? parts[2] : "ok";
    const items = {};
    const codes = parts[11] || "";
    (typeof Probe === "undefined" ? [] : Probe.checks).forEach((item, index) => {
      items[item.id] = { status: Poster.statusFrom(codes[index] || "i"), detail: "" };
    });
    return {
      kind: "relay",
      shared: true,
      score: Poster.num(parts[1]),
      level,
      title: Poster.titles[level],
      summary: Poster.summaries[level],
      modelId: parts[3],
      modelName: Poster.named(parts[3]),
      time: parts[5],
      items,
      stats: {
        host: parts[4],
        requests: Poster.num(parts[6]),
        elapsedMs: Poster.num(parts[7]),
        firstMs: Poster.num(parts[8]),
        inputTokens: Poster.num(parts[9]),
        outputTokens: Poster.num(parts[10])
      }
    };
  },
  detectSnap(report) {
    const parts = report.parts || {};
    const timed = (score, time) => ({ score, time: score == null ? "" : (time || report.time || "") });
    return {
      score: report.score,
      time: report.time || "",
      modelName: report.modelName || "",
      hold: report.score == null ? "incomplete" : "",
      parts: {
        meta: { score: report.score, time: report.time || "" },
        basic: timed(parts.basic, parts.basicTime),
        candy: timed(parts.candy, parts.candyTime),
        pelican: timed(parts.pelican, parts.pelicanTime)
      }
    };
  },
  finishDetect(report) {
    const info = typeof Engine === "undefined" ? { level: "none", title: "检测结果", desc: "" } : Engine.judgeText(report.score, "detect");
    report.level = info.level;
    report.title = info.title;
    report.summary = info.desc;
    report.snap = Poster.detectSnap(report);
    return report;
  },
  unpackDetect(parts) {
    if (parts.length < 7) return null;
    const report = {
      kind: "detect",
      shared: true,
      score: Poster.num(parts[1]),
      modelId: parts[2] || "",
      modelName: Poster.named(parts[2]),
      time: parts[3] || "",
      parts: {
        basic: Poster.num(parts[4]),
        candy: Poster.num(parts[5]),
        pelican: Poster.num(parts[6]),
        basicTime: parts[7] || "",
        candyTime: parts[8] || "",
        pelicanTime: parts[9] || ""
      }
    };
    return Poster.finishDetect(report);
  },
  familyOf(letter, name) {
    if (letter === "c" || /^claude/i.test(String(name || ""))) return "Claude";
    return "GPT";
  },
  unpackTrace(parts) {
    if (parts.length < 10) return null;
    const claimed = parts[1] || "";
    const known = parts[2] === "1";
    const prediction = parts[3] || "";
    const probability = parts[4] === "" ? null : Number(parts[4]) / 1000;
    const same = known && claimed === prediction;
    const top = String(parts[9] || "").split(",").filter(Boolean).map((item) => {
      const bits = item.split("@");
      const letter = bits[2] || "";
      const probText = bits[1] || "";
      return {
        name: bits[0],
        probability: probText === "" ? null : Number(probText) / 1000,
        family: Poster.familyOf(letter, bits[0])
      };
    });
    const digits = String(parts[10] || "").split(",").filter(Boolean).map((item) => ({
      ok: item[0] !== "!",
      n: Number(item[0] === "!" ? item.slice(1) : item) || 0
    }));
    const report = {
      kind: "trace",
      shared: true,
      claimed,
      known,
      prediction,
      predictionName: Poster.named(prediction),
      probability,
      familyName: parts[5] || Poster.familyOf("", prediction),
      familyProbability: parts[6] === "" ? null : Number(parts[6]) / 1000,
      used: Poster.num(parts[7]),
      time: parts[8] || "",
      title: known ? (same ? "回答更像你请求的这个模型" : "回答更像指纹库里的另一个模型") : "所选模型不在指纹库里",
      level: known ? (same ? "ok" : "warn") : "none",
      top,
      digits
    };
    report.view = Poster.traceView(report);
    return report;
  },
  traceView(report) {
    return {
      shared: true,
      claimed: report.claimed,
      known: report.known,
      prediction: report.prediction,
      prediction_name: report.predictionName,
      probability: report.probability,
      family_prediction_name: report.familyName,
      family_probability: report.familyProbability,
      used_outputs: report.used,
      built_at: "",
      errors: [],
      diagnostics: (report.digits || []).map((item, index) => ({ index, parsed_numbers: item.n, accepted: item.ok })),
      results: (report.top || []).map((item) => ({
        display_name: item.name,
        family_name: item.family,
        probability: item.probability
      }))
    };
  },
  unpackTask(parts) {
    if (parts.length < 10) return null;
    const test = parts[1] || "ability";
    const score = Poster.num(parts[2]);
    const scene = test === "pelican" ? "pelican" : "detect";
    const info = typeof Engine === "undefined" ? { level: "none", title: "检测结果", label: "未检测", desc: "" } : Engine.judgeText(score, scene);
    const mode = parts[10] || "";
    let modeName = "";
    if (mode && typeof DATA !== "undefined" && DATA.pelicanModes) {
      const found = DATA.pelicanModes.find((item) => item.id === mode);
      modeName = found ? (found.short || found.name) : mode;
    }
    return {
      kind: "task",
      shared: true,
      test,
      score,
      level: info.level,
      title: test === "pelican" ? info.label : info.title,
      summary: info.desc,
      modelId: parts[3] || "",
      modelName: Poster.named(parts[3]),
      time: parts[4] || "",
      correct: Poster.num(parts[5]),
      total: Poster.num(parts[6]),
      stability: Poster.num(parts[7]),
      difficulty: parts[8] || "",
      name: parts[9] || "测试",
      mode,
      modeName
    };
  },
  fromDetect(snap) {
    if (!snap || !snap.parts) return null;
    const part = (key) => snap.parts[key] || {};
    const basic = part("basic").score;
    const candy = part("candy").score;
    const pelican = part("pelican").score;
    if (snap.score == null && basic == null && candy == null && pelican == null) return null;
    return Poster.finishDetect({
      kind: "detect",
      score: snap.score,
      modelId: "",
      modelName: snap.modelName || "",
      time: snap.time || "",
      parts: {
        basic, candy, pelican,
        basicTime: part("basic").time || "",
        candyTime: part("candy").time || "",
        pelicanTime: part("pelican").time || ""
      }
    });
  },
  fromTrace(payload) {
    if (!payload || !payload.prediction) return null;
    const known = payload.known === true;
    const same = known && payload.claimed === payload.prediction;
    const report = {
      kind: "trace",
      claimed: payload.claimed || "",
      known,
      prediction: payload.prediction || "",
      predictionName: payload.prediction_name || payload.prediction || "",
      probability: payload.probability,
      familyName: payload.family_prediction_name || "",
      familyProbability: payload.family_probability,
      used: payload.used_outputs,
      time: payload.at || "",
      title: known ? (same ? "回答更像你请求的这个模型" : "回答更像指纹库里的另一个模型") : "所选模型不在指纹库里",
      level: known ? (same ? "ok" : "warn") : "none",
      top: (payload.results || []).slice(0, 5).map((item) => ({
        name: item.display_name || item.model || "",
        probability: item.probability,
        family: item.family_name || ""
      })),
      digits: (payload.diagnostics || []).map((item) => ({ n: item.parsed_numbers, ok: !!item.accepted }))
    };
    report.view = Poster.traceView(report);
    report.view.shared = false;
    return report;
  },
  fromTask(task) {
    if (!task || task.status !== "done" || task.score == null || Number.isNaN(Number(task.score))) return null;
    const test = task.kind || "ability";
    const scene = test === "pelican" ? "pelican" : "detect";
    const info = Engine.judgeText(Number(task.score), scene);
    const items = task.items || [];
    const mode = task.pelicanMode || "";
    const found = mode && typeof DATA !== "undefined" ? DATA.pelicanModes.find((item) => item.id === mode) : null;
    const report = {
      kind: "task",
      test,
      score: Number(task.score),
      level: info.level,
      title: test === "pelican" ? info.label : info.title,
      summary: info.desc,
      modelId: task.requestedModel || task.modelId || "",
      modelName: task.modelName || "",
      time: task.finishedAt || task.createdAt || "",
      correct: items.length ? Engine.correctCount(items) : null,
      total: items.length || null,
      stability: test === "pelican" && task.stability != null ? task.stability : null,
      difficulty: typeof UI !== "undefined" ? UI.diffLabel(task.difficulty) : (task.difficulty || ""),
      name: task.name || ((DATA.kinds[test] || {}).label || "测试"),
      mode,
      modeName: found ? (found.short || found.name) : ""
    };
    if (test === "pelican" && typeof task.html === "string" && task.html) {
      if (task.html.length <= Poster.htmlLimit) report.html = task.html;
      else report.htmlOmitted = true;
    }
    return report;
  },
  fromLocation() {
    const hash = location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const report = Poster.unpack(params.get("r"));
    if (!report) return report;
    const html = Poster.htmlText(params.get("h"));
    if (html && report.kind === "task" && report.test === "pelican") report.html = html;
    return report;
  },
  buttons() {
    return `<div class="share-actions" id="share-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-action="share-poster"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15l2.5-2.5 2 2L16 11"/></svg>分享海报</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="share-link"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8"/><path d="M14 11a5 5 0 0 0-7.1-.1L5.5 12.3a5 5 0 0 0 7.1 7.1l.8-.8"/></svg>分享链接</button>
    </div>`;
  },
  ensureButtons() {
    if (document.getElementById("share-actions")) return;
    const head = document.querySelector("[data-share]") || document.querySelector(".relay-head");
    if (head) head.insertAdjacentHTML("beforeend", Poster.buttons());
  },
  current() {
    if (Poster.live) return Poster.live;
    const shared = Poster.fromLocation();
    if (shared && (!shared.kind || shared.kind === "relay")) return shared;
    const saved = typeof Store === "undefined" ? null : Store.basicReport();
    return saved && saved.score != null ? saved : null;
  },
  hashFor(report, withHtml) {
    let hash = "r=" + Poster.pack(report);
    if (withHtml && report.html) {
      const token = Poster.htmlToken(report.html);
      if (token) hash += "&h=" + token;
    }
    return hash;
  },
  link(report, withHtml) {
    const url = new URL(location.href);
    url.search = "";
    const page = { detect: "detect.html", trace: "trace.html", task: "result.html" }[report.kind] || "relay.html";
    url.pathname = url.pathname.replace(/[^/]*$/, page);
    url.hash = Poster.hashFor(report, withHtml);
    return url.toString();
  },
  qrTarget(report) {
    const score = Poster.link(report, false);
    if (!report.html) return { link: score, caption: "扫码看完整报告" };
    const full = Poster.link(report, true);
    if (full.length > 2400 || !QR.versionFor(QR.bytes(full).length)) return { link: score, caption: "扫码看分数" };
    return { link: full, caption: "扫码看完整报告" };
  },
  async copy(report) {
    const url = Poster.link(report, true);
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      const input = document.createElement("textarea");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    if (report.html) UI.toast("分享链接已复制，打开后可以直接看作品");
    else if (report.htmlOmitted) UI.toast("作品太大，分享链接里只保留了分数");
    else UI.toast("分享链接已复制");
  },
  seconds(ms) {
    if (ms == null || Number.isNaN(Number(ms))) return "—";
    return (Number(ms) / 1000).toFixed(1) + "s";
  },
  count(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return String(value);
  },
  tone(level) {
    if (level === "bad") return "#ef5d5d";
    if (level === "warn") return "#f07a3a";
    if (level === "none") return "#3b5ffa";
    return "#1faf73";
  },
  logo() {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = "assets/favicon-32.png";
    });
  },
  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },
  async draw(report) {
    if (report && report.kind === "trace") return Poster.drawTrace(report);
    if (report && (report.kind === "detect" || report.kind === "task")) return Poster.drawScore(report);
    return Poster.drawRelay(report);
  },
  async drawRelay(report) {
    const checks = typeof Probe === "undefined" ? [] : Probe.checks;
    const rows = Math.ceil(checks.length / 2);
    const width = 750;
    const height = 620 + rows * 56 + 210;
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const wash = ctx.createLinearGradient(0, 0, width, 280);
    wash.addColorStop(0, "#fff7f2");
    wash.addColorStop(1, "#ffffff");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, 280);

    const logo = await Poster.logo();
    if (logo) ctx.drawImage(logo, 36, 36, 36, 36);
    else {
      Poster.roundRect(ctx, 36, 36, 36, 36, 8);
      ctx.fillStyle = "#3b5ffa";
      ctx.fill();
    }
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 22px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("大模型降智检测", 82, 62);
    const pill = "中转站实测";
    ctx.font = "600 14px 'Microsoft YaHei', sans-serif";
    const pillWidth = ctx.measureText(pill).width + 28;
    Poster.roundRect(ctx, width - 36 - pillWidth, 40, pillWidth, 30, 15);
    ctx.fillStyle = "#fff1e8";
    ctx.fill();
    ctx.fillStyle = "#e07a2f";
    ctx.fillText(pill, width - 36 - pillWidth + 14, 61);

    const tone = Poster.tone(report.level);
    const cx = width / 2;
    const cy = 196;
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#f3e4dc";
    ctx.beginPath();
    ctx.arc(cx, cy, 62, 0, Math.PI * 2);
    ctx.stroke();
    const ratio = Math.max(0, Math.min(100, Number(report.score) || 0)) / 100;
    ctx.strokeStyle = tone;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 42px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(report.score), cx, 204);
    ctx.font = "600 14px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#98a2b3";
    ctx.fillText("/100", cx, 228);
    ctx.textAlign = "left";

    const title = report.title || Poster.titles[report.level] || "检测结果";
    ctx.font = "700 28px 'Microsoft YaHei', sans-serif";
    const titleWidth = ctx.measureText(title).width;
    const groupX = cx - (28 + titleWidth) / 2;
    ctx.save();
    ctx.translate(groupX + 12, 296);
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(12, -8);
    ctx.lineTo(12, 3);
    ctx.quadraticCurveTo(12, 13, 0, 17);
    ctx.quadraticCurveTo(-12, 13, -12, 3);
    ctx.lineTo(-12, -8);
    ctx.closePath();
    ctx.fillStyle = tone;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-5, 1);
    ctx.lineTo(-1, 5);
    ctx.lineTo(6, -4);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#1c2744";
    ctx.textAlign = "left";
    ctx.fillText(title, groupX + 32, 308);
    ctx.textAlign = "center";
    ctx.font = "700 18px 'Microsoft YaHei', sans-serif";
    ctx.fillText((report.stats && report.stats.host) || "未记录接口", cx, 348);
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#98a2b3";
    ctx.fillText("modeltool.cn", cx, 370);
    ctx.textAlign = "left";

    const stats = report.stats || {};
    const cards = [
      ["首个请求", Poster.seconds(stats.firstMs)],
      ["总耗时", Poster.seconds(stats.elapsedMs)],
      ["输入 tokens", Poster.count(stats.inputTokens)],
      ["输出 tokens", Poster.count(stats.outputTokens)]
    ];
    const gap = 12;
    const cardW = (width - 72 - gap * 3) / 4;
    cards.forEach((card, index) => {
      const x = 36 + index * (cardW + gap);
      Poster.roundRect(ctx, x, 400, cardW, 86, 14);
      ctx.fillStyle = "#f6f8fb";
      ctx.fill();
      ctx.fillStyle = "#98a2b3";
      ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(card[0], x + cardW / 2, 432);
      ctx.fillStyle = "#1c2744";
      ctx.font = "700 22px 'Microsoft YaHei', sans-serif";
      ctx.fillText(card[1], x + cardW / 2, 464);
    });
    ctx.textAlign = "left";

    checks.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 36 + col * 348;
      const y = 516 + row * 56;
      const status = ((report.items || {})[item.id] || {}).status;
      const pass = status === "pass";
      const fail = status === "fail";
      ctx.beginPath();
      ctx.arc(x + 14, y + 16, 11, 0, Math.PI * 2);
      ctx.fillStyle = pass ? "#e7f8f0" : fail ? "#fdecec" : "#f2f4f7";
      ctx.fill();
      ctx.strokeStyle = pass ? "#1faf73" : fail ? "#ef5d5d" : "#c5cedd";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (fail) {
        ctx.moveTo(x + 9, y + 11);
        ctx.lineTo(x + 19, y + 21);
        ctx.moveTo(x + 19, y + 11);
        ctx.lineTo(x + 9, y + 21);
      } else if (pass) {
        ctx.moveTo(x + 8, y + 16);
        ctx.lineTo(x + 12, y + 20);
        ctx.lineTo(x + 20, y + 11);
      } else {
        ctx.moveTo(x + 9, y + 16);
        ctx.lineTo(x + 19, y + 16);
      }
      ctx.stroke();
      ctx.fillStyle = "#24324d";
      ctx.font = "600 16px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.name, x + 34, y + 22);
      const label = pass ? "100" : fail ? "0" : "未测";
      ctx.fillStyle = pass ? "#f07a3a" : fail ? "#ef5d5d" : "#98a2b3";
      ctx.font = "700 18px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(label, x + 320, y + 22);
    });

    const foot = 516 + rows * 56 + 24;
    ctx.strokeStyle = "#eef2f6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, foot);
    ctx.lineTo(width - 36, foot);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#98a2b3";
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillText("检测模型", 36, foot + 36);
    ctx.fillText("检测时间", 36, foot + 78);
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 16px 'Microsoft YaHei', sans-serif";
    ctx.fillText(report.modelName || report.modelId || "—", 108, foot + 36);
    ctx.font = "600 15px 'Microsoft YaHei', sans-serif";
    ctx.fillText(report.time || "—", 108, foot + 78);
    ctx.fillStyle = "#8b97ad";
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillText("modeltool.cn  逐项实测可复现", 36, foot + 112);

    const link = Poster.link(report);
    let modules = null;
    try { modules = QR.matrix(link); } catch (err) { modules = null; }
    const qrSize = 150;
    const qx = width - 36 - qrSize;
    const qy = foot + 16;
    Poster.roundRect(ctx, qx - 8, qy - 8, qrSize + 16, qrSize + 16, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#eef2f6";
    ctx.stroke();
    if (modules) {
      const quiet = 4;
      const cell = qrSize / (modules.length + quiet * 2);
      ctx.fillStyle = "#1c2744";
      modules.forEach((line, row) => line.forEach((bit, col) => {
        if (!bit) return;
        ctx.fillRect(qx + (col + quiet) * cell, qy + (row + quiet) * cell, cell + 0.4, cell + 0.4);
      }));
    }
    ctx.fillStyle = "#98a2b3";
    ctx.font = "500 12px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("扫码看完整报告", qx + qrSize / 2, qy + qrSize + 28);
    ctx.textAlign = "left";
    return canvas;
  },
  async paintBrand(ctx, width, pill) {
    const logo = await Poster.logo();
    if (logo) ctx.drawImage(logo, 36, 36, 36, 36);
    else {
      Poster.roundRect(ctx, 36, 36, 36, 36, 8);
      ctx.fillStyle = "#3b5ffa";
      ctx.fill();
    }
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 22px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("大模型降智检测", 82, 62);
    ctx.font = "600 14px 'Microsoft YaHei', sans-serif";
    const pillWidth = ctx.measureText(pill).width + 28;
    Poster.roundRect(ctx, width - 36 - pillWidth, 40, pillWidth, 30, 15);
    ctx.fillStyle = "#fff1e8";
    ctx.fill();
    ctx.fillStyle = "#e07a3a";
    ctx.fillText(pill, width - 36 - pillWidth + 14, 61);
  },
  paintRing(ctx, cx, cy, text, sub, tone, ratio) {
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#f3e4dc";
    ctx.beginPath();
    ctx.arc(cx, cy, 62, 0, Math.PI * 2);
    ctx.stroke();
    if (ratio > 0) {
      ctx.strokeStyle = tone;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, ratio)));
      ctx.stroke();
    }
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 42px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(text), cx, sub ? 204 : 212);
    if (sub) {
      ctx.font = "600 14px 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = "#98a2b3";
      ctx.fillText(sub, cx, 228);
    }
  },
  paintHeading(ctx, cx, y, title, tone, mark) {
    ctx.font = "700 26px 'Microsoft YaHei', sans-serif";
    let size = 26;
    let titleWidth = ctx.measureText(title).width;
    if (titleWidth > 520) {
      size = 22;
      ctx.font = "700 22px 'Microsoft YaHei', sans-serif";
      titleWidth = ctx.measureText(title).width;
    }
    const groupX = cx - (28 + titleWidth) / 2;
    ctx.save();
    ctx.translate(groupX + 12, y - 12);
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(12, -8);
    ctx.lineTo(12, 3);
    ctx.quadraticCurveTo(12, 13, 0, 17);
    ctx.quadraticCurveTo(-12, 13, -12, 3);
    ctx.lineTo(-12, -8);
    ctx.closePath();
    ctx.fillStyle = tone;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (mark === "bad") {
      ctx.moveTo(-5, -4);
      ctx.lineTo(5, 6);
      ctx.moveTo(5, -4);
      ctx.lineTo(-5, 6);
    } else if (mark === "warn") {
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 3);
      ctx.moveTo(0, 7);
      ctx.lineTo(0.2, 7);
    } else {
      ctx.moveTo(-5, 1);
      ctx.lineTo(-1, 5);
      ctx.lineTo(6, -4);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#1c2744";
    ctx.textAlign = "left";
    ctx.font = "700 " + size + "px 'Microsoft YaHei', sans-serif";
    ctx.fillText(title, groupX + 32, y);
  },
  paintCards(ctx, width, y, cards) {
    const gap = 12;
    const cardW = (width - 72 - gap * (cards.length - 1)) / cards.length;
    cards.forEach((card, index) => {
      const x = 36 + index * (cardW + gap);
      Poster.roundRect(ctx, x, y, cardW, 86, 14);
      ctx.fillStyle = "#f6f8fb";
      ctx.fill();
      ctx.fillStyle = "#98a2b3";
      ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(card[0], x + cardW / 2, y + 32);
      ctx.fillStyle = "#1c2744";
      ctx.font = "700 22px 'Microsoft YaHei', sans-serif";
      if (ctx.measureText(card[1]).width > cardW - 16) ctx.font = "700 15px 'Microsoft YaHei', sans-serif";
      ctx.fillText(card[1], x + cardW / 2, y + 64);
    });
    ctx.textAlign = "left";
  },
  paintRows(ctx, rows, top) {
    rows.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 36 + col * 348;
      const y = top + row * 56;
      ctx.beginPath();
      ctx.arc(x + 14, y + 16, 11, 0, Math.PI * 2);
      ctx.fillStyle = item.tone === "bad" ? "#fdecec" : item.tone === "idle" ? "#f2f4f7" : "#e7f8f0";
      ctx.fill();
      ctx.fillStyle = "#24324d";
      ctx.font = "600 16px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.name, x + 34, y + 22);
      ctx.fillStyle = item.tone === "bad" ? "#ef5d5d" : item.tone === "idle" ? "#98a2b3" : "#f07a3a";
      ctx.font = "700 18px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(item.value, x + 320, y + 22);
    });
    ctx.textAlign = "left";
  },
  async paintFoot(ctx, width, foot, report) {
    ctx.strokeStyle = "#eef2f6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, foot);
    ctx.lineTo(width - 36, foot);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#98a2b3";
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillText("检测模型", 36, foot + 36);
    ctx.fillText("检测时间", 36, foot + 78);
    ctx.fillStyle = "#1c2744";
    ctx.font = "700 16px 'Microsoft YaHei', sans-serif";
    let model = report.modelName || report.modelId || report.claimed || "—";
    while (model.length > 1 && ctx.measureText(model).width > 300) model = model.slice(0, -2) + "…";
    ctx.fillText(model, 108, foot + 36);
    ctx.font = "600 15px 'Microsoft YaHei', sans-serif";
    ctx.fillText(report.time || "—", 108, foot + 78);
    ctx.fillStyle = "#8b97ad";
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillText("modeltool.cn  逐项实测可复现", 36, foot + 112);
    const qr = Poster.qrTarget(report);
    let modules = null;
    try { modules = QR.matrix(qr.link); } catch (err) { modules = null; }
    const qrSize = 150;
    const qx = width - 36 - qrSize;
    const qy = foot + 16;
    Poster.roundRect(ctx, qx - 8, qy - 8, qrSize + 16, qrSize + 16, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#eef2f6";
    ctx.stroke();
    if (modules) {
      const quiet = 4;
      const cell = qrSize / (modules.length + quiet * 2);
      ctx.fillStyle = "#1c2744";
      modules.forEach((line, row) => line.forEach((bit, col) => {
        if (!bit) return;
        ctx.fillRect(qx + (col + quiet) * cell, qy + (row + quiet) * cell, cell + 0.4, cell + 0.4);
      }));
    }
    ctx.fillStyle = "#98a2b3";
    ctx.font = "500 12px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(qr.caption, qx + qrSize / 2, qy + qrSize + 28);
    ctx.textAlign = "left";
  },
  async drawScore(report) {
    const width = 750;
    const height = 760;
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const wash = ctx.createLinearGradient(0, 0, width, 280);
    wash.addColorStop(0, "#fff7f2");
    wash.addColorStop(1, "#ffffff");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, 280);
    const pills = { ability: "能力测试", logic: "逻辑测试", code: "代码测试", qa: "问答测试", candy: "糖果测试", pelican: "鹈鹕骑车" };
    await Poster.paintBrand(ctx, width, report.kind === "detect" ? "模型检测" : (pills[report.test] || "测试结果"));
    const tone = Poster.tone(report.level);
    const cx = width / 2;
    const ratio = report.score == null ? 0 : Math.max(0, Math.min(100, Number(report.score))) / 100;
    Poster.paintRing(ctx, cx, 196, report.score == null ? "—" : String(report.score), "/100", tone, ratio);
    const mark = report.level === "bad" ? "bad" : report.level === "warn" || report.level === "none" ? "warn" : "ok";
    Poster.paintHeading(ctx, cx, 308, report.title || "检测结果", tone, mark);
    ctx.textAlign = "center";
    ctx.font = "700 18px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#1c2744";
    ctx.fillText(report.modelName || report.modelId || "未记录模型", cx, 348);
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#98a2b3";
    ctx.fillText("modeltool.cn", cx, 370);
    let cards;
    if (report.kind === "detect") {
      const label = typeof Engine === "undefined" ? "—" : Engine.judgeText(report.score, "detect").label;
      const parts = report.parts || {};
      cards = [
        ["基础测试", Poster.scoreText(parts.basic)],
        ["糖果测试", Poster.scoreText(parts.candy)],
        ["鹈鹕骑车", Poster.scoreText(parts.pelican)],
        ["判定", label || "—"]
      ];
    } else {
      const rate = report.correct == null || !report.total ? "—" : Math.round(100 * report.correct / report.total) + "%";
      let fourth = ["题量", report.total == null ? "—" : String(report.total)];
      if (report.test === "pelican" && report.modeName) fourth = ["作品", report.modeName];
      else if (report.stability != null) fourth = ["稳定性", String(report.stability)];
      cards = [
        ["答对", report.correct == null ? "—" : report.correct + "/" + (report.total || "—")],
        ["正确率", rate],
        ["难度", report.difficulty || "—"],
        fourth
      ];
    }
    Poster.paintCards(ctx, width, 400, cards);
    await Poster.paintFoot(ctx, width, 520, report);
    return canvas;
  },
  async drawTrace(report) {
    const count = (report.top || []).length;
    const rows = Math.ceil(count / 2);
    const width = 750;
    const foot = 516 + rows * 56 + (rows ? 24 : 0);
    const height = foot + 210;
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const wash = ctx.createLinearGradient(0, 0, width, 280);
    wash.addColorStop(0, "#f4f7ff");
    wash.addColorStop(1, "#ffffff");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, 280);
    await Poster.paintBrand(ctx, width, "指纹检测");
    const tone = Poster.tone(report.level);
    const cx = width / 2;
    const percent = report.probability == null ? null : report.probability * 100;
    Poster.paintRing(ctx, cx, 196, percent == null ? "—" : percent.toFixed(1), "库内概率", tone, percent == null ? 0 : percent / 100);
    Poster.paintHeading(ctx, cx, 308, report.title || "指纹检测", tone, report.level === "ok" ? "ok" : "warn");
    ctx.textAlign = "center";
    ctx.font = "700 18px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#1c2744";
    ctx.fillText(report.predictionName || report.prediction || "—", cx, 348);
    ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "#98a2b3";
    ctx.fillText("modeltool.cn", cx, 370);
    const familyPct = report.familyProbability == null ? "—" : (report.familyProbability * 100).toFixed(1) + "%";
    Poster.paintCards(ctx, width, 400, [
      ["请求模型", report.claimed || "—"],
      ["家族", report.familyName || "—"],
      ["有效回答", report.used == null ? "—" : report.used + "/3"],
      ["家族概率", familyPct]
    ]);
    Poster.paintRows(ctx, (report.top || []).map((item, index) => ({
      name: (index + 1) + "  " + item.name,
      value: item.probability == null ? "—" : (item.probability * 100).toFixed(1) + "%",
      tone: index === 0 ? "ok" : "idle"
    })), 516);
    await Poster.paintFoot(ctx, width, foot, report);
    return canvas;
  },
  fileName(report) {
    const named = { relay: "中转站检测海报", detect: "模型检测海报", trace: "指纹检测海报" }[report.kind];
    const base = named || ((report.name || "测试报告") + "海报");
    return base.replace(/[\\/:*?"<>|]/g, "") + ".png";
  },
  async open(report) {
    document.querySelectorAll(".poster-mask").forEach((node) => node.remove());
    const canvas = await Poster.draw(report);
    const mask = document.createElement("div");
    mask.className = "poster-mask";
    mask.innerHTML = `<div class="poster-dialog" role="dialog" aria-modal="true">
      <button type="button" class="poster-x" data-poster="close" aria-label="关闭">×</button>
      <img alt="检测分享海报">
      <div class="poster-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-poster="close">关闭</button>
        <button type="button" class="btn btn-primary btn-sm" data-poster="save">下载海报</button>
      </div>
    </div>`;
    const image = mask.querySelector("img");
    image.src = canvas.toDataURL("image/png");
    mask.addEventListener("click", (event) => {
      if (event.target === mask || event.target.closest("[data-poster='close']")) mask.remove();
      const save = event.target.closest("[data-poster='save']");
      if (!save) return;
      const link = document.createElement("a");
      link.href = image.src;
      link.download = Poster.fileName(report);
      link.click();
    });
    document.body.appendChild(mask);
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = Poster;
