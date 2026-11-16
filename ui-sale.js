// Sale screen: search + external product, quick-sale keypad, cart, pay.
import { mount, $, esc, header, toast, errText, openModal, confirmBox, showStrip, money, price4, qtyStr, partySuggest, priceShort } from './ui-core.js';
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
  let lastAdded = null;       // name of the last product added from the search (shown in the cart bar)

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
  // phone-dialer layout (1 2 3 on top, read left to right); [00] saves taps on round amounts; C clears everything
  const press = (k) => {
    if (k === '⌫') quick = quick.slice(0, -1);
    else if (k === 'C') quick = '';
    else if (k === '.') { if (!quick.includes('.')) quick = (quick || '0') + '.'; }
    else {
      const add = k === '00' && !quick ? '0' : k;
      if (quick.includes('.') && quick.split('.')[1].length + add.length > 2) return;
      if (quick.length + add.length > 9) return;
      quick = quick === '0' && !quick.includes('.') ? (add === '00' ? '0' : add) : quick + add;
    }
    refreshTotals();
  };
  function drawKeypad() {
    const keys = [['1'], ['2'], ['3'], ['⌫', 'fn'], ['4'], ['5'], ['6'], ['C', 'fn'], ['7'], ['8'], ['9'], ['00', 'fn'], ['0', 'w3'], ['.', 'fn']];
    main.innerHTML = `<div class="keypad">${keys.map(([k, c = '']) => `<button class="key ${c}" data-k="${k}">${k}</button>`).join('')}</div>`;
    main.querySelectorAll('.key').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
  }
  // physical keyboard (touch PC): digits, Backspace, Delete = clear, Enter = pay -- only while the quick keypad is showing
  const onKey = (e) => {
    if (!document.contains(main)) { document.removeEventListener('keydown', onKey); return; }
    if (isNormal() || document.querySelector('.modal') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === '.' || e.key === ',') press('.');
    else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Delete' || e.key === 'Escape') press('C');
    else if (e.key === 'Enter') onPay(); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
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
      pi.enterKeyHint = 'next'; ni.enterKeyHint = 'done';
      pi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ni.focus(); } });
      ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qIn.focus(); } });       // quantity typed -> straight back to the search for the next product
      row.querySelector('.x').addEventListener('click', () => {
        const i = Number(row.dataset.i), [gone] = cart.splice(i, 1); draw();
        showStrip({ warn: true, ms: 5000, html: `حُذف: ${esc(gone.name)}`, actions: [{ label: '↩ تراجع', cls: 'gold', onClick: () => { cart.splice(i, 0, gone); normal = true; draw(); } }] });
      });
    });
  }
  // result row:  [Sku - product]  [V:sale price]  [A<purchase> Q<quantity>]  (the code is a reminder for the employee)
  // the option that matches EXACTLY (number or name) is shown in green
  async function drawResults(target) {
    const rows = await eng.products.search(query, mq.matches ? 80 : 40);
    if (!mq.matches && !isNormal()) return;
    const q = query.toLowerCase();
    const exact = (p) => !!q && (/^\d+$/.test(q) ? p.sku === Number(q) : p.name.toLowerCase() === q);
    const inCart = (p) => { const l = cart.find((x) => x.kind === 'product' && x.productId === p.id); return l ? `<span class="inc">×${esc(l.qty)}</span>` : ''; };
    const bar = cart.length ? `<button class="cartbar" id="cartbar"><span>🛒 <b>${cart.length}</b> ${lastAdded ? `· آخر: ${esc(lastAdded)}` : ''}</span><span>عرض السلة ‹</span></button>` : '';
    target.innerHTML = `<div class="results">${bar}${rows.length ? rows.map((p) => `
      <button class="res rs ${exact(p) ? 'exact' : ''}" data-id="${p.id}"><span class="rn"><b class="sku">${p.sku}</b> - ${esc(p.name)}${inCart(p)}</span>
        <span class="rv">V:${priceShort(p.sale_price)}</span>
        <span class="rc"><span class="ra">A${priceShort(p.purchase_price)}</span> <span class="rq ${p.qty <= 0 ? 'neg' : ''}">Q${qtyStr(p.qty) || 0}</span></span></button>`).join('')
      : '<div class="muted" style="padding:14px">لا نتائج</div>'}</div>`;
    target.querySelectorAll('.res, .cartbar').forEach((b) => b.addEventListener('pointerdown', (e) => e.preventDefault()));   // keep the keyboard / focus: no flicker between two products
    target.querySelectorAll('.res').forEach((b) => b.addEventListener('click', () => addProduct(rows.find((r) => r.id === b.dataset.id))));
    target.querySelector('#cartbar')?.addEventListener('click', showCart);
    lastRows = rows;
  }
  let lastRows = [];
  function showCart() { query = ''; qIn.value = ''; searching = false; qIn.blur(); draw(); }

  function addProduct(p) {
    const ex = cart.find((l) => l.kind === 'product' && l.productId === p.id);
    if (ex) ex.qty = String(safe(() => M.parseQty(ex.qty || 0) / 1000, 0) + 1);
    else cart.push({ kind: 'product', productId: p.id, sku: p.sku, name: p.name, qty: '1', price: price4(p.sale_price) });
    lastAdded = p.name; normal = true; draw();
    if (document.activeElement === qIn) qIn.select();               // the search stays open: type the next product (text is selected, typing replaces it)
    else { query = ''; qIn.value = ''; draw(); }
  }

  // ---- events
  let t;
  qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = qIn.value.trim(); draw(); }, 120); });
  qIn.enterKeyHint = 'go';
  qIn.addEventListener('focus', () => { searching = true; normal = true; draw(); setTimeout(() => qIn.select(), 0); });
  qIn.addEventListener('keydown', async (e) => {                   // Enter: add the exact match (number or name), or the only result
    if (e.key !== 'Enter') return;
    e.preventDefault(); clearTimeout(t); query = qIn.value.trim();
    await drawResults(mq.matches ? $('#resA') : main);
    const q = query.toLowerCase();
    const hit = lastRows.find((p) => (/^\d+$/.test(q) ? p.sku === Number(q) : p.name.toLowerCase() === q)) || (lastRows.length === 1 ? lastRows[0] : null);
    if (hit) addProduct(hit); else if (!lastRows.length) toast('لا نتائج', true, 1200);
  });
  qIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== qIn && !query) { searching = false; draw(); } }, 250));
  $('#lblNormal').onclick = () => {                                // tap "normal sale": quick box -> pay button. Tap again (empty cart) to go back to quick mode
    if (cart.length) return showCart();                           // items in the cart: this cell brings the cart back
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
      showStrip({ ms: 3500, html: `✔ ${esc(r.invoice.invoice_no)} · <b>${money(r.invoice.total)}</b>` }); quick = '';
    } catch (e) { toast(errText(e), true, 3500); }
    busy = false; draw();
  }
  function payCart() {
    const T = cartTotal();
    openModal({
      title: `الدفع · ${money(T)}`,
      html: `<div class="lbl">المبلغ المدفوع</div><input id="paid" class="inp" inputmode="decimal" value="${money(T)}">
        <div class="chips2" id="tender">${tenders(T).map((c) => `<button class="chip ${c.cls}" data-v="${c.v}">${c.label}</button>`).join('')}</div>
        <div id="info" class="chg"></div>
        <div id="cust" style="display:none;gap:8px;flex-direction:column"><input id="cn" class="inp" placeholder="اسم الزبون"><input id="cp" class="inp" inputmode="tel" placeholder="رقم الهاتف"><div id="sg"></div></div>
        <div class="err" id="perr"></div>`,
      buttons: [{ label: 'إلغاء' }, { label: 'تأكيد', cls: 'gold', onClick: (close, m) => confirmSale(m) }],
      onOpen: (m) => {
        const paid = m.querySelector('#paid'), info = m.querySelector('#info'), cust = m.querySelector('#cust');
        const upd = () => {
          const p = safe(() => M.parseMoney(paid.value || 0), 0);
          if (p >= T) { info.textContent = p > T ? `الباقي للزبون: ${money(p - T)}` : ''; info.className = 'chg'; cust.style.display = 'none'; }
          else { info.textContent = `دين على الزبون: ${money(T - p)}`; info.className = 'chg debt'; cust.style.display = 'flex'; }
        };
        partySuggest(app, 'customer', m.querySelector('#cn'), m.querySelector('#cp'), m.querySelector('#sg'));
        paid.addEventListener('input', upd);
        m.querySelectorAll('#tender .chip').forEach((c) => c.addEventListener('click', () => { paid.value = c.dataset.v; upd(); }));
        upd(); paid.focus(); paid.select();
      },
    });
  }
  // one-tap amounts: exact, the next round notes above the total, or "all on credit"
  function tenders(T) {
    const out = [{ label: 'المبلغ كاملاً', v: money(T), cls: 'full' }], seen = new Set([T]);
    for (const d of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
      const v = Math.ceil(T / (d * 100)) * d * 100;
      if (!seen.has(v) && seen.size < 4) { seen.add(v); out.push({ label: money(v), v: money(v), cls: '' }); }
    }
    out.push({ label: 'دين', v: '0', cls: 'debt' });
    return out;
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
    const notes = r.warnings.filter((w) => w.type === 'NEGATIVE_STOCK').map((w) => `⚠ مخزون سالب: ${esc(w.name)}`).join(' · ');
    const first = r.change ? `الباقي للزبون <b>${money(r.change)}</b>` : r.invoice.credit_amount ? `دين <b>${money(r.invoice.credit_amount)}</b>` : `✔ <b>${money(r.invoice.total)}</b>`;
    showStrip({ warn: !!notes, ms: 20000, html: `${esc(r.invoice.invoice_no)} · ${first}${notes ? `<br>${notes}` : ''}`,
      actions: msg ? [{ label: 'واتساب', cls: 'gold', onClick: () => {
        window.open(msg.link || `https://wa.me/?text=${encodeURIComponent(msg.text)}`, '_blank');
        eng.share.markSent(msg.invoice_id).catch(() => {});
      } }] : [] });
  }

  draw();
}
