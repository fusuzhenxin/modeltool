/* Organic station discovery only. Sponsored zones never enter this collector. */
const StationTraffic = {
  view: typeof crypto === 'undefined' ? '' : crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''),
  tokens: {}, tokenPage: '', seen: new Set(), queue: [], waiting: new Map(), timers: new Map(), visible: new Set(), attempts: new Map(),
  page() {
    if (location.pathname === '/stations.html') return 'directory';
    if (location.pathname !== '/relays.html') return '';
    return new URLSearchParams(location.search).get('view') === 'stability' ? 'stability' : 'daily';
  },
  eligible(element) {
    if (!element?.isConnected || document.visibilityState !== 'visible' || element.closest('[data-ad-zone]')) return false;
    if (element.checkVisibility && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = element.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return r.width > 0 && r.height > 0 && area / (r.width * r.height) >= .5;
  },
  record(element, kind) {
    const id = element?.dataset.relayId, placement = element?.dataset.relayPlacement, page = this.page();
    if (!this.view || !id || !placement || !page || element.closest('[data-ad-zone]')) return;
    const key = [id, placement, page, kind].join('|');
    if (this.seen.has(key)) return;
    if (this.tokenPage !== page || !this.tokens[id]) {
      if (kind !== 'impression' && this.waiting.size < 100) { this.waiting.set(key, { element, kind, page }); this.schedule(); }
      return;
    }
    this.seen.add(key);
    this.queue.push({ token: this.tokens[id], page, placement, kind, view_id: this.view, automated: navigator.webdriver === true });
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 50);
  },
  async flush(leaving = false) {
    clearTimeout(this.flushTimer); this.flushTimer = null;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 20), body = JSON.stringify({ events: batch });
    const url = '/api/public/station-traffic/events';
    if (leaving && navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) {
      if (this.queue.length) this.flush(true);
      return;
    }
    try {
      const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      if (response.status >= 500) throw new Error('Temporary failure');
    } catch (_) {
      for (const event of batch) {
        const key = [event.token, event.placement, event.kind].join('|'), attempts = (this.attempts.get(key) || 0) + 1;
        this.attempts.set(key, attempts);
        if (attempts <= 2) this.queue.push(event);
      }
      if (!leaving && this.queue.length) { setTimeout(() => this.flush(), 2000); return; }
    }
    if (this.queue.length) this.flush(leaving);
  },
  cancel(element) { clearTimeout(this.timers.get(element)); this.timers.delete(element); },
  start(element) {
    this.cancel(element);
    if (!this.eligible(element)) return;
    this.timers.set(element, setTimeout(() => {
      this.timers.delete(element);
      if (this.eligible(element)) this.record(element, 'impression');
    }, 1000));
  },
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.scan(); });
  },
  async scan() {
    if (this.scanning) { this.rescan = true; return; }
    this.scanning = true;
    try {
      const page = this.page();
      if (!page || !this.view || typeof IntersectionObserver === 'undefined') return;
      if (this.tokenPage !== page || this.tokenExpires < Date.now()) { this.tokens = {}; this.tokenPage = page; }
      const elements = [...document.querySelectorAll('#app [data-relay-id][data-relay-placement]')].filter(e => !e.closest('[data-ad-zone]'));
      const ids = [...new Set(elements.map(e => e.dataset.relayId).filter(id => id && !this.tokens[id]))].slice(0, 100);
      if (ids.length) {
        const response = await fetch('/api/public/station-traffic/session', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, station_ids: ids }) });
        if (!response.ok) return;
        const data = await response.json();
        if (this.page() !== page || !data.tokens || typeof data.tokens !== 'object') return;
        Object.assign(this.tokens, data.tokens); this.tokenExpires = Date.now() + 20 * 3600000;
        for (const [key, click] of this.waiting) {
          if (click.page === page && this.tokens[click.element.dataset.relayId]) { this.waiting.delete(key); this.record(click.element, click.kind); }
        }
      }
      this.observer?.disconnect();
      for (const element of this.timers.keys()) this.cancel(element);
      this.visible.clear();
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= .5) { this.visible.add(entry.target); this.start(entry.target); }
          else { this.visible.delete(entry.target); this.cancel(entry.target); }
        }
      }, { threshold: [.5] });
      for (const element of elements) if (this.tokens[element.dataset.relayId]) this.observer.observe(element);
    } catch (_) {
      // Discovery and navigation remain usable when optional analytics is unavailable.
    } finally {
      this.scanning = false;
      if (this.rescan) { this.rescan = false; this.schedule(); }
    }
  },
  click(event) {
    if (!event.isTrusted || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0) || !this.page()) return;
    const target = event.target.closest('[data-relay-click]');
    const element = target?.closest('#app [data-relay-id][data-relay-placement]');
    if (!element || element.closest('[data-ad-zone]')) return;
    const kind = target.dataset.relayClick;
    if (!['outbound', 'profile', 'report', 'details'].includes(kind)) return;
    if (kind === 'details' && target.closest('details')?.open) return;
    this.record(element, kind);
    if (kind === 'outbound' || target.tagName === 'A') this.flush(true);
  },
  init() {
    if (!this.page()) return;
    document.addEventListener('visibilitychange', () => {
      for (const element of this.visible) { this.cancel(element); if (document.visibilityState === 'visible') this.start(element); }
      if (document.visibilityState === 'hidden') this.flush(true);
    });
    for (const type of ['click', 'auxclick']) document.addEventListener(type, event => this.click(event));
    window.addEventListener('pagehide', () => this.flush(true));
    window.addEventListener('popstate', () => this.schedule());
    const root = document.getElementById('app');
    if (root) { this.mutations = new MutationObserver(() => this.schedule()); this.mutations.observe(root, { childList: true, subtree: true }); }
    this.schedule();
  }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => StationTraffic.init(), { once: true });
else StationTraffic.init();
