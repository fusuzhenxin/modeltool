/* 只引用仓库中已有来源和许可的公开作品，不生成虚构的 API 实测记录。 */
const Examples = {
  items: [
    { id: "claude-opus-5", model: "Claude Opus 5", title: "先看画面，再理解结构分", note: "一份静态 SVG，看看页面为什么有分，以及分数没有检查什么。" },
    { id: "gpt-5.6-sol", model: "GPT-5.6 Sol", title: "同一道题，另一份公开作品", note: "对照长嘴、车架和脚踏的位置，观察代码分数之外的差异。" },
    { id: "glm-5.2", model: "GLM-5.2", title: "把结果和评分依据放在一起", note: "预览作品，逐项查看 SVG、圆形、路径和动画相关代码。" }
  ],
  source: "https://huggingface.co/datasets/sergiopaniego/pelican-svg-drawings",
  teaser() {
    return `<section class="entry-invite">
      <div><span class="entry-kicker">第一次来？先看一个结果</span><h2>不用填密钥，也能先看懂怎么测</h2><p>查看有来源的公开作品和评分依据，或复制题目到自己的客户端做指纹检测。</p></div>
      <div class="entry-actions"><a class="btn btn-primary" href="examples.html">查看案例</a><a class="btn btn-ghost" href="trace.html?mode=manual">免填密钥，手动检测</a></div>
    </section>`;
  },
  cards() {
    return `<div class="example-grid">${Examples.items.map((item, index) => `<a class="panel example-card" href="examples.html?id=${item.id}">
      <span class="example-number">0${index + 1} / 公开作品</span><span class="example-model">${UI.esc(item.model)}</span>
      <h2>${item.title}</h2><p>${item.note}</p><span class="example-link">查看作品和评分依据 ${UI.icon("arrow")}</span>
    </a>`).join("")}</div>`;
  },
  relayCards() {
    const rows = typeof RelayDirectory === "undefined" ? [] : RelayDirectory.rows();
    if (!rows.length) return "";
    return `<div class="example-grid">${rows.slice(0, 3).map((item) => `<a class="panel example-card" href="relays.html?id=${encodeURIComponent(item.id)}">
      <div class="example-card-top"><span class="badge ${UI.esc(item.level)}"><i></i>${UI.esc(item.title)}</span>${item.demo ? `<span class="demo-tag">演示数据</span>` : ""}</div>
      <span class="example-domain">${UI.esc(item.domain || item.maskedDomain || "")}</span><span class="example-model">${UI.esc(item.model)}</span>
      <div class="example-score"><strong>${UI.esc(item.score ?? "—")}</strong><span>/ 100${item.demo ? " · 模拟检测分" : ""}</span></div><p>${UI.esc(item.summary || "查看这次检测的结果和依据。")}</p><span class="example-link">查看完整报告 ${UI.icon("arrow")}</span>
    </a>`).join("")}</div>`;
  },
  page() {
    const id = new URLSearchParams(location.search).get("id");
    const item = Examples.items.find((row) => row.id === id);
    if (id && !item) return UI.shell("examples", `<div class="page-head"><h1>没有找到这个案例</h1><p>可以返回案例列表，选择一份公开作品。</p><a class="btn btn-primary" href="examples.html">返回案例列表</a></div>`);
    if (!item) return UI.shell("examples", `
      <div class="page-head"><div class="crumb"><a href="index.html">首页</a> / 检测案例</div><h1>先看结果，再开始自己的检测</h1><p>不用接口或密钥，先了解检测报告和逐项依据。</p></div>
      ${Examples.relayCards() ? `<div class="section-intro"><h2>中转检测报告</h2><a href="relays.html">查看全部记录 →</a></div>${RelayDirectory.demoNotice(RelayDirectory.rows())}${Examples.relayCards()}` : ""}
      <div class="section-intro"><h2>公开作品分析</h2></div>
      <p class="note">以下作品来自 pelican-svg-drawings（Apache-2.0），模型标注沿用数据集。本站没有这些作品的原始调用参数和生成时间；这里展示的是公开作品分析，不是本站 API 实测，也不参与综合分。</p>
      ${Examples.cards()}
      <section class="entry-invite"><div><span class="entry-kicker">想看当天哪些中转站有异常？</span><h2>中转检测日报与站点档案</h2><p>按天看统计、按中转站查多份报告，模拟记录会单独标注。</p></div><a class="btn btn-ghost" href="relays.html">查看中转日报</a></section>
      ${Examples.nextSteps()}`);
    return UI.shell("examples", `
      <div class="page-head"><div class="crumb"><a href="index.html">首页</a> / <a href="examples.html">检测案例</a> / ${UI.esc(item.model)}</div><h1>${UI.esc(item.model)} 的鹈鹕作品分析</h1><p>作品、评分依据和人工观察，一起看清这份结果。</p></div>
      <p class="note">公开作品分析 · 模型名称沿用来源标注 · 生成时间与调用参数未提供 · 不计入你的检测记录和综合分</p>
      <section class="grid-side example-detail">
        <article class="panel"><div class="panel-hd"><h2>公开作品预览</h2></div><div class="panel-bd"><iframe class="art-frame" sandbox="allow-scripts" src="works/${item.id}.html" title="${UI.esc(item.model)} 的公开鹈鹕作品"></iframe><p class="note">来源：<a href="${Examples.source}" target="_blank" rel="noopener noreferrer">pelican-svg-drawings</a> · Apache-2.0。本站 HTML 包含展示用的页面包装。</p></div></article>
        <article class="panel"><div class="panel-hd"><h2>代码结构分</h2></div><div class="panel-bd" id="example-checks" aria-live="polite"><p>正在读取本站保存的作品…</p></div></article>
      </section>
      <article class="panel mt16"><div class="panel-bd"><h2>还需要你看什么？</h2><p>长嘴和喉囊能否看出来？两个轮子有没有连到车架上？鹈鹕是否坐在车上，脚是否接近脚踏？结构分没有识别这些画面关系，也不能单独证明模型身份或是否降智。</p></div></article>
      <div class="entry-actions mt16"><a class="btn btn-ghost" href="examples.html">看看其他案例</a><a class="btn btn-primary" href="pelican.html">用我的接口生成作品</a><a class="btn btn-ghost" href="trace.html?mode=manual">免填密钥做指纹检测</a></div>`);
  },
  nextSteps() {
    return `<section class="entry-invite"><div><h2>接下来，测你正在用的模型</h2><p>有 API 可以自动检测；也可以复制题目，在自己的客户端作答后粘贴回来。</p></div><div class="entry-actions"><a class="btn btn-primary" href="relay.html">检查我的 API</a><a class="btn btn-ghost" href="trace.html?mode=manual">手动指纹检测</a></div></section>`;
  },
  async mount() {
    const node = document.getElementById("example-checks");
    const item = Examples.items.find((row) => row.id === new URLSearchParams(location.search).get("id"));
    if (!node || !item) return;
    try {
      const response = await fetch("works/" + item.id + ".html");
      if (!response.ok) throw new Error("读取作品失败");
      const html = await response.text();
      if (!node.isConnected) return;
      node.innerHTML = `<div class="example-score"><strong>${Api.scoreArtwork(html)}</strong><span>/ 100 · 代码结构分</span></div>
        <p>按本站保存的 HTML 计算，只检查代码特征。</p><ul class="example-checks">${Api.artworkChecks(html).map((check) => `<li><span>${check.passed ? "✓" : "—"} ${check.name}</span><b>${check.passed ? "+" + check.points : "0"}</b></li>`).join("")}</ul><p class="note">未出现动画代码的静态作品也可能画得很好。分数不代表画面质量。</p>`;
    } catch (error) {
      node.innerHTML = `<p role="alert">作品读取失败，请刷新重试。未生成结构分。</p>`;
    }
  }
};
