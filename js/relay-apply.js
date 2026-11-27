"use strict";

const RelayApply = {
  field(name, label, type = "text", hint = "", max = 250, required = true) {
    return `<label class="apply-field" for="apply-${name}"><span>${label} ${required ? '<b aria-label="必填">*</b>' : '<em>选填</em>'}</span><input class="text-input" id="apply-${name}" name="${name}" type="${type}" ${required ? "required" : ""} maxlength="${max}" autocomplete="${name === "password" ? "new-password" : "off"}" spellcheck="false">${hint ? `<small>${hint}</small>` : ""}</label>`;
  },
  render() {
    return UI.shell("relay-apply", `<div class="page-head apply-head"><div class="crumb"><a href="relays.html">中转日报</a> / 申请收录</div><h1>让你的中转站加入实测观察</h1><p>提交专用探测账号，我们审核后安排多维度检测，让结果有据可查。</p></div><div class="apply-layout"><section class="panel apply-form-panel"><form id="relay-apply-form" autocomplete="off"><div class="apply-section-title"><span>01</span><div><h2>中转站资料</h2><p>带 * 的为必填项，通知邮箱用于收录进度通知，不会公开。</p></div></div><div class="apply-two">${this.field("name", "中转站名称", "text", "", 80)}${this.field("email", "通知邮箱", "email", "接收申请确认与审核结果通知。")}</div>${this.field("website_url", "中转站官网", "url", "例如 https://example.com", 500)}${this.field("contact", "其他联系方式", "text", "QQ、微信或 Telegram，方便核验账号时沟通。", 250, false)}<div class="apply-section-title"><span>02</span><div><h2>专用探测账号</h2><p>只需账号和密码，无需提前提供 API Key。</p></div></div>${this.field("login_url", "账号登录地址", "url", "填写可直接登录的控制台页面，不要在链接里包含账号密码。", 500)}<div class="apply-two">${this.field("username", "探测账号")}${this.field("password", "探测密码", "password", "使用专为本站检测创建的独立账号。", 500)}</div><button class="apply-password-toggle" type="button" id="apply-password-toggle" aria-pressed="false">显示密码</button><div class="apply-account-note">账号应可正常登录、创建检测 Key 并访问待测模型和分组。能力与指纹等测试会消耗额度，<strong>建议为探测账号预留 100 检测额度</strong>（单位以中转站后台为准），用于多模型、多项目检测；有二次验证或特殊登录要求，请在备注中说明。</div><label class="apply-field" for="apply-notes"><span>分组、模型与补充说明 <em>选填</em></span><textarea class="text-input" id="apply-notes" name="notes" rows="4" maxlength="2000" placeholder="希望测试的模型、对应分组、账号额度、二次验证方式等。请勿在此填写密码。"></textarea></label><label class="apply-trap" aria-hidden="true">公司<input name="company" tabindex="-1" autocomplete="off" maxlength="100"></label><label class="apply-consent"><input type="checkbox" name="consent" required><span>我有权提供此专用探测账号，同意将其用于中转站功能、模型能力、模型指纹和稳定性检测，并公开真实检测结果；知悉测试会消耗账号额度。</span></label><p class="apply-private">账号和密码在服务端加密保存，仅管理员审核和检测时使用，不会出现在公开页面或报告中。</p><div id="apply-error" class="apply-error" role="alert"></div><button class="btn btn-primary apply-submit" type="submit">提交收录申请 ${UI.icon("arrow")}</button></form><div id="apply-success" class="apply-success" role="status" tabindex="-1" hidden></div></section><aside class="apply-guide"><section class="panel"><h2>收录后测什么？</h2><ul><li><strong>稳定性观察</strong><span>持续记录请求表现与完成情况。</span></li><li><strong>模型能力</strong><span>基础能力、推理与糖果等测试。</span></li><li><strong>模型指纹</strong><span>比对模型身份线索，识别疑似不符。</span></li><li><strong>中转站功能</strong><span>检查接口功能是否正常。</span></li></ul></section><section class="panel apply-steps"><h2>申请流程</h2><ol><li>提交站点与探测账号</li><li>管理员审核、验证登录与额度</li><li>配置检测模型，安排测试</li><li>审核报告后公开结果</li></ol><p>提交申请不代表立即收录或通过测试，检测结论由实际结果决定。处理进度可通过所留联系方式沟通。</p></section><a class="apply-back" href="relays.html?view=stability">先看看稳定性观察 ${UI.icon("arrow")}</a></aside></div>`, { promo: false });
  },
  async submit(form, request = fetch) {
    const values = new FormData(form);
    // Deliberately do not persist credentials to Store, localStorage or analytics.
    const sessionResponse = await request("/api/public/proposal-session", { credentials: "same-origin", cache: "no-store" });
    if (!sessionResponse.ok) throw new Error("无法建立提交会话，请刷新后重试");
    const session = await sessionResponse.json();
    const body = {};
    for (const name of ["name", "website_url", "login_url", "username", "contact", "email", "notes", "company"]) body[name] = String(values.get(name) || "").trim();
    body.password = String(values.get("password") || "");
    body.consent = values.has("consent");
    const response = await request("/api/public/station-applications", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Proposal-CSRF": session.csrf }, body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "提交失败，请检查必填项后重试");
    return result;
  },
  mount() {
    const form = document.getElementById("relay-apply-form");
    const password = form.elements.namedItem("password");
    document.getElementById("apply-password-toggle").addEventListener("click", event => {
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "隐藏密码" : "显示密码";
      event.currentTarget.setAttribute("aria-pressed", String(visible));
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]'), error = document.getElementById("apply-error");
      if (button.disabled) return;
      button.disabled = true; button.textContent = "正在提交…"; error.textContent = "";
      try {
        const result = await this.submit(form);
        form.reset(); password.type = "password"; form.hidden = true;
        const success = document.getElementById("apply-success");
        success.innerHTML = `<span class="apply-success-mark">✓</span><h2>收录申请已提交</h2><p>我们将审核账号并安排检测，请保持专用账号可用与额度充足。</p><p class="apply-reference">申请编号：${UI.esc(result.id)}</p><p>${result.mail_enabled ? "申请已记录，申请确认与审核结果会通过通知邮箱告知，请留意收件箱。" : "邮件通知尚未开启，暂时请通过所留联系方式沟通处理进度。"}</p><a class="btn btn-primary" href="relays.html">返回中转日报</a>`;
        success.hidden = false; success.focus();
      } catch (e) { error.textContent = e.message || "网络异常，请稍后重试"; }
      finally { button.disabled = false; button.innerHTML = `提交收录申请 ${UI.icon("arrow")}`; }
    });
    window.addEventListener("pagehide", () => { form.reset(); password.type = "password"; });
  }
};

Pages.relayApply = () => RelayApply.render();
Pages.mount.relayApply = () => RelayApply.mount();
