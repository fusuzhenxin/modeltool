/* The operations service owns live public content. Static previews retain labeled fixtures. */
const PublicData = {
  live: false, failed: false, reports: [], stations: [], announcements: [], ads: [], pending: null,
  async load() {
    if (PublicData.pending) return PublicData.pending;
    PublicData.pending = (async () => {
      const backend = !!document.querySelector('meta[name="modeltool-backend"]');
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 5000);
      try {
        const res = await fetch("/api/public/bootstrap", { signal: abort.signal, cache: "no-store" });
        if (res.status === 404 && !backend) return;
        if (!res.ok) throw new Error("Public data unavailable");
        const data = await res.json();
        if (data.mode !== "live" || !Array.isArray(data.reports) || !Array.isArray(data.stations)) throw new Error("Invalid public data");
        Object.assign(PublicData, { live: true, reports: data.reports, stations: data.stations, announcements: data.announcements || [], ads: data.ads || [] });
      } catch (_) {
        // A live service failure must never replace measurements with fixture reports.
        PublicData.live = true; PublicData.failed = true;
      } finally { clearTimeout(timer); }
    })();
    return PublicData.pending;
  },
  notices(home) {
    const error = PublicData.failed ? '<div class="announcement-error" role="status"><div class="container"><strong>公开数据暂时无法加载</strong> · 请稍后刷新，当前不显示检测统计。</div></div>' : "";
    return error + PublicData.announcements.filter((r) => home || r.placement === "all").slice(0, 3).map((r, index) => {
      const tone = ["info", "warning", "success"].includes(r.tone) ? r.tone : "info";
      const colors = [["background_color", "--announcement-bg"], ["text_color", "--announcement-ink"]].filter(([key]) => /^#[0-9a-f]{6}$/i.test(r[key] || "")).map(([key, variable]) => `${variable}:${r[key]}`).join(";");
      const duration = Math.max(24, Math.min(180, (r.title.length + r.content.length) / 4));
      const copy = (duplicate) => `<span class="announcement-copy"${duplicate ? ' aria-hidden="true"' : ""}><strong>${UI.esc(r.title)}</strong><span>${UI.esc(r.content)}</span>${r.link ? `<a href="${UI.esc(r.link)}" target="_blank" rel="noopener noreferrer"${duplicate ? ' tabindex="-1"' : ""}>查看详情 →</a>` : ""}</span>`;
      return `<aside class="site-announcement tone-${tone}" aria-label="网站公告" style="${colors}"><div class="container announcement-inner"><span class="announcement-label">${UI.icon("info")}公告</span><input class="announcement-toggle" type="checkbox" id="announcement-pause-${index}" aria-label="暂停公告滚动"><div class="announcement-viewport" tabindex="0" role="group" aria-label="公告内容，悬停或聚焦暂停滚动"><div class="announcement-track" style="--announcement-duration:${duration}s">${copy(false)}${copy(true)}</div></div><label class="announcement-control" for="announcement-pause-${index}"><span class="announcement-pause-text">暂停</span><span class="announcement-play-text">继续</span></label></div></aside>`;
    }).join("");
  },
  ad(slot, single = false) {
    const ads = PublicData.ads.filter((r) => r.placement === slot).slice(0, single ? 1 : 2);
    return ads.map((r) => `<a class="${slot === "hero" ? "hero-promo managed-ad-hero" : "managed-ad"}" href="${UI.esc(r.link)}" target="_blank" rel="noopener noreferrer sponsored">${r.image ? `<img class="${slot === "hero" ? "hero-promo-logo" : "managed-ad-image"}" src="${UI.esc(r.image)}" alt="" loading="lazy">` : ""}<span class="hero-promo-copy"><strong>${UI.esc(r.title)}</strong><em>${UI.esc(r.description)}</em></span><span class="managed-ad-label">推广 ↗</span></a>`).join("");
  }
};
