// Owner reset (for tests): wipes operations, KEEPS products and their stock and cost.
// Stock is restored through 'initial' movements. SKUs stay reserved. The audit log is kept.
import { applyMovement, audit } from './post.js';

export function adminApi(ctx) {
  const { store } = ctx;
  return {
    async resetOperations() {
      ctx.access.requireOwner();
      return store.transaction(async (tx) => {
        const keep = (await tx.find('products', p => p.qty > 0 && !p.deleted_at)).map(p => ({ id: p.id, qty: p.qty, cost: p.purchase_price }));
        for (const t of ['invoice_settlements', 'debt_ledger', 'cash_ledger', 'stock_movements', 'price_history',
          'cash_sessions', 'invoice_lines', 'invoices', 'customers', 'suppliers']) await tx.deleteAll(t);
        for (const p of await tx.all('products')) if (p.qty !== 0) await tx.update('products', p.id, { qty: 0 });
        for (const k of keep) await applyMovement(ctx, tx, { product_id: k.id, reason: 'initial', qty_delta: k.qty, unit_cost: k.cost });
        await audit(ctx, tx, 'reset', 'operations', null, null, { products_kept: keep.length });
        return { products_kept: keep.length };
      }, { allowReset: true });
    },
  };
}
