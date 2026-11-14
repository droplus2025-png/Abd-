// Stock screen: LTR table (number | product | purchase | sale | quantity), add, paste from Excel.
import { mount, $, esc, header, toast, errText, openModal, price4, qtyStr } from './ui-core.js';

export async function renderStock(app) {
  const eng = app.engine, can = app.session.permissions, owner = app.session.role === 'owner';
  mount(`<div class="screen">${header('المنتجات')}<div class="body">
    <input id="q" class="inp" placeholder="🔍 بحث: اسم المنتج أو رقمه" autocomplete="off">
    <div class="row">
      ${can.add_product ? '<button class="btn gold" id="add" style="flex:1">+ إضافة</button>' : ''}
      ${can.manage_stock ? '<button class="btn" id="paste" style="flex:1">لصق من Excel</button>' : ''}
    </div>
    <div class="muted" id="count"></div>
    <div id="list" style="overflow:auto;flex:1;min-height:0"></div></div></div>`);
  $('#hdrBack').onclick = () => app.go('home');

  async function load() {
    const rows = await eng.products.search($('#q').value.trim(), 400);
    $('#count').textContent = `${rows.length} منتج${rows.length === 400 ? ' (أول 400)' : ''}`;
    $('#list').innerHTML = `<div class="trow h" style="direction:ltr"><div>الرقم</div><div>المنتج</div><div>شراء</div><div>بيع</div><div>الكمية</div></div>` +
      rows.map((p) => `<div class="trow" style="direction:ltr"><div style="color:var(--gold);font-weight:800">${p.sku}</div>
        <div class="n" dir="auto">${esc(p.name)}</div><div>${price4(p.purchase_price)}</div><div style="color:var(--lime)">${price4(p.sale_price)}</div>
        <div class="${p.qty < 0 ? 'neg' : ''}">${qtyStr(p.qty)}</div></div>`).join('');
  }
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 120); });

  $('#add')?.addEventListener('click', () => openModal({
    title: 'إضافة منتج',
    html: `<input id="n" class="inp" placeholder="اسم المنتج"><div class="row"><input id="pa" class="inp" inputmode="decimal" placeholder="سعر الشراء">
      <input id="pv" class="inp" inputmode="decimal" placeholder="سعر البيع"></div>
      ${can.manage_stock ? '<input id="qt" class="inp" inputmode="decimal" placeholder="الكمية الأولية (اختياري)">' : ''}<div class="err" id="err"></div>`,
    buttons: [{ label: 'إلغاء' }, { label: 'حفظ', cls: 'gold', onClick: async (close, m) => {
      try {
        const p = await eng.products.create({ name: m.querySelector('#n').value, purchasePrice: m.querySelector('#pa').value || '0',
          salePrice: m.querySelector('#pv').value || '0', qty: m.querySelector('#qt')?.value || '0' });
        toast(`تمت الإضافة · رقم ${p.sku}`); load();
      } catch (e) { m.querySelector('#err').textContent = errText(e) + (e.details?.sku ? ` (رقم ${e.details.sku})` : ''); return false; }
    } }],
    onOpen: (m) => m.querySelector('#n').focus(),
  }));

  $('#paste')?.addEventListener('click', () => openModal({
    title: 'لصق من Excel', tall: true,
    html: `<div class="muted" style="font-size:.85rem">الأعمدة بالترتيب: الرقم ← المنتج ← سعر الشراء ← سعر البيع ← الكمية. الفاصل: Tab (من Excel) أو ;<br>الأسطر الفارغة تُتجاهل، والمكرر يبقى مرة واحدة.</div>
      <textarea id="ta" class="inp" rows="7" dir="ltr" placeholder="1;Marteau;30;40;5"></textarea><div class="err" id="err"></div>`,
    buttons: [{ label: 'إلغاء' }, { label: 'استيراد', cls: 'gold', onClick: async (close, m) => {
      const rows = [];
      for (const line of m.querySelector('#ta').value.split('\n')) {
        const c = line.split(/\t|;/).map((x) => x.trim());
        if (c.length < 2 || !c[1]) continue;
        if (c[0] && !/^\d+$/.test(c[0])) continue;                      // header line
        rows.push({ sku: c[0] || undefined, name: c[1], purchasePrice: c[2] || '0', salePrice: c[3] || '0', qty: c[4] || '0' });
      }
      try { const r = await eng.products.import(rows); toast(`أُضيف ${r.created} · تُجوهل ${r.skipped.length}`, false, 3500); load(); }
      catch (e) { m.querySelector('#err').textContent = errText(e); return false; }
    } }],
    onOpen: (m) => m.querySelector('#ta').focus(),
  }));
  load();
}
