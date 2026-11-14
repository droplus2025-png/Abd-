import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createMemoryStore, createAuth, EngineError, money } from './index.js';
import { settingsApi } from './settings.js';
import { createAccess } from './permissions.js';
import { postInvoice } from './post.js';
import { renderInvoice } from './invoice-text.js';

// Clock: 13 Nov 2026 21:46 (Casablanca) + 1 s per call, so FIFO order is deterministic
function setup() {
  let t = Date.UTC(2026, 10, 13, 20, 46, 0);
  const now = () => new Date((t += 1000));
  const store = createMemoryStore();
  const auth = createAuth({ store, now });
  return { store, auth, now };
}
async function world() {
  const { store, auth, now } = setup();
  const ownerS = await auth.setupOwner({ name: 'Owner', code: '1234' });
  const owner = createEngine({ store, session: ownerS, now });
  await owner.settings.init();
  await owner.settings.set('store_name', 'عقاقير العيادي');
  await owner.settings.set('store_phone', '0663152474');
  await auth.addEmployee(ownerS, { name: 'Emp', code: '5678' });
  const empS = await auth.login('5678');
  const emp = createEngine({ store, session: empS, now });
  return { store, auth, now, ownerS, owner, empS, emp };
}
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof EngineError && e.code === code, `expected ${code}`);

test('money: exact rounding, comma decimals, weighted average', () => {
  assert.equal(money.parseMoney('12,5'), 1250);
  assert.equal(money.lineCents(money.parseQty('1,5'), money.parsePrice('10.01')), 1502);     // 15.015 -> 15.02
  assert.equal(money.wac(10000, 30000, 10000, 50000), 40000);                                 // (10x3 + 10x5)/20 = 4
  assert.equal(money.wac(-5000, 30000, 4000, 70000), 70000);                                  // negative stock -> new cost whole
  assert.throws(() => money.parseMoney('1.234'), (e) => e.code === 'TOO_MANY_DECIMALS');
  assert.equal(money.fmtMoney(1501), '15.01');
});

test('login: the code decides the role', async () => {
  const w = await world();
  assert.equal(w.ownerS.role, 'owner');
  assert.equal(w.empS.role, 'employee');
  await rejects(w.auth.login('0000'), 'BAD_CODE');
  await rejects(w.auth.addEmployee(w.empS, { name: 'x', code: '9999' }), 'PERMISSION_DENIED');
  await rejects(w.auth.addEmployee(w.ownerS, { name: 'dup', code: '5678' }), 'CODE_TAKEN');
  assert.equal(w.empS.permissions.cash_deposit_withdraw, false);
  assert.equal(w.empS.permissions.sell, true);
});

async function stocked(w) {
  const nails = await w.owner.products.create({ name: 'مسمار', salePrice: '5' });
  assert.equal(nails.sku, 1);
  await w.owner.deposit('1000');
  const p1 = await w.emp.purchase({ supplier: { name: 'Ali', phone: '0661234567' }, lines: [{ productId: nails.id, qty: 10, price: '3' }], paid: '20' });
  const p2 = await w.emp.purchase({ supplier: { name: 'Ali', phone: '+212661234567' }, lines: [{ productId: nails.id, qty: 10, price: '5' }] });
  return { nails, p1, p2 };
}

test('purchase: stock, weighted cost, till, supplier debt, same phone = same supplier', async () => {
  const w = await world();
  const { nails, p1, p2 } = await stocked(w);
  assert.equal(p1.invoice.invoice_no, '61113002');                       // deposit took 001
  assert.equal(p1.invoice.credit_amount, 1000);
  assert.equal(p1.invoice.cash_effect, -2000);
  const [prod] = await w.emp.products.search('1');
  assert.equal(prod.qty, 20000);
  assert.equal(prod.purchase_price, 40000);                              // WAC 4.00
  assert.equal(await w.owner.reports.cashBalance(), 100000 - 2000 - 5000);
  const sup = await w.emp.reports.suppliers();
  assert.equal(sup.length, 1);                                           // 0661... and +212661... are one supplier
  assert.equal(sup[0].balance, 1000);
  await rejects(w.emp.purchase({ supplier: { name: 'Ali', phone: '0661234567' }, lines: [{ productId: nails.id, qty: 1, price: '3' }], paid: '99' }), 'OVERPAYMENT');
  await rejects(w.emp.purchase({ supplier: { name: '', phone: '' }, lines: [{ productId: nails.id, qty: 1, price: '4' }] }), 'NAME_REQUIRED');
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('sale: cash with change, credit needs customer, frozen cost, negative stock warning', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  const cash0 = await w.owner.reports.cashBalance();
  const s = await w.emp.sale({ lines: [{ productId: nails.id, qty: 5 }], paid: '30' });
  assert.equal(s.invoice.total, 2500);
  assert.equal(s.invoice.paid, 2500);                                    // change 5.00 is not recorded
  assert.equal(s.change, 500);
  assert.equal(s.invoice.profit, 500);                                   // 5 x (5.00 - 4.00)
  assert.equal(await w.owner.reports.cashBalance(), cash0 + 2500);
  await rejects(w.emp.sale({ lines: [{ productId: nails.id, qty: 1 }], paid: '2' }), 'CUSTOMER_REQUIRED');

  const c = await w.emp.sale({ lines: [{ productId: nails.id, qty: 2 }], paid: '4', customer: { name: 'Karim', phone: '0600000001' } });
  assert.equal(c.invoice.credit_amount, 600);
  assert.equal((await w.emp.reports.customers())[0].balance, 600);

  const big = await w.emp.sale({ lines: [{ productId: nails.id, qty: 20 }] });                // only 13 left
  assert.equal(big.warnings[0].type, 'NEGATIVE_STOCK');
  const [prod] = await w.emp.products.search('1');
  assert.equal(prod.qty, -7000);
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('sale below cost: alert first, then allowed (damaged goods); permission can forbid it', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  await rejects(w.emp.sale({ lines: [{ productId: nails.id, qty: 1, price: '2' }] }), 'BELOW_COST');
  const ok = await w.emp.sale({ lines: [{ productId: nails.id, qty: 1, price: '2' }], allowBelowCost: true });
  assert.equal(ok.invoice.profit, -200);
  assert.equal(ok.warnings[0].type, 'BELOW_COST');
  await w.auth.setUserPermission(w.ownerS, w.empS.userId, 'sell_below_cost', false);
  const emp2 = createEngine({ store: w.store, session: await w.auth.login('5678'), now: w.now });
  await rejects(emp2.sale({ lines: [{ productId: nails.id, qty: 1, price: '2' }], allowBelowCost: true }), 'PERMISSION_DENIED');
});

test('external product: its cost leaves the till at the sale, profit is the commission', async () => {
  const w = await world();
  await w.owner.deposit('500');
  const r = await w.emp.sale({ lines: [{ external: { name: 'بيب خاص', cost: '70', price: '90', qty: 1 } }] });
  assert.equal(r.invoice.total, 9000);
  assert.equal(r.invoice.cash_effect, 2000);                             // 90 in, 70 out
  assert.equal(r.invoice.profit, 2000);
  assert.equal(await w.owner.reports.cashBalance(), 50000 + 2000);
});

test('quick sale: full price in the till, only the configured % is profit, can be returned', async () => {
  const w = await world();
  const q = await w.emp.quickSale('8');
  assert.equal(q.invoice.total, 800);
  assert.equal(q.invoice.cash_effect, 800);
  assert.equal(q.invoice.profit, 160);                                   // 20 %
  await w.owner.settings.set('quick_sale_profit_pct', 40);
  const q2 = await w.emp.quickSale('10');
  assert.equal(q2.invoice.profit, 400);                                  // 40 %
  const ret = await w.emp.customerReturn({ invoice: q.invoice.invoice_no, lines: [{ originLineId: q.lines[0].id, qty: 1 }] });
  assert.equal(ret.refunded, 800);
  assert.equal(ret.invoice.profit, -160);                                // profit taken back at the original %
  assert.equal(await w.owner.reports.cashBalance(), 800 + 1000 - 800);
  await rejects(w.emp.customerReturn({ invoice: q.invoice.invoice_no, lines: [{ originLineId: q.lines[0].id, qty: 1 }] }), 'RETURN_EXCEEDS');
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('customer return: debt reduced first, then cash; partial returns; original flagged', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  const s = await w.emp.sale({ lines: [{ productId: nails.id, qty: 4 }], paid: '5', customer: { name: 'Karim', phone: '0600000001' } });   // 20.00, paid 5 -> debt 15
  const cash0 = await w.owner.reports.cashBalance();
  const r1 = await w.emp.customerReturn({ invoice: s.invoice.id, lines: [{ originLineId: s.lines[0].id, qty: 2 }] });      // value 10
  assert.equal(r1.debt_reduced, 1000); assert.equal(r1.refunded, 0);
  assert.equal(await w.owner.reports.cashBalance(), cash0);
  const r2 = await w.emp.customerReturn({ invoice: s.invoice.id, lines: [{ originLineId: s.lines[0].id, qty: 2 }] });      // value 10: 5 debt left, 5 refund
  assert.equal(r2.debt_reduced, 500); assert.equal(r2.refunded, 500);
  assert.equal(await w.owner.reports.cashBalance(), cash0 - 500);
  assert.equal((await w.emp.reports.customers())[0].balance, 0);
  const back = await w.emp.reports.invoice(s.invoice.id);
  assert.equal(back.invoice.is_modified, true);
  assert.equal(back.invoice.total, 2000);                                // original untouched
  assert.equal(back.returns.length, 2);
  const [prod] = await w.emp.products.search('1');
  assert.equal(prod.qty, 20000);                                         // everything back in stock
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('supplier return: blocked without stock, reduces the supplier debt first', async () => {
  const w = await world();
  const { nails, p1 } = await stocked(w);
  await w.emp.sale({ lines: [{ productId: nails.id, qty: 15 }] });                         // 5 left
  await rejects(w.emp.supplierReturn({ invoice: p1.invoice.id, lines: [{ originLineId: p1.lines[0].id, qty: 8 }] }), 'STOCK_INSUFFICIENT');
  const cash0 = await w.owner.reports.cashBalance();
  const r = await w.emp.supplierReturn({ invoice: p1.invoice.id, lines: [{ originLineId: p1.lines[0].id, qty: 4 }] });   // 12.00 at 3.00
  assert.equal(r.debt_reduced, 1000);                                    // supplier debt was 10.00
  assert.equal(r.refunded, 200);
  assert.equal(await w.owner.reports.cashBalance(), cash0 + 200);
  assert.equal((await w.emp.reports.suppliers())[0].balance, 0);
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('debt payments: oldest invoice first, partial, no overpayment', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  const who = { name: 'Karim', phone: '0600000001' };
  const a = await w.emp.sale({ lines: [{ productId: nails.id, qty: 2 }], paid: '0', customer: who });   // 10.00
  const b = await w.emp.sale({ lines: [{ productId: nails.id, qty: 4 }], paid: '0', customer: who });   // 20.00
  const r = await w.emp.collect({ phone: '+212600000001' }, '15');
  assert.deepEqual(r.settled.map(x => x.amount), [1000, 500]);           // A fully, B partly
  const open = await w.emp.reports.openInvoices({ customer_id: r.customer.id });
  assert.equal(open.length, 1);
  assert.equal(open[0].invoice_no, b.invoice.invoice_no);
  assert.equal(open[0].remaining, 1500);
  assert.equal((await w.emp.reports.customers())[0].balance, 1500);
  await rejects(w.emp.collect({ phone: who.phone }, '15.01'), 'OVERPAYMENT');
  await w.emp.collect({ phone: who.phone }, '15');
  assert.equal((await w.emp.reports.customers())[0].balance, 0);
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('till closing is blind for the employee; the difference is recorded and becomes the official balance', async () => {
  const w = await world();
  await w.owner.deposit('100');
  await w.owner.cash.open();
  await w.emp.quickSale('50');                                           // expected 150
  const st = await w.emp.cash.status();
  assert.equal(st.open, true); assert.equal(st.opening_balance, 10000);
  assert.equal(st.expected_now, undefined);                              // never shown
  const res = await w.emp.cash.close('140');
  assert.deepEqual(res, { closed: true });                               // no expected, no difference
  assert.equal(await w.owner.reports.cashBalance(), 14000);              // counted = official
  const [adj] = await w.owner.reports.invoices({ type: 'cash_adjustment' });
  assert.equal(adj.cash_effect, -1000);
  await rejects(w.emp.reports.cashBalance(), 'PERMISSION_DENIED');
  const next = await w.owner.cash.open();
  assert.equal(next.opening_balance, 14000);                             // tomorrow opens with the counted amount
});

test('permissions set by the owner from Settings', async () => {
  const w = await world();
  await rejects(w.emp.deposit('10'), 'PERMISSION_DENIED');
  await rejects(w.emp.products.create({ name: 'x', qty: 5 }), 'PERMISSION_DENIED');           // initial stock = manage_stock
  await rejects(w.auth.setUserPermission(w.empS, w.empS.userId, 'cash_deposit_withdraw', true), 'PERMISSION_DENIED');
  await w.auth.setUserPermission(w.ownerS, w.empS.userId, 'cash_deposit_withdraw', true);
  const emp2 = createEngine({ store: w.store, session: await w.auth.login('5678'), now: w.now });
  assert.equal(emp2.permissions.cash_deposit_withdraw, true);
  await emp2.deposit('10');
  const rows = await w.auth.listPermissions(w.ownerS);
  const row = rows.find(r => r.key === 'cash_deposit_withdraw');
  assert.equal(row.allowed, true); assert.equal(row.customized, true);
  await w.auth.resetUserPermissions(w.ownerS, w.empS.userId, 'cash_deposit_withdraw');
  await w.auth.setDefaultPermission(w.ownerS, 'expense', false);
  const emp3 = createEngine({ store: w.store, session: await w.auth.login('5678'), now: w.now });
  assert.equal(emp3.permissions.cash_deposit_withdraw, false);
  assert.equal(emp3.permissions.expense, false);
  await rejects(emp3.expense('5', 'x'), 'PERMISSION_DENIED');
  await w.auth.setEmployeeActive(w.ownerS, w.empS.userId, false);
  await rejects(w.auth.login('5678'), 'BAD_CODE');
});

test('all or nothing: a failure in the middle writes NOTHING', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  const before = w.store.export();
  await rejects(w.emp.sale({ lines: [{ productId: nails.id, qty: 1 }, { productId: 'nope', qty: 1 }] }), 'UNKNOWN_PRODUCT');
  assert.deepEqual(w.store.export(), before);
  // an unbalanced draft that slips past the builders is caught by the final check and rolled back
  const ctx = { store: w.store, access: createAccess({ role: 'owner' }), ids: () => crypto.randomUUID(), now: w.now };
  await rejects(w.store.transaction((tx) => postInvoice(ctx, tx, { type: 'sale', total: 500, paid: 500, credit_amount: 0, cash_effect: 500,
    lines: [{ kind: 'quick', name: 'x', qty: 1000, unit_price: 60000, unit_cost: 0 }] })), 'CHECK_FAILED');   // total 5.00 but the line says 6.00
  assert.deepEqual(w.store.export(), before);
});

test('ledgers and invoices are frozen', async () => {
  const w = await world();
  const q = await w.emp.quickSale('8');
  await rejects(w.store.transaction((tx) => tx.update('cash_ledger', (w.store.export().cash_ledger[0]).id, { amount: 1 })), 'APPEND_ONLY');
  await rejects(w.store.transaction((tx) => tx.update('invoices', q.invoice.id, { total: 1 })), 'INVOICE_FROZEN');
  await rejects(w.store.transaction((tx) => tx.deleteAll('invoices')), 'APPEND_ONLY');
});

test('products: names unique, SKU never reused, search digits=SKU letters=name, import rules', async () => {
  const w = await world();
  const a = await w.owner.products.create({ name: 'Marteau', salePrice: '40' });
  await rejects(w.owner.products.create({ name: '  marteau ' }), 'PRODUCT_EXISTS');
  const b = await w.owner.products.create({ name: 'Scie' });
  assert.deepEqual([a.sku, b.sku], [1, 2]);
  await w.owner.products.remove(b.id);
  const c = await w.owner.products.create({ name: 'Clou' });
  assert.equal(c.sku, 3);                                                // SKU 2 stays reserved
  await rejects(w.owner.products.create({ name: 'Autre', sku: 2 }), 'SKU_TAKEN');
  assert.equal((await w.owner.products.search('1'))[0].name, 'Marteau');
  assert.equal((await w.owner.products.search('cl'))[0].name, 'Clou');
  await rejects(w.emp.products.remove(a.id), 'PERMISSION_DENIED');
  const rep = await w.owner.products.import([{ name: 'Vis', qty: '10', purchasePrice: '1', salePrice: '2' }, { name: '' }, { name: 'vis' }, { name: 'Marteau' }, { name: 'Pince' }]);
  assert.equal(rep.created, 2); assert.equal(rep.skipped.length, 2);
  const [vis] = await w.owner.products.search('vis');
  assert.equal(vis.qty, 10000); assert.equal(vis.purchase_price, 10000);
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
});

test('invoice numbers aammjjooo and the text invoice', async () => {
  const w = await world();
  const a = await w.emp.quickSale('8');
  const b = await w.emp.quickSale('9');
  assert.equal(a.invoice.invoice_no, '61113001');
  assert.equal(b.invoice.invoice_no, '61113002');
  const msg = await w.emp.share.invoiceMessage(a.invoice.invoice_no);
  assert.match(msg.text, /\*عقاقير العيادي\*/);
  assert.match(msg.text, /Fact n° : 61113001/);
  assert.match(msg.text, /13 nov 2026/);
  assert.match(msg.text, /\*Montant total : 8 DH\*/);
  assert.match(msg.text, /Tel : 0663152474/);
  assert.equal(msg.link, null);                                          // no party on a quick sale
});

test('store value live, daily report, reminder, reset keeps the stock', async () => {
  const w = await world();
  const { nails } = await stocked(w);                                    // cash 930, stock 20 x 4 = 80, supplier owes 10
  await w.emp.sale({ lines: [{ productId: nails.id, qty: 2 }], paid: '4', customer: { name: 'Karim', phone: '0600000001' } });   // +4 cash, customer owes 6
  const v = await w.owner.reports.storeValue();
  assert.equal(v.cash, 93000 + 400);
  assert.equal(v.stock, 18 * 4 * 100);
  assert.equal(v.customer_debts, 600);
  assert.equal(v.supplier_dues, 1000);
  assert.equal(v.store_value, 93400 + 7200 + 600 - 1000);
  await rejects(w.emp.reports.storeValue(), 'PERMISSION_DENIED');
  const [day] = await w.owner.reports.dailyReport();
  assert.equal(day.day, '2026-11-13');
  assert.equal(day.gross_profit, 200);                                   // 2 x (5 - 4)
  const cust = (await w.emp.reports.customers())[0];
  const rem = await w.emp.share.reminder(cust.id);
  assert.match(rem.text, /6 DH/);
  assert.match(rem.link, /^https:\/\/wa\.me\/212600000001\?text=/);
  const res = await w.owner.admin.resetOperations();
  assert.equal(res.products_kept, 1);
  assert.equal(await w.owner.reports.cashBalance(), 0);
  assert.equal((await w.owner.products.search('1'))[0].qty, 18000);
  assert.equal((await w.owner.products.search('1'))[0].purchase_price, 40000);
  assert.equal((await w.emp.reports.customers()).length, 0);
  assert.deepEqual(await w.owner.reports.integrityCheck(), []);
  await rejects(w.emp.admin.resetOperations(), 'PERMISSION_DENIED');
});

test('persistence hook: only changed rows are saved, a failing disk rolls the operation back', async () => {
  const saved = [];
  let broken = false;
  const persist = async (ch) => { if (broken) throw new Error('disk full'); saved.push(...ch); };
  const store = createMemoryStore(undefined, { persist });
  const auth = createAuth({ store });
  const s = await auth.setupOwner({ name: 'O', code: '1234' });
  const e = createEngine({ store, session: s });
  await e.settings.init();
  saved.length = 0;
  await e.quickSale('8');
  const tables = new Set(saved.map(c => c.table));
  assert.deepEqual([...tables].sort(), ['cash_ledger', 'invoice_lines', 'invoices']);
  broken = true;
  const before = store.export();
  await assert.rejects(e.quickSale('9'), /disk full/);
  assert.deepEqual(store.export(), before);                              // memory rolled back too
  broken = false;
  // reload from the saved rows gives the same state
  const rebuilt = createMemoryStore(store.export());
  assert.deepEqual(rebuilt.export(), store.export());
});

test('invoice search (number, name, phone) and already-returned quantities', async () => {
  const w = await world();
  const { nails } = await stocked(w);
  const s = await w.emp.sale({ lines: [{ productId: nails.id, qty: 4 }], paid: '5', customer: { name: 'Karim', phone: '0600000001' } });
  await w.emp.customerReturn({ invoice: s.invoice.id, lines: [{ originLineId: s.lines[0].id, qty: 1 }] });
  const byName = await w.emp.reports.searchInvoices({ text: 'kar', types: ['sale', 'quick_sale'] });
  assert.equal(byName.length, 1); assert.equal(byName[0].party_name, 'Karim');
  assert.equal((await w.emp.reports.searchInvoices({ text: '0600000001', types: ['sale'] })).length, 1);
  assert.equal((await w.emp.reports.searchInvoices({ text: s.invoice.invoice_no, types: ['sale'] })).length, 1);
  assert.equal((await w.emp.reports.searchInvoices({ text: 'nobody', types: ['sale'] })).length, 0);
  const d = await w.emp.reports.invoice(s.invoice.id);
  assert.equal(d.lines[0].returned, 1000);
  assert.equal(d.party.name, 'Karim');
});
