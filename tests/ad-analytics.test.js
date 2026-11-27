const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function tracker() {
  const callbacks = new Map(), calls = [], timers = new Map();
  let nextTimer = 0, observer;
  const zone = {dataset:{adZone:"hero"}};
  const element = {dataset:{adId:"ad1",adToken:"ticket1"},isConnected:true,closest:()=>zone,
    getBoundingClientRect:()=>({left:0,right:200,top:0,bottom:100,width:200,height:100})};
  const context = vm.createContext({
    crypto:{randomUUID:()=>"pageview_1234567890"}, location:{pathname:"/"}, navigator:{webdriver:false},
    document:{visibilityState:"visible",addEventListener:(key,cb)=>callbacks.set(key,cb),querySelectorAll:()=>[element]},
    window:{addEventListener:(key,cb)=>callbacks.set(key,cb)}, PublicData:{live:true,failed:false},innerWidth:1000,innerHeight:800,
    IntersectionObserver:class {constructor(cb){observer=this;this.callback=cb;} observe(){} disconnect(){}},
    setTimeout:(cb,ms)=>{timers.set(++nextTimer,{cb,ms});return nextTimer;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true};},Blob
  });
  vm.runInContext(fs.readFileSync("js/ad-analytics.js","utf8"),context);
  return {context,api:vm.runInContext("AdAnalytics",context),callbacks,calls,timers,element,zone,
    enter(){observer.callback([{target:element,isIntersecting:true,intersectionRatio:1}]);},
    leave(){observer.callback([{target:element,isIntersecting:false,intersectionRatio:0}]);},
    fire(){const pending=[...timers.values()];timers.clear();for(const timer of pending) timer.cb();}};
}

test("曝光需持续可见一秒，离开或后台页签取消，重新挂载不重复计数",()=>{
  const t=tracker(); t.api.observe(); t.enter();
  assert.equal(t.calls.length,0); assert.equal([...t.timers.values()][0].ms,1000);
  t.leave(); t.fire(); assert.equal(t.calls.length,0);
  t.enter(); t.context.document.visibilityState="hidden";t.callbacks.get("visibilitychange")();t.fire();
  assert.equal(t.calls.length,0);
  t.context.document.visibilityState="visible";t.callbacks.get("visibilitychange")();t.fire();
  assert.equal(t.calls.length,1);assert.equal(t.calls[0].body.events[0].page,"/index.html");
  t.api.observe();t.enter();t.fire();assert.equal(t.calls.length,1);
});

test("同一广告多个位置独立计数，低可见比例、移除或 CSS 隐藏均不计曝光",()=>{
  const t=tracker();t.api.observe();t.enter();t.fire();
  t.zone.dataset.adZone="footer";t.enter();t.fire();assert.equal(t.calls.length,2);
  t.element.dataset.adId="ad2";t.element.getBoundingClientRect=()=>({left:-150,right:50,top:0,bottom:100,width:200,height:100});
  t.enter();t.fire();assert.equal(t.calls.length,2);
  t.element.getBoundingClientRect=()=>({left:0,right:200,top:0,bottom:100,width:200,height:100});
  t.element.checkVisibility=()=>false;t.enter();t.fire();assert.equal(t.calls.length,2);
  t.element.checkVisibility=()=>true;t.enter();t.element.isConnected=false;t.fire();assert.equal(t.calls.length,2);
});

test("仅可信左键、中键和键盘点击计入，重复点击去重，后台预览不采集",()=>{
  const t=tracker(),target={closest:()=>t.element};
  t.callbacks.get("click")({isTrusted:false,target}); assert.equal(t.calls.length,0);
  t.callbacks.get("auxclick")({isTrusted:true,button:2,target}); assert.equal(t.calls.length,0);
  t.callbacks.get("auxclick")({isTrusted:true,button:1,target}); assert.equal(t.calls.length,1);
  t.callbacks.get("click")({isTrusted:true,target}); assert.equal(t.calls.length,1);
  t.context.location.pathname="/admin/";t.element.dataset.adId="ad2";
  t.callbacks.get("click")({isTrusted:true,target}); assert.equal(t.calls.length,1);
});

test("全部广告来自真实服务才监听曝光，失败或静态页面不补造统计",()=>{
  const t=tracker(); t.context.PublicData.failed=true;t.api.observe();assert.equal(t.timers.size,0);
  t.context.PublicData.failed=false;t.context.PublicData.live=false;t.api.observe();assert.equal(t.timers.size,0);
});

test("报告接口失败但独立广告配置有效时仍正常计算曝光",()=>{
  const t=tracker();
  t.context.PublicData.failed=true;
  t.context.PublicData.contentReady=true;
  t.api.observe();t.enter();t.fire();
  assert.equal(t.calls.length,1);
});

test("广告分析页面转义广告文案，明确页面、物理位置及统计规则",()=>{
  const context=vm.createContext({URLSearchParams,Date});
  vm.runInContext(fs.readFileSync('admin/ad-analytics.js','utf8'),context);
  const api=vm.runInContext('AdminAdAnalytics',context),zero={impressions:0,clicks:0,visitors:0,ctr:0};
  const data={start:"2026-11-01",end:"2026-11-20",started_at:1,traffic:"clean",summary:zero,raw:zero,classes:{automated:zero,internal:zero,unknown:zero},trend:[{day:"2026-11-20",...zero}],pages:[],ads:[{id:'a1',title:'<img onerror=alert(1)>',name:'广告',...zero}],details:[{ad_id:'a1',placement:'hero',page:'/index.html',...zero}],options:{ads:[{id:'a1',title:'<img onerror=alert(1)>',name:'广告'}],pages:{'/index.html':'首页'},placements:{hero:'顶部赞助商'}}};
  const html=api.render(data);
  assert.match(html,/&lt;img onerror/);assert.doesNotMatch(html,/<img onerror/);
  assert.match(html,/页面 × 位置 × 广告明细/);assert.match(html,/\/index.html/);assert.match(html,/顶部赞助商/);assert.match(html,/不回填历史/);
});
