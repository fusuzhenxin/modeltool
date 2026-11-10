const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function client() {
  const ctx = vm.createContext({URL});
  for (const file of ["engine", "probe"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + file + ".js"), "utf8"), ctx);
  return vm.runInContext("Probe", ctx);
}
function reply(tokens, finish = "length", content = "1,2,3,4,5") {
  const json = {choices:[{message:{content},finish_reason:finish}]};
  if (tokens !== undefined) json.usage = {completion_tokens:tokens};
  return {status:200,json,text:JSON.stringify(json)};
}
async function run(responses, url = "https://fixture.example/v1") {
  const requests = [], probe = client();
  const result = await probe.testOutputLimit(async (payload) => {
    requests.push(JSON.parse(JSON.stringify(payload)));
    assert(responses.length, "不应出现额外请求");
    return responses.shift();
  }, "fixture-model", url);
  return {requests, result, probe};
}

test("32 Token 上限使用新参数；用量、截断原因和请求值均保留", async () => {
  const {result,requests} = await run([reply(32)]);
  assert.equal(result.status,"pass");
  assert.equal(requests.length,1);
  assert.equal(requests[0].max_completion_tokens,32);
  assert.equal(requests[0].max_tokens,undefined);
  assert.equal(requests[0].temperature,undefined);
  assert.match(result.detail,/接口报告输出 32 Token，结束原因 length/);
});

test("只有明确拒绝参数名才回退旧参数；不同时发送两种上限", async () => {
  const rejected = {status:400,json:{error:{param:"max_completion_tokens",message:"Unsupported parameter"}},text:""};
  const {result,requests} = await run([rejected,reply(32)]);
  assert.equal(result.status,"pass");
  assert.equal(requests[1].max_tokens,32);
  assert.equal(requests[1].max_completion_tokens,undefined);
  assert.equal(result.attempts.length,2);
  assert.match(result.detail,/HTTP 400/);
});

test("两个参数明确拒绝时显示不支持，并限制回退次数", async () => {
  const {result,requests} = await run([
    {status:422,json:{error:{message:"Unknown parameter max_completion_tokens"}}},
    {status:400,json:{error:{message:"max_tokens is not supported"}}}
  ]);
  assert.equal(result.status,"skip");
  assert.equal(requests.length,2);
});

test("最小值限制与无关错误不会触发盲目参数切换", async () => {
  for (const response of [
    {status:400,json:{error:{param:"max_completion_tokens",message:"Must be >= 64"}}},
    {status:400,json:{error:{message:"Unsupported temperature"}}},
    {status:401,json:{error:{message:"Invalid API key"}}},
    {status:429,json:null}, {status:0,error:"network unavailable"}
  ]) {
    const {result,requests} = await run([response]);
    assert.equal(result.status,response.json?.error?.param ? "skip" : "unknown");
    assert.equal(requests.length,1);
  }
});

test("连续 32/64 两次上报超限才确认异常，即使声称 length 也不掩盖超限", async () => {
  const {result,requests} = await run([reply(626,"stop"),reply(700)]);
  assert.equal(result.status,"fail");
  assert.deepEqual(requests.map(p=>p.max_completion_tokens),[32,64]);
  assert.match(result.detail,/两次返回用量均超出/);
  assert.equal(result.attempts[0].tokens,626);
});

test("首次超限而复测正常、拒绝或无证据时不确认异常", async () => {
  for (const second of [reply(64),reply(undefined,"stop"),{status:400,json:{error:{param:"max_completion_tokens",message:"Invalid value"}}}]) {
    const {result,requests} = await run([reply(626,"stop"),second]);
    assert.equal(result.status,"unknown");
    assert.equal(requests.length,2);
    assert.match(result.detail,/复测未能重复确认/);
  }
});

test("短回答、空回答与推理耗尽预算不能伪装为通过", async () => {
  for (const response of [reply(1,"stop","A"),reply(32,"length",""),reply(undefined,"stop","短回答"),reply(0,"length","1")]) {
    const {result,requests} = await run([response]);
    assert.equal(result.status,"unknown");
    assert.equal(requests.length,1);
  }
});

test("缺用量但明确截断且有可见输出时可通过，并说明缺用量", async () => {
  const {result} = await run([reply(undefined)]);
  assert.equal(result.status,"pass");
  assert.match(result.detail,/用量缺失或无效/);
});

test("无效或冲突用量不能作为通过证据", async () => {
  const conflict=reply(32);conflict.json.usage.output_tokens=40;
  for (const response of [reply(-1),reply("32"),reply(1.2),conflict]) {
    const {result} = await run([response]);
    assert.equal(result.status,"unknown");
  }
});

test("Anthropic 使用 max_tokens 和 stop_reason，并核对 output_tokens", async () => {
  const response={status:200,json:{type:"message",content:[{type:"text",text:"1,2,3"}],stop_reason:"max_tokens",usage:{output_tokens:32}}};
  const {result,requests} = await run([response],"https://fixture.example/v1/messages");
  assert.equal(requests[0].max_tokens,32);
  assert.equal(requests[0].max_completion_tokens,undefined);
  assert.equal(result.status,"pass");
  assert.equal(result.attempts[0].finish,"max_tokens");
});

test("接口异常或取消会向外传播，不能吞掉后继续请求", async () => {
  const probe=client();let requests=0;
  await assert.rejects(probe.testOutputLimit(async()=>{requests++;throw new Error("cancelled");},"fixture","https://fixture.example/v1"),/cancelled/);
  assert.equal(requests,1);
});

test("输出控制结果不改变掺水评分，其他九项原扣分和等级规则保持一致", () => {
  const probe=client();
  const amounts={echo:35,protocol:20,shape:15,system:15,memory:15,stream:10,tools:10,usage:8,replay:8};
  const clean=Object.fromEntries(probe.checks.map(c=>[c.id,{status:"pass",detail:"fixture"}]));
  for (const limitStatus of ["fail","skip","unknown"]) {
    const verdict=probe.evaluate({items:{...clean,limit:{status:limitStatus,detail:"test"}}});
    assert.equal(verdict.score,100);assert.equal(verdict.level,"ok");
    assert.match(verdict.summary,/兼容性/);
    assert.doesNotMatch(verdict.summary,/输出限制都按原样生效/);
    assert(verdict.findings.some(f=>f.text.includes("不计入掺水评分")));
    for (const [id,amount] of Object.entries(amounts)) {
      const original=probe.evaluate({items:{...clean,[id]:{status:"fail"}}});
      const changed=probe.evaluate({items:{...clean,[id]:{status:"fail"},limit:{status:limitStatus}}});
      assert.equal(original.score,100-amount,id);
      assert.equal(changed.score,original.score,id);
      assert.equal(changed.level,original.level,id);
    }
  }
});
