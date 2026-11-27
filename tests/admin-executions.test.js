const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin/executions.js'),'utf8'),ctx);
const ui = vm.runInContext('AdminExecutions',ctx);
const esc = v => String(v ?? '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const helpers = {esc,name:()=>'<station>',kindLabel:v=>v,badge:v=>`<i>${esc(v)}</i>`,date:v=>String(v)};

test('组合执行列表只显示一行，提供整体进度和实际用量',()=>{
  const row={id:'group',station_id:'s',grouped:true,models:['gpt','claude'],kinds:['site_basic','site_candy'],total:4,finished:2,completed:1,status:'running',created:1,usage:{calls:25,tokens:200}};
  const html=ui.row(row,helpers);
  assert.equal((html.match(/<tr>/g)||[]).length,1);
  assert.match(html,/2 个模型 \/ 4 个测试组合/);
  assert.match(html,/2 \/ 4 已结束/);
  assert.match(html,/25 次请求/);
  assert.match(html,/data-action="execution"/);
  assert.doesNotMatch(html,/排除统计|<station>/);
});
test('执行明细保留独立结果与失败原因，所有外部文本转义',()=>{
  const run={id:'group',station_id:'s',actor:'<actor>',status:'partial',total:2,finished:2,completed:1,usage:{calls:1,tokens:20},snapshot:{version:2,models:['<model>']},children:[
    {id:'one',model:'<model>',kind:'site_candy',status:'done',key_name:'<key>',report_id:'r',report_status:'draft',ability:{score:65}},
    {id:'two',model:'claude',kind:'site_candy',status:'failed',key_name:'<key>',error:'<script>bad</script>'}
  ]};
  const html=ui.detail(run,helpers);
  assert.match(html,/配置版本 2/);assert.match(html,/65 分/);assert.match(html,/公开已完成报告/);
  assert.match(html,/&lt;script>/);assert.doesNotMatch(html,/<script>|<actor>|<model>|<key>/);
});
test('全项与基础子项互斥，防止重复调用收费',()=>{
  const boxes=['site_all','site_basic','site_logic','site_candy'].map(value=>({value,checked:true}));
  const form={querySelectorAll:()=>boxes};
  ui.synchronizeTests(form,boxes[0]);
  assert.deepEqual(boxes.map(b=>b.checked),[true,false,false,false]);
  boxes[1].checked=true;ui.synchronizeTests(form,boxes[1]);
  assert.deepEqual(boxes.map(b=>b.checked),[false,true,false,false]);
});

test('手动检测入口使用多站模型组合表单与批量提交路径',async()=>{
  let opened,argumentsOfFields;
  const source=fs.readFileSync(path.join(__dirname,'../admin/admin.js'),'utf8');
  const actionSource=source.slice(source.indexOf('  async function action(event)'),source.indexOf('  editor.addEventListener'));
  const context=vm.createContext({state:{stations:[{id:'s'}]},syncBulkSelection:()=>{},toast:()=>{},
    runFields:(...args)=>{argumentsOfFields=args;return 'group-fields';},openDialog:(...args)=>{opened=args;}});
  vm.runInContext(actionSource,context);
  const element={dataset:{action:'run',id:'s'},disabled:false};
  await context.action({target:{closest:()=>element}});
  assert.equal(argumentsOfFields[2],true);
  assert.equal(opened[2],'batch-run-form');
});
