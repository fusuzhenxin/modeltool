const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function run(cacheStatus = 200) {
  const context = vm.createContext({URL,
    Store: {api: () => ({baseUrl: 'https://fixture.example/v1'}), saveBasicReport() {}},
    DATA: {model: () => ({name: 'model'})}, Engine: {now: () => ''},
    Poster: {note() {}, hostOf: () => '', ensureButtons() {}},
    document: {getElementById: () => null}
  });
  for (const file of ['engine', 'probe']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
  }
  const probe = vm.runInContext('Probe', context), requests = [];
  probe.paint = () => {};
  probe.call = async payload => {
    const cache = payload.messages[0].content === '请忽略这段重复前缀。'.repeat(80);
    if (cache) requests.push(JSON.parse(JSON.stringify(payload)));
    const cap = payload.max_tokens ?? payload.max_completion_tokens;
    const status = cache && cap < 16 ? 400 : cache ? cacheStatus : 200;
    const json = status === 200
      ? {model: 'm', choices: [{message: {content: 'OK'}, finish_reason: 'stop'}], usage: {completion_tokens: 2}}
      : {error: {message: status === 400 ? "Invalid 'max_output_tokens': expected a value >= 16" : 'Service unavailable'}};
    return {status, json, text: JSON.stringify(json), headers: {}};
  };
  return {report: await probe.run('m'), requests};
}

test('缓存和重放使用满足 16 Token 下限的相同请求，不产生参数误判', async () => {
  const {report, requests} = await run();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.ok(requests.every(r => (r.max_tokens ?? r.max_completion_tokens) >= 16));
  assert.equal(report.items.replay.status, 'pass');
  assert.notEqual(report.items.cache.status, 'fail');
});

test('合法输出上限下真正的服务失败仍保留异常', async () => {
  const {report} = await run(503);
  assert.equal(report.items.replay.status, 'fail');
  assert.equal(report.items.cache.status, 'fail');
  assert.ok(report.findings.some(f => f.title === '同样的请求不稳定'));
});
