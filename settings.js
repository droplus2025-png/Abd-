// Settings edited from the Administration screen (owner). Everybody can read them.
import { fail } from './errors.js';

export const DEFAULT_SETTINGS = {
  store_name: 'اسم المحل', store_phone: '', store_address: '', thanks_text: 'شكراً لثقتكم، نتمنى رؤيتكم قريباً',
  currency: 'DH', wa_country_code: '212', timezone: 'Africa/Casablanca',
  quick_sale_profit_pct: 20,                                  // % of a quick sale counted as profit
  low_stock_threshold: 5,
  invoice_template: {
    separator: '━━━━━━━━━━━━━━', show_phone: true, show_address: true, show_customer: true, bold_total: true,
    line_format: '{n}. {name}\n   {qty}×{price}  {total}',
    labels: { invoice: 'Fact n°', date: 'Date', time: 'Heure', items: 'Nombre des articles', total: 'Montant total',
      paid: 'Payé', remaining: 'Reste', phone: 'Tel', address: 'Adresse', customer: 'Client' },
    footer: '{thanks_text}',
  },
};
const EDITABLE = new Set(Object.keys(DEFAULT_SETTINGS));

export function settingsApi(ctx) {
  const { store } = ctx;
  return {
    async init() {                                            // first launch: fill what is missing
      return store.transaction(async (tx) => {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
          if (!(await tx.get('settings', key))) await tx.insert('settings', { key, value, updated_at: ctx.now().toISOString() });
      });
    },
    async get() {
      return store.transaction(async (tx) => {
        const out = {};
        for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = (await tx.get('settings', k))?.value ?? DEFAULT_SETTINGS[k];
        return out;
      });
    },
    // owner only: store identity, quick-sale %, invoice template ...
    async set(key, value) {
      ctx.access.requireOwner();
      if (!EDITABLE.has(key)) fail('UNKNOWN_SETTING', `Unknown setting ${key}`);
      if (key === 'quick_sale_profit_pct' && !(Number(value) >= 0 && Number(value) <= 100)) fail('BAD_NUMBER', 'Percentage must be between 0 and 100');
      return store.transaction(async (tx) => {
        const cur = await tx.get('settings', key);
        const row = { value, updated_at: ctx.now().toISOString() };
        if (cur) await tx.update('settings', key, row); else await tx.insert('settings', { key, ...row });
        await tx.insert('audit_log', { id: ctx.ids(), at: ctx.now().toISOString(), user_id: ctx.userId ?? null, action: 'update',
          entity: 'settings', entity_id: key, old_data: cur?.value ?? null, new_data: value });
      });
    },
  };
}
