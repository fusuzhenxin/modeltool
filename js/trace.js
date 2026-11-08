/* ModelTrace fingerprint client.
   Challenge text, number parser, and attribution are adapted from
   https://github.com/xqy2006/ModelTrace by xqy2006, MIT License.
   The fingerprint bank is data/trace-bank.json. */
const Trace = (() => {
  const VALUE_MIN = 1;
  const VALUE_MAX = 355;
  const DIMENSION = VALUE_MAX - VALUE_MIN + 1;
  const ALPHA = 0.5;
  let bankPromise = null;
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

  function randomIndex(length) {
    const limit = Math.floor(0x100000000 / length) * length;
    const buffer = new Uint32Array(1);
    do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
    return buffer[0] % length;
  }

  function choose(values) {
    return values[randomIndex(values.length)];
  }

  function uniqueLengths(count) {
    const available = Array.from({ length: 41 }, (_, index) => 292 + index);
    const output = [];
    while (output.length < count) output.push(available.splice(randomIndex(available.length), 1)[0]);
    return output;
  }

  function generateChallenges(count) {
    const openings = [
      "这是一次独立的数值选择记录",
      "请完成下面的无语义整数选择任务",
      "执行一次第一反应取值记录",
      "生成一组不承载语义的整数选择",
      "进行一轮快速逐项取值"
    ];
    const actions = [
      "为各个位置分别凭第一反应选择",
      "逐项选择",
      "每次只决定当前一项，共给出",
      "分别凭第一反应给出",
      "逐个直接选择"
    ];
    const endings = [
      "允许某个数字再次出现；每项写出后不要回头排序、去重或替换。",
      "偶然重复是有效的；不要重新排列或修正已经写出的项目。",
      "相同值可以再次出现；输出过程中不要整理或改写前面的项目。",
      "重复值无需删除；不要筛选、重排或补成某种规律。",
      "不必赋予数字任何含义；已经给出的值保持不变。"
    ];
    const separators = [
      "数字之间用逗号或空格分隔均可。",
      "使用一种一致的常见分隔符即可。",
      "可以用逗号、空格或换行分隔。",
      "只要每个整数边界清楚，格式可自行选择。"
    ];
    return uniqueLengths(count || 3).map((length, index) => ({
      id: "probe-" + (index + 1) + "-" + crypto.randomUUID(),
      expected_count: length,
      prompt: choose(openings) + "。" + choose(actions) + " " + length + " 个 1 到 355（含端点）的整数。"
        + "每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。"
        + "本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。"
        + choose(endings) + choose(separators)
        + "直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。"
    }));
  }

  function parseNumbers(text) {
    const runs = [];
    let current = [];
    let previousEnd = 0;
    const source = String(text);
    for (const match of source.matchAll(/\d+/g)) {
      const separator = source.slice(previousEnd, match.index);
      const value = Number(match[0]);
      if (current.length && /\p{L}/u.test(separator)) {
        runs.push(current);
        current = [];
      }
      if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value);
      previousEnd = match.index + match[0].length;
    }
    if (current.length) runs.push(current);
    return runs.reduce((best, run) => run.length > best.length ? run : best, []);
  }

  function countNumbers(numbers) {
    const counts = Array(DIMENSION).fill(0);
    numbers.forEach((number) => { counts[number - VALUE_MIN] += 1; });
    return counts;
  }

  function mean(values) {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function standardize(values) {
    const center = mean(values);
    const variance = mean(values.map((value) => (value - center) ** 2));
    const scale = Math.max(Math.sqrt(variance), 1e-12);
    return values.map((value) => (value - center) / scale);
  }

  function dot(left, right) {
    let value = 0;
    for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
    return value;
  }

  function norm(values) {
    return Math.sqrt(dot(values, values));
  }

  function normalized(values) {
    const scale = Math.max(norm(values), 1e-12);
    return values.map((value) => value / scale);
  }

  function subtractBasis(values, basis) {
    const output = values.slice();
    for (const vector of basis || []) {
      const projection = dot(output, vector);
      for (let index = 0; index < output.length; index += 1) output[index] -= projection * vector[index];
    }
    return output;
  }

  function hellingerFeature(counts) {
    const total = counts.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
    return counts.map((value) => Math.sqrt((value + ALPHA) / total));
  }

  function splitIntoFour(values) {
    const base = Math.floor(values.length / 4);
    const remainder = values.length % 4;
    const chunks = [];
    let start = 0;
    for (let index = 0; index < 4; index += 1) {
      const size = base + (index < remainder ? 1 : 0);
      chunks.push(values.slice(start, start + size));
      start += size;
    }
    return chunks;
  }

  function orderedBlockFeature(numbers) {
    const pieces = [];
    for (const chunk of splitIntoFour(numbers)) {
      const bins = Array(16).fill(0.5);
      for (const value of chunk) {
        const index = Math.min(15, Math.floor(((value - 1) / 355) * 16));
        bins[index] += 1;
      }
      const total = bins.reduce((sum, value) => sum + value, 0);
      pieces.push(...bins.map((value) => Math.sqrt(value / total)));
    }
    const lastDigits = Array(10).fill(0.5);
    numbers.forEach((value) => { lastDigits[value % 10] += 1; });
    const lastTotal = lastDigits.reduce((sum, value) => sum + value, 0);
    pieces.push(...lastDigits.map((value) => Math.sqrt(value / lastTotal)));
    return pieces;
  }

  function robustScoreCounts(counts, bank) {
    const artifact = bank.robust.hellinger;
    const feature = hellingerFeature(counts);
    let projected = feature.map((value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index]);
    projected = subtractBasis(projected, artifact.nuisance_basis);
    projected = normalized(projected);
    return standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
  }

  function orderedBlockScores(numbers, bank) {
    const artifact = bank.robust.ordered_blocks;
    const feature = orderedBlockFeature(numbers);
    const standardizedFeature = feature.map((value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index]);
    const unit = normalized(standardizedFeature);
    const environmentScores = artifact.environment_centroids.map(
      (centroids) => centroids.map((centroid) => dot(unit, centroid))
    );
    const template = standardize(artifact.centroids.map((_, modelIndex) => Math.max(
      ...environmentScores.map((scores) => scores[modelIndex])
    )));
    const projected = normalized(subtractBasis(standardizedFeature, artifact.nuisance_basis));
    const nuisance = standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
    return standardize(template.map((value, index) => 0.5 * value + 0.5 * nuisance[index]));
  }

  function robustScoreNumbers(numbers, bank) {
    const marginal = robustScoreCounts(countNumbers(numbers), bank);
    const artifact = bank.robust.ordered_blocks;
    const weight = artifact ? Number(artifact.weight || 0) : 0;
    if (!artifact || weight === 0) return marginal;
    const ordered = orderedBlockScores(numbers, bank);
    return marginal.map((value, index) => (1 - weight) * value + weight * ordered[index]);
  }

  function softmax(values) {
    const maximum = Math.max(...values);
    const weights = values.map((value) => Math.exp(value - maximum));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return weights.map((value) => value / total);
  }

  function jsSimilarity(left, right) {
    const leftTotal = left.reduce((sum, value) => sum + value, 0);
    const rightTotal = right.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
    const p = left.map((value) => value / leftTotal);
    const q = right.map((value) => (value + ALPHA) / rightTotal);
    const midpoint = p.map((value, index) => (value + q[index]) / 2);
    const divergence = (values) => values.reduce(
      (total, value, index) => total + (value ? value * Math.log(value / midpoint[index]) : 0),
      0
    );
    const js = (divergence(p) + divergence(q)) / 2;
    return 1 - Math.sqrt(js / Math.log(2));
  }

  function minimumCount(expected) {
    return expected ? Math.max(80, Math.ceil(expected * 0.55)) : 80;
  }

  function analyze(outputs, bank) {
    const modelIds = bank.models.map((model) => model.id);
    const valid = [];
    const diagnostics = [];
    outputs.forEach((item, index) => {
      const expected = Number(item.expected_count || 0);
      const numbers = parseNumbers(item.text || "");
      const minimum = minimumCount(expected);
      const accepted = numbers.length >= minimum;
      diagnostics.push({ index, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted });
      if (accepted) valid.push({ numbers, counts: countNumbers(numbers), scores: robustScoreNumbers(numbers, bank) });
    });
    if (!valid.length) throw new Error("没有可用回答。模型需要直接输出完整数字序列，拒答或截断太短的回答不会计入。");
    const combinedScores = modelIds.map((_, modelIndex) => mean(valid.map((item) => item.scores[modelIndex])));
    const calibrationKey = String(Math.min(valid.length, 3));
    const beta = Number(bank.calibration[calibrationKey].beta);
    const probabilities = softmax(combinedScores.map((value) => beta * value));
    const pooledCounts = Array.from({ length: DIMENSION }, (_, index) => valid.reduce((sum, item) => sum + item.counts[index], 0));
    const modelEntries = Object.fromEntries(bank.models.map((model) => [model.id, model]));
    const familyOrder = [...new Set(bank.models.map((model) => model.family || "models"))];
    const familyNames = Object.fromEntries(familyOrder.map((family) => [
      family,
      bank.models.find((model) => (model.family || "models") === family)?.family_name || family
    ]));
    const results = modelIds.map((model, index) => ({
      model,
      display_name: modelEntries[model].display_name,
      probability: probabilities[index],
      profile_similarity: jsSimilarity(pooledCounts, modelEntries[model].counts),
      score: combinedScores[index],
      family: modelEntries[model].family || "models",
      family_name: familyNames[modelEntries[model].family || "models"]
    })).sort((left, right) => right.probability - left.probability);
    const familyProbabilities = Object.fromEntries(familyOrder.map((family) => [
      family,
      results.filter((item) => item.family === family).reduce((sum, item) => sum + item.probability, 0)
    ]));
    results.forEach((item) => { item.conditional_probability = item.probability / familyProbabilities[item.family]; });
    const winningFamily = familyOrder.reduce((best, family) => familyProbabilities[family] > familyProbabilities[best] ? family : best);
    return {
      prediction: results[0].model,
      prediction_name: results[0].display_name,
      probability: results[0].probability,
      used_outputs: valid.length,
      results,
      diagnostics,
      family_prediction: winningFamily,
      family_prediction_name: familyNames[winningFamily],
      family_probability: familyProbabilities[winningFamily]
    };
  }

  function loadBank() {
    if (!bankPromise) {
      bankPromise = fetch("data/trace-bank.json").then((response) => {
        if (!response.ok) throw new Error("指纹库没有加载成功");
        return response.json();
      }).catch((error) => {
        bankPromise = null;
        throw error;
      });
    }
    return bankPromise;
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
    const known = payload.known === true;
    const same = known && payload.claimed === payload.prediction;
    const headline = known
      ? (same ? "回答更像你请求的这个模型" : "回答更像指纹库里的另一个模型")
      : (payload.claimed ? "所选模型不在指纹库里" : "已找到库内最接近的候选");
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
          <div><span>库内最接近的模型</span><strong>${UI.esc(payload.prediction_name)} · ${percent(payload.probability)}</strong></div>
          <div><span>家族</span><strong>${UI.esc(payload.family_prediction_name)} · ${percent(payload.family_probability)}</strong></div>
        </div>
        <p class="trace-note">${payload.method === "manual" ? "你填写的" : "标注的"}模型 ID：${UI.esc(payload.claimed || "未填写")}。有效回答 ${payload.used_outputs}/3。${UI.esc(limit)}</p>
        ${payload.errors && payload.errors.length ? `<p class="trace-note">有 ${payload.errors.length} 次没有计入：${UI.esc(payload.errors[0])}</p>` : ""}
        <div class="trace-steps">${checks}</div>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>排序</th><th>候选模型</th><th>家族</th><th>库内概率</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${resultRows.length > 5 ? `<details class="trace-more"><summary>查看其余 ${resultRows.length - 5} 个候选</summary><div class="table-wrap"><table class="grid"><thead><tr><th>排序</th><th>候选模型</th><th>家族</th><th>库内概率</th></tr></thead><tbody>${resultRows.slice(5).join("")}</tbody></table></div></details>` : ""}
        <div class="trace-explain"><h3>这个结果怎么理解？</h3><p>算法比较回答中的数字分布与顺序特征，不读取模型的自我介绍。未收录的模型也会有一个最接近的候选；上下文、隐藏系统提示和推理设置都可能影响结果。</p><p>复测时保持同一个模型和设置，每题新开对话。多次结果一致时，再结合协议检测和真实任务表现判断。</p>${payload.used_outputs < 3 ? `<p>本次只有 ${payload.used_outputs} 道有效回答，建议补足三题后再比较。</p>` : ""}</div>
        ${payload.shared ? `<div class="entry-actions trace-note"><a class="btn btn-primary" href="trace.html?mode=manual">检测我正在用的模型</a><a class="btn btn-ghost" href="trace.html">使用 API 自动检测</a></div>` : `<div class="entry-actions trace-note"><button class="btn btn-ghost" type="button" data-action="${payload.method === "manual" ? "reset-manual" : "retest-trace"}">${UI.icon("refresh")} ${payload.method === "manual" ? "换一组题目复测" : "用当前接口设置复测"}</button></div>`}
        <p class="trace-note">算法和指纹库来自 <a href="https://github.com/xqy2006/ModelTrace" target="_blank" rel="noopener noreferrer">ModelTrace</a>${payload.model_count ? `，库内共 ${payload.model_count} 个模型` : ""}${payload.built_at ? `，建库时间 ${UI.esc(payload.built_at)}` : ""}。${payload.method === "manual" ? "本次回答由用户粘贴，本站未核验其来源。" : ""}</p>
      </article>`;
  }

  async function run(modelId, onProgress) {
    const cfg = Store.api();
    const claimed = (cfg.modelOverride || modelId || "").trim();
    const bank = await loadBank();
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

  return { generateChallenges, parseNumbers, analyze, loadBank, resultHtml, remembered, clearResult, run, minimumCount, manual, manualHtml, bindManual, resetManual, analyzeManual };
})();
