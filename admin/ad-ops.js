/* Advertising operations: inventory and private order records. */
const AdminAdOps = {
  esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  money(cents) { return cents == null ? "待定" : "¥" + (cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  date(value) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "不限"; },
  states: { draft: "草稿", reserved: "已预订", published: "已上架", paused: "暂停展示", cancelled: "已取消" },
  status(row) {
    const status = row.booking_status || (row.enabled ? "published" : "draft");
    if (["draft", "cancelled"].includes(status)) return AdminAdOps.states[status];
    if (row.ends_at && Date.parse(row.ends_at) <= Date.now()) return "已到期";
    if (status === "reserved") return "已预订";
    if (status === "paused" || !row.enabled) return "暂停展示";
    return row.starts_at && Date.parse(row.starts_at) > Date.now() ? "待开始" : "展示中";
  },
  render(data) {
    this.data = data;
    const E = this.esc, M = this.money, totals = data.totals;
    const startDate = data.start.slice(0, 10), endDate = data.end.slice(0, 10);
    return `<div class="booking-workspace"><div class="adops-top"><div><span class="adops-eyebrow">ADVERTISING OPERATIONS</span><h2>广告投放工作台</h2><p>先看空位，再安排投放。价格未设置时统一显示待定。</p></div><div><a class="btn" href="#ad-analytics">流量分析</a> <button class="btn" data-adop="refresh">刷新</button> <button class="btn primary" data-adop="new">＋ 新建广告订单</button></div></div>
    <div class="adops-metrics">${[["广告总容量", totals.capacity + " 个", "六类实际位置，套餐共用名额"], ["所选区间可售", totals.remaining + " 个", "每个位置全程可用的最少空位"], ["7 天内到期", totals.expiring + " 单", "请及时安排续期或换素材"], ["有效订单实收", M(totals.received_cents), "已定合同 " + M(totals.contract_cents) + " · " + (totals.pending_contracts || 0) + " 单待定"]].map(([label, value, hint]) => `<section class="card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></section>`).join("")}</div>
    <form class="adops-range" data-adop-range><label>开始日期（北京时间）<input name="start" type="date" required value="${E(startDate)}"></label><label>结束日期（不含当天）<input name="end" type="date" required value="${E(endDate)}"></label><button class="btn" type="submit">查询排期与空位</button><span>支持最多 366 天；结束时刻释放名额。</span><div class="error-box" role="alert"></div></form>
    <div class="adops-slots">${data.slots.map(slot => `<section class="card adops-slot"><div><h3>${E(slot.label)}</h3><span class="chip ${slot.remaining ? "green" : "orange"}">${slot.remaining ? "可售 " + slot.remaining + " / " + slot.capacity : "已满"}</span></div><p>${E(slot.spec)}</p><div class="adops-rate"><span>天 <b>${M(slot.daily_cents)}</b></span><span>周 <b>${M(slot.weekly_cents)}</b></span><span>月 <b>${M(slot.monthly_cents)}</b></span></div><p>当前占用 ${slot.occupied_now} · 区间最多占用 ${slot.peak_booked}${slot.overbooked ? ' <b class="adops-warning">历史排期超额 ' + slot.overbooked + '</b>' : ""}</p><div class="adops-slot-foot"><span>${slot.accepting ? "开放接单" : "暂停接单"}</span><button class="text-btn" data-adop="price" data-id="${slot.key}">定价 / 设置</button><button class="text-btn" data-adop="new" data-id="${slot.key}">安排投放</button></div></section>`).join("")}</div>
    ${this.packageCards(data)}
    <section class="card adops-calendar"><div class="card-head"><h2>排期日历 <small>数字为当日最少剩余名额</small></h2></div><div class="adops-scroll"><table><thead><tr><th>位置 / 总容量</th>${data.calendar.map(day => `<th title="${E(day.start)}">${day.date}</th>`).join("")}</tr></thead><tbody>${data.slots.map(slot => `<tr><th>${E(slot.label)} / ${slot.capacity}</th>${data.calendar.map(day => `<td><span class="adops-cell ${day.slots[slot.key] === 0 ? "full" : day.slots[slot.key] < slot.capacity ? "partial" : ""}">${day.slots[slot.key]}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div></section>
    <section class="card adops-orders"><div class="card-head"><h2>广告订单与素材 <small>${data.records.length} 条记录</small></h2><button class="text-btn" data-adop="export">导出订单 CSV</button></div><div class="adops-filters"><input data-adop-search type="search" placeholder="搜索客户、订单号、广告名称…" aria-label="搜索广告订单"><select data-adop-slot aria-label="筛选广告位置"><option value="">全部位置</option>${this.products().map(s => `<option value="${s.key}">${E(s.label)}</option>`).join("")}</select><select data-adop-status aria-label="筛选广告状态"><option value="">全部状态</option>${[...Object.values(this.states), "展示中", "待开始", "已到期"].map(v => `<option>${v}</option>`).join("")}</select></div><div class="adops-scroll"><table><thead><tr><th>素材 / 客户</th><th>位置 / 排期</th><th>状态 / 剩余</th><th>合同 / 实收</th><th>累计曝光 / 点击</th><th>操作</th></tr></thead><tbody data-adop-rows></tbody></table></div></section>
    <details class="card adops-history"><summary>最近操作记录</summary>${this.history(data)}${data.audit.map(a => `<p><time>${this.date(a.at * 1000)}</time><b>${E(a.actor)}</b><span>${E(({ created_ads: "新建广告订单", updated_ads: "更新广告订单", deleted_ads: "删除草稿", updated_ad_prices: "修改位置定价" })[a.action] || a.action)}</span><code>${E(a.target)}</code></p>`).join("") || '<p>暂无记录</p>'}</details><p class="adops-footnote">草稿不占位；预订、上架及暂停展示均保留排期，取消后释放。参考报价按天 / 7 天 / 30 天向上取整，合同金额单独记录。所有客户联系、备注与金额仅后台可见。</p></div>`;
  },
  rows() {
    const root = this.root, E = this.esc, data = this.data;
    const search = root.querySelector('[data-adop-search]').value.toLowerCase().trim();
    const slot = root.querySelector('[data-adop-slot]').value;
    const status = root.querySelector('[data-adop-status]').value;
    this.filtered = data.records.filter(r => (!search || [r.name, r.title, r.advertiser, r.contact, r.order_code].join(" ").toLowerCase().includes(search)) && (!slot || r.placement === slot || AdminAds.targets(r).includes(slot)) && (!status || this.status(r) === status || this.states[r.booking_status] === status));
    root.querySelector('[data-adop-rows]').innerHTML = this.filtered.map(r => {
      const st = this.status(r);
      const end = r.remaining_days == null ? "未设截止" : r.remaining_days === 0 ? "已结束" : "剩余 " + r.remaining_days + " 天";
      const outstanding = r.contract_cents == null ? "合同待定" : "待收 " + this.money(Math.max(0, r.contract_cents - (r.received_cents || 0)));
      const action = (id, label) => `<button class="text-btn" data-adop="${id}" data-id="${E(r.id)}">${label}</button>`;
      return `<tr><td><div class="adops-material">${r.image ? `<img src="${E(r.image)}" alt="" loading="lazy">` : '<span class="adops-noimage">AD</span>'}<div><strong>${E(r.name)}</strong><span>${E(r.advertiser || "未填写客户")}</span><small>${E(r.order_code || r.id)}</small></div></div></td><td><strong>${E(this.productLabel(r))}</strong><span class="sub">${this.date(r.starts_at)} →</span><span class="sub">${this.date(r.ends_at)}</span></td><td><span class="chip ${st === "展示中" ? "green" : st === "草稿" ? "" : "blue"}">${st}</span><span class="sub ${r.remaining_days > 0 && r.remaining_days <= 7 ? "adops-warning" : ""}">${end}</span></td><td>${this.money(r.contract_cents)}<span class="sub">实收 ${this.money(r.received_cents || 0)}</span><span class="sub">${outstanding}</span></td><td>${(data.traffic_totals?.[r.id]?.impressions || 0).toLocaleString("zh-CN")} / ${(data.traffic_totals?.[r.id]?.clicks || 0).toLocaleString("zh-CN")}<span class="sub">全部流量 · 含已识别自动化</span></td><td class="adops-actions">${action("preview", "预览 / 上架")}${action("analytics", "流量数据")}${action("edit", "编辑")}${action("copy", "复制")}${action("renew", "续期")}${r.booking_status === "published" ? action("pause", "暂停") : ""}${r.booking_status !== "cancelled" ? action("cancel", "取消投放") : ""}${r.booking_status === "draft" && !r.received_cents && !r.contract_cents ? action("delete", "删除草稿") : ""}</td></tr>`;
    }).join("") || '<tr><td colspan="6" class="adops-empty">没有匹配的广告订单。点击“新建广告订单”上传素材并安排排期。</td></tr>';
  },
  slotKey(key) { return key === "dock" ? "left" : key; },
  products() { return [...this.data.slots, ...(this.data.packages || [])]; },
  productLabel(row) {
    const label = this.products().find(s => s.key === this.slotKey(row.placement))?.label || "已停用位置";
    return label + (row.placement === "full" ? row.side === "right" ? " · 右侧" : " · 左侧" : "");
  },
  packageCards(data) {
    const E = this.esc, M = this.money;
    return `<div class="adops-package-heading"><h3>组合套餐</h3><p>一笔订单统一排期、统一素材，同时占用套餐内的实际位置；套餐单独定价。</p></div><div class="adops-slots adops-packages">${(data.packages || []).map(product => `<section class="card adops-slot"><div><h3>${E(product.label)}</h3><span class="chip ${product.remaining ? "green" : "orange"}">可售 ${product.remaining} 套</span></div><p>${E(product.spec)}</p><div class="adops-rate"><span>天 <b>${M(product.daily_cents)}</b></span><span>周 <b>${M(product.weekly_cents)}</b></span><span>月 <b>${M(product.monthly_cents)}</b></span></div><p>${product.key === "full" ? `选左侧可售 ${product.variants.left} 套 · 选右侧可售 ${product.variants.right} 套` : "顶部、底部各占一个卡片名额，任一位置满额则无法预订。"}</p><div class="adops-slot-foot"><span>${product.accepting ? "开放接单" : "暂停接单"}</span><button class="text-btn" data-adop="price" data-id="${product.key}">套餐定价</button><button class="text-btn" data-adop="new" data-id="${product.key}">预订套餐</button></div></section>`).join('')}</div>`;
  },
  history(data) {
    const labels = { name: "内部名称", title: "标题", description: "描述", image: "图片", link: "跳转链接", placement: "广告位置 / 套餐", side: "全包侧栏", booking_status: "订单状态", enabled: "启用展示", starts_at: "开始时间", ends_at: "结束时间", order: "排序", advertiser: "客户", contact: "联系方式", internal_note: "内部备注", billing_unit: "计价方式", contract_cents: "合同金额", received_cents: "累计实收", daily_cents: "日价", weekly_cents: "周价", monthly_cents: "月价", accepting: "开放接单", note: "位置备注" };
    const value = (key, v) => {
      if (key.endsWith('_cents')) return this.money(v);
      if (v == null || v === '') return "未填写";
      if (typeof v === 'boolean') return v ? "是" : "否";
      if (key === 'booking_status') return this.states[v] || v;
      if (key === 'placement') return this.products().find(s => s.key === this.slotKey(v))?.label || v;
      if (key === 'side') return v === 'right' ? '右侧全站赞助位' : '左侧全站赞助位';
      if (key === 'billing_unit') return ({ day: "按天", week: "按周", month: "按月" })[v] || v;
      return v;
    };
    return (data.events || []).map(event => `<details class="adops-event"><summary>${this.date(event.at * 1000)} · ${this.esc(event.actor)} · ${this.esc(({ created: "新建", updated: "修改", deleted: "删除草稿", prices: "修改定价" })[event.action] || event.action)} · ${this.esc(event.name)}</summary><div>${Object.entries(event.changes).map(([key, change]) => `<p><b>${this.esc(labels[key] || key)}</b><span>${this.esc(value(key, change.before))} → ${this.esc(value(key, change.after))}</span></p>`).join('')}</div></details>`).join('');
  },
  mount(root, context, data) {
    this.root = root; this.context = context; if (data) this.data = data;
    AdminSelect.enhance(root.querySelector(".booking-workspace"));
    this.rows();
    root.querySelector('[data-adop-search]').addEventListener('input', () => this.rows());
    root.querySelectorAll('[data-adop-slot],[data-adop-status]').forEach(el => el.addEventListener('change', () => this.rows()));
    root.querySelector('[data-adop-range]').addEventListener('submit', async event => {
      event.preventDefault(); event.stopPropagation();
      const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
      try {
        const params = new URLSearchParams({ start: form.elements.start.value + "T00:00:00+08:00", end: form.elements.end.value + "T00:00:00+08:00" });
        const result = await context.api("admin/advertising/overview?" + params);
        root.querySelector('.booking-workspace').outerHTML = this.render(result); this.data = result; this.mount(root, context);
      } catch (e) { form.querySelector('.error-box').textContent = e.message; }
      finally { button.disabled = false; }
    });
    // Replace the handler when a query rerenders the workspace.
    root.onclick = event => {
      const button = event.target.closest('[data-adop]');
      if (!button) return;
      this.action(button.dataset.adop, button.dataset.id).catch(e => context.toast(e.message, true));
    };
  },
  clean(row) {
    const keys = ["name", "title", "description", "image", "link", "placement", "side", "starts_at", "ends_at", "order", "enabled", "booking_status", "advertiser", "contact", "internal_note", "billing_unit", "contract_cents", "received_cents"];
    return Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
  },
  async action(action, id) {
    const c = this.context, row = this.data.records.find(r => r.id === id);
    if (action === "refresh") return c.refresh();
    if (action === "new") return this.edit({ placement: id || "hero", booking_status: "draft", enabled: true });
    if (action === "price") return this.price(this.products().find(s => s.key === id));
    if (action === "analytics") return AdminAdAnalytics.open(id);
    if (action === "edit") return this.edit(row);
    if (action === "preview") return this.preview(row);
    if (action === "copy" || action === "renew") {
      const next = { ...this.clean(row), booking_status: "draft", received_cents: 0, contract_cents: null, name: row.name.slice(0, 70) + (action === "renew" ? " · 续期" : " · 副本") };
      if (action === "renew") {
        const start = Math.max(Date.now(), row.ends_at ? Date.parse(row.ends_at) : Date.now());
        const duration = row.starts_at && row.ends_at ? Date.parse(row.ends_at) - Date.parse(row.starts_at) : 30 * 86400000;
        next.starts_at = new Date(start).toISOString(); next.ends_at = new Date(start + duration).toISOString();
      }
      return this.edit(next);
    }
    if (action === "delete") {
      if (!confirm("确定删除此草稿？")) return;
      await c.api("admin/ads/" + id, "DELETE");
    } else if (["pause", "cancel"].includes(action)) {
      if (!confirm(action === "pause" ? "暂停展示并保留原排期？" : "取消投放并释放排期？合同和实收记录会保留。")) return;
      await c.api("admin/ads/" + id, "PUT", { ...this.clean(row), booking_status: action === "pause" ? "paused" : "cancelled" });
    } else if (action === "export") return this.export();
    c.toast("已保存"); await c.refresh();
  },
  moneyInput(key, label, value, hint = "") { return this.context.input(key, label, value == null ? "" : (value / 100).toFixed(2), "number", hint, 'min="0" max="100000000" step="0.01"'); },
  cents(form, key, optional = true) {
    const value = form.elements.namedItem(key).value.trim();
    if (!value) return optional ? null : 0;
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("金额请输入非负数，最多两位小数");
    return cents;
  },
  bindForm(handler) {
    const form = document.querySelector('#editor form');
    form.addEventListener('submit', async event => {
      event.preventDefault(); event.stopPropagation();
      const button = form.querySelector('[type="submit"]'), error = form.querySelector('.error-box');
      error.textContent = ""; button.disabled = true;
      try { await handler(form); document.getElementById('editor').close(); this.context.toast("已保存"); await this.context.refresh(); }
      catch (e) { error.textContent = e.message; }
      finally { button.disabled = false; }
    });
    return form;
  },
  price(slot) {
    const c = this.context;
    c.openDialog(slot.label + " · 定价与接单", `<p class="tabs-note">人民币，每个名额。留空为待定，0 表示免费。修改单价不改变已登记的合同金额。</p><div class="field-row">${this.moneyInput("daily_cents", "每天价格（元）", slot.daily_cents)}${this.moneyInput("weekly_cents", "每周价格（元）", slot.weekly_cents)}</div>${this.moneyInput("monthly_cents", "每月价格（元，30 天）", slot.monthly_cents)}${c.select("accepting", "接单状态", [["true", "开放接单"], ["false", "暂停新增预订"]], String(slot.accepting))}${c.area("note", "位置内部备注", slot.note, "例如合作条件、素材要求；仅后台可见。", 'maxlength="500"')}`, "adops-price", "保存定价");
    this.bindForm(async form => {
      await c.api("admin/advertising/prices/" + slot.key, "PUT", { daily_cents: this.cents(form, "daily_cents"), weekly_cents: this.cents(form, "weekly_cents"), monthly_cents: this.cents(form, "monthly_cents"), accepting: form.elements.accepting.value === "true", note: form.elements.note.value.trim() });
    });
  },
  edit(row) {
    const c = this.context, E = this.esc;
    const body = AdminAds.fields(row, c.input, c.area, c.select)
      + `<h3 class="adops-form-heading">客户与排期</h3><div class="field-row">${c.input("advertiser", "广告客户 / 中转站", row.advertiser || "", "text", "仅后台可见", 'maxlength="120"')}${c.input("contact", "客户联系方式", row.contact || "", "text", "微信、邮箱或其他联系方式", 'maxlength="250"')}</div><div class="field-row">${c.input("starts_at", "开始时间", c.localValue(row.starts_at), "datetime-local", "按当前设备时区输入；留空不限制开始")}${c.input("ends_at", "结束时间", c.localValue(row.ends_at), "datetime-local", "结束时自动停止展示；留空为长期占位")}</div><div class="field-row">${c.select("booking_status", "订单状态", Object.entries(this.states).filter(([k]) => k !== "published" || row.booking_status === "published"), row.booking_status || "draft")}${c.input("order", "展示排序", row.order || 0, "number", "数字越小越靠前", 'min="-10000" max="10000" step="1"')}</div><p class="tabs-note">预订和暂停展示都会占位；草稿不占位。首次上架请保存后点击“预览 / 上架”。</p><h3 class="adops-form-heading">报价与收款</h3>${c.select("billing_unit", "参考计价方式", [["day", "按天"], ["week", "按周（7 天）"], ["month", "按月（30 天）"]], row.billing_unit || "day")}<div class="adops-quote" data-adop-quote></div><div class="field-row">${this.moneyInput("contract_cents", "合同总金额（元）", row.contract_cents, "留空为待定；可填写协商后的总价")}${this.moneyInput("received_cents", "累计实收金额（元）", row.received_cents || 0, "手工记录到账金额；退款后更新为净实收")}</div>${c.area("internal_note", "内部订单备注", row.internal_note || "", "仅后台可见，可记录付款、合同、素材更换和沟通情况。", 'maxlength="2000" rows="4"')}<p class="tabs-note">${row.order_code ? "订单号 " + E(row.order_code) : "保存后自动生成订单号"}</p>`;
    c.openDialog(row.id ? "编辑广告订单" : "新建广告订单", body, "adops-edit", "保存订单", 'data-kind="ads"');
    const form = this.bindForm(async form => {
      const value = key => form.elements.namedItem(key).value.trim();
      const time = key => value(key) ? new Date(value(key)).toISOString() : null;
      const record = { name: value("name"), title: value("title"), image: value("image"), description: value("description"), link: value("link"), placement: value("placement"), side: value("side"), advertiser: value("advertiser"), contact: value("contact"), internal_note: value("internal_note"), booking_status: value("booking_status"), starts_at: time("starts_at"), ends_at: time("ends_at"), order: Number(value("order")), enabled: true, billing_unit: value("billing_unit"), contract_cents: this.cents(form, "contract_cents"), received_cents: this.cents(form, "received_cents", false) };
      await c.api("admin/ads" + (row.id ? "/" + row.id : ""), row.id ? "PUT" : "POST", record);
    });
    const update = () => {
      const value = key => form.elements.namedItem(key).value;
      const slot = this.products().find(s => s.key === value("placement"));
      const unit = value("billing_unit"), days = Math.ceil((Date.parse(value("ends_at")) - Date.parse(value("starts_at"))) / 86400000);
      const count = Math.ceil(days / ({ day: 1, week: 7, month: 30 }[unit]));
      const price = slot?.[{ day: "daily_cents", week: "weekly_cents", month: "monthly_cents" }[unit]];
      form.querySelector('[data-adop-quote]').textContent = days > 0 ? `参考报价：${count} ${({ day: "天", week: "周", month: "月" })[unit]} × ${this.money(price)} = ${this.money(price == null ? null : count * price)}。以合同金额为准。` : "填写开始与结束时间后计算参考报价。未设置价格时显示待定。";
    };
    form.addEventListener('input', update); form.addEventListener('change', update); update();
  },
  preview(row) {
    const c = this.context, E = this.esc, slot = this.slotKey(row.placement);
    const position = this.products().find(s => s.key === slot);
    if (!position) return c.toast("此位置已停用，请先编辑并选择现有广告位", true);
    const content = AdminAds.targets(row).map(target => AdminAds.markup(row, target, E)).join("");
    c.openDialog("上架前预览", `<div class="adops-preview-meta"><strong>${E(row.title)}</strong><span>${E(this.productLabel(row))} · ${E(this.status(row))}</span><p>${this.date(row.starts_at)} → ${this.date(row.ends_at)}</p><p>客户：${E(row.advertiser || "未填写")} · 合同 ${this.money(row.contract_cents)} · 实收 ${this.money(row.received_cents || 0)}</p><a href="${E(row.link)}" target="_blank" rel="noopener noreferrer">检查跳转链接 ↗</a></div><div class="adops-preview-switch"><button type="button" class="btn" data-adop-size="desktop">桌面预览</button><button type="button" class="btn" data-adop-size="mobile">手机预览</button></div><div class="adops-stage"><div class="adops-device" data-adop-device><div class="adops-site-head">ModelTool <span>中转站检测与模型工具</span></div><div class="adops-page-skeleton"></div>${content}<div class="adops-page-skeleton short"></div></div></div><p class="tabs-note">素材复用前台样式；页面示意用于检查图片、文字和链接，最终布局随访问设备适配。上架将重新校验排期，未来订单按开始时间自动展示，到期自动停止。</p><label class="check-field"><input type="checkbox" name="approved" required>已核对素材、链接、排期和金额，确认上架</label>`, "adops-publish", "确认上架");
    document.getElementById('editor').classList.add('ad-editor-dialog');
    const form = this.bindForm(async () => { await c.api("admin/ads/" + row.id, "PUT", { ...this.clean(row), booking_status: "published", enabled: true }); });
    form.querySelectorAll('[data-adop-size]').forEach(button => button.addEventListener('click', () => form.querySelector('[data-adop-device]').classList.toggle('mobile', button.dataset.adopSize === "mobile")));
  },
  export() {
    const headers = ["订单号", "内部名称", "标题", "客户", "联系", "位置", "状态", "开始", "结束", "合同金额（元）", "实收（元）", "内部备注"];
    const cell = value => '"' + String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
    const rows = this.filtered.map(r => [r.order_code || r.id, r.name, r.title, r.advertiser, r.contact, this.productLabel(r), this.status(r), r.starts_at, r.ends_at, r.contract_cents == null ? "待定" : (r.contract_cents / 100).toFixed(2), ((r.received_cents || 0) / 100).toFixed(2), r.internal_note]);
    const blob = new Blob(['\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = '广告订单-' + new Date().toISOString().slice(0, 10) + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
