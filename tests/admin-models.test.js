"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element(value = "") {
  return {
    value, hidden: false, disabled: false, textContent: "", children: [], listeners: {},
    classList: { toggle() {} },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
    dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); },
    async fire(type, action) {
      for (const handler of this.listeners[type] || []) {
        await handler({ target: { closest: () => ({ dataset: { modelAction: action } }) } });
      }
    },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    reportValidity() { return true; }, focus() {}
  };
}

function setup(existing, response) {
  const field = element(existing.join("\n")), button = element(), status = element();
  const panel = element(), list = element(), search = element(), count = element(), apply = element();
  panel.querySelector = (selector) => ({ ".model-picker-list": list, 'input[type="search"]': search,
    ".model-picker-count": count, '[data-model-action="apply"]': apply }[selector]);
  const form = element(); form.isConnected = true; form.dataset = { id: "station-id" };
  const fields = { base_url: element("https://fixture.example/v1"), protocol: element("openai"), discovery_key: element("0") };
  form.elements = { namedItem: (name) => fields[name] };
  form.querySelector = (selector) => ({ '[name="models"]': field, '[data-model-action="discover"]': button,
    ".model-discovery-status": status, ".model-picker": panel }[selector]);
  const requests = [];
  const context = vm.createContext({ Event, document: { createElement: () => element() },
    root: { querySelector: () => form }, chosenKey: { id: "key-b", api_key: null },
    api: async (...args) => { requests.push(args); return response; } });
  for (const file of ["keys.js", "models.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../admin", file), "utf8"), context);
  }
  vm.runInContext("AdminKeys.discovery = () => chosenKey; AdminModels.enhance(root, api);", context);
  return { field, button, status, panel, form, requests };
}

test("识别使用所选 Key，填入时保留其他 Key 的模型并去重", async () => {
  const ui = setup(["claude-model"], { models: ["gpt-model", "new-model"], has_more: false });
  await ui.button.fire("click");
  const [url, method, request] = ui.requests[0];
  assert.equal(url, "admin/stations/discover-models"); assert.equal(method, "POST");
  assert.equal(request.key_id, "key-b"); assert.equal(request.api_key, null);
  assert.equal(request.station_id, "station-id");
  await ui.panel.fire("click", "select"); await ui.panel.fire("click", "apply");
  assert.equal(ui.field.value, "claude-model\ngpt-model\nnew-model");
  assert.equal(ui.panel.hidden, true);
  assert.match(ui.status.textContent, /已合并.*3/);
});

test("模型合并超过 30 个时保留原列表并提示调整", async () => {
  const existing = Array.from({ length: 30 }, (_, i) => "model-" + i);
  const ui = setup(existing, { models: ["new-model"], has_more: false });
  await ui.button.fire("click"); await ui.panel.fire("click", "select"); await ui.panel.fire("click", "apply");
  assert.equal(ui.field.value, existing.join("\n"));
  assert.equal(ui.panel.hidden, false);
  assert.match(ui.status.textContent, /超过 30/);
});

test("识别期间增删 Key 后，旧请求结果不能覆盖当前表单", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const ui = setup(["existing"], pending);
  const request = ui.button.fire("click");
  ui.form.dispatchEvent(new Event("keyschange"));
  finish({ models: ["stale-model"], has_more: false }); await request;
  assert.equal(ui.field.value, "existing");
  assert.equal(ui.panel.hidden, true); assert.equal(ui.button.disabled, false);
  assert.equal(ui.status.textContent, "");
});
