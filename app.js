// Boot, router, session. Screens live in ui-*.js
import { createMemoryStore, createAuth, createEngine } from './index.js';
import { openPersist } from './idb-persist.js';
import { createSync, supabaseTransport } from './sync.js';
import { SUPABASE } from './sync-config.js';
import { APP_VERSION } from './version.js';
import './viewport.js';
import { toast } from './ui-core.js';
import { renderLogin, renderSetup } from './ui-login.js';
import { renderHome, renderSoon } from './ui-home.js';
import { renderSale } from './ui-sale.js';
import { renderPurchase } from './ui-purchase.js';
import { renderReturn } from './ui-returns.js';
import { renderInvoices } from './ui-invoices.js';
import { renderDebts } from './ui-debts.js';
import { renderExpenses } from './ui-expenses.js';
import { renderCash } from './ui-cash.js';
import { renderStock } from './ui-stock.js';
import { renderAdmin } from './ui-admin.js';

const SCREENS = { login: renderLogin, setup: renderSetup, home: renderHome, soon: renderSoon, sale: renderSale, purchase: renderPurchase, return: renderReturn, invoices: renderInvoices, debts: renderDebts, expenses: renderExpenses, cash: renderCash, stock: renderStock, admin: renderAdmin };
export const app = { screen: null, updatePending: false };

const deviceId = localStorage.getItem('pos_device_id') || (() => { const id = crypto.randomUUID(); localStorage.setItem('pos_device_id', id); return id; })();

app.go = async (name, params = {}) => {
  app.screen = name; app.syncHook = null;
  if (name === 'home' && app.updatePending) return applyUpdate();
  try { await SCREENS[name](app, params); }
  catch (e) { console.error(e); toast(e.message || 'خطأ', true, 4000); }
};

app.startSession = async (session) => {
  app.session = session;
  app.engine = createEngine({ store: app.store, session, deviceId });
  await app.engine.settings.init();
  app.cfg = await app.engine.settings.get();
  app.go('home');
};
app.refreshCfg = async () => { app.cfg = await app.engine.settings.get(); };
app.logout = () => { app.session = null; app.engine = null; app.go('login'); };

// ------------------------------------------------------------- sync indicator (a dot in every header)
const SYNC_TIP = { off: '', idle: 'متزامن', syncing: 'جارٍ المزامنة…', offline: 'بلا إنترنت — ستتم المزامنة تلقائياً', error: 'خطأ في المزامنة', badcode: 'رمز الربط غير صحيح' };
function paintSync(s) {
  document.querySelectorAll('.sdot').forEach((el) => {
    el.className = `sdot ${s.state}${s.pending ? ' pend' : ''}`;
    el.title = `${SYNC_TIP[s.state] || ''}${s.pending ? ` · ${s.pending} بانتظار الإرسال` : ''}`;
    el.textContent = s.pending && s.state !== 'off' ? s.pending : '';
  });
  app.syncHook?.(s);
}
app.paintSync = () => paintSync(app.sync.status);

// ------------------------------------------------------------- updates (applied only on the home screen)
async function checkUpdate() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const v = (await r.json()).version;
    if (v && v !== APP_VERSION) { app.updatePending = true; if (app.screen === 'home' || app.screen === 'login') applyUpdate(); }
  } catch { /* offline: nothing to do */ }
}
function applyUpdate() { toast('تم تحديث البرنامج'); setTimeout(() => location.reload(), 600); }

async function boot() {
  const persist = await openPersist();
  const state = await persist.load();
  app.persist = persist;
  app.store = createMemoryStore(Object.keys(state).length ? state : undefined, { persist: persist.persist });
  app.auth = createAuth({ store: app.store });
  app.sync = createSync({ store: app.store, meta: persist.meta, transport: supabaseTransport(SUPABASE), deviceId });
  app.sync.onStatus(paintSync);
  app.sync.start();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  setInterval(checkUpdate, 60 * 60 * 1000);
  checkUpdate();
  app.go((await app.auth.hasOwner()) ? 'login' : 'setup');
}
boot().catch((e) => { console.error(e); document.getElementById('app').innerHTML = `<div class="center"><div class="err">تعذّر تشغيل البرنامج: ${e.message}</div></div>`; });
window.__app = app;           // handy for debugging / tests
