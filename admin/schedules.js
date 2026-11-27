"use strict";

/* Batch creation stores independent schedules, using each station's own credentials. */
const AdminSchedules = {
  publicationLabel(plan) {
    return plan.publish_mode === "auto" ? "完成后直接公开" : "完成后待审核";
  },
  publicationField(plan, select) {
    return select("publish_mode", "报告发布方式", [["review", "完成后待审核"], ["auto", "完成后直接公开"]], plan.publish_mode || "review")
      + '<p class="tabs-note">直接公开会发布真实检测结果，低分也会公开；未公开站点的报告保留待审核。失败、取消的任务不会生成公开报告。</p>';
  },
  timingFields(plan, select, input, check, localValue) {
    const mode = plan.schedule_mode || "interval";
    return select("schedule_mode", "执行方式", [["interval", "按间隔重复"], ["once", "指定时间执行一次"], ["daily", "每天指定时刻"]], mode)
      + `<fieldset class="schedule-timing" data-schedule-timing="interval" ${mode !== "interval" ? "hidden disabled" : ""}>${input("interval_minutes", "检测间隔（分钟）", plan.interval_minutes ?? 360, "number", "最短 1 分钟；360 分钟 = 6 小时。", 'min="1" max="43200" step="1" required')}${input("first_run", "首次运行时间（选填）", localValue(plan.first_run), "datetime-local", "使用当前设备时区；留空则在一个间隔后首次运行，之后按间隔重复。")}</fieldset>`
      + `<fieldset class="schedule-timing" data-schedule-timing="once" ${mode !== "once" ? "hidden disabled" : ""}>${input("execution_at", "执行日期和时间", mode === "once" ? localValue(plan.first_run) : "", "datetime-local", "使用当前设备时区；到时只加入一次检测队列，随后自动停用计划。", "required")}</fieldset>`
      + `<fieldset class="schedule-timing" data-schedule-timing="daily" ${mode !== "daily" ? "hidden disabled" : ""}>${input("daily_time", "每天执行时刻（北京时间）", plan.daily_time || "", "time", "每天北京时间此时加入队列；当天已过则从明天开始。", "required")}</fieldset>`
      + check("enabled", "启用此检测计划", plan.enabled ?? true);
  },
  updateTiming(form) {
    const mode = form.elements.namedItem("schedule_mode")?.value || "interval";
    form.querySelectorAll("[data-schedule-timing]").forEach((group) => {
      group.hidden = group.disabled = group.dataset.scheduleTiming !== mode;
    });
  },
  timing(form) {
    const fields = new FormData(form);
    const mode = String(fields.get("schedule_mode") || "interval");
    if (mode === "daily") return { schedule_mode: mode, daily_time: String(fields.get("daily_time") || "") };
    const first = String(fields.get(mode === "once" ? "execution_at" : "first_run") || "");
    if (mode === "once" && !first) throw new Error("请选择执行日期和时间");
    const first_run = first ? new Date(first).toISOString() : null;
    return mode === "once" ? { schedule_mode: mode, first_run }
      : { schedule_mode: mode, first_run, interval_minutes: Number(fields.get("interval_minutes")) };
  },
  timingLabel(plan) {
    if (plan.schedule_mode === "once") return "指定时间 · 仅一次";
    if (plan.schedule_mode === "daily") return `每天 ${plan.daily_time}（北京时间）`;
    return `每 ${plan.interval_minutes >= 60 && plan.interval_minutes % 60 === 0 ? plan.interval_minutes / 60 + " 小时" : plan.interval_minutes + " 分钟"}`;
  },
  selected(stations, ids) { return stations.filter((station) => ids.includes(station.id)); },
  stationField(stations, ids, esc, task = false) {
    return `<div class="field"><label for="f-station_ids">中转站（可多选）</label><select id="f-station_ids" name="station_ids" multiple required>${stations.map((station) => `<option value="${esc(station.id)}" ${ids.includes(station.id) ? "selected" : ""}>${esc(station.name)}${station.has_key ? "" : "（未配置密钥）"}${station.enabled ? "" : "（已暂停）"}</option>`).join("")}</select><small>支持搜索、全选搜索结果；每个站点与所选模型分别创建独立${task ? "检测任务" : "计划"}，最多一次选择 100 家。</small></div>`;
  },
  modelList(value) { return [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter(Boolean))]; },
  modelSelect(name, label, options, selected, esc) {
    return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><select id="f-${esc(name)}" name="${esc(name)}" aria-label="${esc(label)}" multiple required>${options.map(([id,title]) => `<option value="${esc(id)}" ${selected.includes(id) ? "selected" : ""}>${esc(title)}</option>`).join("")}</select><small>支持多选、搜索、全选搜索结果与清空选择。</small></div>`;
  },
  selection(form, stations) {
    const read = (name) => [...(form.elements.namedItem(name)?.selectedOptions || [])].map((option) => option.value);
    return { mode: form.elements.namedItem("schedule_model_mode")?.value || "shared", shared: read("schedule_model"),
      models: Object.fromEntries(stations.map((station) => [station.id, read("station_model_" + station.id)])) };
  },
  modelFields(stations, ids, previous, select, esc, task = false) {
    const chosen = AdminSchedules.selected(stations, ids);
    const saved = previous ? AdminSchedules.modelList(previous.shared) : null;
    const models = [...new Set([...chosen.flatMap((station) => station.models), ...(saved || [])])];
    const coverage = (model) => chosen.filter((station) => station.models.includes(model)).length;
    models.sort((a,b) => coverage(b)-coverage(a) || a.localeCompare(b));
    const shared = saved || models.slice(0,1);
    const mode = previous?.mode === "separate" ? "separate" : "shared";
    const fields = select("schedule_model_mode", "模型设置", [["shared", "统一选择模型（可多选）"], ["separate", "按站点分别选择模型（可多选）"]], mode)
      + `<fieldset id="schedule-shared-model" class="schedule-model-group" ${mode === "shared" ? "" : "hidden disabled"}>${AdminSchedules.modelSelect("schedule_model", "统一检测模型（可多选）", models.map((model) => [model, `${model}（${coverage(model)}/${chosen.length} 家已登记）`]), shared, esc)}</fieldset><fieldset id="schedule-station-models" class="schedule-model-group schedule-station-models" ${mode === "separate" ? "" : "hidden disabled"}>${chosen.map((station) => {
        const value = previous?.models?.[station.id];
        const selected = value === undefined ? station.models.slice(0,1) : AdminSchedules.modelList(value);
        const available = [...new Set([...station.models, ...selected])];
        return AdminSchedules.modelSelect("station_model_" + station.id, station.name + "（模型可多选）", available.map((model) => [model, model + (station.models.includes(model) ? "" : "（本站未登记）")]), selected, esc);
      }).join("")}</fieldset>`;
    const perStation = Object.fromEntries(chosen.map((station) => [station.id, previous?.models?.[station.id] ?? station.models.slice(0,1)]));
    return fields + `<div id="schedule-model-hint" data-model-task="${task}">${AdminSchedules.selectionHint(stations, ids, { mode, shared, models: perStation }, esc, task)}</div>`;
  },
  updateModelMode(form) {
    const mode = form.elements.namedItem("schedule_model_mode")?.value || "shared";
    for (const [id, value] of [["schedule-shared-model", "shared"], ["schedule-station-models", "separate"]]) {
      const group = form.querySelector("#" + id);
      if (group) group.hidden = group.disabled = mode !== value;
    }
  },
  pairs(stations, ids, selection) {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("请选择 1–100 家中转站");
    const chosen = AdminSchedules.selected(stations, ids);
    if (chosen.length !== ids.length) throw new Error("中转站列表已变化，请刷新后重新选择");
    const unified = selection.mode ? selection.mode === "shared" : AdminSchedules.modelList(selection.shared).length > 0;
    const pairs = [], missing = [];
    for (const station of chosen) {
      const models = AdminSchedules.modelList(unified ? selection.shared : selection.models?.[station.id]);
      if (!models.length) throw new Error(unified ? "请选择至少一个统一检测模型" : `${station.name}：请选择至少一个检测模型`);
      for (const model of models) {
        if (!station.models.includes(model)) missing.push(`${station.name}：未登记${unified ? "统一" : "检测"}模型 ${model}`);
        else pairs.push({ station, model });
      }
    }
    if (missing.length) throw new Error(missing.join("；") + "，请先登记模型或按站点分别选择");
    if (pairs.length > 100) throw new Error(`将生成 ${pairs.length} 条，超过单批 100 条上限，请减少站点或模型数量`);
    return pairs;
  },
  selectionHint(stations, ids, selection, esc, task = false) {
    try {
      const pairs = AdminSchedules.pairs(stations, ids, selection);
      return `<p class="schedule-model-hint" role="status">已选 <strong>${ids.length}</strong> 家中转站，将创建 <strong>${pairs.length}</strong> 条独立${task ? "检测任务" : "计划"}（每个站点 × 每个所选模型各一条）。每条单独计入调用与 Token 用量，单批最多 100 条。</p>`;
    } catch (error) {
      return `<p class="schedule-model-hint schedule-model-warning" role="status">${esc(error.message)}；当前不能保存。</p>`;
    }
  },
  modelHint(stations, ids, models, esc) {
    return AdminSchedules.selectionHint(stations, ids, {mode:"shared", shared:models}, esc);
  },
  buildRuns(spec, stations, ids, selection) {
    const plans = AdminSchedules.build({ ...spec, name: "", enabled: true }, stations, ids, selection);
    return { runs: plans.schedules.map(({ name, enabled, ...run }) => run) };
  },
  build(spec, stations, ids, selection) {
    const pairs = AdminSchedules.pairs(stations, ids, selection);
    const multiModel = new Set(pairs.map(({model}) => model)).size > 1;
    return { schedules: pairs.map(({station, model}) => {
      if (spec.enabled && (!station.enabled || !station.has_key)) throw new Error(`${station.name}：请先启用站点并配置密钥，或取消勾选「启用此检测计划」`);
      const labels = [...(ids.length > 1 ? [station.name] : []), ...(multiModel ? [model] : [])];
      const suffix = labels.length ? " · " + Array.from(labels.join(" · ")).slice(0,80).join("") : "";
      const name = Array.from(spec.name).slice(0,100-Array.from(suffix).length).join("") + suffix;
      return { ...spec, name, station_id: station.id, model };
    }) };
  }
};
