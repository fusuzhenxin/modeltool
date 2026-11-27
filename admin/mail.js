"use strict";

const AdminMail = {
  esc: value => AdminApplications.esc(value),
  labels: {pending:'等待发送',sending:'发送中',sent:'邮件服务器已接收',failed:'发送失败'},
  render(data) {
    this.data=data;
    const E=this.esc,s=data.settings;
    return `<div class="mail-admin"><div class="page-heading"><div><div class="eyebrow">EMAIL NOTIFICATIONS</div><h1>邮件通知</h1><p>通过 SMTP 真实发送申请确认、新申请通知及审核结果，记录状态并自动重试失败邮件。</p></div><button type="button" class="btn" data-mail-refresh>刷新发送状态</button></div><div class="settings-grid"><section class="card"><div class="card-head"><h2>发件邮箱配置</h2><span class="chip ${s.enabled?'green':'orange'}">${s.enabled?'已启用':'未启用'}</span></div><form class="card-body" data-mail-settings><p class="tabs-note">QQ 邮箱通常使用 smtp.qq.com、465 端口、SSL/TLS 加密和邮箱 SMTP 授权码。</p><div data-mail-fields></div><label class="check-field"><input type="checkbox" name="enabled" ${s.enabled?'checked':''}>启用自动邮件通知</label><p class="tabs-note">启用后会自动发送待发送通知；关闭只暂停发送，申请和队列仍保留。授权码加密保存，重新打开时不会返回原文。</p><div class="error-box" role="alert"></div><button type="submit" class="btn primary">保存邮件配置</button></form></section><div><section class="card"><div class="card-head"><h2>发送真实测试邮件</h2></div><form class="card-body" data-mail-test><p>先保存并启用配置，再向指定邮箱发送一封测试邮件。</p><label class="field"><span>测试收件邮箱</span><input type="email" name="recipient" required maxlength="254" autocomplete="off" value="${E(s.notify_email)}"></label><div class="error-box" role="alert"></div><button type="submit" class="btn">发送测试邮件</button><p class="mail-test-result" role="status"></p></form></section><section class="card"><div class="card-head"><h2>通知内容</h2></div><div class="card-body"><p><b>管理员：</b>收到新的收录申请后发送提醒。</p><p><b>申请人：</b>提交后发送确认，审核通过或未通过时发送结果。</p><p class="tabs-note">邮件不包含探测账号、密码、API Key 或内部审核备注。只有配置通知邮箱的申请才发送申请人通知。</p><p class="tabs-note">“服务器已接收”表示 SMTP 服务已接受邮件，实际收件情况请查看收件箱或垃圾箱。</p></div></section></div></div><section class="card mail-history"><div class="card-head"><h2>最近发送记录</h2><span>待发送 ${data.counts.pending||0} · 发送中 ${data.counts.sending||0} · 已提交服务器 ${data.counts.sent||0} · 失败 ${data.counts.failed||0}</span></div><div class="table-scroll"><table><thead><tr><th>通知 / 收件人</th><th>状态</th><th>尝试次数</th><th>时间</th><th>操作</th></tr></thead><tbody>${data.messages.map(row=>`<tr><td><strong>${E(row.subject)}</strong><span class="sub">${E(row.recipient)}</span></td><td><span class="chip ${row.status==='sent'?'green':row.status==='failed'?'red':'orange'}">${this.labels[row.status]}</span>${row.last_error?`<span class="sub">${E(row.last_error)}</span>`:''}</td><td>${row.attempts}</td><td>${E(AdminApplications.date(row.sent_at||row.created))}${row.status==='pending'&&row.attempts?`<span class="sub">下次重试：${E(AdminApplications.date(row.next_attempt))}</span>`:''}</td><td>${['pending','failed'].includes(row.status)?`<button type="button" class="text-btn" data-mail-retry="${E(row.id)}">立即重试</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="application-empty">还没有邮件发送记录</td></tr>'}</tbody></table></div></section></div>`;
  },
  mount(root,context) {
    const s=this.data.settings,c=context;
    const form=root.querySelector('[data-mail-settings]');
    form.querySelector('[data-mail-fields]').innerHTML=`${c.input('host','SMTP 服务器',s.host,'text','','maxlength="253" autocomplete="off"')}<div class="field-row">${c.input('port','端口',s.port,'number','','required min="1" max="65535"')}${c.select('security','安全连接',[['ssl','SSL/TLS（常用 465）'],['starttls','STARTTLS（常用 587）']],s.security)}</div>${c.input('username','SMTP 登录账号',s.username,'text','通常为完整发件邮箱地址。','maxlength="254" autocomplete="off"')}${c.input('password','SMTP 授权码','','password',s.has_password?'已加密保存；留空保留原授权码。':'填写邮箱服务提供的 SMTP 授权码。','maxlength="1000" autocomplete="new-password"')}<label class="check-field"><input type="checkbox" name="clear_password">清除已保存的授权码</label>${c.input('from_email','发件邮箱',s.from_email,'email','','maxlength="254"')}${c.input('from_name','发件人名称',s.from_name,'text','','required maxlength="100"')}${c.input('notify_email','管理员收件邮箱',s.notify_email,'email','新申请通知发送到这里。','maxlength="254"')}${c.input('site_url','网站地址',s.site_url,'url','用于邮件中的后台和日报链接。','required maxlength="500"')}`;
    AdminSelect.enhance(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();
      const values=new FormData(form),button=form.querySelector('[type="submit"]'),error=form.querySelector('.error-box');
      button.disabled=true;error.textContent='';
      try{
        const body={};for(const key of ['host','username','from_email','from_name','notify_email','site_url','security'])body[key]=String(values.get(key)||'').trim();
        body.password=String(values.get('password')||'');body.port=Number(values.get('port'));body.enabled=values.has('enabled');body.clear_password=values.has('clear_password');
        await c.api('admin/mail','PUT',body);form.elements.namedItem('password').value='';c.toast('邮件配置已保存');await c.refresh();
      }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
    });
    root.querySelector('[data-mail-test]').addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();
      const form=event.currentTarget,button=form.querySelector('[type="submit"]'),error=form.querySelector('.error-box'),status=form.querySelector('.mail-test-result');
      button.disabled=true;error.textContent='';status.textContent='正在连接邮件服务器并发送…';
      try{
        const result=await c.api('admin/mail/test','POST',{recipient:String(new FormData(form).get('recipient')).trim()});
        status.textContent=result.status==='sent'?'测试邮件已由 SMTP 服务器接收，请检查收件箱或垃圾箱。':'测试邮件正在发送，可刷新发送状态查看结果。';
        c.toast(result.status==='sent'?'测试邮件发送成功':'测试邮件正在发送');
      }catch(e){status.textContent='';error.textContent=e.message;}finally{button.disabled=false;}
    });
    root.querySelector('[data-mail-refresh]').addEventListener('click',()=>c.refresh());
    root.querySelectorAll('[data-mail-retry]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;try{await c.api('admin/mail/'+button.dataset.mailRetry+'/retry','POST',{});c.toast('已安排重试');await c.refresh();}catch(e){c.toast(e.message,true);button.disabled=false;}
    }));
  }
};
