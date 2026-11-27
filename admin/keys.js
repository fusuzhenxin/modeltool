"use strict";

const AdminKeys = (() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[c]));
  const splitModels = (text) => [...new Set(String(text).split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean))];
  const option = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
  function row(key = {}) {
    const scope = key.model_scope || (key.id ? "all" : "bound");
    return `<fieldset class="station-key" data-key-id="${esc(key.id || "")}"><legend>${key.id ? "已保存的 Key" : "新增 Key"}</legend>
      <div class="station-key-head"><label class="check-field"><input type="checkbox" data-key-field="enabled" ${key.enabled !== false ? "checked" : ""}>参与检测</label><button type="button" class="text-btn danger" data-key-action="remove">删除此 Key</button></div>
      <label class="field"><span>Key 名称</span><input data-key-field="name" value="${esc(key.name || "检测 Key")}" required maxlength="80" placeholder="例如 GPT 专用 / Claude 专用"></label>
      <label class="field"><span>${key.id ? "替换密钥" : "密钥"}</span><input type="password" data-key-field="api_key" autocomplete="new-password" maxlength="1000" ${key.id ? 'placeholder="留空保留已保存的密钥"' : 'required placeholder="sk-..."'}></label>
      <div class="field-row"><label class="field"><span>此 Key 的接口协议</span><select data-key-field="protocol" aria-label="此 Key 的接口协议">${[["inherit", "使用站点默认协议"], ["openai", "OpenAI 兼容"], ["anthropic", "Anthropic Messages"]].map(([v,l]) => option(v,l,key.protocol || "inherit")).join("")}</select></label>
      <label class="field"><span>模型使用范围</span><select data-key-field="model_scope" aria-label="模型使用范围">${option("bound", "仅检测已绑定模型（推荐）", scope)}${option("all", "通用兜底 Key", scope)}</select></label></div>
      <details class="key-connection" ${key.base_url ? "open" : ""}><summary>独立接口地址（可选）</summary><label class="field"><span>此 Key 的接口地址</span><input type="url" data-key-field="base_url" maxlength="500" value="${esc(key.base_url || "")}" placeholder="留空使用站点基础地址"><small>GPT 和 Claude 使用不同接口地址时在这里设置。</small></label></details>
      <div class="model-discovery-head"><strong>绑定模型</strong><button type="button" class="btn small" data-model-action="discover">获取此 Key 的模型</button></div>
      <label class="field"><textarea aria-label="此 Key 绑定的模型" data-key-field="models" rows="3" placeholder="点击上方获取后勾选，或每行手动填写一个模型 ID">${esc((key.models || []).join("\n"))}</textarea><small>检测按模型匹配 Key；同一模型绑定多个 Key 时按任务轮换。手动新增的模型会同步到本站模型列表。</small></label>
      <p class="key-scope-note tabs-note"></p><div class="model-discovery-status" role="status" aria-live="polite"></div>
      <section class="model-picker" aria-label="选择此 Key 的模型" hidden><input type="search" placeholder="搜索此 Key 的模型…" aria-label="搜索此 Key 的模型"><div class="model-picker-toolbar"><span class="model-picker-count"></span><button type="button" class="text-btn" data-model-action="select">选择搜索结果</button><button type="button" class="text-btn" data-model-action="clear">清空选择</button></div><div class="model-picker-list"></div><div class="model-picker-foot"><small>仅绑定到当前 Key，保留其他 Key 的配置。</small><button type="button" class="btn primary small" data-model-action="apply">添加并绑定所选模型</button></div></section>
    </fieldset>`;
  }
  function fields(station) {
    const keys = station.api_keys || (station.has_key ? [{ id: "legacy", name: "默认 Key", enabled: true, models: [] }] : []);
    return `<section class="station-keys" aria-label="检测专用密钥"><div class="station-key-heading"><h3>检测专用 Key 与模型</h3><button type="button" class="btn small" data-key-action="add">＋ 添加 Key</button></div><p class="tabs-note">一个中转站可同时配置 GPT、Claude 等多组 Key，最多 20 个。每张卡片独立获取、绑定模型，可使用不同协议与地址。保存后手动检测、批量检测、定时计划均按相同规则匹配。</p><div data-key-list>${keys.map(row).join("")}</div><p class="tabs-note" data-key-empty ${keys.length ? "hidden" : ""}>尚未配置 Key。点击「添加 Key」后填写。</p></section>`;
  }
  const rows = (form) => [...form.querySelectorAll(".station-key")];
  function read(row) {
    const value = (name) => row.querySelector(`[data-key-field="${name}"]`);
    return { id: row.dataset.keyId || null, name: value("name").value.trim(),
      api_key: value("api_key").value.trim() || null, models: splitModels(value("models").value), enabled: value("enabled").checked,
      model_scope: value("model_scope").value, protocol: value("protocol").value, base_url: value("base_url").value.trim() };
  }
  const serialize = (form) => rows(form).map(read);
  function routes(models, keys) {
    const active = keys.filter((key) => key.enabled && (key.id || key.api_key));
    return models.map((model) => {
      const bound = active.filter((key) => key.models.includes(model));
      return { model, keys: bound.length ? bound : active.filter((key) => !key.models.length && (key.model_scope || "all") === "all"), fallback: !bound.length };
    });
  }
  function enhance(root) {
    const form = root.querySelector('form[data-kind="stations"]');
    if (!form) return;
    const list = form.querySelector("[data-key-list]"), field = form.elements.namedItem("models");
    function refresh() {
      const elements = rows(form), keys = elements.map(read);
      form.querySelector("[data-key-empty]").hidden = !!elements.length;
      form.querySelector('[data-key-action="add"]').disabled = elements.length >= 20;
      elements.forEach((element, i) => {
        const key = keys[i], note = element.querySelector(".key-scope-note");
        const general = key.model_scope === "all" && !key.models.length;
        note.textContent = general ? "通用兜底：未绑定专属 Key 的模型都可能使用此 Key。GPT / Claude 权限不同的 Key 请分别绑定模型。" : key.models.length ? `已绑定 ${key.models.length} 个模型。` : "尚未绑定模型，此 Key 暂不参与检测。请获取模型并勾选绑定。";
        note.classList.toggle("key-warning", general);
      });
      const target = form.querySelector("[data-model-routes]");
      if (!target) return;
      const mapping = routes(splitModels(field.value), keys);
      target.innerHTML = mapping.length ? `<div class="key-route-head"><span>检测模型</span><span>匹配使用的 Key</span></div>${mapping.map((r) => `<div class="key-route-row ${!r.keys.length || r.fallback ? "key-route-warning" : ""}"><strong>${esc(r.model)}</strong><span>${r.keys.length ? r.keys.map((key) => esc(key.name || "未命名 Key")).join(" / ") + (r.fallback ? "（通用兜底）" : "") + (r.keys.length > 1 ? " · 按任务轮换" : "") : "未配置可用 Key，无法检测"}</span></div>`).join("")}` : '<p class="tabs-note">绑定模型后，在这里核对每个模型使用的 Key。</p>';
    }
    form.addEventListener("click", (event) => {
      const action = event.target.closest("[data-key-action]")?.dataset.keyAction;
      if (action === "add" && rows(form).length < 20) {
        list.insertAdjacentHTML("beforeend", row()); refresh();
        AdminSelect.enhance(root);
        rows(form).at(-1).querySelector('[data-key-field="name"]').focus();
      }
      if (action === "remove") { event.target.closest(".station-key").remove(); refresh(); }
      if (action === "add" || action === "remove") form.dispatchEvent(new Event("keyschange"));
    });
    form.addEventListener("input", (event) => {
      if (event.target.matches('[data-key-field="models"]')) {
        const merged = splitModels([field.value, event.target.value].join("\n"));
        field.value = merged.join("\n");
      }
      refresh();
    });
    form.addEventListener("change", refresh);
    form.addEventListener("keyschange", refresh);
    form.addEventListener("keybindingschange", refresh);
    refresh();
  }
  return { fields, enhance, serialize, read, rows, routes, splitModels };
})();
