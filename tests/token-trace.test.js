const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');
const samples = JSON.parse(fs.readFileSync(path.join(root, 'data/token-reference-samples.json')));
const modelBank = JSON.parse(fs.readFileSync(path.join(root, 'data/trace-bank.json')));
function setup(respond) {
  const calls = [], storage = new Map();
  const ctx = vm.createContext({ crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    URL, URLSearchParams, Uint32Array, btoa, atob, escape, unescape,
    location: {protocol:'http:',origin:'http://fixture.invalid'},
    sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    Store: { api: () => ({ baseUrl:'https://fixture.invalid/v1',apiKey:'secret-test-value',modelOverride:'' }) },
    fetch: async (url, opts) => {
      if (url.startsWith('data/')) return {ok:true,json:async () => url.includes('token-reference') ? samples : modelBank};
      const body = JSON.parse(opts.body); calls.push(body);
      const r = respond ? respond(body, calls.length) : {status:200, content:'7'};
      return {ok:r.status===200,status:r.status,text:async () => JSON.stringify(r.status===200 ?
        {choices:[{message:{content:r.content}}]} : {error:{message:'sensitive-upstream-secret-test-value'}})};
    }, UI: {esc:v=>String(v ?? '').replace(/</g,'&lt;'), icon:()=>''},
    document: {getElementById:()=>null}
  });
  for (const file of ['report-quality','data','engine','vendor/modeltrace-core','vendor/token-fingerprint-core','token-trace','trace','poster','site-report'])
    vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),ctx);
  return {...vm.runInContext('({Trace,TokenTrace,TokenFingerprintCore,ModelTraceCore,ReportQuality,Poster,SiteReport})',ctx),calls,storage};
}
test('按精确版本路由，GPT/Claude 不借用单词示例，未知版本不花费模型请求', async () => {
  const {Trace,TokenTrace,calls} = setup();
  assert.equal(modelBank.models.length,22);
  assert.equal(TokenTrace.referenceId('google/gemini-2.5-flash'),'google/gemini-2.5-flash');
  for (const id of ['gpt-4o','claude-sonnet-4.5','kimi-k3.1','qwen3-max','gemini-3-pro','glm-5','grok-4']) {
    assert.equal(TokenTrace.referenceId(id),null);
  }
  const result = await Trace.run('kimi-k3.1');
  assert.equal(result.coverage,'unsupported');
  assert.equal((await Trace.run('gpt-4o')).coverage,'unsupported');
  assert.equal(calls.length,0);
});
test('模型选项与两个指纹库同步，新增 GPT 靠前且示例版本可直接选择', async () => {
  const { Trace, TokenTrace } = setup();
  await Trace.loadBank();
  const options = Trace.models();
  const ids = options.map(m => m.id);
  assert.equal(ids.length,29);
  assert.equal(new Set(ids).size,29);
  assert.equal(ids[0],'gpt-6.2-astra');
  for (const model of modelBank.models) assert.ok(ids.includes(model.id),model.id);
  for (const ref of TokenTrace.references) {
    const option=options.find(m => m.id===ref.slice(ref.indexOf('/')+1));
    assert.ok(option,ref); assert.match(option.name,/参考比对/);
  }
  assert.ok(!ids.includes('kimi-k3.1-pro'));
});
test('单词采样沿用代理、固定协议与调用量，不保存密钥且不产生正式身份结论', async () => {
  const {Trace,TokenTrace,calls,storage,ReportQuality,Poster,SiteReport} = setup(body => {
    const p = body.payload.messages[1].content;
    return {status:200,content:/color|颜色/.test(p)?'blue':/animal/.test(p)?'cat':/letter/.test(p)?'A':/coin|Toss/.test(p)?'heads':'7'};
  });
  const progress=[];
  const result = await Trace.run('deepseek-chat',p=>progress.push(p));
  assert.equal(result.engine,'one-token'); assert.equal(result.reference_only,true);
  assert.equal(calls.length,201); assert.equal(result.request_count,201);
  assert.equal(result.reference_comparison.protocolMismatch,true);
  assert.equal(result.results.length,7); assert.equal(result.probability,null);
  assert.ok(calls.every(c=>c.payload.temperature===1 && c.payload.max_tokens===16 && c.payload.model==='deepseek-chat'));
  assert.equal(progress.at(-1).valid,200);
  assert.equal(ReportQuality.fingerprint(result).status,'inconclusive');
  assert.ok(![...storage.values()].join('').includes('secret-test-value'));
  const report=Poster.fromTrace(result), shared=Poster.unpack(Poster.pack(report));
  assert.equal(shared.view.engine,'one-token'); assert.equal(shared.view.reference_only,true);
  assert.equal(shared.view.reference_comparison.meanJsd,result.reference_comparison.meanJsd);
  assert.equal(shared.title,'暂无法判断');
  for (const html of [TokenTrace.resultHtml(shared.view,String),SiteReport.trace(result,String)]) {
    assert.match(html,/参考比对/); assert.match(html,/不作身份判定/); assert.match(html,/CC-BY-4.0/);
    assert.doesNotMatch(html,/第一候选占比|有效回答.*\/3/);
  }
});
test('鉴权、限流、网络错误立即停止；参数拒绝最多尝试四种，不删除温度', async () => {
  for (const status of [401,403,429,500]) {
    const {Trace,calls}=setup(()=>({status}));
    await assert.rejects(Trace.run('deepseek-chat'),new RegExp('HTTP '+status));
    assert.equal(calls.length,1);
  }
  const {Trace,calls}=setup(()=>({status:400}));
  await assert.rejects(Trace.run('deepseek-chat'),/固定采样参数/);
  assert.equal(calls.length,4);
  assert.ok(calls.every(c=>c.payload.temperature===1));
});
test('拒绝归因和未知概率穿过分享摘要，不能因候选占比高变成相符', () => {
  const {Poster,ReportQuality} = setup();
  const payload={engine:'modeltrace-v6',claimed:'gpt-5.4',known:true,prediction:'gpt-5.4',prediction_name:'GPT 5.4',
    probability:.99,used_outputs:3,decision:'reject',accepted_model:null,unknown_probability:.9,
    results:[{model:'gpt-5.4',probability:.99},{model:'other',probability:.01}],diagnostics:[]};
  const shared=Poster.unpack(Poster.pack(Poster.fromTrace(payload)));
  assert.equal(shared.view.decision,'reject'); assert.equal(shared.view.unknown_probability,.9);
  assert.equal(ReportQuality.fingerprint(shared.view).status,'inconclusive');
});
test('样本不足时保留可比维度，不能把未覆盖维度当作低距离', () => {
  const {TokenTrace}=setup();
  const result=TokenTrace.analyze({'random-color:en':{cellId:'random-color:en',counts:{blue:1},validCount:1,totalCount:25}},samples,'deepseek-chat');
  assert.equal(result.reference_comparison.verdict,'insufficient');
  assert.equal(result.reference_comparison.meanJsd,null);
  assert.equal(result.prediction,null);
});
