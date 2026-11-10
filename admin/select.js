"use strict";

/* Keep native selects for form submission; draw the menu in the browser top layer. */
const AdminSelect = (() => {
  let opened, serial = 0;
  function enhance(root = document) {
    root.querySelectorAll("select:not([data-enhanced])").forEach((select) => {
      select.dataset.enhanced = "true";
      const id = "admin-select-" + ++serial;
      const wrap = document.createElement("div"); wrap.className = "admin-select";
      select.before(wrap); wrap.append(select);
      select.classList.add("admin-select-native"); select.tabIndex = -1; select.setAttribute("aria-hidden", "true");
      const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "admin-select-trigger";
      trigger.id = id; trigger.setAttribute("role", "combobox"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-controls", id + "-list");
      const label = select.id && document.querySelector(`label[for="${select.id}"]`);
      if (label) label.htmlFor = id;
      trigger.setAttribute("aria-label", select.getAttribute("aria-label") || label?.textContent || "选择选项");
      wrap.append(trigger);
      const menu = document.createElement("div"); menu.className = "admin-select-menu"; menu.setAttribute("popover", "manual");
      const search = document.createElement("input"); search.type = "search"; search.placeholder = "搜索选项…"; search.setAttribute("aria-label", "搜索" + trigger.getAttribute("aria-label"));
      const list = document.createElement("div"); list.id = id + "-list"; list.className = "admin-select-options"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", trigger.getAttribute("aria-label"));
      if (select.multiple) list.setAttribute("aria-multiselectable", "true");
      menu.append(search, list); wrap.append(menu);
      let active = 0, visible = [];
      const sync = () => {
        const selected = [...select.selectedOptions];
        trigger.textContent = select.multiple ? (selected.length ? `已选 ${selected.length} 个：${selected.map((o) => o.textContent).join("、")}` : "选择中转站，可多选") : selected[0]?.textContent || "暂无可选项";
        trigger.title = trigger.textContent; trigger.disabled = select.disabled || !select.options.length;
        if (selected.length) trigger.removeAttribute("aria-invalid");
      };
      const mark = () => {
        [...list.querySelectorAll('[role="option"]')].forEach((el, i) => el.classList.toggle("highlighted", i === active));
        const current = list.querySelectorAll('[role="option"]')[active];
        if (current) { search.setAttribute("aria-activedescendant", current.id); current.scrollIntoView({ block: "nearest" }); }
      };
      const close = (focus = false) => {
        if (opened?.menu !== menu) return;
        menu.hidePopover(); trigger.setAttribute("aria-expanded", "false"); opened = undefined;
        if (focus && trigger.isConnected) trigger.focus();
      };
      const choose = (option) => {
        if (select.multiple) option.selected = !option.selected;
        else select.value = option.value;
        sync();
        if (!select.multiple) close(true);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        if (select.multiple) draw(true);
      };
      const draw = (keepActive = false) => {
        visible = [...select.options].filter((o) => !o.disabled && o.textContent.toLowerCase().includes(search.value.toLowerCase()));
        list.replaceChildren();
        visible.forEach((option, i) => {
          const row = document.createElement("button"); row.type = "button"; row.id = id + "-option-" + i; row.tabIndex = -1;
          row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(option.selected)); row.textContent = option.textContent;
          row.addEventListener("click", () => choose(option)); row.addEventListener("pointermove", () => { active = i; mark(); }); list.append(row);
        });
        if (!visible.length) { const empty = document.createElement("p"); empty.className = "admin-select-empty"; empty.textContent = "没有匹配的选项"; list.append(empty); }
        active = keepActive ? Math.max(0, Math.min(active, visible.length - 1)) : Math.max(0, visible.findIndex((o) => o.selected)); mark();
      };
      if (select.multiple) {
        const tools = document.createElement("div"); tools.className = "admin-select-tools";
        for (const [label, all] of [["全选搜索结果", true], ["清空选择", false]]) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.addEventListener("click", () => {
            for (const option of all ? visible : [...select.options]) if (!option.disabled) option.selected = all;
            sync(); draw(); select.dispatchEvent(new Event("change", { bubbles: true }));
          });
          tools.append(button);
        }
        search.after(tools);
      }
      const open = () => {
        if (trigger.disabled) return;
        if (opened?.menu === menu) return close();
        opened?.close(); opened = { menu, wrap, close }; search.value = ""; draw();
        const rect = trigger.getBoundingClientRect();
        const below = innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const up = below < 240 && above > below;
        menu.style.width = Math.min(rect.width, innerWidth - 24) + "px";
        menu.style.left = Math.max(12, Math.min(rect.left, innerWidth - rect.width - 12)) + "px";
        menu.style.maxHeight = Math.max(100, Math.min(320, up ? above : below)) + "px";
        menu.style.top = up ? "auto" : rect.bottom + 6 + "px";
        menu.style.bottom = up ? innerHeight - rect.top + 6 + "px" : "auto";
        menu.showPopover(); trigger.setAttribute("aria-expanded", "true"); search.focus(); mark();
      };
      trigger.addEventListener("click", open);
      trigger.addEventListener("keydown", (e) => { if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(); } });
      search.addEventListener("input", () => draw());
      menu.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === "Tab") close(true);
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault(); active = e.key === "Home" ? 0 : e.key === "End" ? visible.length - 1 : (active + (e.key === "ArrowDown" ? 1 : -1) + visible.length) % (visible.length || 1); mark();
        } else if (e.key === "Enter" && (e.target === search || e.target.getAttribute("role") === "option")) { e.preventDefault(); if (visible[active]) choose(visible[active]); }
      });
      select.addEventListener("change", sync);
      select.addEventListener("invalid", (e) => { e.preventDefault(); trigger.focus(); trigger.setAttribute("aria-invalid", "true"); });
      new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
      sync();
    });
  }
  document.addEventListener("pointerdown", (e) => { if (opened && !opened.wrap.contains(e.target)) opened.close(); });
  document.addEventListener("scroll", (e) => { if (opened && !opened.menu.contains(e.target)) opened.close(); }, true);
  window.addEventListener("resize", () => opened?.close());
  return { enhance, close: () => opened?.close() };
})();
