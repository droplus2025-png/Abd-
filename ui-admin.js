// Administration (owner only): live store value, store settings, employees & permissions, reset.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, money } from './ui-core.js';
import { APP_VERSION } from './version.js';

const GROUPS = { sales: 'البيع', purchases: 'الشراء', returns: 'الإرجاع', money: 'المال والصندوق', stock: 'المخزون', other: 'أخرى' };

export async function renderAdmin(app) {
  const eng = app.engine, auth = app.auth, S = app.session, c = app.cfg;
  mount(`<div class="screen">${header('الإدارة')}<div class="body cards" id="b"></div></div>`);
  $('#hdrBack').onclick = () => app.go('home');

  async function draw() {
    const v = await eng.reports.storeValue();
    const emps = await auth.listEmployees(S);
    const days = await eng.reports.dailyReport();
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: c.timezone });
    const z = { sales_count: 0, sales_total: 0, returns_total: 0, gross_profit: 0, expenses: 0, net_profit: 0, undetailed_count: 0, undetailed_total: 0, estimated_profit: 0, real_profit: 0 };
    const t = days.find((x) => x.day === todayKey) || z;
    $('#b').innerHTML = `
      <div class="card"><div class="grp" style="margin-top:0">تقرير اليوم</div>
        <div class="kv"><span>المبيعات (${t.sales_count} فاتورة)</span><b>${money(t.sales_total)}</b></div>
        <div class="kv"><span>المرتجعات</span><b>${money(t.returns_total)}</b></div>
        <div class="kv"><span>الربح الحقيقي <span class="muted" style="font-size:.78rem">(بيع عادي + بيع سريع مفصّل)</span></span><b>${money(t.real_profit)}</b></div>
        <div class="kv"><span>ربح تقديري <span class="muted" style="font-size:.78rem">(${t.undetailed_count} بيع سريع غير مفصّل بمبلغ ${money(t.undetailed_total)} × ${c.quick_sale_profit_pct}%)</span></span><b style="color:var(--amber)">${money(t.estimated_profit)}</b></div>
        <div class="kv"><span>إجمالي الربح</span><b style="color:var(--gold)">${money(t.gross_profit)}</b></div>
        <div class="kv"><span>المصاريف</span><b>−${money(t.expenses)}</b></div>
        <div class="kv" style="font-size:1.15rem"><span>صافي الربح</span><b style="color:var(--gold)">${money(t.net_profit)}</b></div>
        ${days.filter((x) => x.day !== todayKey).slice(0, 10).length ? `<div class="grp">الأيام السابقة</div>${days.filter((x) => x.day !== todayKey).slice(0, 10).map((x) => `<div class="kv"><span>${x.day}</span><span class="muted">مبيعات ${money(x.sales_total)}</span><b>${money(x.net_profit)}</b></div>`).join('')}` : ''}</div>

      <div class="card"><div class="grp" style="margin-top:0">قيمة المحل الآن</div>
        <div class="kv"><span>الصندوق</span><b>${money(v.cash)}</b></div>
        <div class="kv"><span>المخزون (بسعر الشراء)</span><b>${money(v.stock)}</b></div>
        <div class="kv"><span>ديون الزبناء</span><b>${money(v.customer_debts)}</b></div>
        <div class="kv"><span>مستحقات الموردين</span><b>−${money(v.supplier_dues)}</b></div>
        <div class="kv" style="font-size:1.2rem"><span>القيمة الإجمالية</span><b style="color:var(--gold)">${money(v.store_value)}</b></div></div>

      <div class="card"><div class="grp" style="margin-top:0">إعدادات المحل</div>
        ${[['store_name', 'اسم المحل'], ['store_phone', 'هاتف المحل'], ['store_address', 'العنوان'], ['thanks_text', 'عبارة الشكر'], ['currency', 'العملة (مثل DH)'], ['quick_sale_profit_pct', 'نسبة الربح في البيع السريع %']]
          .map(([k, l]) => `<div class="lbl">${l}</div><input class="inp cfg" data-k="${k}" value="${esc(c[k])}" ${k === 'quick_sale_profit_pct' ? 'inputmode="decimal"' : ''}>`).join('')}
        <button class="btn gold" id="saveCfg" style="margin-top:8px;width:100%">حفظ الإعدادات</button></div>

      <div class="card"><div class="grp" style="margin-top:0">الموظفون</div>
        ${emps.length ? emps.map((e) => `<div class="sw"><span>${esc(e.name)} ${e.active ? '' : '<span class="muted">(موقوف)</span>'}</span>
          <span class="row"><button class="btn" data-perm="${e.id}">الصلاحيات</button><button class="btn" data-act="${e.id}" data-on="${e.active ? 1 : 0}">${e.active ? 'إيقاف' : 'تفعيل'}</button></span></div>`).join('')
          : '<div class="muted">لا يوجد موظفون بعد</div>'}
        <button class="btn" id="addEmp" style="margin-top:8px;width:100%">+ إضافة موظف</button></div>

      <div class="card"><div class="grp" style="margin-top:0">الحساب والبرنامج</div>
        <button class="btn" id="chCode" style="width:100%">تغيير كلمة مرور المالك</button>
        <div class="kv"><span>إصدار البرنامج</span><b>${APP_VERSION}</b></div>
        <button class="btn red" id="reset" style="margin-top:8px;width:100%">تصفير العمليات (للتجارب) — يُبقي المنتجات والمخزون</button></div>`;

    $('#saveCfg').onclick = async () => {
      try {
        for (const inp of document.querySelectorAll('.cfg')) {
          const k = inp.dataset.k; let val = inp.value;
          if (k === 'quick_sale_profit_pct') val = Number(String(val).replace(',', '.'));
          if (val !== c[k]) await eng.settings.set(k, val);
        }
        await app.refreshCfg(); toast('تم حفظ الإعدادات');
      } catch (e) { toast(errText(e), true, 3000); }
    };
    $('#addEmp').onclick = () => openModal({
      title: 'إضافة موظف', html: `<input id="n" class="inp" placeholder="اسم الموظف"><input id="c" class="inp" type="password" placeholder="كلمة مروره (4 أحرف على الأقل)"><div class="err" id="err"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'حفظ', cls: 'gold', onClick: async (close, m) => {
        try { await auth.addEmployee(S, { name: m.querySelector('#n').value.trim() || 'موظف', code: m.querySelector('#c').value }); draw(); }
        catch (e) { m.querySelector('#err').textContent = errText(e); return false; }
      } }], onOpen: (m) => m.querySelector('#n').focus() });
    $('#chCode').onclick = () => openModal({
      title: 'كلمة مرور جديدة', html: `<input id="c" class="inp" type="password" placeholder="الكلمة الجديدة"><div class="err" id="err"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'حفظ', cls: 'gold', onClick: async (close, m) => {
        try { await auth.changeCode(S, S.userId, m.querySelector('#c').value); toast('تم التغيير'); }
        catch (e) { m.querySelector('#err').textContent = errText(e); return false; }
      } }], onOpen: (m) => m.querySelector('#c').focus() });
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      await auth.setEmployeeActive(S, b.dataset.act, b.dataset.on !== '1'); draw();
    }));
    document.querySelectorAll('[data-perm]').forEach((b) => b.addEventListener('click', () => permissions(b.dataset.perm)));
    $('#reset').onclick = async () => {
      if (!(await confirmBox('تصفير العمليات', 'ستُحذف كل الفواتير والزبناء والموردين والصندوق. تبقى المنتجات والمخزون. متابعة؟', 'تصفير', 'إلغاء'))) return;
      try { const r = await eng.admin.resetOperations(); toast(`تم التصفير · ${r.products_kept} منتج محفوظ`); draw(); } catch (e) { toast(errText(e), true); }
    };
  }

  // permissions of one employee, chosen by the owner
  async function permissions(userId) {
    const rows = (await auth.listPermissions(S)).filter((r) => r.user_id === userId).sort((a, b) => a.sort - b.sort);
    const name = rows[0]?.user_name || '';
    let last = '';
    const html = rows.map((r) => { const g = r.grp !== last ? `<div class="grp">${GROUPS[r.grp] || r.grp}</div>` : ''; last = r.grp;
      return `${g}<label class="sw"><span>${esc(r.label_ar)}</span><input type="checkbox" data-k="${r.key}" ${r.allowed ? 'checked' : ''}></label>`; }).join('');
    openModal({ title: `صلاحيات ${name}`, html, tall: true,
      buttons: [{ label: 'استعادة الافتراضي', onClick: async () => { await auth.resetUserPermissions(S, userId); toast('تمت الاستعادة'); } }, { label: 'إغلاق', cls: 'gold' }],
      onOpen: (m) => m.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
        try { await auth.setUserPermission(S, userId, cb.dataset.k, cb.checked); }
        catch (e) { toast(errText(e), true); cb.checked = !cb.checked; }
      })) });
  }
  draw();
}
