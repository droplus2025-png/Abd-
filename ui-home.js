import { mount, $, esc, header } from './ui-core.js';

// order = right column first, then left column (RTL), as in the reference screen
const TILES = [
  ['suppliers', 'مستحقات الموردين', 'Suppliers Receivables', '🚚'], ['customers', 'ديون الزبناء', 'Customers Debts', '👥'],
  ['expenses', 'مصاريف', 'Expenses', '💸'], ['purchase', 'شراء', 'Purchases', '📦'],
  ['supret', 'ارجاع للمورد', 'Supplier Returns', '↪️'], ['custret', 'ارجاع من زبون', 'Customer Returns', '↩️'],
  ['stock', 'المخزون', 'Inventory', '🏬'], ['cash', 'الصندوق', 'Cash Register', '🧮'],
  ['admin', 'الإدارة', 'Administration', '⚙️'], ['invoices', 'الفواتير', 'Invoices', '🧾'],
];
const PERM = { stock: 'view_stock', purchase: 'purchase', expenses: 'expense', supret: 'return_supplier', custret: 'return_customer',
  customers: 'collect_debt', suppliers: 'pay_supplier', cash: 'cash_count', invoices: 'view_invoices' };
const LIVE = { sell: ['sale'], purchase: ['purchase'], stock: ['stock'], admin: ['admin'], custret: ['return', { mode: 'customer' }], supret: ['return', { mode: 'supplier' }],
  invoices: ['invoices'], customers: ['debts', { mode: 'customer' }], suppliers: ['debts', { mode: 'supplier' }] };

export function renderHome(app) {
  const p = app.session.permissions, owner = app.session.role === 'owner';
  const d = new Date().toLocaleDateString('ar-MA-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  const tile = ([id, ar, en, ico]) => {
    if (id === 'admin' && !owner) return '<div></div>';
    const off = PERM[id] && !p[PERM[id]] && !owner;
    return `<button class="tile" data-id="${id}" ${off ? 'disabled' : ''}><div class="ico">${ico}</div><div><div class="t1">${ar}</div><div class="t2">${en}</div></div></button>`;
  };
  mount(`<div class="screen">
    <div class="homehead"><img src="logo.png" alt=""><div><div class="name">${esc(app.cfg.store_name)}</div><div class="date">${esc(d)}</div></div></div>
    <div class="body">
      <button class="tile sell" data-id="sell" ${!(p.sell || p.quick_sale) ? 'disabled' : ''}><div class="ico">🛒</div><div><div class="t1" style="font-size:1.6rem">بيع</div><div class="t2">سريع أو حسب الطلب</div></div></button>
      <div class="grid2">${TILES.map(tile).join('')}</div>
      <button class="btn" id="out" style="margin-top:4px">خروج</button>
    </div></div>`);
  document.querySelectorAll('.tile').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    if (LIVE[id]) app.go(...LIVE[id]); else app.go('soon', { title: TILES.find((t) => t[0] === id)?.[1] || 'قريباً' });
  }));
  $('#out').onclick = () => app.logout();
}

export function renderSoon(app, { title }) {
  mount(`<div class="screen">${header(title)}<div class="center"><div style="font-size:3rem">🛠️</div><div>هذه الشاشة قيد البناء</div></div></div>`);
  $('#hdrBack').onclick = () => app.go('home');
}
