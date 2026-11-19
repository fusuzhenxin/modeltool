const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function api(fetch) {
  const context = vm.createContext({ fetch, TextDecoder, URL, location: { protocol: "https:", origin: "https://fixture.invalid" }, UI: { offlineForward: () => "offline", gatewayWait: () => "", platformStop: () => "" } });
  vm.runInContext(fs.readFileSync("js/engine.js", "utf8"), context);
  return vm.runInContext("Api", context);
}
const options = { baseUrl: "https://upstream.invalid/v1", apiKey: "fixture-key", model: "fixture-model", system: "test", user: "test", long: true };
const sse = (value) => "data: " + JSON.stringify(value) + "\n\n";
const envelope = (text, end = true, status = 200) => sse({ type: "status", status }) + sse({ type: "chunk", text }) + (end ? sse({ type: "end" }) : "");
function response(text, bytewise = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "X-ModelTool-Stream": "1", "Content-Type": "text/event-stream" } });
}

test("流式作品在结束前报告进度，逐字节接收不损坏中文和表情", async () => {
  const content = "<html>鹈鹕😀</html>", seen = [];
  const instance = api(async (_, request) => {
    const data = JSON.parse(request.body);
    assert.equal(data.payload.stream, true);
    assert.equal(data.streamResponse, true);
    return response(envelope(sse({ choices: [{ delta: { content } }] }) + "data: [DONE]\n\n"), true);
  });
  assert.equal(await instance.complete({ ...options, onProgress: ({ chars, content }) => seen.push([chars, content]) }), content);
  assert.equal(seen[0][1], content);
});

test("Anthropic SSE 与 JSON 兼容响应均能提取作品", async () => {
  const upstream = "event: content_block_delta\r\n" + sse({ type: "content_block_delta", delta: { type: "text_delta", text: "<html>作品</html>" } }) + sse({ type: "message_stop" });
  assert.equal(await api(async () => response(envelope(upstream))).complete({ ...options, baseUrl: "https://api.anthropic.com/v1/messages" }), "<html>作品</html>");
  assert.equal(await api(async () => response(envelope(JSON.stringify({ choices: [{ message: { content: "JSON作品" } }] })))).complete(options), "JSON作品");
});

test("上游未正常结束或本站流中断，拒绝将部分内容记成成功", async () => {
  const part = sse({ choices: [{ delta: { content: "<html>不完整" } }] });
  await assert.rejects(api(async () => response(envelope(part))).complete(options), /不完整/);
  await assert.rejects(api(async () => response(envelope(part, false))).complete(options), /连接已中断/);
});

test("502 给出可读提示，不自动重复调用", async () => {
  let calls = 0;
  await assert.rejects(api(async () => { calls++; return response(envelope("<!DOCTYPE html>Cloudflare", true, 502)); }).complete(options), /502.*上游/);
  assert.equal(calls, 1);
});

test("仅在明确拒绝 stream 参数后回退一次，保留长连接转发", async () => {
  const sent = [];
  const result = await api(async (_, request) => {
    const data = JSON.parse(request.body); sent.push(data);
    return sent.length === 1 ? response(envelope('{"error":{"message":"stream is not supported"}}', true, 400)) : response(envelope('{"choices":[{"message":{"content":"fallback"}}]}'));
  }).complete(options);
  assert.equal(result, "fallback");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].payload.stream, undefined);
  assert.equal(sent[1].streamResponse, true);
});

test("后台缓冲 SSE 复用前台解析器，流中错误不暴露原始正文", async () => {
  const instance = api(async () => ({ status: 200, ok: true, text: async () => sse({ choices: [{ delta: { content: "backend" }, finish_reason: "stop" }] }) }));
  assert.equal(await instance.complete(options), "backend");
  await assert.rejects(api(async () => response(envelope(sse({ error: { message: "secret-upstream-error" } })))).complete(options), (error) => !error.message.includes("secret-upstream-error") && /报错/.test(error.message));
});

test("收到部分作品就更新进度，无需等待最终响应", async () => {
  let output, closed = false;
  const instance = api(async () => new Response(new ReadableStream({ start(controller) {
    output = controller;
    controller.enqueue(new TextEncoder().encode(envelope(sse({ choices: [{ delta: { content: "部分作品" } }] }), false)));
  } }), { headers: { "X-ModelTool-Stream": "1" } }));
  const result = await instance.complete({ ...options, onProgress: ({ content }) => {
    assert.equal(closed, false);
    assert.equal(content, "部分作品");
    output.enqueue(new TextEncoder().encode(sse({ type: "chunk", text: "data: [DONE]\n\n" }) + sse({ type: "end" })));
    output.close(); closed = true;
  } });
  assert.equal(result, "部分作品");
});

test("明确拒绝 temperature 才省略重试，同接口模型后续直接兼容且保留其他参数", async () => {
  const sent = [];
  const instance = api(async (_, request) => {
    const body = JSON.parse(request.body); sent.push(body.payload);
    return sent.length === 1
      ? new Response(JSON.stringify({error:{param:"temperature",message:"Unsupported parameter: 'temperature' is not supported with this model."}}), {status:400})
      : new Response(JSON.stringify({choices:[{message:{content:"OK"}}]}));
  });
  const opts = {...options,long:false};
  assert.equal(await instance.complete(opts), "OK");
  assert.equal(await instance.complete(opts), "OK");
  assert.equal(sent.length, 3);
  assert.equal(sent[0].temperature, 0);
  const expected = {...sent[0]}; delete expected.temperature;
  assert.deepEqual(sent[1], expected);
  assert.deepEqual(sent[2], expected);
  assert.equal(opts.long, false);
  assert.match(instance.temperatureNotice, /默认采样/);
});

test("temperature 拒绝重复出现只重试一次，无关错误不重试", async () => {
  for (const [status,message,expectedCalls] of [
    [400,"temperature is not supported",2], [422,"Unsupported parameter: temperature",2],
    [400,"temperature must be between 0 and 2",1], [400,"Unsupported model",1],
    [401,"temperature is not supported",1], [429,"temperature is not supported",1]
  ]) {
    let calls = 0;
    await assert.rejects(api(async () => {calls++; return new Response(JSON.stringify({error:{message}}),{status});}).complete({...options,long:false}));
    assert.equal(calls,expectedCalls,message);
  }
  let calls = 0;
  await assert.rejects(api(async () => {calls++; throw new Error("network");}).complete({...options,long:false}));
  assert.equal(calls,1);
});

test("温度兼容与已有流式参数回退组合使用且每项有界", async () => {
  const sent=[];
  const instance=api(async (_,request)=>{
    const payload=JSON.parse(request.body).payload; sent.push(payload);
    if ("temperature" in payload) return response(envelope('{"error":{"message":"temperature is not supported"}}',true,400));
    if (payload.stream) return response(envelope('{"error":{"message":"stream is not supported"}}',true,400));
    return response(envelope('{"choices":[{"message":{"content":"OK"}}]}'));
  });
  assert.equal(await instance.complete(options),"OK");
  assert.equal(sent.length,3);
  assert.equal(sent[0].temperature,0.4);
  assert.equal(sent[1].temperature,undefined);
  assert.equal(sent[1].stream,true);
  assert.equal(sent[2].stream,undefined);
  assert.equal(sent[2].reasoning_effort,"low");
});
