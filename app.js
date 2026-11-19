import { firebaseConfig, SITE_NAME } from './config.js';
import * as espn from './espn.js';
import * as sfx from './sounds.js';
import * as coach from './coach.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_LEAGUE = 'pickem-league';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};
const code = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
const PIN_RE = /^[0-9]{4}$/;
const S = { api: null, L: null, league: null, me: null, members: [], membersOn: false, unsub: [], cur: null, viewIdx: null, seq: 0, timers: [] };

const LINKS = {
  shoppingMan: 'https://smccormack-blip.github.io/grocery-list/',
  knightSchool: 'https://smccormack-blip.github.io/knight-school/'
};

// ───────────────────────── boot & routing ─────────────────────────
async function boot() {
  document.title = SITE_NAME;
  try {
    if (firebaseConfig.apiKey) {
      S.api = await (await import('./data-firebase.js')).createApi(firebaseConfig);
    } else {
      const m = await import('./data-demo.js');
      S.api = await m.createApi();
      espn.useFixture(m.espnFixture);
    }
  } catch (e) {
    console.error(e);
    return screen(`<div class="card center"><h2>Can't reach the database</h2><p>Check your connection and reload. (${esc(e.message)})</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`);
  }
  S.cur = await espn.current().catch(() => null) || guessCurrent();
  window.addEventListener('hashchange', route);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  route();
}
function guessCurrent() {
  const d = new Date(); const year = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  return { year, t: 2, w: 1 };
}
function parseHash() {
  const [path, qs] = location.hash.slice(1).split('?');
  return { path: path || '/', q: new URLSearchParams(qs || '') };
}
async function route() {
  clearTimers();
  const { path, q } = parseHash();
  if (path === '/join') return joinFlow(q.get('l'), q.get('c'));
  if (path === '/move') return moveFlow(q.get('l') || ls.get(LS_LEAGUE));
  if (path === '/recover') return recoverFlow(q.get('l'), q.get('r'));
  const L = ls.get(LS_LEAGUE);
  if (!L) return startScreen();
  if (S.L !== L) await enterLeague(L);
  render();
}

async function enterLeague(L) {
  S.unsub.forEach(f => f()); S.unsub = [];
  Object.assign(S, { L, league: null, me: null, members: [], membersOn: false });
  await new Promise(res => {
    let a = false, b = false;
    const ready = () => { if (a && b) res(); };
    S.unsub.push(S.api.watchLeague(L, lg => {
      const first = !a, wasC = isCommish(); S.league = lg; a = true;
      if (first) ready(); else { maybeWatchMembers(); if (wasC !== isCommish()) render(); else chrome(); }
    }));
    S.unsub.push(S.api.watchMember(L, S.api.uid, m => {
      const first = !b, was = S.me?.status; S.me = m; b = true;
      if (first) ready(); else { maybeWatchMembers(); if (was !== m?.status) render(); else chrome(); }
    }));
  });
  maybeWatchMembers();
}
function maybeWatchMembers() {
  if (S.membersOn || !(S.me?.status === 'active' || isCommish())) return;
  S.membersOn = true;
  S.unsub.push(S.api.watchMembers(S.L, ms => {
    S.members = ms;
    chrome();
    if (parseHash().path === '/commish' && !$('#modal.show')) render();
  }));
}

const isCommish = () => !!S.league && S.league.commissionerUid === S.api.uid;
const active = () => S.members.filter(m => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
const pending = () => S.members.filter(m => m.status === 'pending');
const curIdx = () => Math.max(0, espn.WEEKS.findIndex(x => x.t === S.cur.t && x.w === S.cur.w));
const startIdx = () => Math.max(0, espn.weekIndex(S.league.startWeek));
// A player's pick for one game: newest device wins (their current id, then earlier devices in order).
function pickOf(m, crowdGame) {
  if (!crowdGame) return null;
  for (const u of [m.id, ...(m.prevUids || [])]) if (crowdGame[u]) return crowdGame[u];
  return null;
}
// Stop listening to the current league before switching identity or league.
function detach() { clearTimers(); S.unsub.forEach(f => f()); S.unsub = []; S.seq++; S.L = null; }
function clearTimers() { S.timers.forEach(t => clearTimeout(t)); S.timers = []; }
function later(fn, ms) { S.timers.push(setTimeout(fn, ms)); }

// ───────────────────────── layout ─────────────────────────
function screen(html) {
  $('#tabs').innerHTML = '';
  $('#main').innerHTML = html;
  chrome();
}
function chrome() {
  $('#lgName').textContent = S.league?.name || SITE_NAME;
  document.title = S.league?.name || SITE_NAME;
  const meActive = S.me?.status === 'active';
  $('#who').innerHTML = `<button class="iconbtn" data-act="mute" title="Sound on/off">${sfx.isMuted() ? '🔇' : '🔊'}</button>` +
    (meActive ? `<button class="mebtn" data-act="account">${esc(S.me.name)}${isCommish() ? ' <span class="badge gold" title="Commissioner">C</span>' : ''}</button>` : '');
  const ct = $('#tabs [data-tab="/commish"] .count');
  if (ct) ct.textContent = pending().length || '';
  demoBar();
}
function tabs(path) {
  const t = [['/picks', 'My Picks'], ['/standings', 'Leaderboard'], ['/grid', 'All Picks']];
  if (isCommish()) t.push(['/commish', 'Commish']);
  $('#tabs').innerHTML = t.map(([p, l]) => `<a href="#${p}" data-tab="${p}" class="${path === p ? 'on' : ''}">${l}${p === '/commish' ? '<span class="count"></span>' : ''}</a>`).join('');
}
const coachHero = (title, sub) => `<div class="hero"><img class="crest" src="logo.png" alt="Office Pick 'Em"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;

function render() {
  clearTimers();
  const seq = ++S.seq;
  const { path } = parseHash();
  if (!S.league) return screen(`<div class="card center"><h2>League not found</h2><p>This league may have been deleted, or the link is wrong.</p>
    <button class="btn" data-act="leave">Start over</button></div>`);
  const moveBtn = `<a class="btn ghost" href="#/move?l=${esc(S.L)}">I already play — sign in with my PIN</a>`;
  if (!S.me) return screen(`<div class="card center"><h2>You're not in ${esc(S.league.name)} on this device</h2>
    <p>New player? Open the invite link the Commissioner sent you.</p><p>Already playing on another phone or computer?</p>${moveBtn}
    <p><button class="link" data-act="leave">Start over</button></p></div>`);
  if (S.me.status === 'pending') return screen(`${coachHero(`Hang tight, ${esc(S.me.name)}`, `Your request to join <b>${esc(S.league.name)}</b> is with the Commissioner. This page opens up on its own once you're let in.`)}
    <div class="card center"><p class="muted small">Oops — you already play and this is just a new phone or computer?</p>
    <button class="btn ghost sm" data-act="pendingToMove">Sign in with my PIN instead</button></div>`);
  if (S.me.status === 'replaced') return screen(`<div class="card center"><h2>You're signed in on another device</h2>
    <p>${esc(S.me.name)} moved to a different phone or computer. To use this one again, sign in with your PIN.</p>${moveBtn}</div>`);
  if (S.me.status !== 'active') return screen(`<div class="card center"><h2>You're no longer in ${esc(S.league.name)}</h2>
    <p>The Commissioner has removed this player. If that's a mistake, ask them to reinstate you.</p><button class="btn ghost" data-act="leave">Start over</button></div>`);
  const p = ['/picks', '/standings', '/grid', '/commish'].includes(path) && (path !== '/commish' || isCommish()) ? path : '/picks';
  tabs(p); chrome();
  if (S.viewIdx == null) S.viewIdx = Math.max(curIdx(), startIdx());
  ({ '/picks': viewPicks, '/standings': viewStandings, '/grid': viewGrid, '/commish': viewCommish })[p](seq);
  if (!$('#modal.show') && !$('#entrance')) {
    const wkId = espn.weekDocId(S.league.season, espn.WEEKS[curIdx()]);
    const ek = `pickem-entrance-${S.L}-${wkId}`;
    const after = () => {
      if (isCommish() && !ls.get(`pickem-cwelcome-${S.L}-${S.api.uid}`)) commishWelcome();
      else gamblingReminder();
    };
    if (!ls.get(ek)) { ls.set(ek, '1'); coach.bustThrough(S.league.name, `${espn.weekLabel(espn.WEEKS[curIdx()])} · Let's go!`).then(after); }
    else after();
  }
}
const main = (html) => { $('#main').innerHTML = html; };
const live = (seq) => seq === S.seq;

// Messages come from the coach, in a speech bubble.
function toast(msg, bad) {
  const t = $('#toast');
  t.innerHTML = `<img src="coach-face.jpg" alt=""><div class="bubble">${esc(msg)}</div>`;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ''; }, 3200);
}
function errMsg(e) {
  if (e?.code === 'permission-denied') return "Not allowed — the game may have kicked off, or you don't have permission.";
  return e?.message || String(e);
}
function modal(html) { $('#modal').innerHTML = `<div class="sheet"><button class="x" data-act="close">×</button>${html}</div>`; $('#modal').className = 'show'; }
function closeModal() { $('#modal').className = ''; $('#modal').innerHTML = ''; }
// In-page yes/no dialog (works on phones and inside sandboxed previews).
function ask(msg) {
  return new Promise(res => {
    modal(`<p class="askq">${esc(msg)}</p><div class="row"><button class="btn" id="askYes">Yes</button><button class="btn ghost" id="askNo">Cancel</button></div>`);
    const done = (v) => { closeModal(); res(v); };
    $('#askYes').onclick = () => done(true); $('#askNo').onclick = () => done(false);
    $('.sheet .x').onclick = (e) => { e.stopPropagation(); done(false); };
  });
}
// In-page "enter a 4-digit PIN" dialog.
function askPin(title, note = '') {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2>${note ? `<p class="muted small">${note}</p>` : ''}
      <form id="pinForm"><input name="pin" ${pinAttrs} autofocus><div class="row" style="margin-top:12px"><button class="btn">Save</button><button type="button" class="btn ghost" id="pinNo">Cancel</button></div></form>`);
    const done = (v) => { closeModal(); res(v); };
    $('#pinForm').onsubmit = (e) => { e.preventDefault(); e.stopPropagation(); const v = e.target.pin.value.trim(); if (PIN_RE.test(v)) done(v); else toast('PIN must be exactly 4 digits.', true); };
    $('#pinNo').onclick = () => done(null);
    $('.sheet .x').onclick = (e) => { e.stopPropagation(); done(null); };
  });
}
const pinAttrs = 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" autocomplete="off" required placeholder="4 digits" class="pin"';

// Once per NFL week, per device.
function gamblingReminder() {
  const k = `pickem-gamble-${S.L}-${espn.weekDocId(S.league.season, espn.WEEKS[curIdx()])}`;
  if (ls.get(k)) return;
  ls.set(k, '1');
  modal(`<div class="center"><img class="crest sm" src="logo.png" alt=""><h2>A word from Coach</h2>
    <p class="bigquote">Gambling for real money is bad for you, your family, and civilization. It's like crack for your soul. <b>But have fun!</b></p>
    <button class="btn" data-act="close">Let's play</button></div>`);
}
async function commishWelcome() {
  ls.set(`pickem-cwelcome-${S.L}-${S.api.uid}`, '1');
  const s = await S.api.getSecrets(S.L).catch(() => ({}));
  modal(`<div class="center"><img class="crest sm" src="logo.png" alt=""><h2>You're the Commissioner 🎖️</h2></div>
    <p><b>1. Save your recovery link.</b> If your PIN ever fails you, this link gets your Commissioner powers back. Email it to yourself; don't share it.</p>
    ${s.recovery ? copyBox(recoverLink(S.L, s.recovery)) : '<p class="muted">You can find it later under Commissioner → League settings.</p>'}
    <p><b>2. Invite players</b> from the Invite section on the Commissioner page, and let them in as they ask to join.</p>
    <button class="btn" data-act="close">Got it</button>`);
}

// ───────────────────────── start / join / move / recover ─────────────────────────
function startScreen() {
  const ci = curIdx();
  const opts = espn.WEEKS.map((x, i) => i < ci - 1 ? '' : `<option value="${espn.weekKey(x)}" ${i === ci ? 'selected' : ''}>${espn.weekLabel(x)}</option>`).join('');
  screen(`${coachHero("Office Pick 'Em", 'Pick the winner of every NFL game. Bragging rights only — no money, ever.')}
  <div class="card"><h2>Joining a league?</h2><p>Open the invite link your Commissioner sent you. That's it.</p></div>
  <form class="card" id="createForm"><h2>Start a new league</h2><p class="muted">Whoever starts the league is its Commissioner: they let players in, can remove them, and can fix results. (You can hand the job to someone else later.)</p>
    <label>League name<input name="name" maxlength="60" required value="Office Pick 'Em"></label>
    <label>Your name (as other players will see it)<input name="me" maxlength="40" required placeholder="e.g. Shane M."></label>
    <label>Choose a 4-digit PIN <span class="muted small">(for signing in on another phone or computer)</span><input name="pin" ${pinAttrs}></label>
    <label>Start counting with<select name="start">${opts}</select></label>
    <button class="btn">Create league</button></form>`);
}
async function createLeague(f) {
  const btn = $('button', f); btn.disabled = true;
  try {
    const invite = code(8), recovery = code(12);
    const L = await S.api.createLeague({ name: f.name.value.trim(), season: S.cur.year, startWeek: f.start.value, myName: f.me.value.trim(), invite, recovery });
    await S.api.setPin(L, S.api.uid, f.pin.value.trim());
    ls.set(LS_LEAGUE, L);
    location.hash = '#/commish';   // route() → render() shows the Commissioner welcome with the recovery link
  } catch (e) { toast(errMsg(e), true); btn.disabled = false; }
}
const inviteLink = (L, c) => `${location.origin}${location.pathname}#/join?l=${L}&c=${c}`;
const recoverLink = (L, r) => `${location.origin}${location.pathname}#/recover?l=${L}&r=${r}`;
const copyBox = (text) => `<div class="copy"><input readonly value="${esc(text)}"><button class="btn sm" data-act="copy" data-text="${esc(text)}">Copy</button></div>`;

async function joinFlow(L, c) {
  if (!L || !c) return screen(`<div class="card center"><h2>That invite link looks incomplete</h2><p>Ask the Commissioner to send it again.</p></div>`);
  const lg = await S.api.getLeague(L).catch(() => null);
  if (!lg) return screen(`<div class="card center"><h2>League not found</h2><p>Ask the Commissioner for a fresh invite link.</p></div>`);
  const mine = await S.api.getMember(L, S.api.uid).catch(() => null);
  if (mine) { ls.set(LS_LEAGUE, L); location.hash = '#/picks'; return; }
  screen(`${coachHero(esc(lg.name), "You've been invited to the office NFL pick 'em. No money, just glory.")}
    <form class="card" id="joinForm" data-l="${esc(L)}" data-c="${esc(c)}"><h2>I'm new — join the league</h2>
    <label>Your name (as other players will see it)<input name="me" maxlength="40" required placeholder="First name + last initial"></label>
    <label>Choose a 4-digit PIN <span class="muted small">(you'll need it if you switch phones or computers)</span><input name="pin" ${pinAttrs}></label>
    <button class="btn">Ask to join</button></form>
    <div class="card center"><p>Already playing on another phone or computer?</p><a class="btn ghost" href="#/move?l=${esc(L)}">Sign in with my PIN</a></div>`);
}
async function joinLeague(f) {
  const btn = $('button', f); btn.disabled = true;
  try {
    detach();
    await S.api.requestJoin(f.dataset.l, f.me.value.trim(), f.dataset.c);
    await S.api.setPin(f.dataset.l, S.api.uid, f.pin.value.trim());
    ls.set(LS_LEAGUE, f.dataset.l); S.L = null; location.hash = '#/picks';
  } catch (e) {
    btn.disabled = false;
    toast(e?.code === 'permission-denied' ? 'That invite link is no longer valid — ask the Commissioner for a new one.' : errMsg(e), true);
  }
}
async function moveFlow(L) {
  if (!L) return screen(`<div class="card center"><h2>Open your invite link first</h2><p>Then choose “Sign in with my PIN”.</p></div>`);
  const [lg, ms] = await Promise.all([S.api.getLeague(L).catch(() => null), S.api.listMembers(L).catch(() => [])]);
  if (!lg) return screen(`<div class="card center"><h2>League not found</h2></div>`);
  const players = ms.filter(m => m.status === 'active' && m.id !== S.api.uid).sort((a, b) => a.name.localeCompare(b.name));
  screen(`${coachHero(esc(lg.name), 'Welcome back. Sign in on this phone or computer.')}
    <form class="card" id="moveForm" data-l="${esc(L)}"><h2>Sign in with my PIN</h2>
    <label>Who are you?<select name="who" required><option value="">Choose your name…</option>${players.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    <label>Your 4-digit PIN<input name="pin" ${pinAttrs}></label>
    <button class="btn">Sign in</button>
    <p class="muted small">Forgot your PIN? The Commissioner can reset it. Your other device will be signed out of the league.</p></form>`);
}
async function movePlayer(f) {
  const btn = $('button', f); btn.disabled = true;
  const L = f.dataset.l, from = f.who.value, pin = f.pin.value.trim();
  try {
    const mine = await S.api.getMember(L, S.api.uid).catch(() => null);
    detach();
    if (mine?.status === 'pending') await S.api.deleteSelfPending(L);
    else if (mine) await S.api.newIdentity();          // this browser had an old record; start fresh
    await S.api.moveHere(L, from, pin);
    ls.set(LS_LEAGUE, L); location.hash = '#/picks';
    toast('Signed in. Welcome back!');
  } catch (e) {
    btn.disabled = false;
    toast(e?.code === 'permission-denied' ? 'Wrong PIN. Try again, or ask the Commissioner to reset it.' : errMsg(e), true);
  }
}
async function recoverFlow(L, r) {
  const lg = L && await S.api.getLeague(L).catch(() => null);
  if (!lg || !r) return screen(`<div class="card center"><h2>That recovery link doesn't look right</h2></div>`);
  screen(`<div class="card center"><h2>Reclaim Commissioner powers</h2><p>This makes <b>this browser</b> the Commissioner of <b>${esc(lg.name)}</b>.</p>
    <button class="btn" data-act="reclaim" data-l="${esc(L)}" data-r="${esc(r)}">Make me Commissioner</button></div>`);
}
async function reclaim(L, r) {
  try {
    await S.api.claimCommish(L, r);
    ls.set(LS_LEAGUE, L); ls.set(`pickem-cwelcome-${L}-${S.api.uid}`, '1');
    const me = await S.api.getMember(L, S.api.uid).catch(() => null);
    S.L = null; await enterLeague(L);
    if (!me || me.status !== 'active') {
      await new Promise(res => setTimeout(res, 400));
      const players = active();
      modal(`<h2>Which player are you?</h2><p>Pick your old player so your picks and points carry over.</p>
        <form id="relinkForm"><select name="old"><option value="">I'm new — start me at zero</option>
        ${players.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <label>Name (only if new)<input name="name" maxlength="40"></label>
        <label>New 4-digit PIN<input name="pin" ${pinAttrs}></label><button class="btn">Continue</button></form>`);
      return;
    }
    toast('You are the Commissioner again.'); location.hash = '#/commish'; render();
  } catch (e) { toast(e?.code === 'permission-denied' ? 'That recovery link is no longer valid.' : errMsg(e), true); }
}
async function relink(f) {
  const old = S.members.find(m => m.id === f.old.value);
  try {
    if ((await S.api.getMember(S.L, S.api.uid).catch(() => null))) throw new Error('This browser already has a player record. Use “Sign in with my PIN” instead.');
    await S.api.addSelfAsCommish(S.L, old ? { name: old.name, carryover: old.carryover, prevUids: [old.id, ...(old.prevUids || [])] } : { name: f.name.value.trim() || 'Commissioner' });
    if (old) await S.api.updateMember(S.L, old.id, { status: 'replaced' });
    await S.api.setPin(S.L, S.api.uid, f.pin.value.trim());
    closeModal(); location.hash = '#/commish'; render();
  } catch (e) { toast(errMsg(e), true); }
}

// ───────────────────────── week helpers ─────────────────────────
function weekNav(idx) {
  const lo = startIdx(), hi = Math.min(espn.WEEKS.length - 1, curIdx() + 2);
  const opts = espn.WEEKS.map((x, i) => i < lo || i > hi ? '' : `<option value="${i}" ${i === idx ? 'selected' : ''}>${espn.weekLabel(x)}${i === curIdx() ? ' (this week)' : ''}</option>`).join('');
  return `<div class="weeknav"><button class="btn sm ghost" data-act="wk" data-d="-1" ${idx <= lo ? 'disabled' : ''}>‹</button>
    <select data-act="wksel">${opts}</select>
    <button class="btn sm ghost" data-act="wk" data-d="1" ${idx >= hi ? 'disabled' : ''}>›</button></div>`;
}
const weekDocFrom = (year, x, games) => ({ season: year, week: espn.weekKey(x),
  games: Object.fromEntries(games.map(g => [g.id, { home: g.home.abbr, away: g.away.abbr, kickoff: g.kickoff }])) });
function weekDiffers(a, b) {
  const ka = Object.keys(a.games || {}).sort(), kb = Object.keys(b.games).sort();
  if (ka.join() !== kb.join()) return true;
  return kb.some(id => a.games[id].kickoff !== b.games[id].kickoff || a.games[id].home !== b.games[id].home || a.games[id].away !== b.games[id].away);
}
// The schedule saved in the league is what the database uses to lock picks.
async function ensureWeekDoc(id, year, x, games) {
  let doc = await S.api.getWeek(S.L, id).catch(() => null);
  if (!games.length) return doc;
  const fresh = weekDocFrom(year, x, games);
  if (!doc) {
    try { await S.api.createWeek(S.L, id, fresh); doc = fresh; } catch { doc = await S.api.getWeek(S.L, id).catch(() => null); }
  } else if (isCommish() && weekDiffers(doc, fresh)) {
    try { await S.api.setWeek(S.L, id, fresh); doc = fresh; } catch { /* keep old */ }
  }
  return doc;
}
const SAFETY = 30_000;  // wait 30s after kickoff before asking for everyone's picks (clock differences)
// Picks can't change after kickoff, so once a game's picks are fetched they're kept on this
// device for good. Live-score refreshes then cost no database reads (keeps us far under quota).
async function crowdFor(id, games, doc) {
  const ck = `pickem-crowd|${S.L}|${id}`;
  let cache = {}; try { cache = JSON.parse(ls.get(ck)) || {}; } catch { /* none */ }
  const out = {}; let added = false;
  await Promise.all(games.map(async g => {
    const k = doc?.games?.[g.id]?.kickoff;
    if (!k || Date.now() < k + SAFETY) return;
    if (cache[g.id] && cache[g.id].k === k) { out[g.id] = cache[g.id].p; return; }
    try { out[g.id] = await S.api.getGamePicks(S.L, id, g.id); cache[g.id] = { k, p: out[g.id] }; added = true; } catch { /* not open yet */ }
  }));
  if (added) ls.set(ck, JSON.stringify(cache));
  return out;
}
// Tiebreaker game: the last game of the week (usually Monday night).
const tbGameOf = (games) => games.length ? games.reduce((a, b) => (b.kickoff > a.kickoff || (b.kickoff === a.kickoff && b.id > a.id) ? b : a)) : null;
const gameTotal = (g) => (g.completed && g.home.score != null && g.away.score != null ? g.home.score + g.away.score : null);
const fmtKick = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const logo = (t) => t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'logo txt',textContent:'${esc(t.abbr)}'}))">` : `<span class="logo txt">${esc(t.abbr)}</span>`;

// ───────────────────────── My Picks ─────────────────────────
async function viewPicks(seq, quiet = false) {
  const idx = S.viewIdx, x = espn.WEEKS[idx], year = S.league.season, id = espn.weekDocId(year, x);
  if (!quiet) main(`${weekNav(idx)}<div id="games">${coach.loadingHTML(`Coach is pulling up ${espn.weekLabel(x)}…`)}</div>`);
  let games;
  try { games = await espn.week(year, x, { fresh: true }); } catch (e) {
    if (live(seq) && !quiet) $('#games').innerHTML = `<div class="card center"><p>Couldn't load games from ESPN (${esc(e.message)}).</p><button class="btn" data-act="rerender">Try again</button></div>`;
    return;
  }
  if (!games.length) { if (live(seq)) $('#games').innerHTML = `<div class="card center"><p>No games posted for ${espn.weekLabel(x)} yet.</p></div>`; return; }
  if (!live(seq)) return;
  // Automatic refreshes (live scores, kickoff locks) reuse the schedule and your picks already
  // loaded on this page, so they cost no database reads beyond newly-started games' picks.
  const reuse = quiet && S.pickCtx?.id === id ? S.pickCtx : null;
  const doc = reuse ? reuse.doc : await ensureWeekDoc(id, year, x, games);
  if (!live(seq)) return;
  const [mine, crowd] = await Promise.all([
    reuse ? reuse.mine : S.api.getMyPicks(S.L, id, games.map(g => g.id), S.me.prevUids || []),
    crowdFor(id, games, doc)]);
  if (!live(seq)) return;
  const tb = tbGameOf(games);
  S.pickCtx = { id, games, doc, mine, tbId: tb?.id };
  const ov = S.league.overrides || {};
  const lockAt = (g) => doc?.games?.[g.id]?.kickoff ?? g.kickoff;
  const open = games.filter(g => Date.now() < lockAt(g));
  const picked = games.filter(g => mine[g.id]).length;
  const right = games.filter(g => { const w = espn.winner(g, ov[g.id]); return w && mine[g.id]?.team === w; }).length;
  const graded = games.filter(g => { const w = espn.winner(g, ov[g.id]); return w && w !== 'VOID'; }).length;
  const openDetails = [...document.querySelectorAll('details.crowd[open]')].map(d => d.dataset.g);
  const scrollY = window.scrollY;
  $('#games').innerHTML = `
    <div class="summary"><div><b id="nPicked">${picked}</b> of ${games.length} picked</div><div>Record <b>${right}-${graded - right}</b></div>
      <div id="needMsg"></div></div>
    <p class="muted small center">Tap a team to pick it. Each game locks at its kickoff; you can change a pick until then. Everyone's picks appear once a game starts.</p>
    ${games.map(g => gameCard(g, lockAt(g), mine[g.id], crowd[g.id], espn.winner(g, ov[g.id]), ov[g.id], g.id === tb?.id)).join('')}`;
  openDetails.forEach(gid => { const d = $(`details.crowd[data-g="${CSS.escape(gid)}"]`); if (d) d.open = true; });
  if (quiet) window.scrollTo(0, scrollY);
  updateNeed();
  resultSounds(id, games, mine, ov);
  // Whistle at the next kickoff while this page is open; refresh during live games.
  const nextLock = Math.min(...open.map(lockAt));
  if (isFinite(nextLock) && nextLock - Date.now() < 6 * 3600e3) later(() => { if (live(seq)) { sfx.whistle(); viewPicks(seq, true); } }, nextLock - Date.now() + 1000);
  if (games.some(g => g.state === 'in')) later(() => { if (live(seq)) viewPicks(seq, true); }, 60_000);
}
function updateNeed() {
  const ctx = S.pickCtx; if (!ctx) return;
  const open = ctx.games.filter(x => Date.now() < (ctx.doc?.games?.[x.id]?.kickoff ?? x.kickoff));
  const miss = open.filter(x => !ctx.mine[x.id]).length;
  const tbOpen = open.find(x => x.id === ctx.tbId);
  const tbMissing = tbOpen && ctx.mine[ctx.tbId] && ctx.mine[ctx.tbId].total == null;
  const el = $('#needMsg'); if (!el) return miss;
  el.className = miss || tbMissing ? 'warn' : open.length ? 'ok' : '';
  el.textContent = miss ? `${miss} open game${miss > 1 ? 's' : ''} still need a pick` : tbMissing ? 'Add your tiebreaker guess' : open.length ? 'All open games picked ✓' : '';
  $('#nPicked') && ($('#nPicked').textContent = Object.keys(ctx.mine).length);
  return miss;
}
// Cheer or groan once for games of yours that went final since you last looked.
function resultSounds(id, games, mine, ov) {
  const k = `pickem-seen-${S.L}-${id}`;
  let seen = {}; try { seen = JSON.parse(ls.get(k)) || {}; } catch { /* none */ }
  let r = 0, w = 0;
  for (const g of games) {
    const win = espn.winner(g, ov[g.id]);
    if (!win || win === 'VOID' || seen[g.id] || !mine[g.id]) continue;
    seen[g.id] = 1; if (mine[g.id].team === win) r++; else w++;
  }
  ls.set(k, JSON.stringify(seen));
  if (r) { sfx.cheer(); coach.react(true, w ? `${r} right, ${w} wrong. Coach'll take it!` : r > 1 ? `Nailed it! ${r} more right.` : 'Nailed it! Another one right.'); }
  else if (w) { sfx.groan(); coach.react(false, w > 1 ? `Ouch. ${w} misses. Shake it off.` : 'Ouch. That one got away.'); }
}
function gameCard(g, lockAt, my, crowd, win, override, isTb) {
  const locked = Date.now() >= lockAt, myTeam = my?.team;
  const side = (t, at) => {
    const sel = myTeam === t.abbr;
    let cls = 'team';
    if (sel) cls += ' sel';
    if (sel && win && win !== 'VOID') cls += win === t.abbr ? ' right' : ' wrong';
    if (win === t.abbr) cls += ' won';
    const sc = g.state !== 'pre' && t.score != null ? `<span class="sc">${t.score}</span>` : '';
    return `<button class="${cls}" data-act="pick" data-g="${g.id}" data-team="${esc(t.abbr)}" ${locked ? 'disabled' : ''}>
      ${logo(t)}<span class="tn">${esc(t.name)}<span class="rec">${at}${esc(t.record)}</span></span>${sc}${sel ? '<span class="tick">✓</span>' : ''}</button>`;
  };
  let status;
  if (override) status = `<span class="pill gold">Commissioner ruling: ${override === 'VOID' ? 'no contest' : override === 'TIE' ? 'tie' : esc(override) + ' wins'}</span>`;
  else if (g.state === 'post') status = `<span class="pill">${esc(g.detail || 'Final')}</span>`;
  else if (g.state === 'in') status = `<span class="pill live">LIVE · ${esc(g.detail)}</span>`;
  else if (locked) status = `<span class="pill">🔒 Locked · ${fmtKick(g.kickoff)}</span>`;
  else status = `<span class="pill open">Locks ${fmtKick(lockAt)}</span>`;
  let tbHtml = '';
  if (isTb) {
    const tot = gameTotal(g);
    tbHtml = `<div class="tb"><div><b>Tiebreaker:</b> total points in this game${tot != null ? ` — actual <b>${tot}</b>` : ''}</div>
      ${locked ? `<div>Your guess: <b>${my?.total ?? '—'}</b>${tot != null && my?.total != null ? ` (off by ${Math.abs(tot - my.total)})` : ''}</div>`
        : `<form class="row tbform" data-g="${g.id}"><input name="total" type="number" inputmode="numeric" min="0" max="200" value="${my?.total ?? ''}" placeholder="e.g. 44" required><button class="btn sm">Save guess</button></form>`}</div>`;
  }
  let crowdHtml = '';
  if (crowd) {
    const by = { [g.away.abbr]: [], [g.home.abbr]: [] };
    for (const m of active()) { const p = pickOf(m, crowd); if (p && by[p.team]) by[p.team].push(isTb && p.total != null ? `${m.name} (${p.total})` : m.name); }
    const a = by[g.away.abbr].length, h = by[g.home.abbr].length, tot = a + h || 1;
    crowdHtml = `<details class="crowd" data-g="${g.id}"><summary><span class="bar"><span style="width:${(a / tot) * 100}%"></span></span>
      ${esc(g.away.abbr)} ${a} · ${h} ${esc(g.home.abbr)}</summary>
      <div class="cols"><div><b>${esc(g.away.abbr)}</b>${by[g.away.abbr].sort().map(n => `<div>${esc(n)}</div>`).join('') || '<div class="muted">nobody</div>'}</div>
      <div><b>${esc(g.home.abbr)}</b>${by[g.home.abbr].sort().map(n => `<div>${esc(n)}</div>`).join('') || '<div class="muted">nobody</div>'}</div></div></details>`;
  }
  const need = !locked && !myTeam ? ' need' : '';
  return `<div class="game${need}${isTb ? ' tbgame' : ''}" id="g-${g.id}"><div class="gtop">${isTb ? '<span class="pill gold">Tiebreaker game</span>' : '<span></span>'}${status}</div>${side(g.away, '')}${side(g.home, 'Home · ')}${tbHtml}${crowdHtml}</div>`;
}
async function pick(btn) {
  const g = btn.dataset.g, team = btn.dataset.team, ctx = S.pickCtx;
  if (!ctx || ctx.mine[g]?.team === team) return;
  const card = $(`#g-${CSS.escape(g)}`);
  const missBefore = updateNeed();
  card.querySelectorAll('.team').forEach(b => { b.classList.toggle('sel', b.dataset.team === team); b.querySelector('.tick')?.remove(); });
  btn.insertAdjacentHTML('beforeend', '<span class="tick">✓</span>'); card.classList.remove('need'); card.classList.add('saving');
  try {
    await S.api.setPick(S.L, ctx.id, g, team);
    ctx.mine[g] = { ...(ctx.mine[g] || {}), team }; card.classList.remove('saving');
    const missAfter = updateNeed();
    if (missBefore > 0 && missAfter === 0) { sfx.cheer(); toast('All picks in! 🏈'); }
  } catch (e) {
    toast(e?.code === 'permission-denied' ? 'Too late — that game has kicked off.' : errMsg(e), true);
    card.classList.remove('saving');
    render();
  }
}
async function saveTotal(f) {
  const ctx = S.pickCtx, g = f.dataset.g, total = Math.round(Number(f.total.value));
  if (!ctx) return;
  if (!ctx.mine[g]?.team) return toast('Pick a winner for this game first.', true);
  if (!(total >= 0 && total <= 200)) return toast('Enter a total between 0 and 200.', true);
  try { await S.api.setTotal(S.L, ctx.id, g, ctx.mine[g].team, total); ctx.mine[g].total = total; updateNeed(); toast('Tiebreaker saved.'); }
  catch (e) { toast(e?.code === 'permission-denied' ? 'Too late — that game has kicked off.' : errMsg(e), true); }
}

// ───────────────────────── scoring ─────────────────────────
// One week's raw results: games with winners, tiebreaker game, everyone's (visible) picks.
async function weekData(year, i) {
  const x = espn.WEEKS[i], id = espn.weekDocId(year, x), ov = S.league.overrides || {};
  const games = await espn.week(year, x);
  const ck = `pickem-wk|${S.L}|${id}|${JSON.stringify(games.map(g => ov[g.id] || ''))}`;
  try { const c = JSON.parse(ls.get(ck)); if (c) return c; } catch { /* ignore */ }
  const doc = await S.api.getWeek(S.L, id).catch(() => null);
  const crowd = doc ? await crowdFor(id, games, doc) : {};
  const tb = tbGameOf(games);
  const res = {
    idx: i, complete: games.length > 0 && games.every(g => espn.winner(g, ov[g.id])),
    games: games.map(g => ({ id: g.id, win: espn.winner(g, ov[g.id]) })), tbId: tb?.id, tbTotal: tb ? gameTotal(tb) : null, crowd
  };
  const lastKick = Math.max(...games.map(g => g.kickoff));
  if (res.complete && Date.now() - lastKick > 12 * 3600e3) ls.set(ck, JSON.stringify(res));
  return res;
}
const TB_MISSING = 99;
function scoreMember(m, wd) {
  let w = 0, l = 0;
  for (const g of wd.games) {
    if (!g.win || g.win === 'VOID') continue;
    const p = pickOf(m, wd.crowd[g.id]);
    if (p && p.team === g.win) w++; else l++;
  }
  const tp = pickOf(m, wd.crowd[wd.tbId]);
  const tbMiss = wd.tbTotal == null ? null : (tp?.total != null ? Math.abs(tp.total - wd.tbTotal) : TB_MISSING);
  return { w, l, tbMiss };
}

async function viewStandings(seq) {
  main(coach.loadingHTML('Coach is tallying the scores…'));
  const year = S.league.season, lo = startIdx(), hi = curIdx();
  const idxs = []; for (let i = lo; i <= hi; i++) idxs.push(i);
  const weeks = (await Promise.all(idxs.map(i => weekData(year, i).catch(() => null)))).filter(Boolean);
  if (!live(seq)) return;
  const players = active();
  const rows = players.map(m => ({ m, carry: m.carryover || 0, wk: {}, total: m.carryover || 0, tb: 0, wins: 0 }));
  const winners = [];
  for (const wd of weeks) {
    rows.forEach(r => { const s = scoreMember(r.m, wd); r.wk[wd.idx] = s; r.total += s.w; if (wd.complete && s.tbMiss != null) r.tb += s.tbMiss; });
    if (wd.complete && rows.length) {
      const best = Math.max(...rows.map(r => r.wk[wd.idx].w));
      if (best > 0) {
        let top = rows.filter(r => r.wk[wd.idx].w === best);
        const bestTb = Math.min(...top.map(r => r.wk[wd.idx].tbMiss ?? TB_MISSING));
        top = top.filter(r => (r.wk[wd.idx].tbMiss ?? TB_MISSING) === bestTb);
        top.forEach(r => { r.wins++; });
        const graded = wd.games.filter(g => g.win && g.win !== 'VOID').length;
        winners.push({ idx: wd.idx, score: best, of: graded, tbMiss: bestTb, ids: top.map(r => r.m.id), who: top.map(r => r.m.name) });
      }
    }
  }
  rows.sort((a, b) => b.total - a.total || a.tb - b.tb || a.m.name.localeCompare(b.m.name));
  rows.forEach((r, i) => { const p = rows[i - 1]; r.rank = p && p.total === r.total && p.tb === r.tb ? p.rank : i + 1; });
  const hasCarry = rows.some(r => r.carry);
  const showIdx = idxs.slice(-3);
  const latest = winners[winners.length - 1];
  main(`<div class="card"><h2>Leaderboard</h2>
    <div class="tablewrap"><table class="standings"><thead><tr><th>#</th><th class="l">Player</th>${hasCarry ? '<th title="Points carried over from the old pool">Before</th>' : ''}
      ${showIdx.map(i => `<th>${espn.WEEKS[i].t === 2 ? 'Wk ' + espn.WEEKS[i].w : espn.weekLabel(espn.WEEKS[i]).split(' ')[0]}</th>`).join('')}<th>Pts</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.m.id === S.me.id ? 'mine' : ''}"><td>${r.rank === 1 ? '🏆' : r.rank}</td><td class="l">${esc(r.m.name)}${r.wins ? ` <span class="stars" title="Picker of the Week wins">${'★'.repeat(Math.min(r.wins, 5))}</span>` : ''}</td>
      ${hasCarry ? `<td class="dim">${r.carry}</td>` : ''}${showIdx.map(i => `<td>${r.wk[i] ? `${r.wk[i].w}-${r.wk[i].l}` : '0-0'}</td>`).join('')}<td><b>${r.total}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="muted small">1 point per correct pick (weekly columns show wins-losses; a missed pick is a loss). Ties and no-contest games count for nobody. ${hasCarry ? '“Before” = points carried over from the old pool. ' : ''}Tied totals are broken by the season's tiebreaker guesses (smallest total miss). ★ = Picker of the Week. The current week updates live.</p></div>
    <div class="card"><h2>Picker of the Week</h2>
    ${latest ? `<div class="potw"><img class="crest sm" src="logo.png" alt=""><div><div class="muted small">${espn.weekLabel(espn.WEEKS[latest.idx])}</div><div class="potwname">${latest.who.map(esc).join(' & ')}</div>
      <div class="muted small">${latest.score}/${latest.of} correct${latest.tbMiss < TB_MISSING ? ` · tiebreaker off by ${latest.tbMiss}` : ''}</div>
      <button class="btn sm" data-act="cert" data-i="${winners.length - 1}" style="margin-top:6px">🏅 View certificate</button></div></div>` : ''}
    ${winners.length > 1 ? winners.slice(0, -1).map((w, i) => ({ w, i })).reverse().map(({ w, i }) => `<div class="winner"><span>${espn.weekLabel(espn.WEEKS[w.idx])}</span><b>${w.who.map(esc).join(', ')}</b><span class="muted">${w.score}/${w.of}</span><button class="link" data-act="cert" data-i="${i}">certificate</button></div>`).join('') : ''}
    ${!winners.length ? '<p class="muted">No completed weeks yet.</p>' : ''}</div>`);
  S.winners = winners;
  if (latest && latest.ids.includes(S.me.id)) {
    const k = `pickem-potw-${S.L}-${latest.idx}`;
    if (!ls.get(k)) { ls.set(k, '1'); sfx.fanfare(); coach.confetti(); showCertificate(winners.length - 1); }
  }
}

function showCertificate(i) {
  const w = S.winners?.[i]; if (!w) return;
  const cm = S.members.find(m => m.id === S.league.commissionerUid);
  modal(coach.certificateHTML({ names: w.who, week: espn.weekLabel(espn.WEEKS[w.idx]), score: w.score, of: w.of,
    tbMiss: w.tbMiss < TB_MISSING ? w.tbMiss : null, commissioner: cm?.name, league: S.league.name }) +
    `<p class="muted small center">Take a screenshot to share it.</p>`);
  $('#modal .sheet').classList.add('wide');
}

// ───────────────────────── Everyone's Picks ─────────────────────────
async function viewGrid(seq) {
  const idx = S.viewIdx, x = espn.WEEKS[idx], year = S.league.season, id = espn.weekDocId(year, x);
  main(`${weekNav(idx)}<div id="grid">${coach.loadingHTML()}</div>`);
  let games; try { games = await espn.week(year, x); } catch { if (live(seq)) $('#grid').innerHTML = `<p class="center">Couldn't reach ESPN.</p>`; return; }
  const doc = await S.api.getWeek(S.L, id).catch(() => null);
  const crowd = doc ? await crowdFor(id, games, doc) : {};
  if (!live(seq)) return;
  const started = games.filter(g => crowd[g.id]);
  if (!started.length) { $('#grid').innerHTML = `<div class="card center"><p>Nobody's picks are visible yet — each game's picks appear once it kicks off.</p></div>`; return; }
  const ov = S.league.overrides || {}, tb = tbGameOf(games), tbShown = tb && crowd[tb.id];
  const rows = active().map(m => {
    let n = 0; started.forEach(g => { const w = espn.winner(g, ov[g.id]); if (w && w !== 'VOID' && pickOf(m, crowd[g.id])?.team === w) n++; });
    return { m, n };
  }).sort((a, b) => b.n - a.n || a.m.name.localeCompare(b.m.name));
  $('#grid').innerHTML = `<div class="tablewrap"><table class="grid"><thead><tr><th class="l">Player</th>${started.map(g => `<th><div>${esc(g.away.abbr)}</div><div>@${esc(g.home.abbr)}</div></th>`).join('')}${tbShown ? '<th title="Tiebreaker guess">TB</th>' : ''}<th>Pts</th></tr></thead>
    <tbody>${rows.map(({ m, n }) => `<tr class="${m.id === S.me.id ? 'mine' : ''}"><td class="l">${esc(m.name)}</td>${started.map(g => {
      const t = pickOf(m, crowd[g.id])?.team, w = espn.winner(g, ov[g.id]);
      const c = !t ? 'none' : !w || w === 'VOID' ? '' : t === w ? 'right' : 'wrong';
      return `<td class="${c}">${t ? esc(t) : '–'}</td>`;
    }).join('')}${tbShown ? `<td>${pickOf(m, crowd[tb.id])?.total ?? '–'}</td>` : ''}<td><b>${n}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="muted small center">Only games that have kicked off are shown.</p>`;
}

// ───────────────────────── Commissioner ─────────────────────────
async function viewCommish(seq) {
  const secrets = await S.api.getSecrets(S.L).catch(() => ({}));
  if (!live(seq)) return;
  const pend = pending(), players = active(), gone = S.members.filter(m => m.status === 'removed');
  main(`
  <div class="card"><h2>Invite players</h2><p class="muted small">Send this link to coworkers (email or Teams). Anyone who opens it can <i>ask</i> to join — you approve each one below.</p>
    ${secrets.invite ? copyBox(inviteLink(S.L, secrets.invite)) : '<p>Loading…</p>'}
    <button class="btn sm ghost" data-act="newInvite">Make a new link (old one stops working)</button></div>

  <div class="card"><h2>Waiting to join ${pend.length ? `<span class="badge">${pend.length}</span>` : ''}</h2>
    ${pend.length ? pend.map(m => `<div class="req"><div><b>${esc(m.name)}</b></div>
      <div class="row"><button class="btn sm" data-act="approve" data-u="${m.id}">Let in</button>
      <select data-act="approveAs" data-u="${m.id}"><option value="">Returning player? Reconnect as…</option>${players.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      <button class="btn sm ghost danger" data-act="decline" data-u="${m.id}">Decline</button></div></div>`).join('') : '<p class="muted">Nobody waiting.</p>'}
    <p class="muted small">Players who switch phones normally sign back in with their PIN. “Reconnect as” is the backup if someone forgot their PIN and asked to join again.</p></div>

  <div class="card"><h2>Players (${players.length})</h2>
    <div class="tablewrap"><table class="players"><thead><tr><th class="l">Name</th><th title="Season points carried over from the old pool">Points before</th><th></th></tr></thead><tbody>
    ${players.map(m => `<tr><td class="l"><input class="inl" data-act="rename" data-u="${m.id}" value="${esc(m.name)}" maxlength="40">${m.id === S.league.commissionerUid ? ' <span class="badge gold">C</span>' : ''}</td>
      <td><input class="inl num" type="number" min="0" step="1" data-act="carry" data-u="${m.id}" value="${m.carryover || 0}"></td>
      <td class="r"><button class="btn sm ghost" data-act="resetPin" data-u="${m.id}">Reset PIN</button>${m.id === S.api.uid ? '' : ` <button class="btn sm ghost danger" data-act="remove" data-u="${m.id}">Remove</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">Enter each player's season total from the old pool under “Points before” — it's added to their total here. Changes save when you leave the box.</p>
    ${gone.length ? `<details><summary>Removed players (${gone.length})</summary>${gone.map(m => `<div class="req"><span>${esc(m.name)}</span><button class="btn sm ghost" data-act="reinstate" data-u="${m.id}">Reinstate</button></div>`).join('')}</details>` : ''}
  </div>

  <div class="card"><h2>Results & rulings</h2>${weekNav(S.viewIdx)}<div id="rulings">${coach.loadingHTML('Coach is checking the scoreboard…')}</div></div>

  <div class="card"><h2>League settings</h2>
    <label>League name<input id="lgNameIn" maxlength="60" value="${esc(S.league.name)}"></label>
    <button class="btn sm" data-act="saveName">Save name</button>
    <hr><h3>Hand off the Commissioner job</h3>
    <p class="muted small">Make another player the Commissioner. A new recovery link is created for them and yours stops working.</p>
    <div class="row"><select id="handoff"><option value="">Choose a player…</option>${players.filter(m => m.id !== S.api.uid).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
    <button class="btn sm ghost" data-act="handoff">Make Commissioner</button></div>
    <hr><h3>Your recovery link</h3><p class="muted small">Gets Commissioner powers back if your PIN fails you. Keep it private.</p>
    <details><summary>Show recovery link</summary>${secrets.recovery ? copyBox(recoverLink(S.L, secrets.recovery)) : ''}
      <button class="btn sm ghost" data-act="newRecovery">Make a new recovery link</button></details>
  </div>`);
  rulings(seq);
}
async function rulings(seq) {
  const x = espn.WEEKS[S.viewIdx], year = S.league.season, id = espn.weekDocId(year, x);
  let games; try { games = await espn.week(year, x, { fresh: true }); } catch { if (live(seq)) $('#rulings').innerHTML = '<p>Couldn\'t reach ESPN.</p>'; return; }
  await ensureWeekDoc(id, year, x, games);   // also re-syncs kickoff times (flexed games)
  if (!live(seq)) return;
  const ov = S.league.overrides || {};
  $('#rulings').innerHTML = games.length ? `<p class="muted small">Results come from ESPN automatically. Only overrule a game if ESPN is wrong or a game is postponed/cancelled.</p>
    ${games.map(g => {
      const auto = espn.winner(g);
      return `<div class="ruling"><span>${esc(g.away.abbr)} ${g.away.score ?? ''} @ ${esc(g.home.abbr)} ${g.home.score ?? ''}</span>
      <select data-act="override" data-g="${g.id}">
        <option value="">Automatic${auto ? ` (${auto === 'TIE' ? 'tie' : auto + ' won'})` : g.state === 'in' ? ' (in progress)' : ' (not played)'}</option>
        <option value="${esc(g.away.abbr)}" ${ov[g.id] === g.away.abbr ? 'selected' : ''}>${esc(g.away.abbr)} wins</option>
        <option value="${esc(g.home.abbr)}" ${ov[g.id] === g.home.abbr ? 'selected' : ''}>${esc(g.home.abbr)} wins</option>
        <option value="TIE" ${ov[g.id] === 'TIE' ? 'selected' : ''}>Tie (nobody scores)</option>
        <option value="VOID" ${ov[g.id] === 'VOID' ? 'selected' : ''}>No contest (doesn't count)</option></select></div>`;
    }).join('')}` : '<p class="muted">No games this week.</p>';
}

async function commishAct(act, el) {
  const u = el.dataset.u, m = S.members.find(x => x.id === u);
  try {
    if (act === 'approve') { await S.api.updateMember(S.L, u, { status: 'active' }); toast(`${m.name} is in.`); }
    if (act === 'decline') { if (!(await ask(`Decline ${m.name}'s request?`))) return; await S.api.deleteMember(S.L, u); }
    if (act === 'remove') { if (!(await ask(`Remove ${m.name} from the league? Their picks are kept, and you can reinstate them later.`))) return; await S.api.updateMember(S.L, u, { status: 'removed' }); toast(`${m.name} removed.`); }
    if (act === 'reinstate') { await S.api.updateMember(S.L, u, { status: 'active' }); toast(`${m.name} is back.`); }
    if (act === 'resetPin') {
      const pin = await askPin(`New PIN for ${m.name}`, `Type a new 4-digit PIN, then tell ${esc(m.name)} what it is. Their old PIN stops working.`);
      if (pin) { await S.api.setPin(S.L, u, pin); toast(`${m.name}'s PIN is now ${pin}.`); }
    }
    if (act === 'newInvite') { if (!(await ask('Make a new invite link? The old link will stop working for new players (current players are unaffected).'))) return; await S.api.setSecret(S.L, 'invite', code(8)); render(); }
    if (act === 'newRecovery') { if (!(await ask('Make a new recovery link? The old one will stop working.'))) return; await S.api.setSecret(S.L, 'recovery', code(12)); render(); }
    if (act === 'saveName') { const n = $('#lgNameIn').value.trim(); if (n) { await S.api.updateLeague(S.L, { name: n }); toast('Saved.'); } }
    if (act === 'handoff') {
      const to = S.members.find(x => x.id === $('#handoff').value); if (!to) return toast('Choose a player first.', true);
      if (!(await ask(`Make ${to.name} the Commissioner? You'll lose Commissioner powers, and your recovery link will stop working. ${to.name} will see their own recovery link the next time they open the site.`))) return;
      await S.api.setSecret(S.L, 'recovery', code(12));       // fresh recovery link that only the new Commissioner will see
      await S.api.updateLeague(S.L, { commissionerUid: to.id });
      toast(`${to.name} is now the Commissioner.`); location.hash = '#/picks';
    }
  } catch (e) { toast(errMsg(e), true); }
}
async function onChange(e) {
  const el = e.target, act = el.dataset.act;
  if (el.id === 'demoAs') return S.api.demoActAs(el.value);
  if (act === 'wksel') { S.viewIdx = Number(el.value); return render(); }
  if (!isCommish()) return;
  try {
    if (act === 'rename') { const n = el.value.trim(); if (n) { await S.api.updateMember(S.L, el.dataset.u, { name: n }); toast('Name saved.'); } }
    if (act === 'carry') { const n = Math.max(0, Math.round(Number(el.value) || 0)); el.value = n; await S.api.updateMember(S.L, el.dataset.u, { carryover: n }); toast('Points saved.'); }
    if (act === 'override') {
      const ov = { ...(S.league.overrides || {}) };
      if (el.value) ov[el.dataset.g] = el.value; else delete ov[el.dataset.g];
      await S.api.updateLeague(S.L, { overrides: ov }); toast('Ruling saved.');
    }
    if (act === 'approveAs' && el.value) {
      const nu = S.members.find(x => x.id === el.dataset.u), old = S.members.find(x => x.id === el.value);
      if (!(await ask(`Reconnect “${nu.name}” as ${old.name}? ${old.name}'s picks and points move to this new device.`))) { el.value = ''; return; }
      await S.api.updateMember(S.L, nu.id, { status: 'active', name: old.name, carryover: old.carryover || 0, prevUids: [old.id, ...(old.prevUids || [])] });
      await S.api.updateMember(S.L, old.id, { status: 'replaced' });
      if (S.league.commissionerUid === old.id) await S.api.updateLeague(S.L, { commissionerUid: nu.id });
      toast(`${old.name} reconnected.`);
    }
  } catch (err) { toast(errMsg(err), true); }
}

// ───────────────────────── my account ─────────────────────────
function account() {
  modal(`<h2>${esc(S.me.name)}</h2>
    <form id="nameForm"><label>Display name<input name="name" maxlength="40" required value="${esc(S.me.name)}"></label><button class="btn sm">Save name</button></form>
    <hr><h3>PIN</h3><p class="muted small">Your PIN signs you in on another phone or computer.</p>
    <button class="btn sm ghost" data-act="myPin">Change my PIN</button>
    <hr><p class="muted small">Using a new device? Open the invite link (or this site) there and choose “Sign in with my PIN”.</p>`);
}

// ───────────────────────── clicks, forms, demo ─────────────────────────
async function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const act = el.dataset.act;
  if (act === 'pick') return pick(el);
  if (act === 'wk') { S.viewIdx += Number(el.dataset.d); return render(); }
  if (act === 'rerender') return render();
  if (act === 'close') return closeModal();
  if (act === 'copy') { navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Copied.'), () => toast('Select the text and copy it.')); return; }
  if (act === 'leave') { ls.del(LS_LEAGUE); S.L = null; location.hash = '#/'; return route(); }
  if (act === 'reclaim') return reclaim(el.dataset.l, el.dataset.r);
  if (act === 'how') return modal(HOW);
  if (act === 'cert') return showCertificate(Number(el.dataset.i));
  if (act === 'legal') { sfx.legalMumboJumbo(); return modal(coach.judgeHTML() + LEGAL); }
  if (act === 'mute') { sfx.setMuted(!sfx.isMuted()); el.textContent = sfx.isMuted() ? '🔇' : '🔊'; toast(sfx.isMuted() ? 'Sound off' : 'Sound on'); if (!sfx.isMuted()) sfx.whistle(); return; }
  if (act === 'account') return account();
  if (act === 'myPin') { const pin = await askPin('Choose a new PIN'); if (pin) { try { await S.api.setPin(S.L, S.api.uid, pin); toast('PIN changed.'); } catch (err) { toast(errMsg(err), true); } } return; }
  if (act === 'pendingToMove') { try { await S.api.deleteSelfPending(S.L); } catch { /* ignore */ } location.hash = `#/move?l=${S.L}`; return; }
  if (act === 'demoSeed') { await S.api.demoSeed(S.L); toast('Added sample players (their PINs are 1234).'); return render(); }
  if (act === 'demoReset') { if (await ask('Erase the demo league?')) S.api.demoReset(); return; }
  return commishAct(act, el);
}
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'createForm') createLeague(f);
  if (f.id === 'joinForm') joinLeague(f);
  if (f.id === 'moveForm') movePlayer(f);
  if (f.id === 'relinkForm') relink(f);
  if (f.classList.contains('tbform')) saveTotal(f);
  if (f.id === 'nameForm') {
    try { await S.api.updateMember(S.L, S.api.uid, { name: f.name.value.trim() }); closeModal(); toast('Name saved.'); } catch (err) { toast(errMsg(err), true); }
  }
});
$('#modal')?.addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function demoBar() {
  const bar = $('#demoBar');
  if (!S.api?.demo) { bar.innerHTML = ''; return; }
  const users = S.L ? S.api.demoUsers(S.L) : [];
  bar.innerHTML = `<span><b>DEMO MODE</b> — made-up games; data stays in this browser.</span>
    ${users.length ? `<label>Act as <select id="demoAs">${users.map(u => `<option value="${u.id}" ${u.id === S.api.uid ? 'selected' : ''}>${esc(u.name)}${u.status !== 'active' ? ` (${u.status})` : ''}</option>`).join('')}<option value="">+ a brand-new visitor</option></select></label>` : ''}
    ${S.L && isCommish() && users.length < 3 ? '<button class="btn sm" data-act="demoSeed">Add sample players</button>' : ''}
    <button class="btn sm ghost" data-act="demoReset">Reset demo</button>`;
}

const HOW = `<h2>How it works</h2>
<ol><li><b>Pick every game.</b> Tap the team you think will win. You can change a pick any time before that game kicks off.</li>
<li><b>Picks lock at kickoff</b>, game by game, so you can make Sunday picks on Sunday morning.</li>
<li><b>1 point per correct pick.</b> Ties and cancelled games count for nobody. A missed pick is a loss.</li>
<li><b>Tiebreaker:</b> guess the total points in the week's last game (usually Monday night). Closest guess breaks ties for Picker of the Week and the Leaderboard.</li>
<li><b>No peeking.</b> Everyone's picks for a game appear once it kicks off.</li>
<li><b>Scores update automatically</b> from ESPN. The Commissioner can overrule a result if ESPN gets one wrong.</li>
<li><b>New phone or computer?</b> Open the site there, choose “Sign in with my PIN”, and pick your name. Forgot your PIN? The Commissioner can reset it.</li>
<li><b>Sound</b> can be turned off with the 🔊 button at the top.</li></ol>
<button class="btn" data-act="close">Got it</button>`;
const LEGAL = `<h2>⚖️ Legal Mumbo Jumbo</h2>
<p><b>No wagering.</b> Nothing of value is paid to enter, and nothing of value is won. There is no entry fee, no pot, no prize, and no side action conducted through or because of this site. Bragging rights are non-transferable, have no cash value, and expire at the start of next season.</p>
<p><b>Gambling for real money is bad for you, your family, and civilization.</b> It's like crack for your soul. But have fun!</p>
<p><b>Not affiliated.</b> This site is not affiliated with, endorsed by, or connected to the NFL, its teams, ESPN, Splash Sports, or any sportsbook or fantasy-sports operator. Team names and logos belong to their owners. Schedules and scores come from ESPN's public scoreboard and may be wrong or late.</p>
<p><b>The Commissioner.</b> All rulings of the Commissioner are final, binding, and unreviewable by any court, arbitrator, or HR department. Grievances may be submitted in writing and will be read aloud at the next office party.</p>
<p><b>Your data.</b> The site stores the display name you enter, your PIN, and your picks — nothing else. No email, no password, no tracking.</p>
<p><b>If betting stops being fun</b>, help is free and confidential: 1-800-GAMBLER.</p>
<button class="btn" data-act="close">I solemnly agree</button>`;

// footer credits
$('#credits').innerHTML = `Brought to you by the creators of <a href="${LINKS.shoppingMan}" target="_blank" rel="noopener">Shopping Man</a> and <a href="${LINKS.knightSchool}" target="_blank" rel="noopener">Knight School</a>.`;

boot();
