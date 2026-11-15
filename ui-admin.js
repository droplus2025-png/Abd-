// Administration (owner only): live store value, store settings, employees & permissions, reset.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, money } from './ui-core.js';
import { APP_VERSION } from './version.js';
import { renderInvoice } from './invoice-text.js';
import { DEFAULT_SETTINGS } from './settings.js';

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
    const last = await eng.admin.lastBackupAt();
    const tpl = c.invoice_template, canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
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

      <div class="card"><div class="grp" style="margin-top:0">النسخ الاحتياطي</div>
        <div class="kv"><span>آخر نسخة</span><b style="color:${last && (Date.now() - new Date(last)) < 3 * 864e5 ? 'var(--ok)' : 'var(--amber)'}">${last ? new Date(last).toLocaleString('ar-MA-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'لم تُحفظ أي نسخة'}</b></div>
        <div class="row" style="margin-top:8px"><button class="btn gold" id="export" style="flex:1">⬇ حفظ نسخة احتياطية</button>
          ${canShare ? '<button class="btn" id="share" style="flex:1">مشاركة</button>' : ''}</div>
        <button class="btn" id="restore" style="width:100%;margin-top:8px">⬆ استعادة من ملف</button>
        <input type="file" id="restoreFile" accept=".json,application/json" style="display:none">
        <div class="muted" style="font-size:.78rem;margin-top:6px">الملف يحوي كل البيانات وبصمات كلمات المرور. احفظه في مكان آمن (Drive أو واتساب لنفسك). الاستعادة تفحص الملف أولاً وتستبدل كل ما في هذا الجهاز.</div></div>

      <div class="card" style="grid-column:1/-1"><div class="grp" style="margin-top:0">شكل الفاتورة (واتساب)</div>
        <div class="tplgrid">
          <div>${[['show_phone', 'إظهار هاتف المحل'], ['show_address', 'إظهار العنوان'], ['show_customer', 'إظهار اسم الزبون'], ['bold_total', 'المجموع بخط عريض']]
            .map(([k, l]) => `<label class="sw"><span>${l}</span><input type="checkbox" class="tpl" data-k="${k}" ${tpl[k] ? 'checked' : ''}></label>`).join('')}
            <div class="lbl">شكل سطر المنتج</div>
            <select class="inp tpl" data-k="line_format"><option value="${esc(DEFAULT_SETTINGS.invoice_template.line_format)}" ${tpl.line_format === DEFAULT_SETTINGS.invoice_template.line_format ? 'selected' : ''}>سطران: الاسم ثم الكمية×السعر والمجموع</option>
              <option value="{n}. {name} {qty}×{price} = {total}" ${tpl.line_format === '{n}. {name} {qty}×{price} = {total}' ? 'selected' : ''}>سطر واحد مختصر</option></select>
            <div class="lbl">الفاصل</div><input class="inp tpl" data-k="separator" value="${esc(tpl.separator)}">
            <div class="lbl">عبارة الختام (تأخذ {thanks_text} من الإعدادات)</div><input class="inp tpl" data-k="footer" value="${esc(tpl.footer)}">
            ${Object.keys(DEFAULT_SETTINGS.invoice_template.labels).map((k) => `<div class="lbl">عنوان: ${k}</div><input class="inp tpl lab" data-k="${k}" value="${esc(tpl.labels[k])}">`).join('')}
          </div>
          <div><div class="lbl">معاينة مباشرة</div><pre id="tplPreview" dir="auto" class="card" style="white-space:pre-wrap;margin:0;font:inherit;line-height:1.6;user-select:text"></pre>
            <div class="row" style="margin-top:8px"><button class="btn" id="tplReset" style="flex:1">الافتراضي</button><button class="btn gold" id="tplSave" style="flex:1">حفظ الشكل</button></div></div>
        </div></div>

      <div class="card"><div class="grp" style="margin-top:0">الحساب والبرنامج</div>
        <button class="btn" id="chCode" style="width:100%">تغيير كلمة مرور المالك</button>
        <div class="kv"><span>إصدار البرنامج</span><b>${APP_VERSION}</b></div>
        <button class="btn red" id="reset" style="margin-top:8px;width:100%">تصفير العمليات (للتجارب) — يُبقي المنتجات والمخزون</button></div>`;

    // ---- invoice template editor with live preview
    const readTpl = () => {
      const t2 = JSON.parse(JSON.stringify(tpl)); t2.labels = { ...tpl.labels };
      document.querySelectorAll('.tpl').forEach((el) => {
        const k = el.dataset.k;
        if (el.classList.contains('lab')) t2.labels[k] = el.value; else t2[k] = el.type === 'checkbox' ? el.checked : el.value;
      });
      return t2;
    };
    const sample = () => renderInvoice({
      invoice: { invoice_no: '61115001', type: 'sale', created_at: new Date().toISOString(), total: 12000, paid: 10000, credit_amount: 2000, note: null },
      lines: [{ name: 'منتج تجريبي 1', qty: 2000, unit_price: 250000, line_total: 5000 }, { name: 'منتج تجريبي 2', qty: 1000, unit_price: 700000, line_total: 7000 }],
      party: { name: 'اسم الزبون' }, settings: { ...c, invoice_template: readTpl() },
    });
    const paint = () => { $('#tplPreview').textContent = sample(); };
    document.querySelectorAll('.tpl').forEach((el) => { el.addEventListener('input', paint); el.addEventListener('change', paint); });
    paint();
    $('#tplSave').onclick = async () => { try { await eng.settings.set('invoice_template', readTpl()); await app.refreshCfg(); toast('تم حفظ شكل الفاتورة'); } catch (e) { toast(errText(e), true); } };
    $('#tplReset').onclick = async () => { await eng.settings.set('invoice_template', DEFAULT_SETTINGS.invoice_template); await app.refreshCfg(); toast('عادت الفاتورة للشكل الافتراضي'); draw(); };

    // ---- backup / restore
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    async function makeFile() {
      const file = await eng.admin.backup();
      return new File([JSON.stringify(file)], `pos-backup-${stamp()}.json`, { type: 'application/json' });
    }
    $('#export').onclick = async () => {
      try {
        const f = await makeFile(), a = document.createElement('a');
        a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('تم حفظ النسخة الاحتياطية'); draw();
      } catch (e) { toast(errText(e), true); }
    };
    $('#share')?.addEventListener('click', async () => {
      try { const f = await makeFile(); await navigator.share({ files: [f], title: 'نسخة احتياطية' }); draw(); }
      catch (e) { if (e.name !== 'AbortError') toast(errText(e), true); }
    });
    $('#restore').onclick = () => $('#restoreFile').click();
    $('#restoreFile').addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      let file; try { file = JSON.parse(await f.text()); } catch { return toast('الملف ليس نسخة احتياطية صالحة', true); }
      let v; try { v = await eng.admin.verifyBackup(file); } catch (e) { return toast(errText(e), true, 3500); }
      if (!v.ok) return openModal({ title: 'ملف مرفوض', html: `<div class="err">الأرقام داخل الملف لا تتطابق (تالف أو مُعدَّل):</div>${v.problems.slice(0, 5).map((p) => `<div class="muted" style="font-size:.8rem">${esc(p.check)} · ${esc(p.ref)}</div>`).join('')}`, buttons: [{ label: 'إغلاق', cls: 'gold' }] });
      openModal({ title: 'استعادة نسخة احتياطية',
        html: `<div class="kv"><span>تاريخ النسخة</span><b>${v.exported_at ? new Date(v.exported_at).toLocaleString('ar-MA-u-nu-latn') : '—'}</b></div>
          <div class="kv"><span>المنتجات</span><b>${v.counts.products}</b></div><div class="kv"><span>الفواتير</span><b>${v.counts.invoices}</b></div>
          <div class="kv"><span>الزبناء / الموردون</span><b>${v.counts.customers} / ${v.counts.suppliers}</b></div>
          <div class="err">⚠ سيُستبدل كل ما في هذا الجهاز بمحتوى هذه النسخة، وستدخل بكلمات مرورها.</div>`,
        buttons: [{ label: 'إلغاء' }, { label: 'استعادة', cls: 'gold', onClick: async () => {
          try { await eng.admin.restoreBackup(file); toast('تمت الاستعادة، سيُعاد تشغيل البرنامج'); setTimeout(() => location.reload(), 900); }
          catch (e) { toast(errText(e), true, 3500); }
        } }] });
    });

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
