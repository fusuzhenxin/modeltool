"use strict";

/* Batch creation stores independent schedules, using each station's own credentials. */
const AdminSchedules = {
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
    return `<div class="field"><label for="f-station_ids">中转站（可多选）</label><select id="f-station_ids" name="station_ids" multiple required>${stations.map((station) => `<option value="${esc(station.id)}" ${ids.includes(station.id) ? "selected" : ""}>${esc(station.name)}${station.has_key ? "" : "（未配置密钥）"}${station.enabled ? "" : "（已暂停）"}</option>`).join("")}</select><small>支持搜索、全选搜索结果；每个站点创建一条独立${task ? "检测任务" : "计划"}，最多一次选择 100 家。</small></div>`;
  },
  modelFields(stations, ids, previous, select, esc) {
    const chosen = AdminSchedules.selected(stations, ids);
    const models = [...new Set(chosen.flatMap((station) => station.models))];
    const coverage = (model) => chosen.filter((station) => station.models.includes(model)).length;
    models.sort((a, b) => coverage(b) - coverage(a) || a.localeCompare(b));
    const shared = models.includes(previous?.shared) ? previous.shared : models[0] || "";
    const mode = previous?.mode === "separate" ? "separate" : "shared";
    return select("schedule_model_mode", "模型设置", [["shared", "统一使用一个模型"], ["separate", "按站点分别选择模型"]], mode)
      + `<div id="schedule-shared-model" ${mode === "shared" ? "" : "hidden"}>${select("schedule_model", "统一检测模型", models.map((model) => [model, `${model}（${coverage(model)}/${chosen.length} 家已登记）`]), shared)}<div id="schedule-model-hint">${AdminSchedules.modelHint(stations, ids, shared, esc)}</div></div><div id="schedule-station-models" class="schedule-station-models" ${mode === "separate" ? "" : "hidden"}>${chosen.map((station) => {
        const saved = previous?.models?.[station.id];
        const model = station.models.includes(saved) ? saved : station.models[0];
        return select("station_model_" + station.id, station.name, station.models.map((model) => [model, model]), model);
      }).join("")}</div>`;
  },
  modelHint(stations, ids, model, esc) {
    const chosen = AdminSchedules.selected(stations, ids);
    if (!chosen.length) return '<p class="schedule-model-hint">请先选择中转站。</p>';
    const missing = chosen.filter((station) => !station.models.includes(model));
    return missing.length
      ? `<p class="schedule-model-hint schedule-model-warning" role="status">${missing.map((station) => esc(station.name)).join("、")} 未登记 ${esc(model)}，请先在中转站管理中识别或登记该模型，或切换为分别选择；当前不能保存。</p>`
      : `<p class="schedule-model-hint" role="status">已选 <strong>${chosen.length}</strong> 家中转站，统一检测 <strong>${esc(model)}</strong>。</p>`;
  },
  buildRuns(spec, stations, ids, selection) {
    const plans = AdminSchedules.build({ ...spec, name: "", enabled: true }, stations, ids, selection);
    return { runs: plans.schedules.map(({ name, enabled, ...run }) => run) };
  },
  build(spec, stations, ids, selection) {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("请选择 1–100 家中转站");
    const chosen = AdminSchedules.selected(stations, ids);
    if (chosen.length !== ids.length) throw new Error("中转站列表已变化，请刷新后重新选择");
    const unified = selection.mode ? selection.mode === "shared" : !!selection.shared;
    if (unified) {
      const missing = chosen.filter((station) => !station.models.includes(selection.shared));
      if (missing.length) throw new Error(`${missing.map((station) => station.name).join("、")}：未登记统一模型 ${selection.shared || "（未选择）"}，请先登记该模型或按站点分别选择`);
    }
    return { schedules: chosen.map((station) => {
      const model = unified ? selection.shared : selection.models[station.id];
      if (!station.models.includes(model)) throw new Error(`${station.name}：请选择已登记的检测模型`);
      if (spec.enabled && (!station.enabled || !station.has_key)) throw new Error(`${station.name}：请先启用站点并配置密钥，或取消勾选「启用此检测计划」`);
      const suffix = chosen.length > 1 ? " · " + station.name : "";
      const name = Array.from(spec.name).slice(0, 100 - Array.from(suffix).length).join("") + suffix;
      return { ...spec, name, station_id: station.id, model };
    }) };
  }
};
