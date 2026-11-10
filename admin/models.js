"use strict";

const AdminModels = (() => {
  function enhance(root, api) {
    const form = root.querySelector('form[data-kind="stations"]');
    if (!form) return;
    const field = form.querySelector('[name="models"]');
    const button = form.querySelector('[data-model-action="discover"]');
    const status = form.querySelector(".model-discovery-status");
    const panel = form.querySelector(".model-picker");
    const list = panel.querySelector(".model-picker-list");
    const search = panel.querySelector('input[type="search"]');
    const count = panel.querySelector(".model-picker-count");
    const apply = panel.querySelector('[data-model-action="apply"]');
    const selected = new Set();
    let models = [], ticket = 0;
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle("error", error); };
    const filtered = () => models.filter((id) => id.toLowerCase().includes(search.value.trim().toLowerCase()));
    function update() {
      count.textContent = `已选 ${selected.size} / 30`;
      apply.disabled = !selected.size;
    }
    function draw() {
      list.replaceChildren();
      const matches = filtered();
      for (const id of matches) {
        const label = document.createElement("label"); label.className = "model-picker-item";
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = selected.has(id);
        input.addEventListener("change", () => {
          if (input.checked && selected.size >= 30) {
            input.checked = false; say("最多登记 30 个模型，请先取消其他选择。", true); return;
          }
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
      button.disabled = false; button.textContent = "识别模型"; say("");
    }
    for (const name of ["base_url", "api_key", "protocol", "clear_key"]) {
      const input = form.elements.namedItem(name);
      if (input) { input.addEventListener("input", invalidate); input.addEventListener("change", invalidate); }
    }
    search.addEventListener("input", draw);
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-model-action]")?.dataset.modelAction;
      if (action === "clear") { selected.clear(); draw(); }
      if (action === "select") {
        const matches = filtered();
        for (const id of matches) { if (selected.size < 30) selected.add(id); }
        if (matches.some((id) => !selected.has(id))) say("最多登记 30 个模型，已选中当前结果中可加入的模型。", true);
        draw();
      }
      if (action === "apply") {
        field.value = [...selected].join("\n"); field.dispatchEvent(new Event("input", { bubbles: true }));
        panel.hidden = true; say(`已填入 ${selected.size} 个模型，保存中转站后生效。`);
      }
    });
    button.addEventListener("click", async () => {
      const base = form.elements.namedItem("base_url");
      if (!base.value.trim() || !base.reportValidity()) { say("请先填写有效的接口基础地址。", true); base.focus(); return; }
      const key = form.elements.namedItem("api_key").value;
      if (form.elements.namedItem("clear_key")?.checked) { say("已勾选移除密钥，请取消勾选后再识别。", true); return; }
      if (!key.trim() && !form.dataset.hasKey) { say("请先填写检测专用密钥。", true); form.elements.namedItem("api_key").focus(); return; }
      const current = ++ticket;
      button.disabled = true; button.textContent = "识别中…"; panel.hidden = true;
      say("正在读取接口提供的模型列表…");
      try {
        const result = await api("admin/stations/discover-models", "POST", {
          base_url: base.value.trim(), protocol: form.elements.namedItem("protocol").value,
          api_key: key || null, station_id: form.dataset.id || null
        });
        if (current !== ticket || !form.isConnected) return;
        models = result.models; selected.clear(); search.value = "";
        const existing = new Set(field.value.split(/[\n,，]+/).map((id) => id.trim()).filter(Boolean));
        for (const id of models) {
          if ((existing.size ? existing.has(id) : models.length <= 30) && selected.size < 30) selected.add(id);
        }
        say(`识别到 ${models.length} 个模型，请勾选后填入。${result.has_more ? "接口列表未完整返回，其余模型可手动补充。" : ""}`);
        draw(); panel.hidden = false;
      } catch (error) {
        if (current === ticket && form.isConnected) say(error.message, true);
      } finally {
        if (current === ticket && form.isConnected) { button.disabled = false; button.textContent = "重新识别"; }
      }
    });
  }
  return { enhance };
})();
