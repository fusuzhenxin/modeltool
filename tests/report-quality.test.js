const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/report-quality.js'), 'utf8'), ctx);
const quality = vm.runInContext('ReportQuality', ctx);
for (const item of JSON.parse(fs.readFileSync(path.join(__dirname, 'quality-cases.json'), 'utf8'))) {
  test(item.name, () => assert.equal(quality.fingerprint(item.section, item.model || '').status, item.expected));
}
test('糖果高低分与协议异常均不产生身份结论', () => {
  for (const report of [{kind:'site_candy', ability:{score:0}}, {kind:'site_candy', ability:{score:100}}, {kind:'site_relay', level:'bad'}]) {
    assert.equal(quality.identity(report).status, 'untested');
  }
  assert.equal(quality.protocolTested({kind:'site_candy', level:'ok'}), false);
  assert.equal(quality.protocolTested({kind:'site_relay', level:'bad', protocol_tested:false}), false);
  assert.equal(quality.title({kind:'site_relay', level:'bad', title:'明显掺水'}), '多项功能异常');
});
