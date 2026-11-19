// DEMO data layer: same functions as data-firebase.js, but stored in this
// browser's localStorage, with made-up games. Used when config.js has no apiKey.
import { WEEKS, weekDocId } from './espn.js';

const KEY = 'pickem-demo-v1', UKEY = 'pickem-demo-uid', BKEY = 'pickem-demo-base';
const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { leagues: {} }; } catch { return { leagues: {} }; } };
let db = load();
const subs = new Set();
const save = () => { localStorage.setItem(KEY, JSON.stringify(db)); subs.forEach(f => f()); };
window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); subs.forEach(f => f()); } });
const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
function watch(get, cb) {          // only fire when the watched value really changes
  let last;
  const f = () => { const v = JSON.stringify(get() ?? null); if (v !== last) { last = v; cb(JSON.parse(v)); } };
  subs.add(f); f(); return () => subs.delete(f);
}
const deny = (msg = 'Missing or insufficient permissions.') => Object.assign(new Error(msg), { code: 'permission-denied' });

export async function createApi() {
  let uid = localStorage.getItem(UKEY);
  if (!uid) { uid = rid(12); localStorage.setItem(UKEY, uid); }
  const lg = (L) => db.leagues[L];
  const isCommish = (L) => lg(L)?.doc.commissionerUid === uid;
  const isActive = (L) => lg(L)?.members[uid]?.status === 'active';

  return {
    get uid() { return uid; }, demo: true,
    async newIdentity() { uid = rid(12); localStorage.setItem(UKEY, uid); },
    async createLeague({ name, season, startWeek, myName, invite, recovery }) {
      const L = rid();
      db.leagues[L] = { doc: { name, season, startWeek, commissionerUid: uid, overrides: {} }, secret: { invite, recovery },
        members: { [uid]: { name: myName, status: 'active', carryover: 0, prevUids: [] } }, weeks: {}, picks: {} };
      save(); return L;
    },
    async getLeague(L) { return lg(L) ? { id: L, ...clone(lg(L).doc) } : null; },
    watchLeague(L, cb) { return watch(() => lg(L) && { id: L, ...lg(L).doc }, cb); },
    async updateLeague(L, patch) {
      const ok = isCommish(L) || (Object.keys(patch).join() === 'commissionerUid' && patch.commissionerUid === uid && lg(L).claims?.[uid] === lg(L).secret.recovery);
      if (!ok) throw deny();
      Object.assign(lg(L).doc, clone(patch)); save();
    },
    async getSecrets(L) { if (!isCommish(L)) throw deny(); return clone(lg(L).secret); },
    async setSecret(L, which, code) { if (!isCommish(L)) throw deny(); lg(L).secret[which] = code; save(); },
    async claimCommish(L, code) {
      if (!lg(L) || code !== lg(L).secret.recovery) throw deny();
      (lg(L).claims ||= {})[uid] = code; lg(L).doc.commissionerUid = uid; save();
    },
    async getMember(L, u) { const m = lg(L)?.members[u]; return m ? { id: u, ...clone(m) } : null; },
    watchMember(L, u, cb) { return watch(() => { const m = lg(L)?.members[u]; return m && { id: u, ...m }; }, cb); },
    watchMembers(L, cb) { return watch(() => Object.entries(lg(L)?.members || {}).map(([id, m]) => ({ id, ...m })), cb); },
    async requestJoin(L, name, code) {
      if (!lg(L) || code !== lg(L).secret.invite || lg(L).members[uid]) throw deny();
      lg(L).members[uid] = { name, status: 'pending', carryover: 0, prevUids: [], code }; save();
    },
    async addSelfAsCommish(L, data) {
      if (!isCommish(L) || lg(L).members[uid]) throw deny();
      lg(L).members[uid] = { name: data.name, status: 'active', carryover: data.carryover || 0, prevUids: data.prevUids || [] }; save();
    },
    async updateMember(L, u, patch) {
      const self = u === uid && Object.keys(patch).every(k => k === 'name');
      if (!isCommish(L) && !self) throw deny();
      Object.assign(lg(L).members[u], clone(patch)); save();
    },
    async deleteMember(L, u) { if (!isCommish(L)) throw deny(); delete lg(L).members[u]; save(); },
    async getWeek(L, id) { if (!isActive(L) && !isCommish(L)) throw deny(); return clone(lg(L).weeks[id]); },
    async createWeek(L, id, w) { if (lg(L).weeks[id]) throw Object.assign(new Error('exists'), { code: 'exists' }); lg(L).weeks[id] = clone(w); save(); },
    async setWeek(L, id, w) { if (!isCommish(L)) throw deny(); lg(L).weeks[id] = clone(w); save(); },
    async getMyPicks(L, id, gids, prevUids = []) {
      const out = {};
      for (const g of gids) for (const u of [uid, ...prevUids]) { const p = lg(L).picks[`${id}|${g}`]?.[u]; if (p) { out[g] = clone(p); break; } }
      return out;
    },
    async setPick(L, id, g, team) { return this.setTotal(L, id, g, team, undefined); },
    async setTotal(L, id, g, team, total) {
      const game = lg(L).weeks[id]?.games?.[g];
      if (!isActive(L) || !game || Date.now() >= game.kickoff || ![game.home, game.away].includes(team)) throw deny();
      const p = ((lg(L).picks[`${id}|${g}`] ||= {})[uid] ||= {});
      p.team = team; if (total !== undefined) p.total = total; save();
    },
    async getGamePicks(L, id, g) {
      const game = lg(L).weeks[id]?.games?.[g];
      if (!game || Date.now() < game.kickoff) throw deny();
      return clone(lg(L).picks[`${id}|${g}`] || {});
    },
    async listMembers(L) { return Object.entries(lg(L)?.members || {}).map(([id, m]) => ({ id, ...clone(m) })); },
    async setPin(L, u, pin) { if (u !== uid && !isCommish(L)) throw deny(); (lg(L).pins ||= {})[u] = pin; save(); },
    async deleteSelfPending(L) { if (lg(L).members[uid]?.status !== 'pending') throw deny(); delete lg(L).members[uid]; save(); },
    async moveHere(L, from, pin) {
      const old = lg(L).members[from];
      if (!old || old.status !== 'active' || (lg(L).pins || {})[from] !== pin || lg(L).members[uid]) throw deny();
      lg(L).members[uid] = { name: old.name, status: 'active', carryover: old.carryover || 0, prevUids: [from, ...(old.prevUids || [])] };
      if (lg(L).doc.commissionerUid === from) lg(L).doc.commissionerUid = uid;
      old.status = 'replaced'; lg(L).pins[uid] = pin; save();
    },

    // ── demo-only helpers ──
    demoUsers(L) { return Object.entries(lg(L)?.members || {}).map(([id, m]) => ({ id, name: m.name, status: m.status })); },
    demoActAs(u) { localStorage.setItem(UKEY, u || rid(12)); location.hash = '#/'; location.reload(); },
    demoReset() { [KEY, UKEY, BKEY, 'pickem-league'].forEach(k => localStorage.removeItem(k)); Object.keys(localStorage).filter(k => k.startsWith('pickem-score')).forEach(k => localStorage.removeItem(k)); location.hash = '#/'; location.reload(); },
    async demoSeed(L) {
      const names = ['Pat', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Avery', 'Quinn'];
      const year = lg(L).doc.season;
      const startIdx = WEEKS.findIndex(x => `${x.t}-${x.w}` === lg(L).doc.startWeek);
      const cur = await espnFixture.current();
      const curIdx = WEEKS.findIndex(x => x.t === cur.t && x.w === cur.w);
      const ids = names.map(n => {
        const id = rid(12);
        lg(L).members[id] = { name: n, status: 'active', carryover: 60 + Math.floor(Math.random() * 50), prevUids: [] };
        (lg(L).pins ||= {})[id] = '1234';
        return id;
      });
      const pend = rid(12); lg(L).members[pend] = { name: 'Sam from Accounting', status: 'pending', carryover: 0, prevUids: [] };
      for (let i = startIdx; i <= curIdx; i++) {
        const games = await espnFixture.week(year, WEEKS[i]);
        const id = weekDocId(year, WEEKS[i]);
        lg(L).weeks[id] ||= { season: year, week: `${WEEKS[i].t}-${WEEKS[i].w}`, games: Object.fromEntries(games.map(g => [g.id, { home: g.home.abbr, away: g.away.abbr, kickoff: g.kickoff }])) };
        for (const g of games) {
          const p = (lg(L).picks[`${id}|${g.id}`] ||= {});
          for (const m of ids) if (Math.random() < 0.95) p[m] = { team: Math.random() < 0.55 ? g.home.abbr : g.away.abbr, total: 30 + Math.floor(Math.random() * 30) };
        }
      }
      save();
    }
  };
}

// ── Made-up schedule standing in for ESPN in demo mode ──
const TEAMS = [['ARI','Cardinals'],['ATL','Falcons'],['BAL','Ravens'],['BUF','Bills'],['CAR','Panthers'],['CHI','Bears'],['CIN','Bengals'],['CLE','Browns'],
  ['DAL','Cowboys'],['DEN','Broncos'],['DET','Lions'],['GB','Packers'],['HOU','Texans'],['IND','Colts'],['JAX','Jaguars'],['KC','Chiefs'],
  ['LV','Raiders'],['LAC','Chargers'],['LAR','Rams'],['MIA','Dolphins'],['MIN','Vikings'],['NE','Patriots'],['NO','Saints'],['NYG','Giants'],
  ['NYJ','Jets'],['PHI','Eagles'],['PIT','Steelers'],['SF','49ers'],['SEA','Seahawks'],['TB','Buccaneers'],['TEN','Titans'],['WSH','Commanders']];
const rnd = (n) => { const x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); };
function base() { let b = Number(localStorage.getItem(BKEY)); if (!b) { b = Date.now(); localStorage.setItem(BKEY, String(b)); } return b; }
const CUR = { year: 2026, t: 2, w: 12 };

export const espnFixture = {
  async current() { return { ...CUR }; },
  async week(year, x) {
    const idx = WEEKS.findIndex(q => q.t === x.t && q.w === x.w);
    const curIdx = WEEKS.findIndex(q => q.t === CUR.t && q.w === CUR.w);
    const order = TEAMS.map((t, i) => ({ t, k: rnd(idx * 100 + i) })).sort((a, b) => a.k - b.k).map(o => o.t);
    const n = x.t === 3 ? [6, 4, 2, 0, 1][x.w - 1] : 16;
    const H = 3600e3, D = 24 * H;
    const slots = [-2 * D, -150 * 60e3, -150 * 60e3, -20 * 60e3, D, D, D, D, D, D, D, D + 3 * H, D + 3 * H, D + 3 * H, D + 7 * H, 2 * D + 7 * H];
    const now = Date.now();
    return Array.from({ length: n }, (_, i) => {
      const kickoff = Math.round((base() + (idx - curIdx) * 7 * D + slots[i]) / 60e3) * 60e3;
      const el = now - kickoff, len = 3.3 * H;
      const state = el < 0 ? 'pre' : el < len ? 'in' : 'post';
      const frac = state === 'pre' ? 0 : Math.min(1, el / len);
      const fs = (k) => Math.round((10 + Math.floor(rnd(idx * 1000 + i * 7 + k) * 25)) * frac);
      const mk = (t, k) => ({ abbr: t[0], name: t[1], full: t[1], logo: `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${t[0].toLowerCase()}.png`,
        score: state === 'pre' ? null : fs(k), record: `${5 + Math.floor(rnd(idx + i + k) * 4)}-${3 + Math.floor(rnd(idx * 3 + i + k) * 4)}` });
      return { id: `demo${idx}x${i}`, kickoff, home: mk(order[i * 2], 1), away: mk(order[i * 2 + 1], 2), state, completed: state === 'post',
        detail: state === 'pre' ? '' : state === 'in' ? `Q${1 + Math.floor(frac * 4)} ${Math.floor(15 - (frac * 60) % 15)}:00` : 'Final' };
    });
  }
};
