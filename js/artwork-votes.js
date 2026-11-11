/* Votes are visitor opinions, separate from measured scores. */
const ArtworkVotes = {
  ticket: 0,
  async api(path, method = "GET", data, csrf = "") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-Proposal-CSRF": csrf },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      if (response.status === 404) throw new Error("投票接口尚未更新，请重启本地后台或刷新线上页面");
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "票数暂时无法加载，请重试");
      return body;
    } finally { clearTimeout(timer); }
  },
  render(box, data, message = "", busy = false) {
    const esc = UI.esc;
    box.innerHTML = `<div class="artwork-vote-buttons">${[["real", "判真", "✓"], ["fake", "判假", "×"]].map(([choice, label, icon]) => `<button type="button" class="artwork-vote-${choice}" data-artwork-choice="${choice}" aria-pressed="${data?.choice === choice}" ${busy || !data ? "disabled" : ""}><span aria-hidden="true">${icon}</span>${label}<b>${data ? esc(data[choice]) : "—"}</b></button>`).join("")}</div><small role="status" aria-live="polite" ${message ? "" : "hidden"}>${esc(message)}</small>`;
  },
  async mount() {
    const ticket = ++ArtworkVotes.ticket;
    const boxes = [...document.querySelectorAll("[data-artwork-votes]")];
    if (!boxes.length) return;
    const current = () => ticket === ArtworkVotes.ticket;
    if (typeof PublicData === "undefined" || !PublicData.live || PublicData.failed) {
      boxes.forEach((box) => ArtworkVotes.render(box, null, "连接运营后台后可参与投票"));
      return;
    }
    let session;
    try {
      session = await ArtworkVotes.api("/api/public/proposal-session");
      if (!current()) return;
      const query = new URLSearchParams({ ids: boxes.map((box) => box.dataset.artworkVotes).join(",") });
      const result = await ArtworkVotes.api("/api/public/artwork-votes?" + query);
      if (!current()) return;
      boxes.forEach((box) => {
        const id = box.dataset.artworkVotes;
        let state = result.items[id];
        let busy = false;
        ArtworkVotes.render(box, state, state ? undefined : "作品已撤回或暂不可投票");
        box.onclick = async (event) => {
          const button = event.target.closest("[data-artwork-choice]");
          if (!button || !state || busy || !current()) return;
          busy = true;
          const choice = state.choice === button.dataset.artworkChoice ? null : button.dataset.artworkChoice;
          ArtworkVotes.render(box, state, "正在保存…", true);
          try {
            const updated = await ArtworkVotes.api(`/api/public/reports/${encodeURIComponent(id)}/artwork-vote`, "PUT", { choice }, session.csrf);
            if (!current()) return;
            state = updated;
            ArtworkVotes.render(box, state, choice ? "已记录" : "已撤回");
          } catch (error) {
            if (current()) ArtworkVotes.render(box, state, error.message || "提交失败，请重试");
          } finally { busy = false; }
        };
      });
    } catch (error) {
      if (!current()) return;
      boxes.forEach((box) => {
        ArtworkVotes.render(box, null, error.message || "票数暂时无法加载");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "artwork-vote-retry";
        retry.textContent = "重试";
        retry.onclick = () => ArtworkVotes.mount();
        box.appendChild(retry);
      });
    }
  }
};
