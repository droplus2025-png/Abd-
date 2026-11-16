// Sale screen: search + external product, quick-sale keypad, cart, pay.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, money, price4, qtyStr, partySuggest, priceShort } from './ui-core.js';
import { openExternal } from './ui-external.js';
import { money as M } from './index.js';

export async function renderSale(app) {
  const eng = app.engine;
  let cart = [];            // {kind:'product', productId, sku, name, qty, price} | {kind:'ext', name, qty, price, cost}
  let quick = '';
  let query = '';
  let searching = false;      // search box focused: show the product list instead of the keypad
  let normal = false;         // false = QUICK mode (keypad); true = NORMAL sale mode (the quick box gives its place to the pay button)
  let busy = false;

  mount(`<div class="screen">${header('بيع')}
    <div class="body salegrid">
      <!-- 2 x 2 block: green = normal sale, rose = external product (what is missing), orange = quick sale (+ its keypad) -->
      <div class="saletop">
        <button class="cell normal" id="lblNormal"><span class="nl">🔍 بيع عادي</span><span class="v" id="nv"></span></button>
        <button class="cell ext" id="ext">🔦 منتج خارجي</button>
        <input id="q" class="cell srch" placeholder="بحث بالاسم أو بالرقم" autocomplete="off">
        <div id="quickbox" class="cell quickc"><span class="ql">🚀 بيع سريع</span><span class="v" id="qv">0</span></div>
        <button class="cell pay paybtn" id="payTop" style="display:none">دفع</button>
      </div>
      <div class="colA"><div id="resA" class="resA"></div></div>
      <div class="colB">
        <div id="main" style="flex:1;display:flex;flex-direction:column;gap:8px;min-height:0"></div>
        <div class="payrow" id="payrow"><button class="btn teal paybtn" id="pay">دفع</button>
          <div class="totalbox"><div class="l">الإجمالي</div><div class="v" id="tot">0</div></div></div>
      </div>
    </div></div>`);

  const main = $('#main');
  const qIn = $('#q');

  // ---- totals (display only: the engine recomputes everything with exact arithmetic)
  const safe = (fn, d = 0) => { try { return fn(); } catch { return d; } };
  const lineTotal = (l) => safe(() => M.lineCents(M.parseQty(l.qty || 0), M.parsePrice(l.price || 0)));
  const cartTotal = () => cart.reduce((a, l) => a + lineTotal(l), 0);
  const quickCents = () => safe(() => M.parseMoney(quick || 0));
  const total = () => (cart.length ? cartTotal() : quickCents());
  const isNormal = () => normal || cart.length > 0;
  function refreshTotals() {
    $('#tot').textContent = money(total()); $('#qv').textContent = quick || '0';
    $('#nv').textContent = isNormal() ? money(total()) : '';          // the total shows in the green cell, as the quick amount shows in the orange one
    document.querySelectorAll('.paybtn').forEach((b) => { b.disabled = busy || total() <= 0; });
  }

  // ---- what the middle area shows
  const mq = window.matchMedia('(min-width: 900px)');       // touch-screen computer: list on one side, cart / keypad on the other
  function draw() {
    refreshTotals();
    const n = isNormal();
    $('#quickbox').style.display = n ? 'none' : '';                // normal sale: the quick-sale box disappears ...
    $('#payTop').style.display = n ? '' : 'none';                  // ... and the pay button takes its place
    $('#payrow').style.display = n ? 'none' : '';
    $('#lblNormal').classList.toggle('on', n);
    if (mq.matches) { drawResults($('#resA')); return n ? drawCart() : drawKeypad(); }
    $('#resA').innerHTML = '';
    if (!n) return drawKeypad();
    if (query || searching || !cart.length) return drawResults(main);
    drawCart();
  }
  const onMq = () => { if (!document.contains(main)) { mq.removeEventListener('change', onMq); return; } draw(); };   // never draw on a screen that was left
  mq.addEventListener('change', onMq);
  function drawKeypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '.'];
    main.innerHTML = `<div class="keypad">${keys.map((k) => `<button class="key" data-k="${k}">${k}</button>`).join('')}</div>`;
    main.querySelectorAll('.key').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === '⌫') quick = quick.slice(0, -1);
      else if (k === '.') { if (!quick.includes('.')) quick = (quick || '0') + '.'; }
      else if (!(quick.includes('.') && quick.split('.')[1].length >= 2) && quick.length < 9) quick = quick === '0' ? k : quick + k;
      refreshTotals();
    }));
  }
  function drawCart() {
    if (!cart.length) { main.innerHTML = '<div class="muted" style="padding:18px;text-align:center">اختر منتجاً من القائمة، أو أضف منتجاً خارجياً</div>'; return; }
    main.innerHTML = `<div class="cart">${cart.map((l, i) => `
      <div class="line ${l.kind === 'ext' ? 'ext' : ''}" data-i="${i}">
        <div class="nm">${l.kind === 'product' ? `<span class="muted">${l.sku} · </span>` : '＋ '}${esc(l.name)}</div>
        <label class="pf"><b>P:</b><input class="p" inputmode="decimal" value="${esc(l.price)}"></label><label class="pf"><b>Q:</b><input class="n" inputmode="decimal" value="${esc(l.qty)}"></label>
        <button class="x">✖</button></div>`).join('')}</div>`;
    main.querySelectorAll('.line').forEach((row) => {
      const l = cart[Number(row.dataset.i)];
      const pi = row.querySelector('.p'), ni = row.querySelector('.n');
      [pi, ni].forEach((inp) => inp.addEventListener('focus', () => inp.select()));
      pi.addEventListener('input', () => { l.price = pi.value; refreshTotals(); });
      ni.addEventListener('input', () => { l.qty = ni.value; refreshTotals(); });
      row.querySelector('.x').addEventListener('click', () => { cart.splice(Number(row.dataset.i), 1); draw(); });
    });
  }
  // result row:  [Sku - product]  [V:sale price]  [A<purchase> Q<quantity>]  (the code is a reminder for the employee)
  // the option that matches EXACTLY (number or name) is shown in green
  async function drawResults(target) {
    const rows = await eng.products.search(query, mq.matches ? 80 : 40);
    if (!mq.matches && !isNormal()) return;
    const q = query.toLowerCase();
    const exact = (p) => !!q && (/^\d+$/.test(q) ? p.sku === Number(q) : p.name.toLowerCase() === q);
    target.innerHTML = `<div class="results">${rows.length ? rows.map((p) => `
      <button class="res rs ${exact(p) ? 'exact' : ''}" data-id="${p.id}"><span class="rn"><b class="sku">${p.sku}</b> - ${esc(p.name)}</span>
        <span class="rv">V:${priceShort(p.sale_price)}</span>
        <span class="rc"><span class="ra">A${priceShort(p.purchase_price)}</span> <span class="rq ${p.qty <= 0 ? 'neg' : ''}">Q${qtyStr(p.qty) || 0}</span></span></button>`).join('')
      : '<div class="muted" style="padding:14px">لا نتائج</div>'}</div>`;
    target.querySelectorAll('.res').forEach((b) => b.addEventListener('click', () => addProduct(rows.find((r) => r.id === b.dataset.id))));
  }

  function addProduct(p) {
    const ex = cart.find((l) => l.kind === 'product' && l.productId === p.id);
    if (ex) ex.qty = String(safe(() => M.parseQty(ex.qty || 0) / 1000, 0) + 1);
    else cart.push({ kind: 'product', productId: p.id, sku: p.sku, name: p.name, qty: '1', price: price4(p.sale_price) });
    normal = true; query = ''; qIn.value = ''; qIn.blur(); draw();
  }

  // ---- events
  let t;
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = qIn.value.trim(); draw(); }, 120); });
  qIn.addEventListener('focus', () => { searching = true; normal = true; draw(); });
  qIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== qIn && !query) { searching = false; draw(); } }, 250));
  $('#lblNormal').onclick = () => {                                // tap "normal sale": quick box -> pay button. Tap again (empty cart) to go back to quick mode
    if (cart.length) return;
    normal = !normal; query = ''; qIn.value = ''; searching = false; draw();
  };
  $('#hdrBack').onclick = async () => { if (cart.length && !(await confirmBox('السلة غير فارغة', 'الخروج دون حفظ؟', 'خروج', 'بقاء'))) return; app.go('home'); };

  $('#ext').onclick = () => openExternal(app, (v) => { normal = true; cart.push({ kind: 'ext', name: v.name, qty: v.qty, price: v.price, cost: v.cost }); draw(); });

  // ---- pay
  const onPay = async () => {
    if (busy || total() <= 0) return;
    if (!cart.length) return payQuick();
    payCart();
  };
  document.querySelectorAll('.paybtn').forEach((b) => { b.onclick = onPay; });
  async function payQuick() {
    busy = true; refreshTotals();
    try {
      const r = await eng.quickSale(quick);
      quick = ''; toast(`تم · فاتورة ${r.invoice.invoice_no}`);
    } catch (e) { toast(errText(e), true, 3500); }
    busy = false; draw();
  }
  function payCart() {
    const T = cartTotal();
    openModal({
      title: `الدفع · ${money(T)}`,
      html: `<div class="lbl">المبلغ المدفوع</div><input id="paid" class="inp" inputmode="decimal" value="${money(T)}">
        <div id="info" class="muted"></div>
        <div id="cust" style="display:none;gap:8px;flex-direction:column"><input id="cn" class="inp" placeholder="اسم الزبون"><input id="cp" class="inp" inputmode="tel" placeholder="رقم الهاتف"><div id="sg"></div></div>
        <div class="err" id="perr"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'تأكيد', cls: 'gold', onClick: (close, m) => confirmSale(m) }],
      onOpen: (m) => {
        const paid = m.querySelector('#paid'), info = m.querySelector('#info'), cust = m.querySelector('#cust');
        const upd = () => {
          const p = safe(() => M.parseMoney(paid.value || 0), 0);
          if (p >= T) { info.textContent = p > T ? `الباقي للزبون: ${money(p - T)}` : ''; cust.style.display = 'none'; }
          else { info.textContent = `دين على الزبون: ${money(T - p)}`; cust.style.display = 'flex'; }
        };
        partySuggest(app, 'customer', m.querySelector('#cn'), m.querySelector('#cp'), m.querySelector('#sg'));
        paid.addEventListener('input', upd); paid.addEventListener('focus', () => paid.select());
        upd(); paid.focus(); paid.select();
        paid.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.querySelector('.mbtns .gold').click(); });
      },
    });
  }
  async function confirmSale(m, allowBelowCost = false) {
    const err = m.querySelector('#perr');
    const paid = m.querySelector('#paid').value;
    const input = { paid, allowBelowCost,
      lines: cart.map((l) => (l.kind === 'product' ? { productId: l.productId, qty: l.qty, price: l.price }
        : { external: { name: l.name, cost: l.cost, price: l.price, qty: l.qty } })) };
    const cn = m.querySelector('#cn').value.trim(), cp = m.querySelector('#cp').value.trim();
    if (cn || cp) input.customer = { name: cn, phone: cp };
    try {
      const r = await eng.sale(input);
      const msg = await eng.share.invoiceMessage(r.invoice.invoice_no).catch(() => null);
      cart = []; quick = ''; query = ''; qIn.value = ''; normal = false; searching = false; draw();      // back to quick mode
      m.remove();
      done(r, msg);
      return false;
    } catch (e) {
      if (e.code === 'BELOW_COST') {
        const names = e.details.items.map((i) => i.name).join('، ');
        if (await confirmBox('بيع بأقل من التكلفة', `${names} — هل تريد المتابعة؟`)) return confirmSale(m, true);
        return false;
      }
      err.textContent = errText(e); return false;
    }
  }
  function done(r, msg) {
    const notes = r.warnings.filter((w) => w.type === 'NEGATIVE_STOCK').map((w) => `⚠ مخزون سالب: ${esc(w.name)}`).join('<br>');
    openModal({
      title: `✔ تمت العملية · ${r.invoice.invoice_no}`,
      html: `<div class="kv"><span>الإجمالي</span><b>${money(r.invoice.total)}</b></div>
        ${r.change ? `<div class="kv"><span>الباقي للزبون</span><b>${money(r.change)}</b></div>` : ''}
        ${r.invoice.credit_amount ? `<div class="kv"><span>دين</span><b>${money(r.invoice.credit_amount)}</b></div>` : ''}
        ${notes ? `<div class="err">${notes}</div>` : ''}`,
      buttons: [{ label: 'تم' }, ...(msg ? [{ label: 'واتساب', cls: 'gold', onClick: () => {
        window.open(msg.link || `https://wa.me/?text=${encodeURIComponent(msg.text)}`, '_blank');
        eng.share.markSent(msg.invoice_id).catch(() => {});
      } }] : [])],
    });
  }

  draw();
}
