"use strict";

const AdminApplications = {
  filter: "", search: "", page: 1,
  statuses: { pending: "待审核", reviewing: "核验中", approved: "已通过 / 已建站", rejected: "未通过" },
  esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  query() { return new URLSearchParams({ q: this.search, status: this.filter, page: String(this.page) }).toString(); },
  date(value) { return value ? new Date(value * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"; },
  render(data) {
    const E = this.esc;
    return `<div class="application-admin"><div class="page-heading"><div><div class="eyebrow">STATION APPLICATIONS</div><h1>中转站收录申请</h1><p>先核验专用探测账号，再配置检测。账号密码仅在主动查看时读取。</p></div><a class="btn" href="/relay-apply.html" target="_blank" rel="noopener">查看申请页面 ↗</a></div><div class="application-counts">${Object.entries(this.statuses).map(([key,label])=>`<button type="button" data-app-status="${key}" class="${this.filter===key?'active':''}"><strong>${data.counts[key] || 0}</strong><span>${label}</span></button>`).join("")}</div><form class="toolbar application-search" data-app-search><label class="search"><input name="q" type="search" maxlength="150" aria-label="搜索收录申请" placeholder="搜索中转站、域名或联系方式" value="${E(this.search)}"></label><select name="status" aria-label="申请状态"><option value="">全部状态</option>${Object.entries(this.statuses).map(([key,label])=>`<option value="${key}" ${key===this.filter?'selected':''}>${label}</option>`).join("")}</select><button class="btn primary" type="submit">查询</button></form><section class="card"><div class="card-head"><h2>申请记录</h2><span>共 ${data.total} 条</span></div><div class="table-scroll"><table><thead><tr><th>中转站</th><th>联系方式</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>${data.items.map(row=>`<tr><td><strong>${E(row.name)}</strong><span class="sub">${E(row.domain)}</span></td><td>${E(row.email || row.contact)}${row.email && row.contact ? `<span class="sub">${E(row.contact)}</span>` : ""}</td><td><span class="chip ${row.status==='approved'?'green':row.status==='rejected'?'red':'orange'}">${this.statuses[row.status]}</span></td><td>${E(this.date(row.created_at))}</td><td class="actions"><button type="button" class="text-btn" data-app-review="${E(row.id)}">查看 / 审核</button><button type="button" class="text-btn danger" data-app-delete="${E(row.id)}">删除申请</button></td></tr>`).join("") || '<tr><td colspan="5" class="application-empty">暂无符合条件的收录申请</td></tr>'}</tbody></table></div>${data.pages>1?`<div class="application-pagination"><button type="button" class="btn" data-app-page="${data.page-1}" ${data.page<=1?'disabled':''}>上一页</button><span>${data.page} / ${data.pages}</span><button type="button" class="btn" data-app-page="${data.page+1}" ${data.page>=data.pages?'disabled':''}>下一页</button></div>`:""}</section></div>`;
  },
  mount(root, context) {
    this.context = context;
    root.querySelector('[data-app-search]').addEventListener('submit', event=>{
      event.preventDefault();event.stopPropagation();
      const values=new FormData(event.currentTarget);
      this.search=String(values.get('q') || '').trim();this.filter=String(values.get('status') || '');this.page=1;context.refresh();
    });
    root.querySelectorAll('[data-app-status]').forEach(button=>button.addEventListener('click',()=>{this.filter=this.filter===button.dataset.appStatus?'':button.dataset.appStatus;this.page=1;context.refresh();}));
    root.querySelectorAll('[data-app-page]').forEach(button=>button.addEventListener('click',()=>{this.page=Number(button.dataset.appPage);context.refresh();}));
    root.querySelectorAll('[data-app-review]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;try{await this.edit(button.dataset.appReview);}catch(e){context.toast(e.message,true);}finally{button.disabled=false;}
    }));
    root.querySelectorAll('[data-app-delete]').forEach(button=>button.addEventListener('click',async()=>{
      if(!confirm('删除这条申请及其中保存的探测账号密码？已创建的中转站和检测报告会保留。'))return;
      button.disabled=true;try{await context.api('admin/station-applications/'+button.dataset.appDelete,'DELETE');context.toast('申请及探测凭据已删除');await context.refresh();}catch(e){context.toast(e.message,true);button.disabled=false;}
    }));
  },
  clearCredentials(root) {
    root.querySelectorAll('[data-application-secret]').forEach(input=>{input.value='';if(input.dataset.password!==undefined)input.type='password';});
  },
  async edit(id) {
    const c=this.context,E=this.esc;
    const row=await c.api('admin/station-applications/'+id);
    const approved=row.status==='approved';
    const body=`<div class="application-detail"><h3>${E(row.name)}</h3><p><a href="${E(row.website_url)}" target="_blank" rel="noopener noreferrer">打开中转站官网 ↗</a> · <a href="${E(row.login_url)}" target="_blank" rel="noopener noreferrer">打开探测账号登录页 ↗</a></p><p><b>通知邮箱：</b>${E(row.email || "未提供")}</p><p><b>其他联系：</b>${E(row.contact || "未提供")}</p><p><b>提交：</b>${E(this.date(row.created_at))}</p><p class="application-notes"><b>补充说明：</b>${E(row.notes || '未填写')}</p><section class="application-credentials"><h3>专用探测账号</h3><p class="tabs-note">点击后读取解密凭据并记录操作日志。关闭窗口会清空当前显示。</p><button type="button" class="btn" data-app-credentials>查看探测账号密码</button><div data-app-secret-fields hidden><div class="field-row"><label class="field"><span>探测账号</span><input readonly data-application-secret aria-label="探测账号" autocomplete="off"></label><label class="field"><span>探测密码</span><input readonly type="password" data-application-secret data-password aria-label="探测密码" autocomplete="off"></label></div><button type="button" class="text-btn" data-app-show-password>显示密码</button><button type="button" class="text-btn" data-app-hide-credentials>隐藏并清空</button></div></section>${approved?`<div class="notice">已创建隐藏、暂停的中转站。请在中转站管理里配置 API Key、核对模型和预算，配置完成后再启用检测。<a href="#stations">打开中转站管理 →</a></div>`:''}${c.select('status','审核处理',approved?[['approved',this.statuses.approved]]:Object.entries(this.statuses),row.status)}${c.area('note','内部审核备注',row.note || '', '记录账号核验、额度、沟通情况或未通过原因；不公开。','maxlength="2000"')}<div data-app-import hidden><div class="notice">通过时创建隐藏且暂停的站点，不会自动发起测试或公开排名。请登录探测账号后填写实际接口与模型。</div>${c.input('base_url','检测接口地址','','url','例如 https://api.example.com/v1','maxlength="500"')}${c.select('protocol','接口协议',[['openai','OpenAI 兼容'],['anthropic','Anthropic Messages']],'openai')}${c.area('models','待检测模型 ID','','每行一个实际模型 ID，最多 30 个。','maxlength="4600"')}</div>${row.reviewed_at?`<p class="tabs-note">最近处理：${E(row.reviewed_by)} · ${E(this.date(row.reviewed_at))}</p>`:''}</div>`;
    c.openDialog('收录申请审核',body,'station-application-review','保存处理');
    const editor=document.getElementById('editor'),form=editor.querySelector('form');
    const update=()=>{
      const create=!approved && form.elements.namedItem('status').value==='approved';
      form.querySelector('[data-app-import]').hidden=!create;
      ['base_url','models'].forEach(name=>{form.elements.namedItem(name).required=create;});
      form.querySelector('[type="submit"]').textContent=create?'通过并创建待配置站点':'保存处理';
    };
    form.elements.namedItem('status').addEventListener('change',update);update();
    form.querySelector('[data-app-credentials]').addEventListener('click',async event=>{
      const button=event.currentTarget,error=form.querySelector('.error-box');button.disabled=true;error.textContent='';
      try{
        const secret=await c.api('admin/station-applications/'+id+'/credentials','POST',{});
        if(!form.isConnected || !editor.open)return;
        form.querySelector('[aria-label="探测账号"]').value=secret.username;
        form.querySelector('[aria-label="探测密码"]').value=secret.password;
        form.querySelector('[data-app-secret-fields]').hidden=false;button.hidden=true;
      }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
    });
    form.querySelector('[data-app-show-password]').addEventListener('click',event=>{
      const input=form.querySelector('[data-password]');input.type=input.type==='password'?'text':'password';event.currentTarget.textContent=input.type==='password'?'显示密码':'隐藏密码';
    });
    form.querySelector('[data-app-hide-credentials]').addEventListener('click',()=>{
      this.clearCredentials(form);form.querySelector('[data-app-secret-fields]').hidden=true;form.querySelector('[data-app-credentials]').hidden=false;form.querySelector('[data-app-show-password]').textContent='显示密码';
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();
      const button=form.querySelector('[type="submit"]'),error=form.querySelector('.error-box'),values=new FormData(form);
      button.disabled=true;error.textContent='';
      try{
        const result=await c.api('admin/station-applications/'+id,'PUT',{
          status:values.get('status'),note:values.get('note'),base_url:values.get('base_url') || '',protocol:values.get('protocol') || 'openai',models:String(values.get('models') || '').split(/[\n,，]+/).map(v=>v.trim()).filter(Boolean)
        });
        this.clearCredentials(form);editor.close();c.toast(result.station_id?'已保存，可到中转站管理配置 Key 并安排检测':'申请处理已保存');await c.refresh();
      }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
    });
  }
};
