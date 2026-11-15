// Quick sale -> product details added AFTER the sale, without touching the total.
// The original invoice stays frozen. A linked "detail" record carries the product lines
// (their prices are shared out so that the lines add up EXACTLY to the original total),
// takes the stock out, and replaces the flat quick-sale profit % by the REAL profit:
//   detail.profit = (total - real cost) - original flat profit    ->  sum = real profit
import { fail } from './errors.js';
import { parseQty, lineCents } from './money.js';
import { postInvoice } from './post.js';

// share `total` cents over weights (largest remainder: the result adds up exactly)
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1), S = BigInt(sum > 0 ? sum : weights.length);
  const raw = w.map((x) => BigInt(total) * BigInt(x));
  const out = raw.map((r) => Number(r / S));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [Number(r % S), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}
// unit price (1/10000) such that round(qty * price, 2 decimals) === alloc cents
export function priceFor(alloc, qty) {
  if (alloc === 0) return 0;
  const approx = Math.round((alloc * 100 * 1000) / qty);
  for (let d = 0; d <= 400; d++) for (const p of d === 0 ? [approx] : [approx + d, approx - d]) {
    if (p >= 0 && lineCents(qty, p) === alloc) return p;
  }
  fail('CANNOT_ALLOCATE', 'Cannot share the total over these quantities');
}

async function build(tx, input) {
  const parent = (await tx.find('invoices', (i) => i.id === input.invoice || i.invoice_no === input.invoice))[0];
  if (!parent) fail('INVOICE_NOT_FOUND', 'Invoice not found');
  if (parent.type !== 'quick_sale') fail('BAD_PARENT', 'Only a quick sale can be detailed', { type: parent.type });
  if ((await tx.find('invoices', (i) => i.type === 'quick_detail' && i.parent_invoice_id === parent.id)).length) fail('ALREADY_DETAILED', 'This quick sale already has its details');
  if ((await tx.find('invoices', (i) => i.type === 'return_customer' && i.parent_invoice_id === parent.id)).length) fail('HAS_RETURNS', 'A returned quick sale cannot be detailed');
  if (!input.lines?.length) fail('EMPTY_CART', 'Add at least one product');
  const items = [], warnings = [], used = new Map();
  for (const l of input.lines) {
    const p = await tx.get('products', l.productId);
    if (!p || p.deleted_at) fail('UNKNOWN_PRODUCT', 'Unknown product', { productId: l.productId });
    const qty = parseQty(l.qty ?? 1, 'qty');
    if (qty <= 0) fail('BAD_NUMBER', 'Quantity must be positive');
    items.push({ p, qty });
    const after = p.qty - (used.get(p.id) || 0) - qty;
    used.set(p.id, (used.get(p.id) || 0) + qty);
    if (after < 0) warnings.push({ type: 'NEGATIVE_STOCK', sku: p.sku, name: p.name, qty_after: after });
  }
  const alloc = allocate(parent.total, items.map(({ p, qty }) => lineCents(qty, p.sale_price)));
  const lines = items.map(({ p, qty }, i) => ({ kind: 'product', product_id: p.id, name: p.name, qty,
    unit_price: priceFor(alloc[i], qty), unit_cost: p.purchase_price }));
  const costTotal = lines.reduce((a, l) => a + lineCents(l.qty, l.unit_cost), 0);
  return { parent, lines, alloc, costTotal, realProfit: parent.total - costTotal, warnings };
}

export function quickDetailApi(ctx) {
  const { store } = ctx;
  return {
    // input: { invoice: <id or number of the quick sale>, lines: [{ productId, qty }] }
    async previewQuickDetail(input) {
      ctx.access.require('detail_quick_sale');
      return store.transaction(async (tx) => {
        const b = await build(tx, input);
        return { total: b.parent.total, lines: b.lines.map((l, i) => ({ ...l, line_total: b.alloc[i] })), cost_total: b.costTotal,
          real_profit: b.realProfit, flat_profit: b.parent.profit, warnings: b.warnings };
      });
    },
    async detailQuickSale(input) {
      ctx.access.require('detail_quick_sale');
      return store.transaction(async (tx) => {
        const b = await build(tx, input);
        const res = await postInvoice(ctx, tx, {
          type: 'quick_detail', invoice_no: `${b.parent.invoice_no}-D`, parent_invoice_id: b.parent.id,
          total: b.parent.total, paid: b.parent.total, credit_amount: 0, cash_effect: 0,
          cost_total: b.costTotal, profit: b.realProfit - b.parent.profit,        // the flat % is cancelled
          lines: b.lines, stock: b.lines.map((l, i) => ({ line: i, product_id: l.product_id, reason: 'sale', qty_delta: -l.qty })),
        });
        await tx.update('invoices', b.parent.id, { is_modified: true, updated_at: ctx.now().toISOString() });
        return { ...res, real_profit: b.realProfit, flat_profit: b.parent.profit, warnings: b.warnings };
      });
    },
  };
}
