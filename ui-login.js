import { mount, $, toast, errText } from './ui-core.js';

export function renderLogin(app) {
  mount(`<div class="screen"><div class="center">
    <img src="logo.png" alt="">
    <div class="lbl">كلمة المرور</div>
    <input id="code" class="inp" type="password" autocomplete="off" inputmode="text" style="text-align:center;max-width:300px" autofocus>
    <div class="err" id="err"></div>
    <button class="btn gold big" id="go" style="min-width:200px">دخول</button>
  </div></div>`);
  const submit = async () => {
    try { app.startSession(await app.auth.login($('#code').value)); }
    catch (e) { $('#err').textContent = errText(e); $('#code').select(); }
  };
  $('#go').onclick = submit;
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

export function renderSetup(app) {
  mount(`<div class="screen"><div class="center">
    <img src="logo.png" alt=""><h2 style="margin:0;color:var(--gold)">الإعداد الأول</h2>
    <div class="muted">أنشئ كلمة مرور المالك (4 أحرف على الأقل)</div>
    <input id="name" class="inp" placeholder="اسمك" style="max-width:300px">
    <input id="c1" class="inp" type="password" placeholder="كلمة المرور" style="max-width:300px">
    <input id="c2" class="inp" type="password" placeholder="أعد كلمة المرور" style="max-width:300px">
    <div class="err" id="err"></div>
    <button class="btn gold big" id="go" style="min-width:200px">إنشاء</button>
  </div></div>`);
  $('#go').onclick = async () => {
    if ($('#c1').value !== $('#c2').value) { $('#err').textContent = 'كلمتا المرور غير متطابقتين'; return; }
    try { await app.startSession(await app.auth.setupOwner({ name: $('#name').value.trim() || 'المالك', code: $('#c1').value })); toast('مرحباً'); }
    catch (e) { $('#err').textContent = errText(e); }
  };
}
