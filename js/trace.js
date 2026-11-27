/* ModelTrace fingerprint client.
   Challenge text, number parser, and attribution are adapted from
   https://github.com/xqy2006/ModelTrace by xqy2006, MIT License.
   The fingerprint bank is data/trace-bank.json. */
const Trace = (() => {
  let bankPromise = null;
  let loadedBank = null;
  let manualDraft = null;

  function manual() {
    if (!manualDraft) manualDraft = { challenges: generateChallenges(3), answers: ["", "", ""], claimed: "" };
    return manualDraft;
  }

  function manualHtml() {
    const draft = manual();
    return `<div class="panel-bd">
      <div class="manual-intro"><span class="entry-kicker">不需要接口或密钥</span><h2>复制题目，把回答贴回来</h2><p>每道题都新开一个对话，使用同一个模型，关闭工具、联网和代码执行。只粘贴模型的数字回答。</p></div>
      <label class="field manual-claimed"><span>你正在使用的模型 ID（可选）</span><input id="manual-claimed" maxlength="120" autocomplete="off" placeholder="例如 gpt-6.1-sol，不确定可以留空" value="${UI.esc(draft.claimed)}"></label>
      <div class="manual-steps">${draft.challenges.map((challenge, index) => `<section class="manual-step">
        <div class="manual-step-head"><h3><span>${index + 1}</span> 第 ${index + 1} 道数字题</h3><button class="btn btn-ghost btn-sm" type="button" data-action="copy-manual-prompt" data-index="${index}">${UI.icon("doc")} 复制题目</button></div>
        <details><summary>查看完整题目 · 要求 ${challenge.expected_count} 个数字</summary><p class="prompt-text">${UI.esc(challenge.prompt)}</p></details>
        <label class="field"><span>粘贴第 ${index + 1} 题的模型回答</span><textarea id="manual-answer-${index}" data-manual-answer="${index}" rows="5" maxlength="60000" placeholder="把数字序列粘贴到这里…" aria-describedby="manual-count-${index}">${UI.esc(draft.answers[index])}</textarea></label>
        <p class="manual-count" id="manual-count-${index}" aria-live="polite">尚未粘贴回答</p>
      </section>`).join("")}</div>
      <p class="note">建议完成 3 题，至少 1 题有效才可分析。数字数量只用于检查是否足够，不能确认回答来自哪个模型。原始回答只留在当前页面，刷新后清空；摘要结果会留在本次浏览会话中。</p>
      <div id="manual-error" role="alert"></div><div class="entry-actions"><button class="btn btn-primary" type="button" data-action="analyze-manual">分析已粘贴的回答</button><button class="btn btn-ghost" type="button" data-action="reset-manual">换一组题目</button></div>
    </div>`;
  }

  function updateManualCount(index) {
    const draft = manual();
    const node = document.getElementById("manual-count-" + index);
    if (!node || !draft.challenges[index]) return;
    const numbers = parseNumbers(draft.answers[index]);
    const minimum = minimumCount(draft.challenges[index].expected_count);
    const accepted = numbers.length >= minimum;
    node.textContent = !draft.answers[index].trim() ? "尚未粘贴回答" : `已识别 ${numbers.length} 个有效数字 · ${accepted ? "可以计入" : "至少需要 " + minimum + " 个，请补全回答"}`;
    node.classList.toggle("ready", accepted);
  }

  function bindManual() {
    const panel = document.getElementById("trace-manual");
    if (!panel) return;
    panel.addEventListener("input", (event) => {
      const draft = manual();
      if (event.target.id === "manual-claimed") draft.claimed = event.target.value;
      if (event.target.matches("[data-manual-answer]")) {
        const index = Number(event.target.dataset.manualAnswer);
        draft.answers[index] = event.target.value;
        updateManualCount(index);
      }
      const error = document.getElementById("manual-error");
      if (error) error.textContent = "";
      const result = document.getElementById("trace-result");
      if (result && result.querySelector(".panel")) {
        clearResult();
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
        result.innerHTML = `<p class="note">输入已更改，请重新分析回答。</p>`;
        if (typeof Poster !== "undefined") Poster.live = null;
        document.querySelectorAll("[data-share] .share-actions").forEach((node) => node.remove());
      }
    });
    manual().challenges.forEach((_, index) => updateManualCount(index));
  }

  function resetManual() {
    const claimed = manual().claimed;
    manualDraft = null;
    manual().claimed = claimed;
    const panel = document.getElementById("trace-manual");
    if (panel) { panel.innerHTML = manualHtml(); manual().challenges.forEach((_, index) => updateManualCount(index)); }
  }

  function makePayload(outputs, bank, claimed, method) {
    return Object.assign({}, analyze(outputs, bank), {
      engine: "modeltrace-v6",
      claimed,
      known: bank.models.some((model) => model.id === claimed),
      built_at: String(bank.built_at || "").slice(0, 10),
      model_count: bank.models.length,
      errors: [], method, at: Engine.now()
    });
  }

  async function analyzeManual() {
    const draft = manual();
    const outputs = draft.challenges.map((challenge, index) => ({ text: draft.answers[index], expected_count: challenge.expected_count }));
    if (!outputs.some((item) => parseNumbers(item.text).length >= minimumCount(item.expected_count))) {
      throw new Error("请先粘贴至少一道有效回答。每道题下方会显示已识别的数字数量。");
    }
    const claimed = draft.claimed.trim();
    const payload = makePayload(outputs, await loadBank(), claimed, "manual");
    remember(payload);
    return payload;
  }

  function generateChallenges(count) { return ModelTraceCore.generateChallenges(count || 3); }
  function parseNumbers(text) { return ModelTraceCore.parseNumbers(text); }

  function minimumCount(expected) {
    return expected ? Math.max(80, Math.ceil(expected * 0.55)) : 80;
  }

  function analyze(outputs, bank) { return ModelTraceCore.analyzeGlobalOutputs(outputs, bank); }

  function loadBank() {
    if (!bankPromise) {
      bankPromise = fetch("data/trace-bank.json?v=20261127-v6").then((response) => {
        if (!response.ok) throw new Error("指纹库没有加载成功");
        return response.json();
      }).then((bank) => {
        loadedBank = bank;
        return bank;
      }).catch((error) => {
        bankPromise = null;
        throw error;
      });
    }
    return bankPromise;
  }

  function models() {
    const entries = (loadedBank?.models || []).map((model) => ({ id: model.id, name: model.display_name || model.id }));
    if (typeof TokenTrace !== "undefined") {
      for (const ref of TokenTrace.references) {
        const id = ref.slice(ref.indexOf("/") + 1);
        entries.push({ id, name: id, reference: true });
      }
    }
    const order = new Map(DATA.models.map((model, index) => [model.id, index]));
    return entries.sort((a, b) => (order.get(a.id) ?? 10000) - (order.get(b.id) ?? 10000)).map((entry) => {
      const preset = DATA.models.find((model) => model.id === entry.id);
      return { ...preset, ...entry, name: (preset?.name || entry.name) + (entry.reference ? "（参考比对）" : ""),
        short: preset?.short || entry.id[0].toUpperCase(), color: preset?.color || "#64748b" };
    });
  }

  function percent(value) {
    return (Number(value) * 100).toFixed(1) + "%";
  }

  function remembered() {
    try {
      const raw = sessionStorage.getItem("modeltool-trace-last");
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function remember(payload) {
    try { sessionStorage.setItem("modeltool-trace-last", JSON.stringify(payload)); } catch (err) { /* 结果只是本页展示，存不下也不影响检测。 */ }
  }
  function clearResult() {
    try { sessionStorage.removeItem("modeltool-trace-last"); } catch (err) { /* 会话存储不可用时无需清理。 */ }
  }

  function resultHtml(payload) {
    if (!payload || !payload.results) return "";
    if (payload.engine === "one-token" || payload.coverage === "unsupported") return TokenTrace.resultHtml(payload, UI.esc);
    const known = payload.known === true;
    const identity = ReportQuality.fingerprint(payload);
    const headline = identity.label;
    const confusionNote = ReportQuality.knownConfusion(payload) ? "GPT-6 Astra 与 GPT-6.1 Sol 是 ModelTrace 已知难以区分的组合，本次暂无法判断；下面保留原始候选占比。" : "";
    const resultRows = payload.results.map((item, index) => `
      <tr class="${index === 0 ? "winner" : ""}">
        <td>${index + 1}</td>
        <td><strong>${UI.esc(item.display_name)}</strong></td>
        <td>${UI.esc(item.family_name)}</td>
        <td><div class="trace-prob"><i><span style="width:${Math.max(0, item.probability * 100)}%"></span></i><b>${percent(item.probability)}</b></div></td>
      </tr>`);
    const rows = resultRows.slice(0, 5).join("");
    const checks = (payload.diagnostics || []).map((item) => {
      const state = item.accepted ? "done" : "bad";
      const label = item.accepted ? "计入" : "忽略";
      return `<span class="trace-step ${state}">题 ${item.index + 1} · ${item.parsed_numbers} 个数字 · ${label}</span>`;
    }).join("");
    const limit = known
      ? "概率是指纹库候选之间的相对结果，不代表身份认证的准确率。"
      : "没有提供模型 ID，或该 ID 不在库中。下面只列出库内最接近的候选，不能单独作为模型被替换的证据。";
    return `
      <article class="panel mt16">
        <div class="panel-hd"><h3>${UI.icon("target")} 指纹对比结果</h3><span>${payload.method === "manual" ? "手动粘贴回答" : payload.shared ? "分享摘要" : "API 自动检测"}</span></div>
        ${payload.shared ? `<p class="trace-note">这是一份分享结果。链接和海报里没有密钥，也没有原始回答，候选只保留前几名。</p>` : ""}
        <div class="trace-summary">
          <div><span>判断</span><strong>${UI.esc(headline)}</strong></div>
          <div><span>${payload.decision === "reject" ? "未匹配 · 仅列最近候选" : "最接近的模型"}</span><strong>${UI.esc(payload.prediction_name)} · ${percent(payload.probability)}</strong></div>
          <div><span>家族</span><strong>${UI.esc(payload.family_prediction_name)} · ${percent(payload.family_probability)}</strong></div>
        </div>
        <p class="trace-note">${payload.method === "manual" ? "你填写的" : "标注的"}模型 ID：${UI.esc(payload.claimed || "未填写")}。有效回答 ${payload.used_outputs}/3。${UI.esc(limit)}</p>
        ${confusionNote ? `<p class="trace-note">${UI.esc(confusionNote)}</p>` : ""}
        ${payload.errors && payload.errors.length ? `<p class="trace-note">有 ${payload.errors.length} 次没有计入：${UI.esc(payload.errors[0])}</p>` : ""}
        ${payload.engine === "modeltrace-v6" ? `<p class="trace-note">${payload.decision === "accept" ? "ModelTrace 已通过归因阈值" : "ModelTrace 未通过归因阈值"}；未知 / 库外概率 ${percent(payload.unknown_probability || 0)}。${UI.esc(payload.reject_reason_zh || "")}</p>` : ""}
        <div class="trace-steps">${checks}</div>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>排序</th><th>候选模型</th><th>家族</th><th>归因占比</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${resultRows.length > 5 ? `<details class="trace-more"><summary>查看其余 ${resultRows.length - 5} 个候选</summary><div class="table-wrap"><table class="grid"><thead><tr><th>排序</th><th>候选模型</th><th>家族</th><th>归因占比</th></tr></thead><tbody>${resultRows.slice(5).join("")}</tbody></table></div></details>` : ""}
        <div class="trace-explain"><h3>这个结果怎么理解？</h3><p>${UI.esc(ReportQuality.identityNote)} ${UI.esc(ReportQuality.ruleNote)}</p><p>算法比较回答中的数字分布与顺序特征，不读取模型的自我介绍。新版同时评估未知模型，未达阈值时拒绝归因；上下文、隐藏系统提示和推理设置都可能影响结果。</p><p>复测时保持同一个模型和设置，每题新开对话。多次结果一致时，再结合协议检测和真实任务表现判断。</p>${payload.used_outputs < 3 ? `<p>本次只有 ${payload.used_outputs} 道有效回答，建议补足三题后再比较。</p>` : ""}</div>
        ${payload.shared ? `<div class="entry-actions trace-note"><a class="btn btn-primary" href="trace.html?mode=manual">检测我正在用的模型</a><a class="btn btn-ghost" href="trace.html">使用 API 自动检测</a></div>` : `<div class="entry-actions trace-note"><button class="btn btn-ghost" type="button" data-action="${payload.method === "manual" ? "reset-manual" : "retest-trace"}">${UI.icon("refresh")} ${payload.method === "manual" ? "换一组题目复测" : "用当前接口设置复测"}</button></div>`}
        <p class="trace-note">算法和指纹库来自 <a href="https://github.com/xqy2006/ModelTrace" target="_blank" rel="noopener noreferrer">ModelTrace</a>${payload.model_count ? `，库内共 ${payload.model_count} 个模型` : ""}${payload.built_at ? `，建库时间 ${UI.esc(payload.built_at)}` : ""}。${payload.method === "manual" ? "本次回答由用户粘贴，本站未核验其来源。" : ""}</p>
      </article>`;
  }

  async function run(modelId, onProgress) {
    const cfg = Store.api();
    const claimed = (cfg.modelOverride || modelId || "").trim();
    if (typeof TokenTrace !== "undefined" && TokenTrace.referenceId(claimed)) {
      const payload = await TokenTrace.run(claimed, cfg, onProgress);
      remember(payload);
      return payload;
    }
    const bank = await loadBank();
    if (!bank.models.some((entry) => entry.id === claimed)) {
      const payload = { engine: "unsupported", coverage: "unsupported", claimed, known: false,
        method: "api", used_outputs: 0, results: [], diagnostics: [], errors: [], at: Engine.now() };
      remember(payload);
      return payload;
    }
    const challenges = generateChallenges(6);
    const outputs = [];
    const attempts = [];
    const errors = [];
    const target = 3;
    for (let index = 0; index < challenges.length && outputs.length < target; index += 1) {
      const challenge = challenges[index];
      if (onProgress) onProgress({ index, total: challenges.length, valid: outputs.length, target, state: "请求中" });
      try {
        const text = await Api.complete({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: claimed,
          user: challenge.prompt,
          bare: true
        });
        const numbers = parseNumbers(text);
        const minimum = minimumCount(challenge.expected_count);
        const accepted = numbers.length >= minimum;
        attempts.push({ index: attempts.length, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted });
        if (accepted) outputs.push({ text, expected_count: challenge.expected_count });
        else errors.push("第 " + (index + 1) + " 次只有 " + numbers.length + " 个有效数字，需要至少 " + minimum + " 个");
      } catch (error) {
        const message = error && error.message ? error.message : "请求失败";
        errors.push("第 " + (index + 1) + " 次：" + message);
        attempts.push({ index: attempts.length, parsed_numbers: 0, minimum_numbers: minimumCount(challenge.expected_count), accepted: false });
      }
      if (onProgress) onProgress({ index, total: challenges.length, valid: outputs.length, target, state: "已收到" });
    }
    if (!outputs.length) throw new Error(errors[0] || "没有获得可分析的数字序列");
    const payload = makePayload(outputs, bank, claimed, "api");
    payload.errors = errors;
    payload.diagnostics = attempts;
    remember(payload);
    return payload;
  }

  return { generateChallenges, parseNumbers, analyze, loadBank, models, resultHtml, remembered, clearResult, run, minimumCount, manual, manualHtml, bindManual, resetManual, analyzeManual };
})();
