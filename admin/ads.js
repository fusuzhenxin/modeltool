/* Advertisement material editor; uploads use the existing authenticated media API. */
const AdminAds = {
  placements: [
    ["masthead", "顶部通栏（1 条，以文字为主）"],
    ["banner", "首屏横幅（1 条，建议 1200 × 200）"],
    ["hero", "顶部赞助商（最多 5 条，建议 600 × 240）"],
    ["left", "全站赞助位 · 左侧（所有页面，1 条）"],
    ["right", "全站赞助位 · 右侧（所有页面，1 条）"],
    ["footer", "页尾赞助商（最多 5 条，建议 600 × 240）"],
    ["top_bottom", "顶部＋底部套餐（各 1 个赞助商卡片）"],
    ["full", "全包套餐（顶部＋底部＋横幅＋左或右侧）"]
  ],
  fields(record, input, area, select) {
    return `<section class="ad-material-intro"><strong>让中转站的特色，一眼可见</strong><p>上传品牌图片，配上名称、介绍和官网链接。右侧预览会随填写更新。</p></section><div class="ad-material-editor"><div class="ad-material-fields">`
      + input("name", "内部名称", record.name, "text", "仅后台识别使用", 'required maxlength="80"')
      + input("title", "中转站 / 广告标题", record.title, "text", "前台展示的名称", 'required maxlength="100"')
      + `<div class="ad-upload"><label class="ad-upload-picker"><span class="ad-upload-icon" aria-hidden="true">↑</span><strong>上传中转站图片</strong><span>点击选择，或将图片拖到这里</span><small>PNG / JPEG / WebP · 最大 2MB</small><input type="file" data-upload="image" accept="image/png,image/jpeg,image/webp" aria-label="上传中转站广告图片"></label><span class="upload-status" role="status" aria-live="polite"></span></div>`
      + `<div class="ad-image-address">${input("image", "图片地址（也可直接粘贴）", record.image, "text", "上传后自动填入；外部图片请用 HTTPS 地址。", 'maxlength="500"')}<button type="button" class="text-btn" data-ad-remove>移除图片</button></div>`
      + area("description", "中转站介绍 / 广告描述", record.description, '介绍支持的模型、接入方式或服务特色。<span data-ad-count>0</span> / 250 字', 'maxlength="250" rows="4" placeholder="例如：面向开发者的多模型 API 接入，提供接入文档、用量管理与团队协作。"')
      + input("link", "中转站跳转链接", record.link, "url", "点击广告后，在新标签页打开此地址。", 'required maxlength="500"')
      + select("placement", "展示位置 / 套餐", AdminAds.placements, record.placement === "dock" ? "left" : record.placement === "inline" ? "footer" : record.placement || "hero")
      + `<div data-ad-side>${select("side", "全包侧栏位置", [["left", "左侧全站赞助位"], ["right", "右侧全站赞助位"]], record.side || "left")}</div>`
      + `</div><aside class="ad-material-preview"><div class="ad-preview-heading"><strong>素材预览</strong><span data-ad-preview-mode></span></div><div class="ad-preview-surface" data-ad-preview></div><p class="ad-preview-note" data-ad-preview-note></p></aside></div>`;
  },
  targets(record) {
    if (record.placement === "top_bottom") return ["hero", "footer"];
    if (record.placement === "full") return ["hero", "footer", "banner", record.side || "left"];
    return [record.placement === "dock" ? "left" : record.placement];
  },
  markup(record, slot, esc) {
    const content = slot === "masthead"
      ? `<div class="ad-masthead"><div class="ad-masthead-inner"><span class="ad-disclosure">推广</span><a><strong>${esc(record.title)}</strong><span>${esc(record.description)}</span><b>↗</b></a></div></div>`
      : Ads.card(record, 0, ["hero", "footer"].includes(slot) ? "card" : ["left", "right"].includes(slot) ? "floating" : "banner", esc);
    const label = this.placements.find(([key]) => key === slot)?.[1].split("（")[0] || slot;
    return `<section class="adops-preview-placement"><p>${esc(label)}</p><div class="ad-zone ad-zone--${slot}"><div class="ad-creatives">${content}</div></div></section>`;
  },
  imageUrl(value) {
    if (!value || !value.trim()) return "";
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
      return url.protocol === "https:" || url.origin === location.origin ? url.href : "";
    } catch (_) { return ""; }
  },
  update(form) {
    const preview = form?.querySelector("[data-ad-preview]");
    if (!preview) return;
    const value = (key) => form.elements.namedItem(key).value.trim();
    const title = value("title") || "你的中转站名称";
    const description = value("description") || "在这里介绍支持的模型、接入方式与服务特色。";
    const placement = value("placement");
    const record = { title, description, placement, side: value("side"), image: AdminAds.imageUrl(value("image")), link: value("link") || location.origin };
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    preview.className = "ad-preview-surface";
    preview.innerHTML = this.targets(record).map(slot => this.markup(record, slot, esc)).join("");
    form.querySelector('[data-ad-side]').hidden = placement !== "full";
    form.querySelector("[data-ad-count]").textContent = form.elements.namedItem("description").value.length;
    form.querySelector("[data-ad-preview-mode]").textContent = AdminAds.placements.find(([key]) => key === placement)[1].split("（")[0];
    form.querySelector("[data-ad-preview-note]").textContent = ["top_bottom", "full"].includes(placement) ? "套餐统一素材、链接和排期；保存时同时校验全部包含位置，套餐价格单独设置。" : ["left", "right"].includes(placement) ? "全站所有前台页面展示；空间不足时转为页内推荐，避免遮挡正文。" : "复用前台广告样式；顶部与页尾卡片一致，图片完整显示。";
    form.querySelector("[data-ad-remove]").disabled = !value("image");
  },
  enhance(root) {
    const form = root.querySelector('form[data-kind="ads"]');
    root.classList.toggle("ad-editor-dialog", Boolean(form));
    if (!form) return;
    form.addEventListener("input", () => AdminAds.update(form));
    form.addEventListener("change", () => AdminAds.update(form));
    form.querySelector("[data-ad-remove]").addEventListener("click", () => {
      form.elements.namedItem("image").value = "";
      form.querySelector('[data-upload="image"]').value = "";
      form.querySelector(".upload-status").textContent = "图片已移除，保存后生效";
      AdminAds.update(form);
    });
    AdminAds.update(form);
  }
};
