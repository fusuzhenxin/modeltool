"use strict";

const AdminBulk = {
  actions: {
    reports: [["published", "批量通过并公开"], ["draft", "批量撤回待审核"], ["rejected", "批量驳回"]],
    stations: [["run", "批量检测"], ["show", "批量公开"], ["hide", "批量隐藏"], ["enable", "允许检测"], ["disable", "暂停检测"], ["delete", "批量删除"]],
    schedules: [["enable", "批量启用"], ["disable", "批量暂停"], ["delete", "批量删除"]],
    jobs: [["cancel", "批量取消"], ["retry", "批量重试"]],
    announcements: [["enable", "批量启用"], ["disable", "批量停用"], ["pin", "批量置顶"], ["unpin", "取消置顶"], ["delete", "批量删除"]],
    ads: [["enable", "批量启用"], ["disable", "批量停用"], ["delete", "批量删除"]],
    proposals: [["scheduled", "设为已排期"], ["testing", "设为测试中"], ["completed", "设为已完成"], ["deferred", "暂不处理"], ["collecting", "恢复征集"], ["show", "批量公开"], ["hide", "批量隐藏"], ["pin", "批量置顶"], ["unpin", "取消置顶"]]
  },
  choose(selected, ids, checked) {
    if (checked && new Set([...selected, ...ids]).size > 100) throw new Error("一次最多选择 100 条，请分批处理");
    for (const id of ids) checked ? selected.add(id) : selected.delete(id);
  },
  prune(selected, rows) {
    const valid = new Set(rows.map((row) => row.id));
    for (const id of selected) if (!valid.has(id)) selected.delete(id);
  },
  table(head, rows, shown, selected, esc, table) {
    const all = shown.length && shown.every((row) => selected.has(row.id));
    const check = `<input type="checkbox" data-bulk-page aria-label="选择本页全部记录" ${all ? "checked" : ""}>`;
    return table([check, ...head], rows.map((html, i) => html.replace("<tr>", `<tr${selected.has(shown[i].id) ? ' class="bulk-selected"' : ""}><td class="bulk-check"><input type="checkbox" data-bulk-id="${esc(shown[i].id)}" aria-label="选择${esc(shown[i].name || shown[i].title || shown[i].model || "记录")}" ${selected.has(shown[i].id) ? "checked" : ""}></td>`)));
  },
  toolbar(kind, selected, total) {
    return `<div class="bulk-toolbar" aria-label="批量操作"><div class="bulk-selection"><strong>已选 <span id="bulk-count" aria-live="polite">${selected.size}</span> 条</strong><button class="text-btn" data-action="bulk-filter" ${!total ? "disabled" : ""}>${total > 100 ? "选择筛选结果前 100 条" : "全选筛选结果"}</button><button class="text-btn" data-action="bulk-clear" ${!selected.size ? "disabled" : ""}>清空</button><small>支持跨页选择 · 最多 100 条</small></div><div class="bulk-actions">${(AdminBulk.actions[kind] || []).map(([action, label]) => `<button type="button" class="btn small${action === "delete" ? " bulk-danger" : ""}" data-action="bulk-open" data-operation="${action}" ${!selected.size ? "disabled" : ""}>${label}</button>`).join("")}</div></div>`;
  },
  explanation(kind, action) {
    if (action === "delete") return "删除后无法恢复。有关联任务、计划或报告的中转站会跳过；删除定时计划只停止后续调度，已排队的任务需到任务记录取消。";
    if (kind === "reports") return action === "published" ? "审核通过的报告会公开到中转日报与站点档案。未公开站点的报告会跳过；检测原始结果保持不变。" : "报告会从公开页面移除，原始检测结果与历史记录保留。";
    if (kind === "jobs") return action === "retry" ? "只重试失败、取消或中断的任务，会创建新任务并使用站点专用密钥额度；已有同站模型在排队或运行时会跳过。" : "只取消排队或运行中的任务；运行中的任务在当前请求结束后停止。定时计划仍会继续调度，可到定时检测中暂停。";
    if (kind === "schedules") return action === "enable" ? "按原计划的模型、检测内容和时间配置启用；站点、模型或密钥配置不完整的计划会跳过。" : "暂停后不再调度新任务，已排队或运行的任务可到任务记录中取消。";
    if (kind === "stations") return ["show", "hide"].includes(action) ? "同时影响该站点及其报告在前台的可见性，检测设置不受影响。" : "调整站点是否允许检测，前台公开状态不受影响。暂停后运行中的任务会在当前请求结束后停止。";
    if (kind === "ads") return "只调整广告配置状态，前台广告位仍按当前站点设置保持暂停展示。";
    if (kind === "proposals") return "统一调整提案状态；评论、投票与已有处理说明保留，不会自动创建检测任务。";
    return "统一调整所选公告的状态，原有展示范围、定时生效时间与内容保留。";
  },
  result(result, esc) {
    if (!result) return "";
    const skipped = result.skipped || [];
    return `<div class="bulk-result" role="status"><strong>${esc(result.label)}：已处理 ${result.count} 条${skipped.length ? `，跳过 ${skipped.length} 条` : ""}</strong>${skipped.length ? `<details><summary>查看跳过原因</summary><ul>${skipped.map((item) => `<li><b>${esc(item.label)}</b>：${esc(item.reason)}</li>`).join("")}</ul></details>` : ""}</div>`;
  }
};
