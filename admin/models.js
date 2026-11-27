"use strict";

const AdminModels = (() => {
  function mergeBinding(existing, bound, selected) {
    const models = [...new Set([...existing, ...selected])];
    const bindings = [...new Set([...bound, ...selected])];
    if (models.length > 30 || bindings.length > 30) throw new Error("合并后超过 30 个模型，请先移除不需要的模型，再绑定。");
    return { models, bindings };
  }
  function enhance(root, api) {
    const form = root.querySelector('form[data-kind="stations"]');
    if (!form) return;
    const field = form.elements.namedItem("models"), controllers = new Map();
    function setup(row) {
      if (controllers.has(row)) return controllers.get(row);
      const button = row.querySelector('[data-model-action="discover"]');
      const status = row.querySelector(".model-discovery-status"), panel = row.querySelector(".model-picker");
      const list = panel.querySelector(".model-picker-list"), search = panel.querySelector('input[type="search"]');
      const count = panel.querySelector(".model-picker-count"), apply = panel.querySelector('[data-model-action="apply"]');
      const selected = new Set();
      let models = [], ticket = 0;
      const say = (text, error = false) => { status.textContent = text; status.classList.toggle("error", error); };
      const filtered = () => models.filter((id) => id.toLowerCase().includes(search.value.trim().toLowerCase()));
      function update() { count.textContent = `已选 ${selected.size} / 30`; apply.disabled = !selected.size; }
      function draw() {
        list.replaceChildren();
        const matches = filtered();
        for (const id of matches) {
          const label = document.createElement("label"); label.className = "model-picker-item";
          const input = document.createElement("input"); input.type = "checkbox"; input.checked = selected.has(id);
          input.addEventListener("change", () => {
            if (input.checked && selected.size >= 30) { input.checked = false; say("最多选择 30 个模型，请先取消其他选择。", true); return; }
            if (input.checked) selected.add(id); else selected.delete(id);
            update();
          });
          const text = document.createElement("span"); text.textContent = id;
          label.append(input, text); list.append(label);
        }
        if (!matches.length) {
          const empty = document.createElement("p"); empty.className = "model-picker-empty"; empty.textContent = "没有匹配的模型"; list.append(empty);
        }
        update();
      }
      function invalidate() {
        ticket++; models = []; selected.clear(); panel.hidden = true; list.replaceChildren();
        button.disabled = false; button.textContent = "获取此 Key 的模型"; say("");
      }
      search.addEventListener("input", draw);
      search.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });
      async function act(action) {
        if (action === "clear") { selected.clear(); draw(); }
        if (action === "select") {
          const matches = filtered();
          for (const id of matches) { if (selected.size < 30) selected.add(id); }
          if (matches.some((id) => !selected.has(id))) say("最多选择 30 个模型，请分批选择需要的模型。", true);
          draw();
        }
        if (action === "apply") {
          try {
            const currentKey = AdminKeys.read(row);
            const merged = mergeBinding(AdminKeys.splitModels(field.value), currentKey.models, [...selected]);
            field.value = merged.models.join("\n");
            row.querySelector('[data-key-field="models"]').value = merged.bindings.join("\n");
            const scope = row.querySelector('[data-key-field="model_scope"]');
            scope.value = "bound";
            scope.dispatchEvent(new Event("change", { bubbles: true }));
            invalidate();
            form.dispatchEvent(new Event("keybindingschange"));
            say(`已绑定到「${currentKey.name}」，此 Key 共 ${merged.bindings.length} 个模型；本站共 ${merged.models.length} 个。保存中转站后生效。`);
          } catch (error) { say(error.message, true); }
        }
        if (action !== "discover") return;
        const key = AdminKeys.read(row);
        const base = key.base_url ? row.querySelector('[data-key-field="base_url"]') : form.elements.namedItem("base_url");
        if (!base.value.trim() || !base.reportValidity()) { say("请先填写有效的接口基础地址。", true); base.focus(); return; }
        if (!key.api_key && !key.id) { say("请先填写此 Key 的密钥。", true); return; }
        const current = ++ticket;
        button.disabled = true; button.textContent = "获取中…"; panel.hidden = true;
        say(`正在读取「${key.name}」可用的模型…`);
        try {
          const result = await api("admin/stations/discover-models", "POST", {
            base_url: base.value.trim(), protocol: key.protocol === "inherit" ? form.elements.namedItem("protocol").value : key.protocol,
            api_key: key.api_key, key_id: key.id, station_id: form.dataset.id || null
          });
          if (current !== ticket || !form.isConnected || !row.isConnected) return;
          models = result.models; selected.clear(); search.value = "";
          for (const id of models) {
            if ((key.models.length ? key.models.includes(id) : models.length <= 30) && selected.size < 30) selected.add(id);
          }
          say(`「${key.name}」获取到 ${models.length} 个模型，请勾选并绑定到此 Key。${result.has_more ? "接口列表未完整返回，其余模型可手动补充。" : ""}`);
          draw(); panel.hidden = false;
        } catch (error) {
          if (current === ticket && form.isConnected && row.isConnected) say(error.message, true);
        } finally {
          if (current === ticket && form.isConnected && row.isConnected) { button.disabled = false; button.textContent = "重新获取此 Key 的模型"; }
        }
      }
      const controller = { act, invalidate }; controllers.set(row, controller); return controller;
    }
    form.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-model-action]"), row = trigger?.closest(".station-key");
      if (row) return setup(row).act(trigger.dataset.modelAction);
    });
    const invalidateAll = () => {
      for (const [row, controller] of controllers) {
        controller.invalidate();
        if (!row.isConnected) controllers.delete(row);
      }
    };
    form.addEventListener("keyschange", () => {
      for (const [row, controller] of controllers) if (!row.isConnected) { controller.invalidate(); controllers.delete(row); }
    });
    for (const type of ["input", "change"]) form.addEventListener(type, (event) => {
      const row = event.target.closest?.(".station-key");
      if (row && event.target.matches("[data-key-field]")) controllers.get(row)?.invalidate();
      else if (event.target === form.elements.namedItem("base_url") || event.target === form.elements.namedItem("protocol")) invalidateAll();
    });
  }
  return { enhance, mergeBinding };
})();
