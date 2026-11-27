/* Shared advertising placements. Only render ads supplied by the public backend. */
const Ads = {
  slots: {
    masthead: { label: "顶部通栏", count: 1 },
    banner: { label: "首屏横幅", count: 1 },
    hero: { label: "赞助商", count: 5 },
    left: { label: "全站赞助位 · 左侧", count: 1 },
    right: { label: "全站赞助位 · 右侧", count: 1 },
    footer: { label: "页尾赞助商", count: 5 }
  },
  hidden: new Set(),
  tracking(record, esc) {
    return record.tracking_token && record.id ? ` data-ad-id="${esc(record.id)}" data-ad-token="${esc(record.tracking_token)}"` : "";
  },
  safeUrl(value, image = false) {
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
      if (image && url.origin !== location.origin && url.protocol !== "https:") return "";
      return url.href;
    } catch (_) { return ""; }
  },
  records(slot) {
    if (!Ads.slots[slot] || Ads.hidden.has(slot)) return [];
    const records = typeof PublicData !== "undefined" ? PublicData.ads || [] : [];
    return records.filter((record) => !record.demo && (slot === "left" ? ["left", "dock"].includes(record.placement) : record.placement === slot) && Ads.safeUrl(record.link)).slice(0, Ads.slots[slot].count);
  },
  card(record, index, kind, escapeText, priority = false) {
    const esc = escapeText || UI.esc;
    const tones = ["blue", "violet", "teal", "amber"];
    const tone = tones.includes(record.tone) ? record.tone : tones[index % 4];
    const href = Ads.safeUrl(record.link);
    const image = record.image && Ads.safeUrl(record.image, true);
    const target = ' target="_blank" rel="noopener noreferrer sponsored"';
    const media = image
      ? `<img class="ad-creative-image" src="${esc(image)}" alt="${esc(record.title)}" loading="${priority ? "eager" : "lazy"}"${priority ? ' fetchpriority="high"' : ""} decoding="async">`
      : `<div class="ad-art" aria-hidden="true"><span class="ad-art-grid"></span><span class="ad-art-orbit"></span><b>${esc(record.mark || record.title.slice(0, 2))}</b><small>PARTNER</small></div>`;
    return `<a class="ad-creative ad-creative--${kind} ad-tone-${tone}${image ? " ad-has-image" : ""}" href="${esc(href)}"${target}${Ads.tracking(record, esc)}>
      ${media}<div class="ad-copy"><div class="ad-brand"><strong>${esc(record.title)}</strong><span class="ad-tag">赞助</span></div>${record.headline && kind !== "card" ? `<p class="ad-headline">${esc(record.headline)}</p>` : ""}${record.description ? `<p class="ad-description">${esc(record.description)}</p>` : ""}${kind === "card" ? "" : `<span class="ad-cta">${kind === "floating" ? "访问站点" : "查看详情"}<span aria-hidden="true">↗</span></span>`}</div>
    </a>`;
  },
  zone(slot) {
    const records = Ads.records(slot);
    if (!records.length) return "";
    const label = Ads.slots[slot].label;
    const close = `<button class="ad-close" type="button" data-ad-close="${slot}" aria-label="关闭${label}" title="关闭${label}">×</button>`;
    if (slot === "masthead") {
      const r = records[0];
      return `<aside class="ad-masthead" data-ad-zone="masthead" aria-label="顶部广告"><div class="ad-masthead-inner"><span class="ad-disclosure">推广</span><a href="${UI.esc(Ads.safeUrl(r.link))}" target="_blank" rel="noopener noreferrer sponsored"${Ads.tracking(r, UI.esc)}><strong>${UI.esc(r.title)}</strong><span>${UI.esc(r.description || "")}</span><b aria-hidden="true">↗</b></a>${close}</div></aside>`;
    }
    if (["left", "right"].includes(slot)) {
      const record = records[0];
      return `<aside class="ad-zone ad-zone--floating ad-zone--${slot} ad-floating--inpage" data-ad-zone="${slot}" aria-label="${label}"><div class="ad-zone-head"><div><span class="ad-section-dot"></span><strong>${label}</strong></div>${close}</div>${Ads.card(record, 0, "floating")}</aside>`;
    }
    const sponsors = ["hero", "footer"].includes(slot);
    const kind = sponsors ? "card" : "banner";
    return `<aside class="ad-zone ad-zone--${slot}" data-ad-zone="${slot}" aria-label="${label}广告"><div class="ad-zone-head"><div><span class="ad-section-dot"></span><strong>${sponsors ? "赞助商" : label}</strong><span>广告</span></div>${sponsors ? '<a href="cooperate.html">成为赞助商 ↗</a>' : ""}${close}</div><div class="ad-creatives">${records.map((record, index) => Ads.card(record, index, kind, null, ["hero", "banner"].includes(slot))).join("")}</div></aside>`;
  },
  insert(parent, html, before = null) {
    if (!html) return null;
    const template = document.createElement("template");
    template.innerHTML = html;
    const element = template.content.firstElementChild;
    parent.insertBefore(element, before);
    return element;
  },
  updateFloating() {
    const center = document.querySelector('#app > main.page .container');
    if (!center) return;
    const rect = center.getBoundingClientRect();
    document.querySelectorAll('.ad-zone--floating').forEach(zone => {
      const gutter = zone.dataset.adZone === "right" ? document.documentElement.clientWidth - rect.right : rect.left;
      const width = Math.min(240, Math.floor(gutter - 28));
      const inpage = width < 168;
      zone.classList.toggle('ad-floating--inpage', inpage);
      zone.style.width = inpage ? '' : width + 'px';
      if (inpage) {
        const anchor = center.querySelector('.home-tools-layout, .ad-zone--footer');
        if (zone.parentElement !== center) center.insertBefore(zone, anchor);
      } else if (zone.parentElement !== document.getElementById('app')) {
        document.getElementById('app').appendChild(zone);
      }
    });
  },
  mount(page) {
    const main = document.querySelector("#app > main.page");
    if (!main) return;
    document.querySelectorAll("#app [data-ad-zone], #app .ad-rail, #app [data-ad-tools]").forEach((node) => node.remove());
    if (page === "cooperate") return;
    const center = main.querySelector(".container");
    if (!center) return;
    // Keep page content outside advertising containers so cosmetic filters only hide ads.
    const shell = document.getElementById("app");
    Ads.insert(shell, Ads.zone("masthead"), shell.firstElementChild);
    Ads.insert(center, Ads.zone("banner"), center.firstElementChild);
    const intro = center.querySelector(".home-entry, .page-head, .proposal-hero");
    const sponsor = Ads.zone("hero");
    if (intro) intro.insertAdjacentHTML("afterend", sponsor);
    else Ads.insert(center, sponsor, center.children[1] || null);
    Ads.insert(center, Ads.zone("footer"));
    for (const side of ["left", "right"]) Ads.insert(shell, Ads.zone(side));
    Ads.updateFloating();
    if (typeof AdAnalytics !== "undefined") AdAnalytics.observe();
  },
  init() {
    try { Ads.hidden = new Set(JSON.parse(sessionStorage.getItem("modeltool-ad-hidden") || "[]")); } catch (_) {}
    if (typeof window !== 'undefined') window.addEventListener('resize', () => Ads.updateFloating());
    document.addEventListener("click", (event) => {
      const close = event.target.closest("[data-ad-close]");
      if (!close) return;
      const slot = close.dataset.adClose;
      Ads.hidden.add(slot);
      try { sessionStorage.setItem("modeltool-ad-hidden", JSON.stringify([...Ads.hidden])); } catch (_) {}
      const zone = close.closest("[data-ad-zone]");
      zone.remove();
    });
  }
};
Ads.init();
