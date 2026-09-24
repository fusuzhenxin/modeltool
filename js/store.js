/* 记录只放在本机 localStorage。 */
const Store = (() => {
  const KEY = "model-eval-site-v1";
  const USER = "model-eval-user-v1";
  const APIKEY = "model-eval-endpoint-v1";
  let state = null;

  function blank() {
    return {
      version: 2,
      tasks: [],
      recent: [],
      basicReport: null,
      snapshot: {
        frozen: false,
        score: null,
        time: "",
        modelName: "",
        parts: {
          meta: { score: null, time: "" },
          basic: { score: null, time: "" },
          candy: { score: null, time: "" },
          pelican: { score: null, time: "" }
        }
      }
    };
  }

  function stripDemo(saved) {
    const demo = /^(b[1-4]|c[0-4]|cp\d+|p[1-4])$/;
    const next = blank();
    next.tasks = (saved.tasks || []).filter((item) => item && item.id && !demo.test(item.id));
    next.basicReport = saved.basicReport || null;
    return next;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  let endpoint = { baseUrl: "", apiKey: "", modelOverride: "" };
  let opening = null;

  function init() {
    if (!opening) opening = openSite();
    return opening;
  }

  async function openSite() {
    if (!state) {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) state = blank();
        else {
          const saved = JSON.parse(raw);
          state = !saved.version || saved.version < 2 ? stripDemo(saved) : saved;
        }
      } catch (err) {
        state = blank();
      }
      if (!state || !Array.isArray(state.tasks)) state = blank();
      if (!Array.isArray(state.recent)) state.recent = [];
      if (!state.snapshot || !state.snapshot.parts) state.snapshot = blank().snapshot;
      recalc();
    }
    await loadEndpoint();
    return state;
  }

  function user() {
    try {
      const raw = sessionStorage.getItem(USER) || localStorage.getItem(USER);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function setUser(account, remember) {
    const name = account.trim();
    const record = { account: name, name };
    sessionStorage.removeItem(USER);
    localStorage.removeItem(USER);
    (remember ? localStorage : sessionStorage).setItem(USER, JSON.stringify(record));
    return record;
  }

  function logout() {
    sessionStorage.removeItem(USER);
    localStorage.removeItem(USER);
  }

  function api() {
    return { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, modelOverride: endpoint.modelOverride };
  }

  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function b64ToBytes(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function sealDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("model-eval-seal-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function sealingKey() {
    if (!crypto.subtle) throw new Error("当前页面不能加密保存密钥");
    const db = await sealDb();
    const existing = await new Promise((resolve, reject) => {
      const request = db.transaction("keys", "readonly").objectStore("keys").get("aes");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await new Promise((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, "aes");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return key;
  }

  async function encryptText(text) {
    const key = await sealingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
    return { iv: bytesToB64(iv), data: bytesToB64(cipher) };
  }

  async function decryptText(box) {
    if (!box || !box.data) return "";
    const key = await sealingKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
    return new TextDecoder().decode(plain);
  }

  async function saveApi(cfg) {
    const apiKey = String(cfg.apiKey || "").trim();
    const record = {
      v: 2,
      baseUrl: String(cfg.baseUrl || "").trim(),
      modelOverride: String(cfg.modelOverride || "").trim(),
      apiKey: apiKey ? await encryptText(apiKey) : { iv: "", data: "" }
    };
    localStorage.setItem(APIKEY, JSON.stringify(record));
    endpoint = { baseUrl: record.baseUrl, apiKey, modelOverride: record.modelOverride };
  }

  async function loadEndpoint() {
    try {
      const raw = localStorage.getItem(APIKEY);
      if (!raw) {
        endpoint = { baseUrl: "", apiKey: "", modelOverride: "" };
        return;
      }
      const saved = JSON.parse(raw);
      const next = {
        baseUrl: String(saved.baseUrl || "").trim(),
        modelOverride: String(saved.modelOverride || "").trim(),
        apiKey: saved && saved.v === 2 ? await decryptText(saved.apiKey) : String(saved.apiKey || "")
      };
      endpoint = next;
      if (!saved || saved.v !== 2) await saveApi(next);
    } catch (err) {
      endpoint = { baseUrl: "", apiKey: "", modelOverride: "" };
    }
  }

  function tasks() { return state.tasks; }
  function task(id) { return state.tasks.find((item) => item.id === id) || null; }

  function recentHref(item) {
    if (item.status === "running") return "run.html?id=" + encodeURIComponent(item.id);
    if (item.status === "done") return "result.html?id=" + encodeURIComponent(item.id);
    if (item.status === "pending") return "setup.html?type=" + encodeURIComponent(item.kind) + "&task=" + encodeURIComponent(item.id);
    if (item.kind === "candy") return "candy.html";
    if (item.kind === "pelican") return "pelican.html";
    return "basic.html";
  }

  function syncRecent() {
    const rows = state.tasks.filter((item) => item.source !== "demo" && !(item.suiteId && item.status === "pending")).map((item) => {
      const meta = typeof DATA !== "undefined" && DATA.kinds ? DATA.kinds[item.kind] : null;
      const status = item.status === "running" || item.status === "pending" || item.status === "stopped" ? item.status : "done";
      return {
        kind: Engine.moduleOf(item.kind),
        name: item.modelName ? (item.name || (meta && meta.label) || "测试") + " · " + item.modelName : (item.name || (meta && meta.label) || "测试"),
        href: recentHref(item),
        status,
        time: item.finishedAt || item.createdAt || ""
      };
    });
    const report = state.basicReport;
    if (report && report.time) {
      const running = report.items && Object.keys(report.items).some((key) => report.items[key] && report.items[key].status === "run");
      rows.push({
        kind: "relay",
        name: report.modelName ? "中转站测试 · " + report.modelName : "中转站测试",
        href: "relay.html",
        status: running ? "running" : "done",
        time: report.time
      });
    }
    const snap = state.snapshot;
    if (snap && snap.score != null) {
      rows.push({
        kind: "detect",
        name: snap.modelName ? "模型检测 · " + snap.modelName : "模型检测",
        href: "detect.html",
        status: "done",
        time: snap.time || ""
      });
    }
    rows.sort((a, b) => Engine.parseTime(b.time) - Engine.parseTime(a.time));
    state.recent = rows.slice(0, 8);
  }

  function touchRecent() {
    syncRecent();
  }

  function addTask(partial) {
    const id = "t" + Date.now().toString(36) + Math.floor(Engine.hash(String(partial.suiteStep || 0) + ":" + (partial.name || "")) * 1000);
    const task = Object.assign({
      id,
      items: [],
      cursor: 0,
      status: "running",
      score: null,
      stability: null,
      stabilityLocked: false,
      createdAt: Engine.now()
    }, partial);
    task.source = task.source || "live";
    if (task.pelicanMode) {
      task.items = [];
      task.count = 1;
    } else if (!task.items.length) {
      task.items = Engine.makeItems({
        kind: task.kind,
        difficulty: task.difficulty,
        count: task.count,
        modelId: task.requestedModel || task.modelId,
        seed: id,
        live: task.source === "live"
      });
    }
    if (task.kind === "pelican") task.stability = Engine.roundStability(task.items);
    state.tasks.unshift(task);
    touchRecent(task.kind);
    save();
    return task;
  }

  function startPending(id) {
    const item = task(id);
    if (!item) return null;
    if (!item.items.length && !item.pelicanMode) {
      item.source = "live";
      item.items = Engine.makeItems({
        kind: item.kind,
        difficulty: item.difficulty,
        count: item.count,
        modelId: item.requestedModel || item.modelId,
        seed: item.seed || id,
        live: true
      });
    }
    item.status = "running";
    item.cursor = item.cursor || 0;
    if (item.kind === "pelican" && item.stability == null) item.stability = Engine.roundStability(item.items);
    touchRecent(item.kind);
    save();
    return item;
  }

  function finish(id) {
    const item = task(id);
    if (!item) return null;
    item.cursor = item.items.length;
    item.status = "done";
    item.finishedAt = Engine.now();
    if (item.pelicanMode) {
      item.score = item.html ? Api.scoreArtwork(item.html) : 0;
    } else {
      if (item.kind === "pelican" && !item.stabilityLocked) item.stability = Engine.roundStability(item.items);
      item.score = Engine.scoreOf(item);
    }
    touchRecent(item.kind);
    recalc();
    return item;
  }

  function stop(id) {
    const item = task(id);
    if (!item || item.status !== "running") return;
    item.status = "stopped";
    touchRecent(item.kind);
    save();
  }

  function remove(id) {
    const item = task(id);
    state.tasks = state.tasks.filter((row) => row.id !== id);
    if (item) touchRecent(item.kind);
    recalc();
  }

  function isScored(item) {
    return !!item && item.status === "done" && item.source !== "demo" && Number.isFinite(Number(item.score));
  }

  function saveCursor(id, cursor) {
    const item = task(id);
    if (!item) return;
    item.cursor = cursor;
    save();
  }

  function latestDone(pred) {
    return state.tasks
      .filter((item) => item.status === "done" && pred(item))
      .sort((a, b) => Engine.parseTime(b.finishedAt || b.createdAt) - Engine.parseTime(a.finishedAt || a.createdAt))[0] || null;
  }

  function recalc() {
    const subtypes = ["ability", "logic", "code", "qa"];
    const subScores = subtypes.map((kind) => {
      const found = latestDone((item) => item.kind === kind && isScored(item));
      return found ? Number(found.score) : null;
    }).filter((score) => score != null);
    const basic = subScores.length ? Math.round(subScores.reduce((sum, score) => sum + score, 0) / subScores.length) : null;
    const basicTask = latestDone((item) => Engine.moduleOf(item.kind) === "basic" && isScored(item));
    const candyTask = latestDone((item) => item.kind === "candy" && isScored(item));
    const pelicanTask = latestDone((item) => item.kind === "pelican" && isScored(item));
    const candy = candyTask ? Number(candyTask.score) : null;
    const pelican = pelicanTask ? Number(pelicanTask.score) : null;
    const ready = basic != null && candy != null && pelican != null;
    const overall = ready ? Math.round(basic * 0.4 + candy * 0.35 + pelican * 0.25) : null;
    const latest = [basicTask, candyTask, pelicanTask].filter(Boolean).sort((a, b) => Engine.parseTime(b.finishedAt || b.createdAt) - Engine.parseTime(a.finishedAt || a.createdAt))[0] || null;
    const names = [basicTask, candyTask, pelicanTask].filter(Boolean).map((item) => item.modelName).filter(Boolean);
    const unique = Array.from(new Set(names));
    const when = overall == null || !latest ? "" : (latest.finishedAt || latest.createdAt || "");
    state.snapshot = {
      frozen: false,
      score: overall,
      time: when,
      modelName: overall == null ? "" : (unique.length > 1 ? unique.join(" / ") : (unique[0] || "")),
      parts: {
        meta: { score: overall, time: when },
        basic: { score: basic, time: basicTask ? (basicTask.finishedAt || "") : "" },
        candy: { score: candy, time: candyTask ? (candyTask.finishedAt || "") : "" },
        pelican: { score: pelican, time: pelicanTask ? (pelicanTask.finishedAt || "") : "" }
      }
    };
    syncRecent();
    save();
    return state.snapshot;
  }

  function reset() {
    state = blank();
    save();
  }

  function basicReport() {
    return state.basicReport || null;
  }

  function saveBasicReport(report) {
    state.basicReport = report;
    syncRecent();
    save();
  }

  function candyStats() {
    const list = state.tasks.filter((item) => item.kind === "candy");
    return {
      total: list.length,
      done: list.filter((item) => item.status === "done").length,
      running: list.filter((item) => item.status === "running").length
    };
  }

  return { init, save, user, setUser, logout, api, saveApi, tasks, task, addTask, startPending, finish, stop, remove, saveCursor, recalc, reset, candyStats, basicReport, saveBasicReport, latestDone, get: () => state };
})();
