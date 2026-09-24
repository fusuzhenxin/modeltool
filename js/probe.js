/* 基础测试：对已配置接口做协议与能力探测，不使用本地模拟分数。 */
const Probe = {
  checks: [
    { id: "protocol", name: "协议识别" },
    { id: "shape", name: "响应结构" },
    { id: "echo", name: "模型回显" },
    { id: "fingerprint", name: "协议指纹" },
    { id: "stream", name: "流式响应" },
    { id: "limit", name: "输出控制" },
    { id: "memory", name: "上下文记忆" },
    { id: "system", name: "系统指令" },
    { id: "tools", name: "工具调用" },
    { id: "vision", name: "多模态" },
    { id: "reasoning", name: "推理参数" },
    { id: "usage", name: "用量审计" },
    { id: "cache", name: "提示词缓存" },
    { id: "replay", name: "缓存与重放" }
  ],
  textOf(json) {
    if (!json || typeof json !== "object") return "";
    const choice = json.choices && json.choices[0];
    if (choice) {
      const message = choice.message || {};
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content)) return message.content.map((part) => part.text || part.content || "").join("");
    }
    if (Array.isArray(json.content)) return json.content.map((part) => part.text || "").join("");
    return "";
  },
  proxyUrl() {
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin + "/api/probe";
    return "http://127.0.0.1:8766/api/probe";
  },
  async call(payload) {
    const cfg = Store.api();
    let response;
    try {
      response = await fetch(Probe.proxyUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, payload })
      });
    } catch (err) {
      return { error: UI.offlineForward(), status: 0, json: null, text: "", headers: {}, elapsedMs: 0 };
    }
    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }
    if (!data) {
      const stopped = UI.platformStop(response.status, "");
      if (stopped) return { error: stopped, status: response.status, json: null, text: "", headers: {}, elapsedMs: 0 };
      return { error: "转发没有返回结果", status: response.status, json: null, text: "", headers: {}, elapsedMs: 0 };
    }
    return data;
  },
  unsupported(result) {
    const text = ((result && result.text) || "") + JSON.stringify((result && result.json) || {});
    return result && result.status >= 400 && /not support|unsupported|unknown|unrecognized|invalid|unexpected|extra|vision|image|tool|reasoning/i.test(text);
  },
  rows(report) {
    const saved = (report && report.items) || {};
    return Probe.checks.map((item, index) => {
      const row = saved[item.id] || { status: "idle", detail: "" };
      return Probe.rowHtml(item, index, row.status, row.detail);
    }).join("");
  },
  rowHtml(item, index, status, detail) {
    const label = { idle: "未测", run: "测试中", pass: "通过", fail: "失败", skip: "不支持", miss: "未命中" }[status] || "未测";
    return `<tr id="probe-${item.id}">
      <td class="probe-no">${String(index + 1).padStart(2, "0")}</td>
      <td><div class="probe-name">${item.name}</div>${detail ? `<div class="probe-detail">${UI.esc(detail)}</div>` : ""}</td>
      <td class="probe-status ${status}">${label}</td>
    </tr>`;
  },
  paint(id, status, detail) {
    const item = Probe.checks.find((row) => row.id === id);
    const index = Probe.checks.indexOf(item);
    const node = document.getElementById("probe-" + id);
    if (node && item) node.outerHTML = Probe.rowHtml(item, index, status, detail);
  },
  async run(modelId) {
    const cfg = Store.api();
    const model = (cfg.modelOverride || modelId).trim();
    const report = { modelId: model, modelName: DATA.model(modelId).name, time: Engine.now(), items: {} };
    const put = (id, status, detail) => {
      report.items[id] = { status, detail };
      Probe.paint(id, status, detail);
      Store.saveBasicReport(report);
    };
    Probe.checks.forEach((item) => put(item.id, "run", ""));

    const hello = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [{ role: "user", content: "只回复 OK" }]
    });
    const helloText = Probe.textOf(hello.json);
    const openai = !!(hello.json && hello.json.choices);
    const anthropic = !!(hello.json && Array.isArray(hello.json.content) && hello.json.type === "message");

    if (hello.error || !hello.status || hello.status >= 400) {
      const detail = hello.error || ("HTTP " + hello.status + "：" + String(hello.text || "").slice(0, 120));
      Probe.checks.forEach((item) => put(item.id, "fail", detail));
      const verdict = Probe.evaluate(report);
      report.score = verdict.score;
      report.level = verdict.level;
      report.title = verdict.title;
      report.summary = verdict.summary;
      report.findings = verdict.findings;
      Store.saveBasicReport(report);
      const box = document.getElementById("relay-report");
      if (box) {
        box.innerHTML = Probe.reportHtml(report);
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return report;
    }
    put("protocol", (openai || anthropic) && hello.status < 400 ? "pass" : "fail", openai ? "OpenAI Chat Completions" : anthropic ? "Anthropic Messages" : "HTTP " + hello.status + "，无法识别为对话协议");

    const shaped = openai
      ? !!(hello.json.choices[0] && hello.json.choices[0].message)
      : anthropic;
    put("shape", shaped ? "pass" : "fail", shaped ? (openai ? "choices[0].message 存在" : "content 数组存在") : "缺少标准消息字段");

    const echoed = hello.json && (hello.json.model || (hello.json.choices && hello.json.choices[0] && hello.json.choices[0].model));
    const echoedText = String(echoed || "");
    put("echo", echoedText ? (echoedText === model || echoedText.indexOf(model) >= 0 ? "pass" : "fail") : "fail", echoedText ? "请求 " + model + "，返回 " + echoedText : "响应里没有 model 字段");

    const fingerprint = [];
    if (hello.json && hello.json.object) fingerprint.push("object=" + hello.json.object);
    if (hello.json && hello.json.id) fingerprint.push("id=" + String(hello.json.id).slice(0, 24));
    if (hello.json && hello.json.system_fingerprint) fingerprint.push("system_fingerprint");
    const headerKeys = Object.keys(hello.headers || {});
    ["x-request-id", "openai-version", "anthropic-request-id", "cf-ray"].forEach((key) => {
      if (headerKeys.some((name) => name.toLowerCase() === key)) fingerprint.push(key);
    });
    put("fingerprint", fingerprint.length ? "pass" : "fail", fingerprint.join("，") || "没有发现协议指纹");

    put("usage", "run", "");
    const usage = hello.json && hello.json.usage;
    const promptTokens = usage && (usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
    const completionTokens = usage && (usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
    put("usage", promptTokens != null && completionTokens != null ? "pass" : "fail", usage ? "输入 " + promptTokens + "，输出 " + completionTokens : "响应没有 usage");

    const stream = await Probe.call({ model, temperature: 0, max_tokens: 16, stream: true, messages: [{ role: "user", content: "只回复 OK" }] });
    const streamOk = stream.status < 400 && /data:\s*\{/.test(stream.text || "") && (/\[DONE\]/.test(stream.text || "") || /delta|content_block_delta/.test(stream.text || ""));
    put("stream", stream.error ? "fail" : streamOk ? "pass" : (Probe.unsupported(stream) ? "skip" : "fail"), streamOk ? "收到 SSE 分片" : (stream.error || "没有解析到流式分片"));

    const limited = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 1,
      messages: [{ role: "user", content: "请用很长一段话介绍鹈鹕，至少写三百字。" }]
    });
    const limitedText = Probe.textOf(limited.json);
    const finish = limited.json && limited.json.choices && limited.json.choices[0] && limited.json.choices[0].finish_reason;
    const limitedOk = limited.status < 400 && (finish === "length" || limitedText.length <= 24);
    put("limit", limited.error ? "fail" : limitedOk ? "pass" : (Probe.unsupported(limited) ? "skip" : "fail"), limitedOk ? "max_tokens=1 已截断" + (finish ? "，finish_reason=" + finish : "") : (limited.error || "输出没有被 max_tokens 限制住"));

    const memory = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: "user", content: "请记住暗号是青鸟。只回复已记住。" },
        { role: "assistant", content: "已记住" },
        { role: "user", content: "暗号是什么？只输出那两个字。" }
      ]
    });
    const memoryText = Probe.textOf(memory.json);
    put("memory", memory.status < 400 && memoryText.indexOf("青鸟") >= 0 ? "pass" : "fail", memoryText ? "模型回复：" + memoryText.slice(0, 40) : (memory.error || "没有复述暗号"));

    const system = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: "system", content: "无论用户问什么，你只能回复：苹果" },
        { role: "user", content: "1+1等于几？" }
      ]
    });
    const systemText = Probe.textOf(system.json).trim();
    put("system", system.status < 400 && systemText.indexOf("苹果") >= 0 ? "pass" : "fail", systemText ? "模型回复：" + systemText.slice(0, 40) : (system.error || "没有遵守系统指令"));

    const tools = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 64,
      tools: [{ type: "function", function: { name: "get_code", description: "查询编号", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } }],
      tool_choice: "auto",
      messages: [{ role: "user", content: "请调用 get_code 查询编号 42，不要自己编造结果。" }]
    });
    const toolCalls = tools.json && tools.json.choices && tools.json.choices[0] && tools.json.choices[0].message && tools.json.choices[0].message.tool_calls;
    const toolName = toolCalls && toolCalls[0] && toolCalls[0].function && toolCalls[0].function.name;
    put("tools", toolName === "get_code" ? "pass" : (Probe.unsupported(tools) ? "skip" : "fail"), toolName ? "调用了 " + toolName : (tools.status >= 400 ? "接口拒绝了 tools" : "没有返回 tool_calls"));

    const vision = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [{ role: "user", content: [
        { type: "text", text: "这张图是什么颜色？只回答一个字。" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } }
      ] }]
    });
    const visionText = Probe.textOf(vision.json);
    put("vision", vision.status < 400 && visionText ? "pass" : (Probe.unsupported(vision) ? "skip" : "fail"), vision.status < 400 ? "已接受图片输入" + (visionText ? "：" + visionText.slice(0, 20) : "") : "接口不接受图片输入");

    const reasoning = await Probe.call({
      model,
      temperature: 0,
      max_tokens: 16,
      reasoning_effort: "low",
      messages: [{ role: "user", content: "只回复 OK" }]
    });
    put("reasoning", reasoning.status < 400 ? "pass" : (Probe.unsupported(reasoning) ? "skip" : "fail"), reasoning.status < 400 ? "接受 reasoning_effort=low" : "接口拒绝了推理参数");

    const pad = "请忽略这段重复前缀。".repeat(80);
    const cachePayload = { model, temperature: 0, max_tokens: 8, messages: [{ role: "system", content: pad }, { role: "user", content: "只回复 OK" }] };
    const first = await Probe.call(cachePayload);
    const second = await Probe.call(cachePayload);
    const cached = (second.json && second.json.usage && ((second.json.usage.prompt_tokens_details && second.json.usage.prompt_tokens_details.cached_tokens) || second.json.usage.cache_read_input_tokens || second.json.usage.cached_tokens)) || 0;
    if (second.status >= 400 || first.status >= 400) put("cache", "fail", "重复请求没有成功");
    else if (cached > 0) put("cache", "pass", "第二次 cached_tokens=" + cached);
    else if (second.json && second.json.usage && (second.json.usage.prompt_tokens_details || "cache_read_input_tokens" in (second.json.usage || {}))) put("cache", "miss", "有缓存字段，但本次未命中");
    else put("cache", "skip", "响应里没有提示词缓存字段");

    const firstText = Probe.textOf(first.json);
    const secondText = Probe.textOf(second.json);
    const replayOk = first.status < 400 && second.status < 400 && firstText && firstText === secondText;
    put("replay", replayOk ? "pass" : (first.status < 400 && second.status < 400 ? "miss" : "fail"), replayOk ? "两次回复一致，可以重放" : (second.status < 400 ? "两次都成功，但回复不同" : "第二次请求失败"));
    const verdict = Probe.evaluate(report);
    report.score = verdict.score;
    report.level = verdict.level;
    report.title = verdict.title;
    report.summary = verdict.summary;
    report.findings = verdict.findings;
    Store.saveBasicReport(report);
    const box = document.getElementById("relay-report");
    if (box) {
      box.innerHTML = Probe.reportHtml(report);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return report;
  },
  evaluate(report) {
    const items = report.items || {};
    const status = (id) => (items[id] && items[id].status) || "idle";
    const detail = (id) => (items[id] && items[id].detail) || "";
    let score = 100;
    const findings = [];
    const cut = (id, amount, title, text) => {
      if (status(id) !== "fail") return;
      score -= amount;
      findings.push({ level: amount >= 20 ? "bad" : "warn", title, text: text + (detail(id) ? " " + detail(id) : "") });
    };
    cut("echo", 35, "模型被换成了别的", "请求的模型 ID 和响应里的 model 不一致。这是掺水里最硬的证据，中转站很可能把贵模型换成了更便宜的。");
    cut("protocol", 20, "协议没有按原样转达", "返回的不是可识别的对话协议，客户端拿到的不是上游应有的格式。");
    cut("shape", 15, "响应结构被改过", "标准消息字段缺失，中转可能包了一层或把字段弄丢了。");
    cut("system", 15, "系统指令没有送达", "系统提示没有约束住回答。中转可能吞掉了 system，或换成了不听指令的小模型。");
    cut("memory", 15, "上下文没有转发给上游", "模型不记得上一轮刚约定的暗号，历史消息很可能没被原样带上。");
    cut("limit", 12, "输出限制没有生效", "max_tokens 没有截断输出。中转可能丢掉了这个参数，用量会比你以为的更大。");
    cut("stream", 10, "没有真正的流式", "打开 stream 后没有收到逐段分片。中转可能把流式缓冲成一次性返回，或根本没转发。");
    cut("tools", 10, "工具调用被丢掉", "请求里带了 tools，响应却没有 tool_calls。中转可能剥掉了工具字段。");
    cut("usage", 8, "用量对不上账", "响应里没有 token 用量。中转不给账，就无法核对有没有多扣。");
    cut("replay", 8, "同样的请求不稳定", "第二次相同请求失败，或无法重放。");
    if (status("cache") === "miss") findings.push({ level: "ok", title: "提示词缓存未命中", text: "接口有缓存字段，但这次没有命中。这不等于掺水。" });
    if (status("cache") === "skip") findings.push({ level: "ok", title: "没有暴露缓存字段", text: "响应里看不到提示词缓存。只能说明中转没把缓存信息交出来，不能单凭这一条判掺水。" });
    ["vision", "reasoning"].forEach((id) => {
      if (status(id) === "skip") findings.push({ level: "ok", title: Probe.checks.find((item) => item.id === id).name + "明确不支持", text: "接口直接拒绝了这项参数，属于能力边界，不算偷偷掺水。" + detail(id) });
    });
    score = Math.max(0, Math.min(100, score));
    const hard = status("echo") === "fail" || status("protocol") === "fail";
    const warns = findings.filter((item) => item.level === "warn" || item.level === "bad").length;
    let level = "ok";
    let title = "未见掺水";
    let summary = "请求的模型有回显，系统指令、上下文和输出限制都按原样生效。这次没有看到中转站偷换模型或改写协议的证据。";
    if (hard || score < 60) {
      level = "bad";
      title = "明显掺水";
      summary = "中转站没有把请求原样交给上游。优先看模型回显和系统指令：模型名对不上，或关键字段被丢掉，就不能按标价的模型来用。";
    } else if (warns > 0 || score < 85) {
      level = "warn";
      title = "疑似掺水";
      summary = "协议大体能通，但有些参数没有按你发的那样生效。它不一定换了模型，但中转过程里有损耗，计费和能力都不能完全相信标称值。";
    }
    if (!findings.length) findings.push({ level: "ok", title: "关键项目都通过", text: "模型回显、结构、指令、记忆和用量都对得上。" });
    return { score, level, title, summary, findings };
  },
  reportHtml(report) {
    if (!report || report.score == null) return "";
    const tone = report.level === "bad" ? "bad" : report.level === "warn" ? "warn" : "ok";
    const findings = (report.findings || []).map((item) => `<div class="finding ${item.level}"><b>${UI.esc(item.title)}</b><p>${UI.esc(item.text)}</p></div>`).join("");
    return `<article class="panel mt16 relay-report">
      <div class="panel-hd"><h3>掺水报告</h3><span class="badge ${tone}"><i></i>${UI.esc(report.title)}</span></div>
      <div class="relay-score">
        ${UI.ring(report.score, report.level === "bad" ? "#ef5d5d" : report.level === "warn" ? "#f0a03a" : "#22c58b")}
        <div>
          <h3>${UI.esc(report.title)}</h3>
          <p>${UI.esc(report.summary)}</p>
          <p class="note">${UI.esc(report.modelName || report.modelId || "")} · ${UI.esc(report.time || "")} · 诚信分 ${report.score}/100</p>
        </div>
      </div>
      <div class="findings">${findings}</div>
    </article>`;
  }
};
