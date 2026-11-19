// NFL schedule + scores from ESPN's free public scoreboard feed (no key needed).
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

let fixture = null;                       // demo-mode stand-in for ESPN
export function useFixture(f) { fixture = f; }

// t = ESPN season type (2 regular, 3 postseason), w = week number.
export const WEEKS = [...Array(18)].map((_, i) => ({ t: 2, w: i + 1 }))
  .concat([{ t: 3, w: 1 }, { t: 3, w: 2 }, { t: 3, w: 3 }, { t: 3, w: 5 }]);

export function weekLabel(x) {
  if (!x) return '';
  if (x.t === 2) return `Week ${x.w}`;
  return { 1: 'Wild Card', 2: 'Divisional', 3: 'Conference Champ.', 5: 'Super Bowl' }[x.w] || `Playoffs ${x.w}`;
}
export const weekKey = (x) => `${x.t}-${x.w}`;                     // "2-12"
export const weekDocId = (year, x) => `${year}-${x.t}-${x.w}`;       // "2026-2-12"
export function weekIndex(key) {
  const [t, w] = String(key).split('-').map(Number);
  return WEEKS.findIndex(x => x.t === t && x.w === w);
}

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`ESPN responded ${r.status}`);
  return r.json();
}

// Which NFL week is it right now?
export async function current() {
  if (fixture) return fixture.current();
  const j = await getJSON(BASE);
  let year = j.season?.year, t = j.season?.type, w = j.week?.number;
  if (t === 1 || !t) { t = 2; w = 1; }          // preseason → week 1
  if (t === 4) { t = 3; w = 5; }                // offseason → Super Bowl
  if (t === 3 && w === 4) w = 5;                // Pro Bowl week → Super Bowl
  return { year, t, w };
}

const cache = new Map();
export async function week(year, x, { fresh = false } = {}) {
  if (fixture) return fixture.week(year, x);
  const key = weekDocId(year, x);
  const c = cache.get(key);
  if (c && !fresh && Date.now() - c.at < 60_000) return c.games;
  const j = await getJSON(`${BASE}?seasontype=${x.t}&week=${x.w}&dates=${year}`);
  const games = (j.events || []).map(parseEvent).filter(g => g.home.abbr && g.away.abbr)
    .sort((a, b) => a.kickoff - b.kickoff || a.id.localeCompare(b.id));
  cache.set(key, { at: Date.now(), games });
  return games;
}

function parseEvent(e) {
  const c = e.competitions?.[0] || {};
  const side = (ha) => {
    const p = (c.competitors || []).find(q => q.homeAway === ha) || {};
    const s = p.score;
    return {
      abbr: p.team?.abbreviation,
      name: p.team?.shortDisplayName || p.team?.name || p.team?.displayName || p.team?.abbreviation,
      full: p.team?.displayName || '',
      logo: p.team?.logo || '',
      score: s === undefined || s === null || s === '' ? null : Number(s),
      record: p.records?.[0]?.summary || ''
    };
  };
  const st = e.status?.type || {};
  return {
    id: String(e.id),
    kickoff: Date.parse(e.date),
    home: side('home'), away: side('away'),
    state: st.state || 'pre',                  // pre | in | post
    completed: !!st.completed,
    detail: st.shortDetail || st.detail || ''
  };
}

// Winner of a game: team abbreviation, 'TIE', 'VOID', or null (not decided yet).
export function winner(g, override) {
  if (override) return override;
  if (!g.completed || g.home.score == null || g.away.score == null) return null;
  if (g.home.score === g.away.score) return 'TIE';
  return g.home.score > g.away.score ? g.home.abbr : g.away.abbr;
}
