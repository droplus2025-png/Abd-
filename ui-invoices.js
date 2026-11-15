// Invoices archive: search, filters, detail, WhatsApp, and product details for quick sales.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, money, price4, qtyStr, TYPE_AR, fmtWhen } from './ui-core.js';
import { money as M } from './index.js';

// modal showing the formatted text invoice with a WhatsApp button (used by other screens too)
export async function showInvoice(app, idOrNo) {
  const eng = app.engine;
  let msg;
  try { msg = await eng.share.invoiceMessage(idOrNo); } catch (e) { return toast(errText(e), true); }
  openModal({
    title: 'الفاتورة', tall: true,
    html: `<pre dir="auto" style="white-space:pre-wrap;margin:0;font:inherit;line-height:1.6;user-select:text">${esc(msg.text)}</pre>`,
    buttons: [{ label: 'إغلاق' }, { label: 'واتساب', cls: 'gold', onClick: () => {
      window.open(msg.link || `https://wa.me/?text=${encodeURIComponent(msg.text)}`, '_blank'); eng.share.markSent(msg.invoice_id).catch(() => {}); } }],
  });
}

const FILTERS = [
  ['all', 'الكل', null], ['sale', 'بيع', ['sale']], ['quick', 'سريع', ['quick_sale']], ['pending', '⏳ بدون تفاصيل', ['quick_sale']],
  ['purchase', 'شراء', ['purchase']], ['ret', 'إرجاع', ['return_customer', 'return_supplier']],
  ['pay', 'قبض/دفع', ['collect', 'pay_supplier']], ['other', 'أخرى', ['expense', 'deposit', 'withdrawal', 'cash_adjustment', 'opening_debt_customer', 'opening_debt_supplier']],
];

export async function renderInvoices(app, params = {}) {
  const eng = app.engine, can = app.session.permissions;
  let filter = params.filter || 'all', back = () => app.go('home');
  mount(`<div class="screen">${header('الفواتير')}<div class="body col">
    <input id="q" class="inp" placeholder="🔍 رقم الفاتورة أو اسم / هاتف" autocomplete="off">
    <div class="chips" id="chips">${FILTERS.map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
    <div id="main" style="flex:1;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:8px"></div></div></div>`);
  $('#hdrBack').onclick = () => back();

  async function list() {
    back = () => app.go('home'); $('#q').style.display = ''; $('#chips').style.display = '';
    const f = FILTERS.find((x) => x[0] === filter);
    let rows = await eng.reports.searchInvoices({ text: $('#q').value, types: f[2], limit: 150 });
    if (filter === 'pending') rows = rows.filter((i) => !i.has_detail);
    $('#main').innerHTML = rows.length ? `<div class="results" style="max-height:none">${rows.map((i) => `
      <button class="res" data-id="${i.id}" style="grid-template-columns:auto 1fr auto">
        <span class="sku">${i.invoice_no}</span>
        <span>${TYPE_AR[i.type] || i.type}${i.party_name ? ' · ' + esc(i.party_name) : ''}
          ${i.type === 'quick_sale' && !i.has_detail ? ' <span class="pill amber">بدون تفاصيل</span>' : ''}${i.is_modified ? ' <span class="pill">معدلة</span>' : ''}
          <br><span class="muted" style="font-size:.8rem">${fmtWhen(i.created_at)}</span></span>
        <span class="p">${money(i.total)}</span></button>`).join('')}</div>` : '<div class="muted" style="padding:14px">لا توجد فواتير</div>';
    document.querySelectorAll('#main .res').forEach((b) => b.addEventListener('click', () => detail(b.dataset.id)));
  }
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(list, 150); });
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; filter = b.dataset.k;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); list(); });

  // ---------------------------------------------------------------- one invoice
  async function detail(id) {
    clearTimeout(t);
    const d = await eng.reports.invoice(id);
    if (!d) return toast('الفاتورة غير موجودة', true);
    back = list; $('#q').style.display = 'none'; $('#chips').style.display = 'none';
    const i = d.invoice;
    $('#main').innerHTML = `
      <div class="card"><div class="kv"><span>رقم</span><b>${i.invoice_no}</b></div>
        <div class="kv"><span>${TYPE_AR[i.type] || i.type}</span><span class="muted">${fmtWhen(i.created_at)}</span></div>
        ${d.party ? `<div class="kv"><span>${esc(d.party.name)}</span><span class="muted" dir="ltr">${esc(d.party.phone)}</span></div>` : ''}
        ${i.note ? `<div class="kv"><span>${esc(i.note)}</span><span></span></div>` : ''}</div>
      ${d.lines.length ? `<div class="card">${d.lines.map((l) => `<div class="kv"><span>${esc(l.name)} <span class="muted">· ${qtyStr(l.qty)} × ${price4(l.unit_price)}</span></span><b>${money(l.line_total)}</b></div>`).join('')}</div>` : ''}
      <div class="card"><div class="kv"><span>الإجمالي</span><b>${money(i.total)}</b></div>
        ${i.credit_amount && ['sale', 'purchase'].includes(i.type) ? `<div class="kv"><span>المدفوع</span><b>${money(i.paid)}</b></div><div class="kv"><span>المتبقي</span><b style="color:var(--amber)">${money(d.remaining)}</b></div>` : ''}
        ${can.view_cost_profit && i.profit !== undefined && ['sale', 'quick_sale', 'return_customer'].includes(i.type)
          ? `<div class="kv"><span>${d.has_detail ? 'الربح الحقيقي' : i.type === 'quick_sale' ? 'الربح (نسبة جزافية)' : 'الربح'}</span><b>${money(d.real_profit ?? i.profit)}</b></div>` : ''}
        ${d.returns.length ? d.returns.map((r) => `<div class="kv"><span class="muted">إرجاع ${r.invoice_no}</span><b>${money(r.total)}</b></div>`).join('') : ''}</div>
      <div class="row"><button class="btn gold big" id="wa" style="flex:1">واتساب / نسخ</button>
        ${d.quick_pending && can.quick_sale ? '<button class="btn amber big" id="det" style="flex:1">إضافة التفاصيل</button>' : ''}</div>`;
    $('#wa').onclick = () => showInvoice(app, id);
    $('#det')?.addEventListener('click', () => editDetails(d));
  }

  // ---------------------------------------------------------------- product details of a quick sale
  // Same freedom as a normal sale (product, external product, price, quantity). The WHOLE total must be distributed.
  function editDetails(d) {
    back = () => detail(d.invoice.id);
    const total = d.invoice.total;
    const canPrice = !!can.edit_sale_price;                  // prices are those really charged; without the right to edit them the product's own price is used
    let lines = [], timer, last = null;                      // {kind:'product', id, sku, name, qty, price} | {kind:'ext', name, qty, price, cost}
    $('#main').innerHTML = `
      <div class="card"><b style="color:var(--gold)">${d.invoice.invoice_no}</b> <span class="muted">· المبلغ المدفوع: <b style="color:var(--text)">${money(total)}</b></span>
        <div class="muted" style="font-size:.82rem;margin-top:4px">أضف المنتجات المباعة فعلاً بأسعار بيعها الحقيقية، ويجب أن يساوي المجموع المبلغ المدفوع تماماً. وإلا فاترك الفاتورة بدون تفاصيل.</div></div>
      <div class="row"><input id="ps" class="inp" placeholder="🔍 أضف منتجاً بالاسم أو الرقم" autocomplete="off" style="flex:1"><button class="btn amber" id="ext" style="flex:0 0 31%">منتج خارجي</button></div>
      <div id="sug"></div><div id="dl" style="display:flex;flex-direction:column;gap:6px"></div>
      <div id="sum" class="card"></div><div class="err" id="derr"></div>
      <button class="btn teal big" id="save" disabled style="font-size:1.2rem">حفظ التفاصيل</button>`;

    async function suggest() {
      const q = $('#ps').value.trim();
      if (!q) { $('#sug').innerHTML = ''; return; }
      const rows = await eng.products.search(q, 6);
      $('#sug').innerHTML = `<div class="results">${rows.map((p) => `<button class="res" data-id="${p.id}"><span class="sku">${p.sku}</span><span>${esc(p.name)}</span><span class="muted">${price4(p.purchase_price)}</span><span class="p">${price4(p.sale_price)}</span></button>`).join('')}</div>`;
      document.querySelectorAll('#sug .res').forEach((b) => b.addEventListener('click', () => {
        const p = rows.find((r) => r.id === b.dataset.id), ex = lines.find((l) => l.id === p.id);
        if (ex) ex.qty = String((Number(ex.qty) || 0) + 1); else lines.push({ kind: 'product', id: p.id, name: p.name, sku: p.sku, qty: '1', price: price4(p.sale_price) });
        $('#ps').value = ''; $('#sug').innerHTML = ''; draw();
      }));
    }
    let ts; $('#ps').addEventListener('input', () => { clearTimeout(ts); ts = setTimeout(suggest, 120); });
    $('#ext').onclick = () => openModal({
      title: 'منتج خارجي (حسب الطلب)',
      html: `<input id="en" class="inp" placeholder="اسم المنتج"><div class="row"><input id="ec" class="inp" inputmode="decimal" placeholder="سعر الشراء"><input id="ep" class="inp" inputmode="decimal" placeholder="سعر البيع"></div><input id="eq" class="inp" inputmode="decimal" value="1"><div class="err" id="eerr"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'إضافة', cls: 'gold', onClick: (close, m) => {
        const name = m.querySelector('#en').value.trim(), cost = m.querySelector('#ec').value || '0', pr = m.querySelector('#ep').value, q = m.querySelector('#eq').value || '1';
        try { M.parsePrice(cost); M.parsePrice(pr); M.parseQty(q); if (!name) throw Object.assign(new Error(), { code: 'NAME_REQUIRED' }); }
        catch (e) { m.querySelector('#eerr').textContent = errText(e); return false; }
        lines.push({ kind: 'ext', name, qty: q, price: pr, cost }); draw();
      } }], onOpen: (m) => m.querySelector('#en').focus(),
    });

    const payload = (extra = {}) => ({ invoice: d.invoice.id, ...extra,
      lines: lines.map((l) => (l.kind === 'product' ? { productId: l.id, qty: l.qty, price: l.price } : { external: { name: l.name, cost: l.cost, price: l.price, qty: l.qty } })) });

    function draw() {
      $('#dl').innerHTML = lines.map((l, k) => `<div class="line ${l.kind === 'ext' ? 'ext' : ''}" style="grid-template-columns:1fr 78px 64px 30px" data-k="${k}">
        <div class="nm">${l.kind === 'product' ? `<span class="muted">${l.sku} · </span>` : '＋ '}${esc(l.name)}<br><span class="muted lt" style="font-size:.78rem"></span></div>
        <input class="inp p" inputmode="decimal" value="${esc(l.price)}" ${canPrice ? '' : 'disabled'}><input class="inp n" inputmode="decimal" value="${esc(l.qty)}">
        <button class="x">✖</button></div>`).join('');
      document.querySelectorAll('#dl .line').forEach((row) => {
        const l = lines[Number(row.dataset.k)], pi = row.querySelector('.p'), ni = row.querySelector('.n');
        [pi, ni].forEach((i) => i.addEventListener('focus', () => i.select()));
        pi.addEventListener('input', () => { l.price = pi.value; schedule(); });
        ni.addEventListener('input', () => { l.qty = ni.value; schedule(); });
        row.querySelector('.x').addEventListener('click', () => { lines.splice(Number(row.dataset.k), 1); draw(); });
      });
      schedule();
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(preview, 150); }
    async function preview() {
      $('#derr').textContent = ''; $('#save').disabled = true; last = null;
      if (!lines.length) { $('#sum').innerHTML = '<div class="muted">أضف المنتجات المباعة فعلاً وكمياتها وأسعارها</div>'; return; }
      try {
        const p = await eng.previewQuickDetail(payload());
        last = p;
        document.querySelectorAll('#dl .line').forEach((row, k) => {
          row.querySelector('.lt').textContent = `= ${money(p.lines[k].line_total)}`;
        });
        const ok = p.remaining === 0;
        $('#sum').innerHTML = `<div class="kv"><span>المبلغ الثابت</span><b>${money(p.total)}</b></div>
          <div class="kv"><span>مجموع المنتجات المضافة</span><b>${money(p.distributed)}</b></div>
          <div class="kv"><span>الفرق عن المبلغ المدفوع</span><b style="color:${ok ? 'var(--ok)' : 'var(--red)'}">${ok ? '0 ✓' : money(p.remaining)}</b></div>
          ${can.view_cost_profit ? `<div class="kv"><span>الربح الحقيقي</span><b style="color:var(--gold)">${money(p.real_profit)}</b></div>
            <div class="kv"><span class="muted">بدل التقديري الجزافي</span><span class="muted">${money(p.flat_profit)}</span></div>` : ''}
          ${p.below_cost.length ? `<div class="err">⚠ بيع بأقل من التكلفة: ${p.below_cost.map((x) => esc(x.name)).join('، ')}</div>` : ''}
          ${p.warnings.filter((w) => w.type === 'NEGATIVE_STOCK').length ? `<div class="err">⚠ مخزون سالب: ${p.warnings.filter((w) => w.type === 'NEGATIVE_STOCK').map((w) => esc(w.name)).join('، ')}</div>` : ''}`;
        $('#save').disabled = !ok;
      } catch (e) { $('#derr').textContent = errText(e); }
    }
    async function save(allowBelowCost = false) {
      $('#save').disabled = true;
      try {
        await eng.detailQuickSale(payload({ allowBelowCost })); toast('تمت إضافة التفاصيل'); detail(d.invoice.id);
      } catch (e) {
        if (e.code === 'BELOW_COST') {
          if (await confirmBox('بيع بأقل من التكلفة', `${e.details.items.map((i) => i.name).join('، ')} — هل تريد المتابعة؟`)) return save(true);
        } else $('#derr').textContent = errText(e);
        $('#save').disabled = false;
      }
    }
    $('#save').onclick = () => save();
    draw();
  }
  list();
  if (params.open) detail(params.open);
}
