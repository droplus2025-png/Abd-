// Read-side: balances and live store value are SUMS of the ledgers (never stored numbers).
import { lineCents } from './money.js';
import { getSetting, checkInvoice, remainingDebt, openInvoices, GOODS_TYPES } from './post.js';
import { dayParts } from './invoice-number.js';

export const cashBalance = async (tx) => (await tx.all('cash_ledger')).reduce((a, c) => a + c.amount, 0);
export const stockValue = async (tx) => (await tx.find('products', p => !p.deleted_at))
  .reduce((a, p) => a + lineCents(Math.max(p.qty, 0), p.purchase_price), 0);
export const partyBalance = async (tx, key, id) => (await tx.find('debt_ledger', d => d[key] === id)).reduce((a, d) => a + d.amount, 0);

export function queriesApi(ctx) {
  const { store } = ctx;
  const ownerRead = async (fn) => { ctx.access.requireOwner(); return store.transaction(fn); };
  return {
    cashBalance: () => ownerRead(cashBalance),                         // the employee never sees the expected till

    // store value = till + stock at cost + customer debts - supplier dues
    storeValue: () => ownerRead(async (tx) => {
      const debts = await tx.all('debt_ledger');
      const customer_debts = debts.filter(d => d.customer_id).reduce((a, d) => a + d.amount, 0);
      const supplier_dues = debts.filter(d => d.supplier_id).reduce((a, d) => a + d.amount, 0);
      const cash = await cashBalance(tx), stock = await stockValue(tx);
      return { cash, stock, customer_debts, supplier_dues, store_value: cash + stock + customer_debts - supplier_dues };
    }),

    customers: () => store.transaction(async (tx) => {
      const rows = await tx.all('customers');
      return Promise.all(rows.map(async c => ({ ...c, balance: await partyBalance(tx, 'customer_id', c.id) })));
    }),
    suppliers: () => store.transaction(async (tx) => {
      const rows = await tx.all('suppliers');
      return Promise.all(rows.map(async s => ({ ...s, balance: await partyBalance(tx, 'supplier_id', s.id) })));
    }),
    openInvoices: (party) => store.transaction(async (tx) => (await openInvoices(tx, party)).map(o => ({ ...o.invoice, remaining: o.remaining }))),

    // archive: one row per invoice; cost and profit hidden if the account may not see them
    async invoices({ type, customerId, supplierId, limit = 200 } = {}) {
      ctx.access.require('view_invoices');
      return store.transaction(async (tx) => {
        let rows = await tx.find('invoices', i => (!type || i.type === type) && (!customerId || i.customer_id === customerId) && (!supplierId || i.supplier_id === supplierId));
        rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
        return rows.map(i => strip(ctx, i));
      });
    },
    async invoice(idOrNo) {
      ctx.access.require('view_invoices');
      return store.transaction(async (tx) => {
        const inv = (await tx.find('invoices', i => i.id === idOrNo || i.invoice_no === idOrNo))[0];
        if (!inv) return null;
        const lines = (await tx.find('invoice_lines', l => l.invoice_id === inv.id)).sort((a, b) => a.line_no - b.line_no);
        const returns = await tx.find('invoices', r => r.parent_invoice_id === inv.id);
        const remaining = await remainingDebt(tx, inv);
        return { invoice: strip(ctx, inv), lines: lines.map(l => stripLine(ctx, l)), returns: returns.map(r => strip(ctx, r)), remaining };
      });
    },

    // owner report: profit recognised at sale, returns come back negative, then expenses
    dailyReport: () => ownerRead(async (tx) => {
      const tz = await getSetting(tx, 'timezone', 'Africa/Casablanca');
      const days = new Map();
      for (const i of await tx.all('invoices')) {
        const k = dayParts(new Date(i.created_at), tz).key;
        const d = days.get(k) || { day: k, sales_count: 0, sales_total: 0, returns_total: 0, gross_profit: 0, expenses: 0, net_profit: 0 };
        if (i.type === 'sale' || i.type === 'quick_sale') { d.sales_count++; d.sales_total += i.total; d.gross_profit += i.profit; }
        if (i.type === 'return_customer') { d.returns_total += i.total; d.gross_profit += i.profit; }
        if (i.type === 'expense') d.expenses += i.total;
        d.net_profit = d.gross_profit - d.expenses;
        days.set(k, d);
      }
      return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
    }),

    // self-check: must be EMPTY. Anything listed is a number that does not add up.
    integrityCheck: () => ownerRead(async (tx) => {
      const problems = [];
      const movs = await tx.all('stock_movements');
      for (const p of await tx.all('products')) {
        const s = movs.filter(m => m.product_id === p.id).reduce((a, m) => a + m.qty_delta, 0);
        if (s !== p.qty) problems.push({ check: 'product_qty', ref: p.sku, detail: `cache=${p.qty} ledger=${s}` });
      }
      for (const [table, key] of [['customers', 'customer_id'], ['suppliers', 'supplier_id']]) {
        for (const party of await tx.all(table)) {
          const bal = await partyBalance(tx, key, party.id);
          const open = (await openInvoices(tx, { [key]: party.id })).reduce((a, o) => a + o.remaining, 0);
          if (bal !== open) problems.push({ check: `${table}_debt`, ref: party.phone_norm, detail: `ledger=${bal} open_invoices=${open}` });
        }
      }
      for (const i of await tx.all('invoices')) {
        try { await checkInvoice(tx, i.id); } catch (e) { problems.push({ check: 'invoice', ref: i.invoice_no, detail: e.message }); }
      }
      return problems;
    }),
  };
}
const strip = (ctx, i) => ctx.access.can('view_cost_profit') ? i : (({ cost_total, profit, profit_pct_applied, ...r }) => r)(i);
const stripLine = (ctx, l) => ctx.access.can('view_cost_profit') ? l : (({ unit_cost, line_cost, ...r }) => r)(l);
export { GOODS_TYPES };
