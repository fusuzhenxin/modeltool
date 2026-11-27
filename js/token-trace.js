/* Single-token exploratory comparison. Upstream MIT/CC-BY attribution: vendor/README.md. */
const TokenTrace = (() => {
  const references = [
    "deepseek/deepseek-chat", "google/gemini-2.5-flash", "qwen/qwen3-30b-a3b-instruct-2507",
    "moonshotai/kimi-k2", "z-ai/glm-4.5", "meta-llama/llama-3.1-8b-instruct",
    "mistralai/mistral-small-3.2-24b-instruct"
  ];
  const samplesPerCell = 25;
  let bankPromise;
  function referenceId(model) {
    const id = String(model || "").trim().toLowerCase();
    return references.find((ref) => id === ref || id === ref.slice(ref.indexOf("/") + 1)) || null;
  }
  function loadBank() {
    if (!bankPromise) bankPromise = fetch("data/token-reference-samples.json?v=20261127")
      .then((r) => { if (!r.ok) throw new Error("参考指纹库加载失败"); return r.json(); })
      .catch((err) => { bankPromise = null; throw err; });
    return bankPromise;
  }
  async function call(cfg, model, cellId, extraBody, maxTokens) {
    // Fixed protocol: never silently remove temperature, change prompts, or inherit the task output cap.
    const payload = { model, temperature: 1, max_tokens: maxTokens, stream: false,
      messages: [{ role: "system", content: TokenFingerprintCore.getSystemPrompt(cellId) },
        { role: "user", content: TokenFingerprintCore.pickParaphrase(cellId) }], ...extraBody };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(Api.proxyUrl(), { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, payload }) });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error("指纹接口未返回有效 JSON，已停止采样"); }
      if (!response.ok) {
        // Do not persist upstream bodies, which can contain credentials.
        throw Object.assign(new Error("指纹采样请求失败（HTTP " + response.status + "）"), { status: response.status });
      }
      if (data.error) throw new Error("指纹接口返回错误，已停止采样");
      return Api.messageText(data.choices?.[0]?.message?.content || "").trim();
    } finally { clearTimeout(timer); }
  }
  async function run(model, cfg, onProgress) {
    const refId = referenceId(model);
    if (!refId) throw new Error("此模型版本尚无参考指纹");
    if (Api.isAnthropic(Api.endpoint(cfg.baseUrl))) throw new Error("其他模型的参考比对需要 OpenAI 兼容接口，请使用对应的 /v1 地址");
    const bank = await loadBank();
    const core = TokenFingerprintCore;
    const cells = core.CELL_PRIORITY_ORDER.slice(0, 8);
    const total = cells.length * samplesPerCell;
    const progress = (done, state) => onProgress?.({ index: done, total, valid: done, target: total, state, engine: "one-token" });
    // Try only parameter rejections; auth, quota, rate limits and network errors stop immediately.
    const strategies = [{ thinking: { type: "disabled" } }, { reasoning: { enabled: false } }, { reasoning_effort: "none" }, {}];
    let adapter = null, requests = 0;
    for (const body of strategies) {
      progress(0, "检查推理参数");
      try {
        requests++;
        if (await call(cfg, model, cells[0], body, 16)) { adapter = body; break; }
      } catch (err) { if (err.status !== 400 && err.status !== 422) throw err; }
    }
    if (!adapter) throw new Error("无法在固定采样参数下获得短回答，本次不生成指纹结论");
    const jobs = cells.flatMap((cellId) => Array.from({ length: samplesPerCell }, () => cellId));
    for (let i = jobs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
    }
    const groups = new Map(cells.map((id) => [id, []]));
    for (let i = 0; i < jobs.length; i++) {
      const cellId = jobs[i];
      progress(i, "采样中");
      requests++;
      const text = await call(cfg, model, cellId, adapter, 16);
      groups.get(cellId).push({ ...core.normalizeAnswer(text, core.getTaskSpec(cellId).domain),
        arrivalIndex: i, latencyMs: 0, usage: null });
      progress(i + 1, "已收到");
    }
    const distributions = Object.fromEntries(cells.map((id) => [id, core.buildCellDistribution(id, groups.get(id), core.getTaskSpec(id).domain)]));
    const result = analyze(distributions, bank, model, requests, core.splitHalfJsd(groups));
    result.sampling_settings = { temperature: 1, max_tokens: 16, adapter, samples_per_cell: samplesPerCell };
    return result;
  }
  function analyze(cells, bank, claimed, requests = 0, splitHalf = null) {
    const core = TokenFingerprintCore;
    const results = references.map((id) => {
      const entry = bank.models[id];
      const referenceCells = Object.fromEntries(Object.entries(entry.cells).map(([key, cell]) => [key, { counts: cell.counts, validCount: cell.n }]));
      const { entries, meanJsd } = core.compareCellSets(cells, referenceCells);
      const comparison = core.buildComparisonResult(entries, meanJsd, bank.protocol !== core.PROBE_PROTOCOL);
      return { model: id, display_name: entry.model, family_name: id.split("/")[0], probability: null,
        jsd: meanJsd, comparison, collected_at: entry.collectedAt };
    }).sort((a, b) => (a.jsd ?? Infinity) - (b.jsd ?? Infinity));
    const own = results.find((r) => r.model === referenceId(claimed));
    const usable = results.find((r) => r.comparison.comparableCellCount >= 4);
    return { engine: "one-token", reference_only: true, coverage: "sample", method: "api", claimed,
      known: false, prediction: usable?.model || null, prediction_name: usable?.display_name || "样本不足",
      probability: null, family_probability: null, family_prediction_name: "",
      reference_model: own?.model, reference_comparison: own?.comparison,
      reference_source: bank.source, protocol: core.PROBE_PROTOCOL, reference_protocol: bank.protocol,
      built_at: String(own?.collected_at || "").slice(0, 10), model_count: references.length,
      used_outputs: Object.values(cells).reduce((sum, cell) => sum + cell.validCount, 0), target_outputs: 200,
      request_count: requests, split_half_jsd: splitHalf,
      results, diagnostics: [], errors: [], at: Engine.now(),
      sampling_cells: Object.values(cells).map((c) => ({ cell: c.cellId, valid: c.validCount, total: c.totalCount })) };
  }
  function resultHtml(section, esc) {
    if (section.coverage === "unsupported") return `<article class="panel mt16"><div class="panel-bd"><h3>此模型版本暂未覆盖</h3><p>${esc(section.claimed)} 暂无对应指纹基准，本次未发送模型请求。可继续使用能力测试与中转站功能检测。</p></div></article>`;
    const labels = { match: "与参考分布接近", mismatch: "与参考分布差异较大", uncertain: "参考比对不确定", insufficient: "有效样本不足" };
    const comp = section.reference_comparison || {};
    const distance = (n) => typeof n === "number" && Number.isFinite(n) ? n.toFixed(4) : "—";
    return `<article class="panel mt16 fingerprint-report fingerprint-inconclusive"><div class="panel-hd"><h3>模型指纹 · 参考比对</h3><span>示例基准 · 不作身份判定</span></div><div class="panel-bd">
      <h2>${esc(labels[comp.verdict] || labels.insufficient)}</h2>
      <p>宣称模型：${esc(section.claimed)}<br>对应示例：${esc(section.reference_model || "未提供")}<br>与对应示例的分布距离（JSD）：<strong>${distance(comp.meanJsd)}</strong>，越小越接近。</p>
      <p>有效短回答 ${esc(section.used_outputs ?? 0)} / ${esc(section.target_outputs ?? 200)}，可比维度 ${esc(comp.comparableCellCount ?? 0)} / 8。${comp.comparableCellCount < 4 ? "至少需要 4 个维度各有 10 份有效回答。" : ""}</p>
      <p class="trace-note">示例由 OpenRouter 采集，采样题目协议与本次不同，只能作参考；差异不能直接证明换模，相近也不能证明未掺水。仅适用于列出的模型版本，不能推广到整个模型家族。</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>示例模型</th><th>分布距离 JSD</th><th>可比维度</th></tr></thead><tbody>${(section.results || []).map((r) => `<tr><td>${esc(r.display_name || r.model)}</td><td>${distance(r.jsd)}</td><td>${esc(r.comparison?.comparableCellCount ?? 0)}</td></tr>`).join("")}</tbody></table></div>
      <p>采样设置：temperature=1，max_tokens=16；8 个维度各 25 次独立请求。${section.split_half_jsd > .25 ? "本轮前后样本分布差异偏大，建议同条件复测。" : ""}</p>
      <p class="trace-note">算法：<a href="https://github.com/ToseaAI/llm-fingerprint-detector" target="_blank" rel="noopener noreferrer">llm-fingerprint-detector</a>（MIT）；示例数据：Tomáš Bruckner，<a href="https://doi.org/10.5281/zenodo.21278557" target="_blank" rel="noopener noreferrer">Zenodo 数据集</a>（CC-BY-4.0）。采集日期 ${esc(section.built_at || "未提供")}。</p>
    </div></article>`;
  }
  return { referenceId, references, run, analyze, resultHtml };
})();
