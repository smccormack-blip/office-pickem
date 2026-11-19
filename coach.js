// The Coach: the app's mascot/logo in action — entrance, loading, reactions,
// the judge's wig, and the Picker of the Week certificate.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Loading screen: the coach's head spirals like a thrown football.
export function loadingHTML(msg = 'Coach is reviewing the tape…') {
  return `<div class="loading"><img class="spinhead" src="coach-face.jpg" alt=""><div>${esc(msg)}</div></div>`;
}

// Bust-through entrance: the crest tears through a paper banner, then flies into the header.
export function bustThrough(title, subtitle) {
  return new Promise(resolve => {
    if (reduced()) return resolve();
    const el = document.createElement('div');
    el.id = 'entrance';
    const scraps = Array.from({ length: 18 }, (_, i) => {
      const ang = (i / 18) * Math.PI * 2, dist = 35 + Math.random() * 30;
      return `<i style="--dx:${Math.cos(ang) * dist}vw;--dy:${Math.sin(ang) * dist}vh;--r:${Math.random() * 720 - 360}deg;left:${45 + Math.random() * 10}%;top:${38 + Math.random() * 10}%"></i>`;
    }).join('');
    const banner = `<div class="bn-text"><b>${esc(title)}</b><span>${esc(subtitle)}</span></div>`;
    el.innerHTML = `<div class="ent-stripes"></div>
      <div class="bn bn-l">${banner}</div><div class="bn bn-r">${banner}</div>
      <div class="scraps">${scraps}</div>
      <img class="ent-crest" src="logo.png" alt="">
      <div class="ent-skip">tap to skip</div>`;
    document.body.appendChild(el);
    // where the crest lands: the little face in the header
    const target = document.querySelector('.hface')?.getBoundingClientRect();
    if (target) {
      const cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
      el.style.setProperty('--tx', `${target.left + target.width / 2 - cx}px`);
      el.style.setProperty('--ty', `${target.top + target.height / 2 - cy}px`);
      el.style.setProperty('--ts', `${target.width / Math.min(300, window.innerWidth * 0.7)}`);
    }
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 250); };
    el.addEventListener('click', finish);
    setTimeout(finish, 3600);
  });
}

// Coach reacts to your results: bouncing with confetti, or slumped under a rain cloud.
export function react(happy, text) {
  // wait for the entrance animation to finish first
  if (document.getElementById('entrance')) return setTimeout(() => react(happy, text), 400);
  document.querySelector('.reaction')?.remove();
  const el = document.createElement('div');
  el.className = `reaction ${happy ? 'happy' : 'sad'}`;
  el.innerHTML = `${happy ? '' : '<div class="cloud">☁️<span class="drops"><i></i><i></i><i></i><i></i></span></div>'}
    <img src="coach-face.jpg" alt=""><div class="r-text">${esc(text)}</div>`;
  document.body.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', close);
  setTimeout(close, 4200);
  if (happy) confetti();
}

export function confetti() {
  if (reduced()) return;
  const box = document.createElement('div'); box.className = 'confetti';
  box.innerHTML = Array.from({ length: 28 }, (_, i) => `<span style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 0.6}s;animation-duration:${1.6 + Math.random()}s">${['🏈', '🏆', '⭐', '🎉'][i % 4]}</span>`).join('');
  document.body.appendChild(box); setTimeout(() => box.remove(), 3500);
}

// Coach, Esq.: powdered wig and gavel for the Legal Mumbo Jumbo.
export function judgeHTML() {
  // Barrister's wig sized to the 100px photo (photo spans x/y 33–167 in this 200-unit box).
  const roll = (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.78}"/><path class="curl" d="M${x - r * 0.55} ${y + 1}a${r * 0.55} ${r * 0.42} 0 1 1 ${r * 1.1} 0"/>`;
  const side = (x) => [78, 100, 122, 144, 166].map((y, i) => roll(x, y, 15 - i * 0.6)).join('');
  return `<div class="judge">
    <div class="judge-face"><img src="coach-face.jpg" alt="">
      <svg class="wig" viewBox="0 0 200 200" aria-hidden="true"><g class="wig-fill">
        <path class="crown" d="M30 92 C 26 30, 72 14, 100 14 C 128 14, 174 30, 170 92 C 160 66, 140 56, 100 56 C 60 56, 40 66, 30 92 Z"/>
        ${[52, 76, 100, 124, 148].map((x, i) => roll(x, i === 2 ? 28 : i % 4 === 0 ? 46 : 34, 13)).join('')}
        ${side(36)}${side(164)}
      </g></svg>
    </div>
    <svg class="gavel" viewBox="0 0 100 100" aria-hidden="true">
      <g class="gavel-arm"><rect x="44" y="30" width="9" height="58" rx="3" fill="#7a4a24"/>
      <rect x="22" y="14" width="54" height="22" rx="5" fill="#8b5a2b"/><rect x="18" y="16" width="8" height="18" rx="2" fill="#d9a520"/><rect x="72" y="16" width="8" height="18" rx="2" fill="#d9a520"/></g>
      <rect x="10" y="90" width="80" height="8" rx="3" fill="#5c3a1c"/>
    </svg>
    <div class="esq">Coach, Esq.</div>
  </div>`;
}

// Framed Picker of the Week certificate (made to be screenshotted and shared).
export function certificateHTML({ names, week, score, of, tbMiss, commissioner, league }) {
  return `<div class="cert"><div class="cert-in">
    <div class="cert-league">${esc(league)}</div>
    <div class="cert-top">Certificate of Achievement</div>
    <img class="cert-seal" src="logo.png" alt="">
    <div class="cert-small">This certifies that</div>
    <div class="cert-name">${names.map(esc).join(' &amp; ')}</div>
    <div class="cert-small">${names.length > 1 ? 'are' : 'is'} hereby proclaimed</div>
    <div class="cert-title">Picker of the Week</div>
    <div class="cert-small">${esc(week)} · ${score} of ${of} correct${tbMiss != null ? ` · tiebreaker off by ${tbMiss}` : ''}</div>
    <div class="cert-sign">
      <div><span class="sig">Coach</span><small>Head Coach</small></div>
      <div><span class="sig">${esc(commissioner || 'The Commish')}</span><small>Commissioner</small></div>
    </div>
    <div class="cert-fine">No money. All glory. Non-transferable. No cash value. Void where prohibited by HR.</div>
  </div></div>`;
}
