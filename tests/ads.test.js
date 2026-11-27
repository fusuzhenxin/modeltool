const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function ads(host = "127.0.0.1") {
  const context = vm.createContext({ URL, URLSearchParams, location: {hostname:host,protocol:"http:",href:`http://${host}/index.html`,origin:`http://${host}`}, sessionStorage:{getItem:()=>null}, document:{addEventListener(){}}, PublicData:{ads:[]}, UI:{esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} });
  vm.runInContext(fs.readFileSync("js/ads.js","utf8"),context);
  return {api:vm.runInContext("Ads",context),publicData:context.PublicData,context};
}

test("正式域名、本地和文件页面均不自动填充空广告位",()=>{
  for (const host of ["www.modeltool.cn","localhost","127.0.0.1","[::1]"]) {
    const {api,context}=ads(host);
    for (const slot of Object.keys(api.slots)) assert.equal(api.zone(slot),"",host);
    context.location.protocol="file:";
    delete context.PublicData;
    for (const slot of Object.keys(api.slots)) assert.equal(api.zone(slot),"",`${host} without backend`);
  }
});

test("本地仅展示后台提供的广告，不补齐空位或展示演示记录",()=>{
  const {api,publicData}=ads();
  publicData.ads=[
    {placement:"hero",title:"实际赞助商",link:"https://example.com"},
    {placement:"hero",title:"演示赞助商",link:"https://example.com",demo:true}
  ];
  assert.equal((api.zone("hero").match(/ad-creative--card/g)||[]).length,1);
  assert.doesNotMatch(api.zone("hero"),/演示赞助商|示例|ad-previews/);
  for (const slot of ["masthead","banner","left","right","footer"]) assert.equal(api.zone(slot),"");
  api.hidden.add("hero");
  assert.equal(api.zone("hero"),"");
});

test("真实广告保留跳转参数，限制展示数，转义文案并拒绝脚本链接",()=>{
  const {api,publicData}=ads("www.modeltool.cn");
  publicData.ads=Array.from({length:6},(_,i)=>({placement:"hero",title:'标题<img src=x onerror=alert(1)>',description:'<script>unsafe</script>',link:`https://example.com/offer?ref=${i}&from=modeltool`}));
  publicData.ads.unshift({placement:"hero",title:"bad",link:"javascript:alert(1)"});
  const html=api.zone("hero");
  assert.equal((html.match(/class="ad-creative /g)||[]).length,5);
  assert.match(html,/ref=0&amp;from=modeltool/);
  assert.match(html,/rel="noopener noreferrer sponsored"/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script>|<img src=x|javascript:|示例广告/);
  assert.equal(api.safeUrl("https://user:password@example.com"),"");
  assert.equal(api.safeUrl("data:image/svg+xml,bad",true),"");
});

test("左右全站赞助独立展示和关闭，历史浮条使用左侧",()=>{
  const {api,publicData}=ads("www.modeltool.cn");
  publicData.ads=["right","dock","left"].map((placement,index)=>({placement,title:`站点${index}`,description:"站点介绍",image:"https://example.com/banner.png",link:`https://example.com/${index}`}));
  const html=api.zone("left");
  assert.equal((html.match(/class="ad-creative /g)||[]).length,1);
  assert.match(html,/站点1/);
  assert.match(html,/访问站点/);
  assert.match(html,/关闭全站赞助位 · 左侧/);
  assert.doesNotMatch(html,/站点0|站点2/);
  assert.match(api.zone("right"),/站点0/);
  assert.match(api.zone("right"),/data-ad-zone="right"/);
  assert.equal(api.zone("dock"),"");
  api.hidden.add("left");
  assert.equal(api.zone("left"),"");
  assert.match(api.zone("right"),/站点0/);
});

test("页尾以卡片展示真实赞助商，最多五条且不使用示例填满空位",()=>{
  const {api,publicData}=ads("www.modeltool.cn");
  publicData.ads=[{placement:"footer",title:"真实赞助商",description:"服务介绍",link:"https://example.com"}];
  const html=api.zone("footer");
  assert.equal((html.match(/ad-creative--card/g)||[]).length,1);
  assert.match(html,/成为赞助商/);
  assert.doesNotMatch(html,/ad-creative--banner|示例广告/);
  publicData.ads=Array.from({length:6},(_,i)=>({...publicData.ads[0],title:`站点${i}`}));
  assert.equal((api.zone("footer").match(/ad-creative--card/g)||[]).length,5);
});

test("所有页面包含左右全站位，执行页同样挂载且不依赖页面类型",()=>{
  const {api,publicData,context}=ads("www.modeltool.cn");
  publicData.ads=["left","right"].map(placement=>({placement,title:placement,link:"https://example.com"}));
  const center={children:[],querySelector(){return null;}};
  const main={querySelector(selector){return selector===".container"?center:null;}};
  const shell={firstElementChild:{}};
  context.document.querySelector=()=>main;
  context.document.querySelectorAll=()=>[];
  context.document.getElementById=()=>shell;
  context.location.search="";
  let mounted=[];
  api.insert=(_,html)=>{if(html) mounted.push(html);};
  api.updateFloating=()=>{};
  for (const page of ["home","trace","run","login","relays"]) {
    mounted=[];api.mount(page);
    assert.equal(mounted.length,2,page);
    assert.match(mounted[0],/data-ad-zone="left"/,page);
    assert.match(mounted[1],/data-ad-zone="right"/,page);
  }
});

test("空广告位和有广告时正文均保留原容器，不成为广告过滤目标",()=>{
  for (const placement of [null,"hero","footer","left"]) {
    const {api,publicData,context}=ads();
    if (placement) publicData.ads=[{placement,title:"赞助商",link:"https://example.com"}];
    const shell={firstElementChild:{}};
    const main={querySelector:()=>center,insertBefore(){assert.fail("不能给正文添加广告包装");}};
    const center={parentElement:main,children:[],querySelector:()=>null,
      classList:{add(){assert.fail("不能给正文添加广告类");}}};
    context.document.querySelector=()=>main;
    context.document.querySelectorAll=()=>[];
    context.document.getElementById=()=>shell;
    api.insert=(_,html)=>{if(html) assert.match(html,/^<aside[^>]*data-ad-zone=/);};
    api.updateFloating=()=>{};
    api.mount("home");
    api.mount("home");
    assert.equal(center.parentElement,main);
  }
});

test("侧栏在窄屏回到正文内，宽屏回到两侧且不依赖广告正文容器",()=>{
  const {api,context}=ads();
  const shell={appendChild(zone){zone.parentElement=this;}};
  const center={getBoundingClientRect:()=>({left:gutter,right:1200-gutter}),querySelector:()=>null,
    insertBefore(zone){zone.parentElement=this;}};
  const zones=["left","right"].map(side=>({dataset:{adZone:side},parentElement:shell,style:{},
    classList:{toggle(_,value){this.inpage=value;}}}));
  context.document.querySelector=selector=>selector==="#app > main.page .container"?center:null;
  context.document.querySelectorAll=()=>zones;
  context.document.getElementById=()=>shell;
  context.document.documentElement={clientWidth:1200};
  let gutter=100;
  api.updateFloating();
  for(const zone of zones){assert.equal(zone.parentElement,center);assert.equal(zone.classList.inpage,true);}
  gutter=300;
  api.updateFloating();
  for(const zone of zones){assert.equal(zone.parentElement,shell);assert.equal(zone.classList.inpage,false);assert.equal(zone.style.width,"240px");}
});

test("首屏赞助图片优先加载，页尾和侧栏按需加载",()=>{
  const {api,publicData}=ads();
  publicData.ads=["hero","banner","footer","left","right"].map(placement=>({placement,title:"赞助商",link:"https://example.com",image:"https://example.com/image.webp"}));
  for(const slot of ["hero","banner"]) {
    assert.match(api.zone(slot),/loading="eager" fetchpriority="high"/);
    assert.doesNotMatch(api.zone(slot),/loading="lazy"/);
  }
  for(const slot of ["footer","left","right"]) {
    assert.match(api.zone(slot),/loading="lazy"/);
    assert.doesNotMatch(api.zone(slot),/fetchpriority="high"/);
  }
});
