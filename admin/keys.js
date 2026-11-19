"use strict";

const AdminKeys = (() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const splitModels = (text) => [...new Set(String(text).split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean))];
  function row(key = {}) {
    return `<fieldset class="station-key" data-key-id="${esc(key.id || "")}"><legend>${key.id ? "已保存的 Key" : "新增 Key"}</legend><div class="station-key-head"><label class="check-field"><input type="checkbox" data-key-field="enabled" ${key.enabled !== false ? "checked" : ""}>参与检测</label><button type="button" class="text-btn danger" data-key-action="remove">删除此 Key</button></div><label class="field"><span>Key 名称</span><input data-key-field="name" value="${esc(key.name || "检测 Key")}" required maxlength="80" placeholder="例如 GPT 专用 / 备用额度"></label><label class="field"><span>${key.id ? "替换密钥" : "密钥"}</span><input type="password" data-key-field="api_key" autocomplete="new-password" maxlength="1000" ${key.id ? 'placeholder="留空保留已保存的密钥"' : 'required placeholder="sk-..."'}></label><label class="field"><span>限定模型（选填）</span><textarea data-key-field="models" rows="2" placeholder="每行一个模型 ID；留空作为通用 Key">${esc((key.models || []).join("\n"))}</textarea><small>只能填写下方模型 ID 列表中的模型。专属 Key 优先，同组 Key 按检测任务轮换。</small></label></fieldset>`;
  }
  function fields(station) {
    const keys = station.api_keys || (station.has_key ? [{ id: "legacy", name: "默认 Key", enabled: true, models: [] }] : []);
    return `<section class="station-keys" aria-label="检测专用密钥"><div class="station-key-heading"><h3>检测专用 Key</h3><button type="button" class="btn small" data-key-action="add">＋ 添加 Key</button></div><p class="tabs-note">最多 20 个。可按模型分配，也可配置多个通用 Key。每次检测固定使用一个 Key，下一次任务自动轮换。</p><div data-key-list>${keys.map(row).join("")}</div><p class="tabs-note" data-key-empty ${keys.length ? "hidden" : ""}>尚未配置 Key。点击「添加 Key」后填写。</p><div class="field"><label for="discovery-key">识别模型使用的 Key</label><select id="discovery-key" name="discovery_key" data-key-discovery></select></div></section>`;
  }
  const rows = (form) => [...form.querySelectorAll(".station-key")];
  function read(row) {
    const value = (name) => row.querySelector(`[data-key-field="${name}"]`);
    return { id: row.dataset.keyId || null, name: value("name").value.trim(),
      api_key: value("api_key").value.trim() || null, models: splitModels(value("models").value), enabled: value("enabled").checked };
  }
  const serialize = (form) => rows(form).map(read);
  function discovery(form) {
    const index = Number(form.querySelector("[data-key-discovery]").value);
    const key = rows(form)[index];
    return key ? read(key) : null;
  }
  function enhance(root) {
    const form = root.querySelector('form[data-kind="stations"]');
    if (!form) return;
    const list = form.querySelector("[data-key-list]");
    const picker = form.querySelector("[data-key-discovery]");
    function refresh() {
      const selected = picker.value;
      picker.replaceChildren();
      rows(form).forEach((element, index) => {
        const option = document.createElement("option");
        const key = read(element);
        option.value = String(index); option.textContent = key.name || `Key ${index + 1}`;
        picker.append(option);
      });
      if ([...picker.options].some((option) => option.value === selected)) picker.value = selected;
      picker.disabled = !picker.options.length;
      form.querySelector("[data-key-empty]").hidden = !!picker.options.length;
      form.querySelector('[data-key-action="add"]').disabled = picker.options.length >= 20;
    }
    form.addEventListener("click", (event) => {
      const action = event.target.closest("[data-key-action]")?.dataset.keyAction;
      if (action === "add" && rows(form).length < 20) {
        list.insertAdjacentHTML("beforeend", row()); refresh();
        rows(form).at(-1).querySelector('[data-key-field="name"]').focus();
      }
      if (action === "remove") { event.target.closest(".station-key").remove(); refresh(); }
      if (action) form.dispatchEvent(new Event("keyschange"));
    });
    form.addEventListener("input", (event) => {
      if (event.target.matches('[data-key-field="name"]')) refresh();
    });
    refresh();
  }
  return { fields, enhance, serialize, discovery, splitModels };
})();
