'use strict';
/* Rozesílá push oznámení podle připomínek nastavených v aplikaci.
   Spouští se z .github/workflows/reminders.yml každých 15 minut. */

const webpush = require('web-push');

const OWNER = '94zryjbn5k-png';
const REPO = 'habit-tracker';
const BRANCH = 'data';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const TOKEN = process.env.GH_TOKEN;
const WINDOW_MIN = 90; // pojistka, kdyby GitHub spustil běh se zpožděním

webpush.setVapidDetails('mailto:habit-tracker@example.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

async function ghGet(path){
  const r = await fetch(API + path + '?ref=' + BRANCH, {
    headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json' }
  });
  if (r.status === 404) return { obj: null, sha: null };
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  const j = await r.json();
  return { obj: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}
async function ghPut(path, obj, sha, msg){
  const body = { message: msg, branch: BRANCH, content: Buffer.from(JSON.stringify(obj, null, 1)).toString('base64') };
  if (sha) body.sha = sha;
  const r = await fetch(API + path, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('zápis ' + path + ' → ' + r.status);
}

/* ---------- čas v Praze ---------- */
function prague(){
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
  });
  const p = {};
  for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
  const wdMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    min: Number(p.hour) * 60 + Number(p.minute),
    wd: wdMap[p.weekday]
  };
}
function toMin(hhmm){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function mondayOf(dateStr){
  const d = new Date(dateStr + 'T12:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

/* ---------- obsah oznámení z dat ---------- */
function weightDone(data, dateStr, wd){
  const wk = mondayOf(dateStr);
  const c = (data.checkins || {})[wk] || {};
  const w = c.weight || {};
  const key = wd === 2 ? 'st' : wd === 4 ? 'pa' : wd === 6 ? 'ne' : null;
  return key ? String(w[key] || '').trim().length > 0 : false;
}
function remainingToday(data, dateStr, wd){
  const done = (data.entries || {})[dateStr] || {};
  const out = [];
  for (const h of (data.habits || [])){
    if (h.archived) continue;
    const f = h.freq || { type: 'daily' };
    if (f.type === 'daily'){ /* platí */ }
    else if (f.type === 'days'){ if (!Array.isArray(f.days) || f.days.indexOf(wd) === -1) continue; }
    else continue; // týdenní, měsíční a intervalové do večerního přehledu nepočítáme
    if (Array.isArray(h.vacations) && h.vacations.some(v => v && v.from <= dateStr && dateStr <= (v.to || '9999-12-31'))) continue;
    if (h.createdAt){
      const c = new Date(h.createdAt);
      const cs = new Date(c.getTime() - c.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      if (dateStr < cs) continue;
    }
    const v = done[h.id];
    const ok = h.type === 'number' ? (typeof v === 'number' && v >= (h.goal || 1)) : v === true;
    if (!ok) out.push(h.name);
  }
  return out;
}
function message(rem, data, t){
  if (rem.kind === 'weight'){
    if (weightDone(data, t.date, t.wd)) return null; // už zapsáno → neotravovat
    return { title: 'Ranní vážení', body: 'Zvaž se nalačno, ještě před jídlem a pitím.' };
  }
  if (rem.kind === 'remaining'){
    const left = remainingToday(data, t.date, t.wd);
    if (!left.length) return { title: 'Hotovo', body: 'Dnešek máš kompletní. Dobrá práce.' };
    const head = 'Zbývá ' + left.length + ' ' + (left.length === 1 ? 'návyk' : left.length < 5 ? 'návyky' : 'návyků');
    return { title: head, body: left.slice(0, 6).join(', ') + (left.length > 6 ? '…' : '') };
  }
  return { title: 'Habit Tracker', body: rem.text || 'Připomínka' };
}

/* ---------- hlavní běh ---------- */
const LOOP_MIN = 26;      // jak dlouho běh zůstane vzhůru (cron jede každých 15 min → souvislé pokrytí)
const TICK_SEC = 60;      // jak často se kontroluje čas
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tick(){
  const t = prague();
  const push = (await ghGet('push-subscriptions.json')).obj;
  if (!push || !Array.isArray(push.devices) || !push.devices.length){
    console.log('žádná zařízení k odeslání');
    return;
  }
  const data = (await ghGet('habit-tracker.json')).obj || {};
  const st = await ghGet('push-state.json');
  const state = st.obj && typeof st.obj === 'object' ? st.obj : {};
  if (!state.sent || typeof state.sent !== 'object') state.sent = {};
  const todaySent = state.sent[t.date] || [];
  let changed = false;

  for (const dev of push.devices){
    if (!dev || !dev.sub || !dev.sub.endpoint) continue;
    const tag = dev.sub.endpoint.slice(-12);
    for (const rem of (dev.reminders || [])){
      if (!rem || rem.on === false) continue;
      if (!Array.isArray(rem.days) || rem.days.indexOf(t.wd) === -1) continue;
      const at = toMin(rem.time);
      if (at === null || t.min < at || t.min > at + WINDOW_MIN) continue;
      const mark = tag + '|' + rem.id;
      if (todaySent.indexOf(mark) !== -1) continue;

      const msg = message(rem, data, t);
      if (!msg){ todaySent.push(mark); changed = true; continue; } // splněno → jen označit
      try {
        await webpush.sendNotification(dev.sub, JSON.stringify({ title: msg.title, body: msg.body, tag: rem.id }));
        console.log('odesláno:', rem.id, '→', msg.title);
      } catch (e) {
        console.log('chyba u', rem.id, e.statusCode || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) dev.dead = true; // zařízení už neexistuje
      }
      todaySent.push(mark);
      changed = true;
    }
  }

  if (changed){
    state.sent[t.date] = todaySent;
    for (const k of Object.keys(state.sent)) if (k < t.date) delete state.sent[k]; // úklid starých dnů
    await ghPut('push-state.json', state, st.sha, 'stav odeslanych oznameni');
  }
  const alive = push.devices.filter(d => !d.dead);
  if (alive.length !== push.devices.length){
    const cur = await ghGet('push-subscriptions.json');
    cur.obj.devices = alive;
    await ghPut('push-subscriptions.json', cur.obj, cur.sha, 'uklid neplatnych zarizeni');
  }
  return changed;
}

(async () => {
  const until = Date.now() + LOOP_MIN * 60000;
  let n = 0;
  while (true){
    try { await tick(); } catch (e) { console.log('kontrola selhala:', e.message); }
    n++;
    if (Date.now() >= until) break;
    await sleep(TICK_SEC * 1000);
  }
  console.log('konec běhu, kontrol:', n);
})().catch(e => { console.error(e); process.exit(1); });
