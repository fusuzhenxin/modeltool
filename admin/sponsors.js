/* Operator-only account provisioning and campaign assignment. */
const AdminSponsors = {
  esc: value => AdminAdAnalytics.esc(value),
  render(data) {
    this.data = data;
    const E = this.esc;
    return `<div class="sponsor-admin"><div class="adops-top"><div><span class="adops-eyebrow">SPONSOR ACCOUNTS</span><h1>赞助商账号</h1><p>为中转站站长开通专属账号，查看自己广告的排期与流量。</p></div><div class="sponsor-admin-actions"><a class="btn" href="/sponsor/" target="_blank" rel="noopener">打开赞助商入口 ↗</a><button type="button" class="btn primary" data-sponsor-new>开通账号</button></div></div><div class="notice">每条广告只能归属一个账号；一个账号可分配多条广告。账号仅有查看和导出权限，停用或重置密码会退出该账号的全部会话。</div><section class="card adops-orders"><div class="card-head"><h2>已开通账号</h2><span class="muted">${data.accounts.length} 个账号</span></div><div class="adops-scroll"><table><thead><tr><th>账号 / 站长</th><th>已分配广告</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${data.accounts.map(row=>`<tr><td><strong>${E(row.display_name)}</strong><span class="sub">${E(row.username)}</span></td><td>${row.ad_ids.map(id=>`<span class="sub">${E(data.ads.find(ad=>ad.id===id)?.title || '已移除的广告')}</span>`).join('') || '<span class="muted">尚未分配</span>'}</td><td><span class="chip ${row.enabled?'green':''}">${row.enabled?'已启用':'已停用'}</span></td><td>${row.last_login ? E(new Date(row.last_login*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})) : '尚未登录'}</td><td><button class="text-btn" data-sponsor-edit="${E(row.id)}">编辑 / 分配广告</button></td></tr>`).join('') || '<tr><td colspan="5" class="sponsor-account-empty">还没有赞助商账号，点击“开通账号”开始。</td></tr>'}</tbody></table></div></section></div>`;
  },
  mount(root, context) {
    this.context = context;
    root.querySelector('[data-sponsor-new]').addEventListener('click',()=>this.edit({enabled:true,ad_ids:[]}));
    root.querySelectorAll('[data-sponsor-edit]').forEach(button=>button.addEventListener('click',()=>this.edit(this.data.accounts.find(row=>row.id===button.dataset.sponsorEdit))));
  },
  edit(row) {
    const c=this.context,E=this.esc;
    const body = `<div class="field-row">${c.input('display_name','站长 / 中转站名称',row.display_name || '', 'text','显示在赞助商后台', 'required maxlength="120"')}${c.input('username','登录用户名',row.username || '', 'text','3～64 位字母、数字、下划线、点或短横线；不区分大小写', 'required minlength="3" maxlength="64" pattern="[a-zA-Z0-9_.-]+" autocomplete="off"')}</div>${c.input('password',row.id?'重置密码（留空保留原密码）':'初始密码','', 'password',row.id?'填写新密码后，原密码和全部已登录会话立即失效。':'至少 12 个字符，保存后请交付给对应站长。', `${row.id?'':'required '}minlength="12" maxlength="128" autocomplete="new-password"`)}<label class="check-field"><input type="checkbox" name="enabled" ${row.enabled?'checked':''}>启用账号</label><h3>分配广告订单</h3><p class="tabs-note">套餐全部位置统一归属。解除分配后，该账号立即失去该广告历史统计的查看权限。</p><input class="sponsor-ad-search" type="search" placeholder="搜索广告标题…" aria-label="搜索可分配广告"><div class="sponsor-ad-choices">${this.data.ads.filter(ad=>!ad.deleted || row.ad_ids.includes(ad.id)).map(ad=>{
      const unavailable=ad.account_id && ad.account_id!==row.id;
      const owner=this.data.accounts.find(account=>account.id===ad.account_id);
      return `<label class="sponsor-ad-choice"><input type="checkbox" name="ad_ids" value="${E(ad.id)}" ${row.ad_ids.includes(ad.id)?'checked':''} ${unavailable?'disabled':''}><span><strong>${E(ad.title)}</strong><small>${ad.deleted?'已移除 · 保留历史统计':E(AdminAds.placements.find(([key])=>key===ad.placement)?.[1] || ad.placement)}${unavailable?' · 已归属 '+E(owner?.display_name || '其他账号'):''}</small></span></label>`;
    }).join('') || '<p class="tabs-note">还没有广告订单，可先创建账号，之后再分配。</p>'}</div>`;
    c.openDialog(row.id?'编辑赞助商账号':'开通赞助商账号',body,'sponsor-account-edit','保存账号');
    const form=document.querySelector('#editor form');
    form.querySelector('.sponsor-ad-search').addEventListener('input',event=>{
      const term=event.target.value.trim().toLowerCase();
      form.querySelectorAll('.sponsor-ad-choice').forEach(label=>{label.hidden=!label.textContent.toLowerCase().includes(term);});
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();
      const button=form.querySelector('[type="submit"]'),error=form.querySelector('.error-box'),values=new FormData(form);
      button.disabled=true;error.textContent='';
      try {
        await c.api('admin/sponsors'+(row.id?'/'+row.id:''),row.id?'PUT':'POST',{
          username:values.get('username').trim(),display_name:values.get('display_name').trim(),password:values.get('password'),enabled:values.has('enabled'),ad_ids:values.getAll('ad_ids')
        });
        form.reset();document.getElementById('editor').close();c.toast('赞助商账号已保存');await c.refresh();
      } catch(e) {error.textContent=e.message;} finally{button.disabled=false;}
    });
  }
};
