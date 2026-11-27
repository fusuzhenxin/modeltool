const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function applicationClient() {
  const context = vm.createContext({ Pages: { mount: {} }, URLSearchParams,
    FormData: class { constructor(values) { this.values=values; } get(key) { return this.values[key] ?? null; } has(key) { return key in this.values; } },
    UI: { shell: (_,html)=>html,icon:()=>'',esc:value=>String(value) }
  });
  vm.runInContext(source('js/relay-apply.js'),context);
  return vm.runInContext('RelayApply',context);
}

test('申请提交保留密码空格并仅以 POST JSON 发送，先取得 CSRF 会话', async()=>{
  const client=applicationClient(), calls=[];
  const password='  exact-test-password  ';
  const result=await client.submit({name:'  Test  ',website_url:'https://relay.example',login_url:'https://relay.example/login',username:'probe',password,contact:'public-contact',consent:'on'},async(url, options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>url.includes('proposal-session')?{csrf:'test-csrf'}:{id:'application-id',status:'pending'}};
  });
  assert.equal(result.id,'application-id');assert.equal(calls.length,2);
  assert.equal(calls[1].url,'/api/public/station-applications');
  assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.headers['X-Proposal-CSRF'],'test-csrf');
  const body=JSON.parse(calls[1].options.body);
  assert.equal(body.password,password);assert.equal(body.name,'Test');assert.equal(body.consent,true);
  assert.equal(body.api_key,undefined);assert.ok(!calls.some(call=>call.url.includes(password)));
});

test('会话失效不提交凭据，服务端失败保留可重试的错误',async()=>{
  const client=applicationClient();let calls=0;
  await assert.rejects(()=>client.submit({},async()=>{calls++;return {ok:false};}),/会话/);
  assert.equal(calls,1);
  await assert.rejects(()=>client.submit({},async url=>({ok:url.includes('proposal-session'),json:async()=>url.includes('proposal-session')?{csrf:'c'}:{detail:'这个中转站已有待处理申请'}})),/已有待处理/);
});

test('后台申请列表转义提交内容，关闭窗口时清空全部解密字段',()=>{
  const context=vm.createContext({URLSearchParams});vm.runInContext(source('admin/applications.js'),context);
  const module=vm.runInContext('AdminApplications',context);
  const html=module.render({counts:{pending:1},items:[{id:'id',name:'<img src=x onerror=bad()>',domain:'relay.example',contact:'<script>bad()</script>',status:'pending',created_at:1}],total:1,pages:1,page:1});
  assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>bad'));
  assert.match(html,/&lt;img/);assert.ok(!html.includes('credentials_cipher'));
  const inputs=[{value:'probe',dataset:{}},{value:'secret',type:'text',dataset:{password:''}}];
  module.clearCredentials({querySelectorAll:()=>inputs});
  assert.deepEqual(inputs.map(input=>input.value),['','']);assert.equal(inputs[1].type,'password');
});

test('日报、稳定性、作品和提案均有申请入口，申请页自身不重复展示',()=>{
  const context=vm.createContext({Store:{api:()=>({}),user:()=>null},document:{documentElement:{getAttribute:()=>null}},location:{pathname:'/relays.html',search:''}});
  vm.runInContext(source('js/ui.js'),context);
  // Keep the test focused on real shared-shell markup instead of data-dependent nav widgets.
  const UI=vm.runInContext('UI',context);UI.veridropCard=()=>'';
  for(const active of ['relay-public','relay-stability','relay-artworks','examples','proposals','relay']) {
    const html=UI.shell(active,'<div class="page-head"><h1>Page</h1></div>');
    assert.match(html,/class="relay-apply-entry"/);assert.match(html,/href="relay-apply.html"/);
  }
  assert.ok(!UI.shell('relay-apply','form').includes('class="relay-apply-entry"'));
});
