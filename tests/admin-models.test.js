"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function element(value = "") {
  return { value, hidden: false, disabled: false, checked: true, textContent: "", children: [], listeners: {}, isConnected: true,
    classList: { toggle() {} }, addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
    dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); },
    async fire(type, target) { for (const handler of this.listeners[type] || []) await handler({ type, target }); },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    reportValidity() { return true; }, focus() {} };
}
function setup(existing = [], response = { models: ["gpt-model"], has_more: false }) {
  const fields = { models: element(existing.join("\n")), base_url: element("https://fixture.example/v1"), protocol: element("openai") };
  const form = element(); form.dataset = { id: "station-id" }; form.elements = { namedItem: (name) => fields[name] };
  const rows = ["GPT", "Claude"].map((name, i) => {
    const row = element(); row.dataset = { keyId: "key-" + i };
    const inputs = Object.fromEntries(Object.entries({ name, api_key: "", models: "", protocol: i ? "anthropic" : "inherit", model_scope: "bound", base_url: i ? "https://claude.example/v1" : "", enabled: "" }).map(([n,v]) => [n,element(v)]));
    const button = element(), status = element(), panel = element(), list = element(), search = element(), count = element(), apply = element();
    panel.querySelector = (s) => ({ ".model-picker-list":list, 'input[type="search"]':search, ".model-picker-count":count, '[data-model-action="apply"]':apply }[s]);
    row.querySelector = (s) => s.startsWith("[data-key-field=") ? inputs[s.match(/"([^"!]+)"/)[1]] : ({ '[data-model-action="discover"]':button, ".model-discovery-status":status, ".model-picker":panel }[s]);
    for (const input of Object.values(inputs)) { input.closest = () => row; input.matches = (s) => s === "[data-key-field]"; }
    return { row, inputs, button, status, panel };
  });
  const requests = [], context = vm.createContext({ Event, document: { createElement: () => element() }, root: { querySelector: () => form },
    api: async (...args) => { requests.push(args); return typeof response === "function" ? response(args) : response; } });
  for (const file of ["keys.js", "models.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname,"../admin",file),"utf8"),context);
  vm.runInContext("AdminModels.enhance(root, api)",context);
  async function click(index, action) {
    const trigger = { dataset: { modelAction: action }, closest: () => rows[index].row };
    await form.fire("click",{ closest: () => trigger });
  }
  return { fields, form, rows, requests, click, context };
}
test("每个 Key 独立获取和绑定模型，保留其他 Key 的模型", async () => {
  const ui = setup([], (args) => ({ models: args[2].key_id === "key-0" ? ["gpt-model"] : ["claude-model"], has_more: false }));
  await ui.click(0,"discover"); await ui.click(0,"apply");
  await ui.click(1,"discover"); await ui.click(1,"apply");
  assert.equal(ui.requests[0][2].key_id,"key-0"); assert.equal(ui.requests[0][2].protocol,"openai");
  assert.equal(ui.requests[1][2].key_id,"key-1"); assert.equal(ui.requests[1][2].protocol,"anthropic");
  assert.equal(ui.requests[1][2].base_url,"https://claude.example/v1");
  assert.equal(ui.requests[1][2].api_key,null); assert.equal(ui.requests[1][2].station_id,"station-id");
  assert.equal(ui.rows[0].inputs.models.value,"gpt-model"); assert.equal(ui.rows[1].inputs.models.value,"claude-model");
  assert.equal(ui.rows[1].inputs.model_scope.value,"bound");
  assert.equal(ui.fields.models.value,"gpt-model\nclaude-model");
  assert.match(ui.rows[1].status.textContent,/已绑定到「Claude」/);
});
test("新建未保存的 Claude Key 使用当前密钥和协议", async () => {
  const ui=setup(); ui.rows[1].row.dataset.keyId=""; ui.rows[1].inputs.api_key.value="sk-unsaved-fixture";
  await ui.click(1,"discover");
  assert.equal(ui.requests[0][2].api_key,"sk-unsaved-fixture"); assert.equal(ui.requests[0][2].key_id,null);
  assert.equal(ui.requests[0][2].protocol,"anthropic");
});
test("模型合并超过 30 个时两个模型列表均不修改", async () => {
  const existing = Array.from({length:30},(_,i) => "model-"+i), ui=setup(existing);
  ui.rows[0].inputs.models.value="model-0";
  await ui.click(0,"discover"); await ui.click(0,"select"); await ui.click(0,"apply");
  assert.equal(ui.fields.models.value,existing.join("\n")); assert.equal(ui.rows[0].inputs.models.value,"model-0");
  assert.equal(ui.rows[0].panel.hidden,false); assert.match(ui.rows[0].status.textContent,/超过 30/);
});
test("修改当前 Key 后，旧的获取请求不能覆盖绑定配置", async () => {
  let finish; const pending=new Promise((resolve)=>{finish=resolve;}); const ui=setup(["existing"],pending);
  const request=ui.click(0,"discover");
  ui.rows[0].inputs.api_key.value="replacement"; await ui.form.fire("input",ui.rows[0].inputs.api_key);
  finish({models:["stale-model"],has_more:false}); await request;
  assert.equal(ui.fields.models.value,"existing"); assert.equal(ui.rows[0].panel.hidden,true);
  assert.equal(ui.rows[0].button.disabled,false); assert.equal(ui.rows[0].status.textContent,"");
});
test("删除 Key 后旧请求不会复活面板，其他 Key 获取不受影响", async () => {
  let finish; const pending=new Promise(resolve=>{finish=resolve;});
  const ui=setup([],args=>args[2].key_id==="key-0" ? pending : {models:["claude-model"],has_more:false});
  const request=ui.click(0,"discover"); await ui.click(1,"discover");
  assert.equal(ui.rows[1].panel.hidden,false);
  ui.rows[0].row.isConnected=false; ui.form.dispatchEvent(new Event("keyschange"));
  finish({models:["stale"],has_more:false}); await request;
  assert.equal(ui.rows[0].panel.hidden,true); assert.equal(ui.fields.models.value,"");
});
test("路由预览只匹配绑定 Key，未绑定的新 Key 不变成通用 Key", () => {
  const ui=setup();
  const result=vm.runInContext(`AdminKeys.routes(["gpt","claude","unknown"],[
    {id:"new",name:"unbound",enabled:true,models:[],model_scope:"bound"},
    {id:"g",name:"GPT",enabled:true,models:["gpt"],model_scope:"bound"},
    {id:"c",name:"Claude",enabled:true,models:["claude"],model_scope:"bound"},
    {id:"off",name:"disabled",enabled:false,models:["gpt"]}
  ])`,ui.context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).map(r=>r.keys.map(k=>k.name)),[["GPT"],["Claude"],[]]);
});
test("绑定 GPT 模型时不会取消 Claude Key 正在获取的模型列表", async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const ui = setup([], args => args[2].key_id === "key-1" ? pending : { models: ["gpt-model"], has_more: false });
  const claudeRequest = ui.click(1, "discover");
  await ui.click(0, "discover"); await ui.click(0, "apply");
  finish({ models: ["claude-model"], has_more: false }); await claudeRequest;
  assert.equal(ui.rows[1].panel.hidden, false);
  await ui.click(1, "apply");
  assert.equal(ui.fields.models.value, "gpt-model\nclaude-model");
  assert.equal(ui.rows[0].inputs.models.value, "gpt-model");
  assert.equal(ui.rows[1].inputs.models.value, "claude-model");
});
test("旧通用 Key 仍作兜底，专属 Key 优先且同模型可轮换", () => {
  const ui=setup();
  const result=vm.runInContext(`AdminKeys.routes(["gpt","claude"],[
    {id:"old",name:"legacy",enabled:true,models:[]},
    {id:"a",name:"GPT A",enabled:true,models:["gpt"],model_scope:"bound"},
    {id:"b",name:"GPT B",enabled:true,models:["gpt"],model_scope:"bound"}
  ])`,ui.context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).map(r=>r.keys.map(k=>k.name)),[["GPT A","GPT B"],["legacy"]]);
});
