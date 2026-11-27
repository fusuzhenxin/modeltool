const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function client() {
  const root = { innerHTML: '', addEventListener() {} };
  const ctx = vm.createContext({
    document: {getElementById:()=>root,querySelector:()=>root},
    URL, URLSearchParams, Date, FormData, setTimeout, clearTimeout, location:{origin:'http://127.0.0.1',hash:''}
  });
  vm.runInContext(fs.readFileSync('admin/ad-analytics.js','utf8'),ctx);
  const source = fs.readFileSync('sponsor/portal.js','utf8').replace('SponsorPortal.start();','');
  vm.runInContext(source,ctx);
  vm.runInContext(fs.readFileSync('admin/sponsors.js','utf8'),ctx);
  return {ctx,root,stats:vm.runInContext('AdminAdAnalytics',ctx),portal:vm.runInContext('SponsorPortal',ctx),admin:vm.runInContext('AdminSponsors',ctx)};
}

function report() {
  const metric={impressions:0,clicks:0,visitors:0,ctr:0};
  return {start:'2026-11-24',end:'2026-11-24',traffic:'clean',started_at:1,summary:metric,raw:metric,classes:{automated:metric,internal:metric,unknown:metric},trend:[],pages:[],ads:[],details:[],options:{ads:[],pages:{},placements:{}}};
}

test('站长看板复用统计且隐藏广告管理操作，管理员视图保留管理入口',()=>{
  const c=client();
  assert.match(c.stats.render(report()),/管理广告投放/);
  assert.match(c.stats.render(report()),/name="traffic"|adstats-classification/);
  c.stats.sponsorMode=true;
  assert.equal(c.stats.endpoint(),'sponsor/analytics');
  const html=c.stats.render(report());
  assert.match(html,/我的投放效果|导出明细 CSV|今天|所在页面/);
  assert.doesNotMatch(html,/管理广告投放|href="#ads"/);
  assert.doesNotMatch(html,/name="traffic"|adstats-classification|请切换对应口径/);
});

test('投放卡片转义站点名称和订单，提供排期与状态而没有编辑按钮',()=>{
  const c=client();
  const html=c.portal.campaign({id:'id" onclick="bad',title:'<img src=x onerror=bad>',order_code:'<order>',placements:[{label:'<hero>'}],status:'live',remaining_days:15,starts_at:null,ends_at:null});
  assert.match(html,/&lt;img|&lt;order&gt;|&lt;hero&gt;|投放中|15 天/);
  assert.doesNotMatch(html,/<img src=x|data-edit|data-delete|data-publish/);
});

test('退出后清理统计数据与过滤条件，并使未完成的异步刷新失效',()=>{
  const c=client();c.portal.login=()=>{};
  c.stats.data=report();c.stats.filters={ad_id:'old'};c.portal.user={username:'old'};
  c.portal.campaigns=[{id:'old-ad'}];c.portal.report=report();
  const before=c.stats.sequence;c.portal.signOut();
  assert.equal(c.portal.user,null);assert.equal(c.stats.data,null);assert.equal(c.stats.filters,null);
  assert.equal(c.portal.campaigns,null);assert.equal(c.portal.report,null);
  assert.ok(c.stats.sequence>before);
});

test('工作台使用真实日期范围和指标，到期提醒只统计七天内的在投广告',()=>{
  const c=client();
  c.portal.user={display_name:'<站长>'};
  c.portal.report=report();
  c.portal.report.summary={impressions:1234,clicks:50,ctr:4.05,visitors:120};
  const ad=(status,remaining_days)=>({id:status,title:'测试广告',placements:[],status,remaining_days});
  c.portal.campaigns=[ad('live',3),ad('live',20),ad('expired',0),ad('scheduled',5),ad('live',null)];
  assert.equal(c.portal.campaigns.filter(row=>c.portal.expiring(row)).length,1);
  const html=c.portal.dashboard();
  assert.match(html,/1,234|4\.05%|120 位独立访客|2026-11-24 至 2026-11-24/);
  assert.match(html,/欢迎回来，&lt;站长&gt;/);
  assert.doesNotMatch(html,/全站累计|待处理申请|申请广告投放/);
  assert.doesNotMatch(html,/data-dash-traffic|<select/);
  assert.match(html,/尚未记录数据/);
});

test('广告卡片拒绝脚本图片和跳转，不向用户显示无效链接',()=>{
  const c=client();
  const row={id:'a',title:'广告',order_code:'AD-001',description:'说明',placements:[],status:'live',remaining_days:8,image:'javascript:alert(1)',link:'javascript:alert(1)'};
  const html=c.portal.campaign(row);
  assert.doesNotMatch(html,/javascript:|<img/);
  assert.match(html,/AD-001|data-campaign="a"/);
  assert.equal(c.portal.safeLink('https://user:secret@example.com'),'');
});

test('从广告或来源页面进入报告时保留工作台日期并使用过滤后流量',()=>{
  const c=client();c.portal.report=report();
  c.portal.openReport('owned-ad','/index.html');
  assert.equal(c.ctx.location.hash,'reports');
  assert.equal(c.stats.filters.ad_id,'owned-ad');
  assert.equal(c.stats.filters.page,'/index.html');
  assert.equal(c.stats.filters.traffic,'clean');
  assert.equal(c.stats.filters.start,'2026-11-24');
});

test('站长报告查询、表单和导出固定过滤后口径，管理员保留口径选择',()=>{
  const c=client();
  c.stats.filters={start:'2026-11-01',end:'2026-11-24',ad_id:'owned',page:'/index.html',placement:'hero',traffic:'all'};
  assert.equal(new URLSearchParams(c.stats.query()).get('traffic'),'all');
  c.stats.sponsorMode=true;
  assert.equal(new URLSearchParams(c.stats.query()).get('traffic'),'clean');
  c.ctx.FormData=class { *[Symbol.iterator]() { yield ['start','2026-11-10']; yield ['end','2026-11-20']; yield ['page','/relays.html']; } };
  c.stats.root={querySelector:()=>({})};
  c.stats.readForm();
  assert.equal(c.stats.filters.start,'2026-11-10');
  assert.equal(c.stats.filters.page,'/relays.html');
  assert.equal(c.stats.filters.traffic,'clean');
  const link={click(){this.clicked=true;}};
  c.ctx.document.createElement=()=>link;
  c.stats.filters.traffic='all';
  c.stats.export();
  assert.ok(link.clicked);
  assert.equal(new URL(link.href,c.ctx.location.origin).searchParams.get('traffic'),'clean');
});

test('账号管理界面转义站长与广告名称，不展示密码',()=>{
  const c=client();
  const html=c.admin.render({accounts:[{id:'a',display_name:'<script>alert(1)</script>',username:'owner',enabled:true,ad_ids:['ad']}],ads:[{id:'ad',title:'<img src=x>',account_id:'a'}]});
  assert.match(html,/&lt;script&gt;|&lt;img/);
  assert.doesNotMatch(html,/<script>|<img src=x|type="password"/);
  assert.match(html,/打开赞助商入口|编辑 \/ 分配广告/);
});
