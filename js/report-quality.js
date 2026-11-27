/* Identity evidence, answer accuracy and protocol compatibility are independent. */
const ReportQuality = {
  identityLabels: { untested: "未测指纹", inconclusive: "暂无法判断", consistent: "指纹相符", mismatch: "疑似模型不符" },
  protocolTitles: { ok: "功能正常", warn: "部分功能异常", bad: "多项功能异常", unknown: "未测接口功能" },
  fingerprint(section, model = "") {
    let status = section ? "inconclusive" : "untested";
    if (section) {
      const p = section.probability, second = section.runner_up ?? section.results?.[1]?.probability;
      const numeric = v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
      if (section.known === true && section.claimed && (!model || section.claimed === model) && section.prediction &&
          section.method !== "manual" && Number.isInteger(section.used_outputs) && section.used_outputs >= 3 &&
          numeric(p) && numeric(second) && p >= .8 && p - second >= .2) {
        status = section.claimed === section.prediction ? "consistent" : "mismatch";
      }
    }
    return { status, label: ReportQuality.identityLabels[status] };
  },
  identity(report) {
    if (report.identity && ReportQuality.identityLabels[report.identity.status])
      return { ...report.identity, label: ReportQuality.identityLabels[report.identity.status] };
    return ReportQuality.fingerprint(report.sections?.find(s => s.kind === "trace"), report.model || report.claimed || "");
  },
  protocolTested(report) {
    if (report.protocol_tested != null) return !!report.protocol_tested;
    return !!report.sections?.some(s => s.kind === "relay") || ["protocol", "combined", "site_relay", "site_all"].includes(report.kind) ||
      (!report.kind && ["ok", "warn", "bad", "unknown"].includes(report.level));
  },
  protocolLevel(report) { return ReportQuality.protocolTested(report) ? report.level || "unknown" : "unknown"; },
  title(report) { return ReportQuality.protocolTested(report) ? ReportQuality.protocolTitles[report.level] || "功能情况暂无法判断" : report.title || "检测已完成"; },
  identityNote: "指纹只提供模型身份线索，不是鉴定证明。库外模型、回答不足或候选接近时暂无法判断；疑似不符需同条件复测。",
  ruleNote: "自动初筛要求宣称模型在库、3 份有效回答、第一候选占比至少 80% 且领先第二候选至少 20 个百分点。这是展示规则，候选占比不是模型真伪准确率。手动粘贴结果只供参考。"
};
