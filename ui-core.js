// Small UI helpers: DOM, toast, top-aligned modal, Arabic error messages, header.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mount(html) { const app = $('#app'); app.innerHTML = html; return app; }

export function toast(msg, bad = false, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const ERR = {
  BAD_CODE: 'كلمة المرور غير صحيحة', WEAK_CODE: 'كلمة المرور قصيرة (4 أحرف على الأقل)', CODE_TAKEN: 'كلمة المرور مستعملة',
  PERMISSION_DENIED: 'غير مسموح لحسابك', BELOW_COST: 'بيع بأقل من التكلفة', CUSTOMER_REQUIRED: 'الاسم والهاتف إلزاميان عند الدين',
  NAME_REQUIRED: 'الاسم مطلوب', PHONE_REQUIRED: 'رقم الهاتف مطلوب (6 أرقام على الأقل)', OVERPAYMENT: 'المبلغ أكبر من المستحق',
  UNKNOWN_PRODUCT: 'منتج غير معروف', EMPTY_CART: 'السلة فارغة', PRODUCT_EXISTS: 'هذا المنتج موجود', SKU_TAKEN: 'هذا الرقم مستعمل',
  BAD_NUMBER: 'رقم غير صالح', TOO_MANY_DECIMALS: 'عدد الخانات العشرية أكثر من المسموح', RETURN_EXCEEDS: 'الكمية أكبر من المباعة',
  STOCK_INSUFFICIENT: 'المخزون لا يكفي', NOT_SETUP: 'لم يتم إنشاء حساب المالك بعد', ALREADY_SETUP: 'حساب المالك موجود',
  CHECK_FAILED: 'خطأ في توازن الأرقام، لم تُحفظ العملية',
};
export const errText = (e) => ERR[e?.code] || e?.message || 'حدث خطأ';

// modal in the top half of the screen. buttons: [{label, cls, onClick(close)}]; onClick returning false keeps it open
export function openModal({ title, html = '', buttons = [], tall = false, onOpen }) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet ${tall ? 'tall' : ''}">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="mbody">${html}</div>
    <div class="row mbtns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}" style="flex:1">${esc(b.label)}</button>`).join('')}</div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelectorAll('.mbtns button').forEach((btn) => btn.addEventListener('click', async () => {
    const r = await buttons[Number(btn.dataset.i)].onClick?.(close, m);
    if (r !== false) close();
  }));
  onOpen?.(m, close);
  return { el: m, close };
}
export const confirmBox = (title, text, yes = 'متابعة', no = 'رجوع') => new Promise((res) => openModal({
  title, html: `<div>${esc(text)}</div>`,
  buttons: [{ label: no, onClick: () => res(false) }, { label: yes, cls: 'gold', onClick: () => res(true) }],
}));

// header: back (right) | title (center) | logo (left)
export function header(title, backLabel = 'الرئيسية') {
  return `<div class="hdr"><button class="back" id="hdrBack">⌂ ${esc(backLabel)}</button><div class="title">${esc(title)}</div><img class="logo" src="logo.png" alt=""></div>`;
}
export const money = (cents) => {
  const neg = cents < 0, a = Math.abs(cents);
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`.replace(/\.00$/, '');
  return (neg ? '-' : '') + s;
};
export const price4 = (p) => (p / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
export const qtyStr = (q) => (q / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
