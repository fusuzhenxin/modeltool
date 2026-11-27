/* Visible ad impressions and trusted outbound clicks; admin previews never participate. */
const AdAnalytics = {
  view: typeof crypto === "undefined" ? "" : crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""),
  seen: new Set(), pending: [], timers: new Map(), visible: new Set(), attempts: new Map(),
  page() { return location.pathname === "/" ? "/index.html" : location.pathname; },
  eligible(element) {
    if (!element?.isConnected || document.visibilityState !== "visible") return false;
    if (element.checkVisibility && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = element.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return r.width > 0 && r.height > 0 && area / (r.width * r.height) >= .5;
  },
  event(element, kind) {
    const zone = element.closest('[data-ad-zone]');
    if (!this.view || !zone || !element.dataset.adToken || !element.dataset.adId) return;
    const key = [element.dataset.adId, zone.dataset.adZone, this.page(), kind].join("|");
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.pending.push({ token: element.dataset.adToken, view_id: this.view, page: this.page(), kind, automated: navigator.webdriver === true });
    this.flush();
  },
  async flush(leaving = false) {
    if (!this.pending.length) return;
    const batch = this.pending.splice(0, 20), body = JSON.stringify({ events: batch });
    if (leaving && navigator.sendBeacon?.("/api/public/advertising/events", new Blob([body], { type: "application/json" }))) return;
    try {
      const response = await fetch("/api/public/advertising/events", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: true });
      if (!response.ok && response.status >= 500) throw new Error("temporary failure");
    } catch (_) {
      for (const event of batch) {
        const key = event.token + event.kind, attempts = (this.attempts.get(key) || 0) + 1;
        this.attempts.set(key, attempts);
        if (attempts <= 2) this.pending.push(event);
      }
      if (this.pending.length && !leaving) setTimeout(() => this.flush(), 2000);
    }
  },
  cancel(element) { clearTimeout(this.timers.get(element)); this.timers.delete(element); },
  start(element) {
    this.cancel(element);
    if (!this.eligible(element)) return;
    this.timers.set(element, setTimeout(() => {
      this.timers.delete(element);
      if (this.eligible(element)) this.event(element, "impression");
    }, 1000));
  },
  observe() {
    if (!this.view || location.pathname.startsWith("/admin") || typeof PublicData === "undefined" || !PublicData.live || (PublicData.failed && !PublicData.contentReady) || typeof IntersectionObserver === "undefined") return;
    this.observer?.disconnect();
    for (const element of this.timers.keys()) this.cancel(element);
    this.visible.clear();
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .5) { this.visible.add(entry.target); this.start(entry.target); }
        else { this.visible.delete(entry.target); this.cancel(entry.target); }
      }
    }, { threshold: [.5] });
    document.querySelectorAll('#app [data-ad-zone] a[data-ad-token]').forEach(element => this.observer.observe(element));
  },
  init() {
    document.addEventListener("visibilitychange", () => {
      for (const element of this.visible) {
        this.cancel(element);
        if (document.visibilityState === "visible") this.start(element);
      }
      if (document.visibilityState === "hidden") this.flush(true);
    });
    for (const type of ["click", "auxclick"]) document.addEventListener(type, event => {
      if (!event.isTrusted || (type === "auxclick" && event.button !== 1) || location.pathname.startsWith("/admin")) return;
      const link = event.target.closest('#app [data-ad-zone] a[data-ad-token]');
      if (link) this.event(link, "click");
    });
    window.addEventListener("pagehide", () => this.flush(true));
  }
};
AdAnalytics.init();
