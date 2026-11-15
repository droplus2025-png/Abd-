// Quick sale -> product details added AFTER the sale (once), total untouched.
// Same freedom as a normal sale: choose products, external products, edit price and quantity.
// The WHOLE total must be distributed over the lines (their sum must equal it exactly).
// The original invoice stays frozen. A linked detail record carries the lines, takes the stock out,
// takes the cost of external items out of the till, and replaces the flat quick-sale profit % by the
// REAL profit:   detail.profit = (total - real costs) - flat profit    ->  original + detail = real.
import { fail } from './errors.js';
import { parseQty, parsePrice, lineCents } from './money.js';
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

// input: { invoice, lines:[{productId, qty, price?} | {external:{name,cost,price,qty}}], autoDistribute?, allowBelowCost? }
async function build(ctx, tx, input) {
  const parent = (await tx.find('invoices', (i) => i.id === input.invoice || i.invoice_no === input.invoice))[0];
  if (!parent) fail('INVOICE_NOT_FOUND', 'Invoice not found');
  if (parent.type !== 'quick_sale') fail('BAD_PARENT', 'Only a quick sale can be detailed', { type: parent.type });
  if ((await tx.find('invoices', (i) => i.type === 'quick_detail' && i.parent_invoice_id === parent.id)).length) fail('ALREADY_DETAILED', 'This quick sale already has its details');
  if ((await tx.find('invoices', (i) => i.type === 'return_customer' && i.parent_invoice_id === parent.id)).length) fail('HAS_RETURNS', 'A returned quick sale cannot be detailed');
  if (!input.lines?.length) fail('EMPTY_CART', 'Add at least one product');

  const lines = [], warnings = [], used = new Map();
  for (const l of input.lines) {
    if (l.external) {                                        // an item bought for this customer, not in stock
      ctx.access.require('external_product');
      const e = l.external;
      if (!e.name || !String(e.name).trim()) fail('NAME_REQUIRED', 'External product needs a name');
      const qty = parseQty(e.qty ?? 1, 'qty');
      if (qty <= 0) fail('BAD_NUMBER', 'Quantity must be positive');
      lines.push({ kind: 'external', name: String(e.name).trim(), qty, unit_price: parsePrice(e.price, 'sale price'), unit_cost: parsePrice(e.cost ?? 0, 'purchase price') });
      continue;
    }
    const p = await tx.get('products', l.productId);
    if (!p || p.deleted_at) fail('UNKNOWN_PRODUCT', 'Unknown product', { productId: l.productId });
    const qty = parseQty(l.qty ?? 1, 'qty');
    if (qty <= 0) fail('BAD_NUMBER', 'Quantity must be positive');
    const price = l.price === undefined || l.price === '' ? p.sale_price : parsePrice(l.price, 'price');
    if (price !== p.sale_price && !input.autoDistribute) ctx.access.require('edit_sale_price');
    lines.push({ kind: 'product', product_id: p.id, name: p.name, qty, unit_price: price, unit_cost: p.purchase_price });
    const after = p.qty - (used.get(p.id) || 0) - qty;
    used.set(p.id, (used.get(p.id) || 0) + qty);
    if (after < 0) warnings.push({ type: 'NEGATIVE_STOCK', sku: p.sku, name: p.name, qty_after: after });
  }
  if (input.autoDistribute) {                                // share the total proportionally to the lines' values
    const alloc = allocate(parent.total, lines.map((l) => lineCents(l.qty, l.unit_price)));
    lines.forEach((l, i) => { l.unit_price = priceFor(alloc[i], l.qty); });
  }
  const lineTotals = lines.map((l) => lineCents(l.qty, l.unit_price));
  const distributed = lineTotals.reduce((a, b) => a + b, 0);
  const costTotal = lines.reduce((a, l) => a + lineCents(l.qty, l.unit_cost), 0);
  const externalCost = lines.filter((l) => l.kind === 'external').reduce((a, l) => a + lineCents(l.qty, l.unit_cost), 0);
  const below = lines.filter((l) => l.unit_price < l.unit_cost).map((l) => ({ name: l.name, price: l.unit_price, cost: l.unit_cost }));
  return { parent, lines, lineTotals, distributed, remaining: parent.total - distributed, costTotal, externalCost,
    realProfit: parent.total - costTotal, warnings, below };
}

export function quickDetailApi(ctx) {
  const { store } = ctx;
  return {
    // what the screen needs while the employee types: how much is distributed, what remains, the real profit
    async previewQuickDetail(input) {
      ctx.access.require('quick_sale');
      return store.transaction(async (tx) => {
        const b = await build(ctx, tx, input);
        return { total: b.parent.total, distributed: b.distributed, remaining: b.remaining,
          lines: b.lines.map((l, i) => ({ ...l, line_total: b.lineTotals[i] })), cost_total: b.costTotal,
          real_profit: b.realProfit, flat_profit: b.parent.profit, warnings: b.warnings, below_cost: b.below };
      });
    },
    async detailQuickSale(input) {
      ctx.access.require('quick_sale');                       // whoever can make a quick sale can (and must) detail it
      return store.transaction(async (tx) => {
        const b = await build(ctx, tx, input);
        if (b.remaining !== 0) fail('DETAIL_TOTAL_MISMATCH', 'The lines must add up to the invoice total', { total: b.parent.total, distributed: b.distributed, remaining: b.remaining });
        const warnings = [...b.warnings];
        if (b.below.length) {                                  // same alert as a normal sale
          ctx.access.require('sell_below_cost');
          if (!input.allowBelowCost) fail('BELOW_COST', 'Selling below cost: confirm to continue', { items: b.below });
          warnings.push({ type: 'BELOW_COST', items: b.below });
        }
        const res = await postInvoice(ctx, tx, {
          type: 'quick_detail', invoice_no: `${b.parent.invoice_no}-D`, parent_invoice_id: b.parent.id,
          total: b.parent.total, paid: b.parent.total, credit_amount: 0,
          cash_effect: -b.externalCost,                         // an external item's cost leaves the till (as in a normal sale)
          cost_total: b.costTotal, profit: b.realProfit - b.parent.profit,        // the flat % is cancelled
          lines: b.lines, stock: b.lines.map((l, i) => l.kind === 'product' ? { line: i, product_id: l.product_id, reason: 'sale', qty_delta: -l.qty } : null).filter(Boolean),
        });
        await tx.update('invoices', b.parent.id, { is_modified: true, updated_at: ctx.now().toISOString() });
        return { ...res, real_profit: b.realProfit, flat_profit: b.parent.profit, warnings };
      });
    },
  };
}
