/* Shared rendering for the admin review and approved public site-test reports. */
const SiteReport = {
  percent(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? (value * 100).toFixed(2) : null; },
  trace(section, esc, context = {}) {
    const identity = ReportQuality.fingerprint(section, context.model || "");
    const probability = this.percent(section.probability);
    const messages = {consistent:"本次回答的指纹与宣称模型相符。",mismatch:"本次回答更接近其他候选模型，建议保持相同条件复测。",inconclusive:"已找到库内候选，现有线索不足以确认是否相符。"};
    const rows = (section.results || []).slice(0, 5);
    const candidates = rows.map((candidate, index) => {
      const share = this.percent(candidate.probability), similarity = this.percent(candidate.profile_similarity);
      return `<li class="fingerprint-candidate ${index === 0 ? 'is-leading' : ''}"><span class="fingerprint-rank">${index + 1}</span><div class="fingerprint-candidate-main"><div><strong>${esc(candidate.display_name || candidate.model || '未命名候选')}</strong><b>${share === null ? '—' : share + '%'}</b></div><div class="fingerprint-track" aria-hidden="true"><i style="width:${share || 0}%"></i></div></div><span class="fingerprint-similarity">轮廓相似度<b>${similarity === null ? '—' : similarity + '%'}</b></span></li>`;
    }).join('');
    return `<section class="site-test-result fingerprint-report fingerprint-${identity.status}" aria-label="模型指纹结果"><header class="fingerprint-heading"><div><span class="fingerprint-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 15a10 10 0 0 1 20 0m-16 3v-3a6 6 0 0 1 12 0v5m-8 5c1-3 1-6 1-10a2 2 0 0 1 4 0v5c0 3-.3 6-1 9M6 20c0 3-.5 5-1 7m5-5c0 2-.2 4-.7 6m13-4-.5 4M26 19v3"/></svg></span><h3>模型指纹结果</h3></div><span>模型身份线索</span></header><div class="fingerprint-body"><div class="fingerprint-primary"><div class="fingerprint-hero"><div><span class="fingerprint-state"><i></i>${esc(identity.label)}</span><span class="fingerprint-model-label">库内最接近的模型</span><h2>${esc(section.prediction_name || '暂无可用候选')}</h2><p>${esc(messages[identity.status] || messages.inconclusive)}</p></div><div class="fingerprint-share"><span>第一候选占比</span><strong>${probability === null ? '—' : probability + '<small>%</small>'}</strong><small>仅在当前指纹库内比较</small></div></div><dl class="fingerprint-facts">${context.model ? `<div><dt>宣称模型</dt><dd>${esc(context.model)}</dd></div>` : ''}<div><dt>有效回答</dt><dd>${esc(section.used_outputs ?? 0)} <small>份${section.used_outputs < 3 ? ' · 样本不足' : ''}</small></dd></div>${context.time ? `<div><dt>检测时间</dt><dd>${esc(context.time)}</dd></div>` : ''}</dl></div><div class="fingerprint-comparison"><div class="fingerprint-list-head"><h4>候选模型对比</h4><span>候选占比</span></div>${candidates ? `<ol class="fingerprint-candidates">${candidates}</ol>` : '<p class="fingerprint-empty">本次没有可展示的候选明细。</p>'}</div></div><p class="fingerprint-caution">候选占比不等于模型身份准确率；指纹相符也不能单独证明未掺水。</p><details class="fingerprint-method"><summary>结果说明与复测建议</summary><div><p>${esc(ReportQuality.identityNote)}</p><p>${esc(ReportQuality.ruleNote)}</p><p>${section.known ? '宣称模型在库内。' : '宣称模型不在指纹库内，可能属于库外模型。'}${section.used_outputs < 3 ? '有效回答不足 3 份，请补足样本后复测。' : ''}${section.method === 'manual' ? '本次回答为手动粘贴，未核验其来源。' : ''}复测请保持相同模型与设置，每题新开对话。</p></div></details><footer class="fingerprint-footer">指纹库日期 ${esc(section.built_at || '未提供')}<span>·</span>${esc(section.model_count ?? '—')} 个模型</footer></section>`;
  },
  render(sections, esc, context = {}) {
    return sections.filter((s) => s.kind !== "pelican").map((section) => {
      if (section.kind === "trace") return this.trace(section, esc, context);
      let body = "";
      if (Array.isArray(section.items)) {
        body = `<p>${section.items.filter((item) => item.correct).length} / ${section.count} 题正确 · ${{easy:"简单",medium:"中等",hard:"困难"}[section.difficulty] || ""} · ${esc(section.judgement?.title || "")}</p><details><summary>查看题目、作答与解析</summary>${section.items.map((item, index) => `<div class="site-question"><strong>${index + 1}. ${esc(item.stem)}</strong>${item.code ? `<pre>${esc(item.code)}</pre>` : ""}<ol type="A">${item.options.map((option) => `<li>${esc(option)}</li>`).join("")}</ol><p>模型作答：${item.choice == null ? "未识别" : "ABCD"[item.choice]} · 正确答案：${"ABCD"[item.answer]} · ${item.correct ? "正确" : "错误"}</p><p>${esc(item.explain)}</p></div>`).join("")}</details>`;
      } else if (section.kind === "relay") {
        body = `<p>${esc(ReportQuality.protocolTitles[section.level] || "功能情况暂无法判断")} · 协议与参数检查不能判断模型身份。</p><p>网站中转站测试原版的 ${section.checks.length} 个检查项，逐项结果见下方。</p>`;
      }
      return `<section class="site-test-result"><div class="site-test-heading"><h3>${esc(section.name)}</h3>${section.score == null ? "" : `<strong>${esc(section.score)} / 100</strong>`}</div>${body}</section>`;
    }).join("");
  }
};
