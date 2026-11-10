/* Shared rendering for the admin review and approved public site-test reports. */
const SiteReport = {
  render(sections, esc) {
    return sections.filter((s) => s.kind !== "pelican").map((section) => {
      let body = "";
      if (Array.isArray(section.items)) {
        body = `<p>${section.items.filter((item) => item.correct).length} / ${section.count} 题正确 · ${{easy:"简单",medium:"中等",hard:"困难"}[section.difficulty] || ""} · ${esc(section.judgement?.title || "")}</p><details><summary>查看题目、作答与解析</summary>${section.items.map((item, index) => `<div class="site-question"><strong>${index + 1}. ${esc(item.stem)}</strong>${item.code ? `<pre>${esc(item.code)}</pre>` : ""}<ol type="A">${item.options.map((option) => `<li>${esc(option)}</li>`).join("")}</ol><p>模型作答：${item.choice == null ? "未识别" : "ABCD"[item.choice]} · 正确答案：${"ABCD"[item.answer]} · ${item.correct ? "正确" : "错误"}</p><p>${esc(item.explain)}</p></div>`).join("")}</details>`;
      } else if (section.kind === "relay") {
        body = `<p>${esc(section.title)} · ${esc(section.summary)}</p><p>网站中转站测试原版的 ${section.checks.length} 个检查项，逐项结果见下方。</p>`;
      } else if (section.kind === "trace") {
        body = `<p>最接近：<strong>${esc(section.prediction_name)}</strong> · ${(section.probability * 100).toFixed(2)}% · 有效回答 ${section.used_outputs} 份</p><p class="site-report-note">候选占比只在当前指纹库内比较，不能单独证明模型身份。${section.known ? "宣称模型在库内。" : "宣称模型不在指纹库内，可能属于库外模型。"}</p><table><thead><tr><th>候选模型</th><th>候选占比</th><th>轮廓相似度</th></tr></thead><tbody>${section.results.slice(0, 5).map((candidate) => `<tr><td>${esc(candidate.display_name)}</td><td>${(candidate.probability * 100).toFixed(2)}%</td><td>${(candidate.profile_similarity * 100).toFixed(2)}%</td></tr>`).join("")}</tbody></table><p>指纹库日期 ${esc(section.built_at)} · ${section.model_count} 个模型${section.used_outputs < 3 ? " · 有效回答不足 3 份，请谨慎参考。" : ""}</p>`;
      }
      return `<section class="site-test-result"><div class="site-test-heading"><h3>${esc(section.name)}</h3>${section.score == null ? "" : `<strong>${esc(section.score)} / 100</strong>`}</div>${body}</section>`;
    }).join("");
  }
};
