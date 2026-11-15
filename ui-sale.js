// Sale screen: search + external product, quick-sale keypad, cart, pay.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, money, price4, qtyStr } from './ui-core.js';
import { money as M } from './index.js';

export async function renderSale(app) {
  const eng = app.engine;
  let cart = [];            // {kind:'product', productId, sku, name, qty, price} | {kind:'ext', name, qty, price, cost}
  let quick = '';
  let query = '';
  let searching = false;      // search box focused: show the product list instead of the keypad
  let busy = false;

  mount(`<div class="screen">${header('بيع')}
    <div class="body salegrid">
      <div class="colA">
        <div class="row"><input id="q" class="inp" placeholder="🔍 بحث بالاسم أو بالرقم" style="flex:1" autocomplete="off">
          <button class="btn amber" id="ext" style="flex:0 0 31%">منتج خارجي</button></div>
        <div id="resA" class="resA"></div>
      </div>
      <div class="colB">
        <div id="quickbox" class="quick"><span class="muted">بيع سريع</span><span class="v" id="qv">0</span></div>
        <div id="main" style="flex:1;display:flex;flex-direction:column;gap:8px;min-height:0"></div>
        <div class="payrow"><button class="btn teal" id="pay">دفع</button>
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
  function refreshTotals() { $('#tot').textContent = money(total()); $('#qv').textContent = quick || '0'; $('#pay').disabled = busy || total() <= 0; }

  // ---- what the middle area shows
  const mq = window.matchMedia('(min-width: 900px)');       // touch-screen computer: list on one side, cart / keypad on the other
  function draw() {
    refreshTotals();
    if (mq.matches) {
      $('#quickbox').style.display = cart.length ? 'none' : 'flex';
      drawResults($('#resA'));
      return cart.length ? drawCart() : drawKeypad();
    }
    $('#resA').innerHTML = '';
    $('#quickbox').style.display = cart.length || query || searching ? 'none' : 'flex';
    if (query || searching) return drawResults(main);
    if (cart.length) return drawCart();
    drawKeypad();
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
    main.innerHTML = `<div class="cart">${cart.map((l, i) => `
      <div class="line ${l.kind === 'ext' ? 'ext' : ''}" data-i="${i}">
        <div class="nm">${l.kind === 'product' ? `<span class="muted">${l.sku} · </span>` : '＋ '}${esc(l.name)}</div>
        <input class="inp p" inputmode="decimal" value="${esc(l.price)}"><input class="inp n" inputmode="decimal" value="${esc(l.qty)}">
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
  async function drawResults(target) {
    const rows = await eng.products.search(query, mq.matches ? 80 : 40);
    if (!mq.matches && !(query || searching)) return;
    target.innerHTML = `<div class="results">${rows.length ? rows.map((p) => `
      <button class="res" data-id="${p.id}"><span class="sku">${p.sku}</span><span>${esc(p.name)}</span>
      <span class="muted">${price4(p.purchase_price)}</span><span class="p">${price4(p.sale_price)}</span></button>`).join('')
      : '<div class="muted" style="padding:14px">لا نتائج</div>'}</div>`;
    target.querySelectorAll('.res').forEach((b) => b.addEventListener('click', () => addProduct(rows.find((r) => r.id === b.dataset.id))));
  }

  function addProduct(p) {
    const ex = cart.find((l) => l.kind === 'product' && l.productId === p.id);
    if (ex) ex.qty = String(safe(() => M.parseQty(ex.qty || 0) / 1000, 0) + 1);
    else cart.push({ kind: 'product', productId: p.id, sku: p.sku, name: p.name, qty: '1', price: price4(p.sale_price) });
    query = ''; qIn.value = ''; qIn.blur(); draw();
  }

  // ---- events
  let t;
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = qIn.value.trim(); draw(); }, 120); });
  qIn.addEventListener('focus', () => { searching = true; draw(); });
  qIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== qIn && !query) { searching = false; draw(); } }, 250));
  $('#hdrBack').onclick = async () => { if (cart.length && !(await confirmBox('السلة غير فارغة', 'الخروج دون حفظ؟', 'خروج', 'بقاء'))) return; app.go('home'); };

  $('#ext').onclick = () => openModal({
    title: 'منتج خارجي (حسب الطلب)',
    html: `<input id="en" class="inp" placeholder="اسم المنتج"><div class="row"><input id="ec" class="inp" inputmode="decimal" placeholder="سعر الشراء">
      <input id="ep" class="inp" inputmode="decimal" placeholder="سعر البيع"></div><input id="eq" class="inp" inputmode="decimal" value="1" placeholder="الكمية"><div class="err" id="eerr"></div>`,
    buttons: [{ label: 'إلغاء' }, { label: 'إضافة', cls: 'gold', onClick: (close, m) => {
      const name = m.querySelector('#en').value.trim(), cost = m.querySelector('#ec').value, pr = m.querySelector('#ep').value, q = m.querySelector('#eq').value || '1';
      try { M.parsePrice(cost || 0); M.parsePrice(pr); M.parseQty(q); if (!name) throw Object.assign(new Error(), { code: 'NAME_REQUIRED' }); }
      catch (e) { m.querySelector('#eerr').textContent = errText(e); return false; }
      cart.push({ kind: 'ext', name, qty: q, price: pr, cost: cost || '0' }); draw();
    } }],
    onOpen: (m) => m.querySelector('#en').focus(),
  });

  // ---- pay
  $('#pay').onclick = async () => {
    if (busy || total() <= 0) return;
    if (!cart.length) return payQuick();
    payCart();
  };
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
        <div id="cust" style="display:none;gap:8px;flex-direction:column"><input id="cn" class="inp" placeholder="اسم الزبون"><input id="cp" class="inp" inputmode="tel" placeholder="رقم الهاتف"></div>
        <div class="err" id="perr"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'تأكيد', cls: 'gold', onClick: (close, m) => confirmSale(m) }],
      onOpen: (m) => {
        const paid = m.querySelector('#paid'), info = m.querySelector('#info'), cust = m.querySelector('#cust');
        const upd = () => {
          const p = safe(() => M.parseMoney(paid.value || 0), 0);
          if (p >= T) { info.textContent = p > T ? `الباقي للزبون: ${money(p - T)}` : ''; cust.style.display = 'none'; }
          else { info.textContent = `دين على الزبون: ${money(T - p)}`; cust.style.display = 'flex'; }
        };
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
      cart = []; quick = ''; query = ''; qIn.value = ''; draw();
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
