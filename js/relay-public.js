/* 公开检测目录。domain 保留完整域名，不收录密钥、私有路径或原始回答。
   demo: true 为本地效果预览数据，列表、卡片和详情均明确标注。
   .example 域名为虚构示例；下面的时间、分数和逐项结果均非实测。 */
const RELAY_PUBLIC = (() => {
  const names = ["协议识别", "响应结构", "模型回显", "协议指纹", "流式响应", "输出控制", "上下文记忆", "系统指令", "工具调用", "多模态", "推理参数", "用量审计", "提示词缓存", "缓存与重放"];
  const checks = (overrides = {}) => names.map((name) => ({ name, status: "pass", detail: "返回结果符合本次测试预期。", ...overrides[name] }));
  const reports = [
    {
      id: "demo-clear", demo: true, domain: "api.clearstream.example", model: "gpt-4.1",
      time: "2026-11-08 14:30", level: "ok", title: "未见掺水", score: 100, runs: 2,
      summary: "关键协议、指令和用量检查通过；本次没有发现明显的请求改写信号。",
      findings: ["关键项目都通过", "提示词缓存未命中"],
      conditions: "OpenAI 兼容协议 · temperature 0 · 同一模型、同一组设置 · 连续检测 2 次",
      retest: "两次模拟结果一致。正式检测时仍需结合模型能力与指纹结果交叉判断。",
      checks: checks({ "提示词缓存": { status: "skip", detail: "返回了缓存字段，本次未命中；未命中不代表掺水。" } })
    },
    {
      id: "demo-caution", demo: true, domain: "gateway.cloudbridge.example", model: "claude-sonnet-4-5",
      time: "2026-11-08 13:15", level: "warn", title: "疑似掺水", score: 78, runs: 2,
      summary: "基础对话可以完成，但模型回显和输出限制存在差异，建议保持参数再次核对。",
      findings: ["模型回显不一致", "输出控制未生效"],
      conditions: "OpenAI 兼容协议 · temperature 0 · max_tokens 64 · 连续检测 2 次",
      retest: "模拟复测中输出限制问题再次出现，模型回显差异也可能来自中转别名映射，不能单凭它确认模型被替换。",
      checks: checks({
        "模型回显": { status: "warn", detail: "请求 claude-sonnet-4-5，响应模型字段为 claude-sonnet；需要确认是否为中转别名。" },
        "输出控制": { status: "fail", detail: "设置 max_tokens 64，模拟响应仍输出 192 tokens。" },
        "提示词缓存": { status: "skip", detail: "没有暴露缓存字段，不单独据此判断掺水。" }
      })
    },
    {
      id: "demo-alert", demo: true, domain: "relay.fastlane.example", model: "gpt-4.1",
      time: "2026-11-08 11:40", level: "bad", title: "明显掺水", score: 40, runs: 3,
      summary: "模拟报告出现系统指令失效、用量异常和重复响应信号，展示严重异常时的结果样式。",
      findings: ["系统指令未生效", "用量审计异常", "疑似响应重放"],
      conditions: "OpenAI 兼容协议 · temperature 0 · 每轮使用不同随机标记 · 连续检测 3 次",
      retest: "三轮模拟结果中均出现相同问题。这是界面演示，不代表任何实际中转站的服务质量。",
      checks: checks({
        "系统指令": { status: "fail", detail: "要求只返回指定随机标记，模拟响应返回了不相关的固定内容。" },
        "用量审计": { status: "fail", detail: "输入长度明显增加，但模拟的 prompt_tokens 持续为 1。" },
        "缓存与重放": { status: "fail", detail: "三次请求的随机标记不同，模拟响应文本却完全相同。" },
        "工具调用": { status: "skip", detail: "接口明确返回不支持；单独列为能力边界。" },
        "提示词缓存": { status: "skip", detail: "没有暴露缓存字段，不单独据此判断掺水。" }
      })
    }
  ];
  const [clear, caution, alert] = reports;
  const normal = { level: "normal", score: 90, baseline: 90, questions: 20, summary: "同一题组、相同设置下，本次能力分与参考基线一致。" };
  const degraded = { level: "degraded", score: 65, baseline: 90, questions: 20, summary: "同一题组、相同设置下，本次能力分低于参考基线 25 分，建议复测。" };
  clear.stationName = "清流 API";
  caution.stationName = "云桥中转";
  alert.stationName = "快线 API";
  clear.ability = { ...normal };
  caution.ability = { ...degraded };
  // 没有能力测试的报告保持未知，不能把协议异常直接算成降智。
  reports.push(
    { ...clear, id: "demo-clear-noon", time: "2026-11-08 12:10", model: "claude-sonnet-4-5", ability: undefined },
    { ...clear, id: "demo-clear-morning", time: "2026-11-08 09:20" },
    { ...caution, id: "demo-caution-retest", time: "2026-11-08 16:05", ability: { ...degraded, score: 70, summary: "相同条件复测得到 70 分，仍低于参考基线 20 分。" } },
    { ...clear, id: "demo-caution-gpt", domain: caution.domain, stationName: caution.stationName, time: "2026-11-08 10:30" },
    { ...alert, id: "demo-alert-retest", time: "2026-11-08 15:20", ability: { ...degraded, score: 55, summary: "同条件能力测试得到 55 分，低于参考基线 35 分。" } },
    { ...clear, id: "demo-clear-yesterday", time: "2026-11-07 17:10" },
    { ...clear, id: "demo-caution-yesterday", domain: caution.domain, stationName: caution.stationName, time: "2026-11-07 14:25" },
    { ...caution, id: "demo-alert-yesterday", domain: alert.domain, stationName: alert.stationName, time: "2026-11-07 11:00", ability: undefined }
  );
  // 补足目录与分页的本地预览；所有站点和检测结果仍为虚构。
  const extraStations = [
    { id: "starport", name: "星港 API", domain: "api.starport.example", base: clear, model: "gpt-4.1", time: "13:55", ability: normal },
    { id: "pinecone", name: "松果中转", domain: "relay.pinecone.example", base: caution, model: "deepseek-chat", time: "13:35" },
    { id: "aurora", name: "极光 API", domain: "api.aurora.example", base: clear, model: "gemini-2.5-pro", time: "12:55", ability: normal },
    { id: "voyager", name: "远航中转", domain: "gateway.voyager.example", base: alert, model: "claude-sonnet-4-5", time: "12:35", ability: degraded },
    { id: "pixelgate", name: "像素网关", domain: "api.pixelgate.example", base: caution, model: "gpt-4.1", time: "12:15", ability: degraded },
    { id: "orbit", name: "轨道 API", domain: "relay.orbit.example", base: alert, model: "deepseek-chat", time: "11:55" }
  ];
  for (const station of extraStations) {
    for (const [index, time] of [station.time, "09:10"].entries()) {
      const row = { ...station.base, id: `demo-${station.id}-${index + 1}`, stationName: station.name, domain: station.domain, model: station.model, time: "2026-11-08 " + time, ability: station.ability ? { ...station.ability } : undefined };
      if (row.level === "warn") row.checks = row.checks.map((check) => check.name === "模型回显" ? { ...check, detail: "模拟的请求模型与响应模型字段不一致，仍需排除中转别名映射。" } : check);
      reports.push(row);
    }
  }
  return reports;
})();
