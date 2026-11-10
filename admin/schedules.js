"use strict";

/* Batch creation stores independent schedules, using each station's own credentials. */
const AdminSchedules = {
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
