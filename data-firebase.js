// Live data layer: Firebase Auth (anonymous) + Cloud Firestore.
// Every permission here is enforced on Google's servers by firestore.rules.
const V = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

export async function createApi(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`)
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  await auth.authStateReady();
  if (!auth.currentUser) await A.signInAnonymously(auth);
  let uid = auth.currentUser.uid;

  const D = (...p) => F.doc(db, 'leagues', ...p);
  const C = (...p) => F.collection(db, 'leagues', ...p);
  const withId = (s) => (s.exists() ? { id: s.id, ...s.data() } : null);
  const weekOut = (d) => {
    if (!d) return null;
    const games = {};
    for (const [id, g] of Object.entries(d.games || {})) games[id] = { ...g, kickoff: g.kickoff?.toMillis?.() ?? g.kickoff };
    return { ...d, games };
  };
  const weekIn = (w) => {
    const games = {};
    for (const [id, g] of Object.entries(w.games)) games[id] = { home: g.home, away: g.away, kickoff: F.Timestamp.fromMillis(g.kickoff) };
    return { season: w.season, week: w.week, games };
  };

  return {
    get uid() { return uid; }, demo: false,
    // Give this browser a brand-new anonymous identity (used when moving a player here).
    async newIdentity() { await A.signOut(auth); await A.signInAnonymously(auth); uid = auth.currentUser.uid; },

    async createLeague({ name, season, startWeek, myName, invite, recovery }) {
      const ref = F.doc(F.collection(db, 'leagues'));
      await F.setDoc(ref, { name, season, startWeek, commissionerUid: uid, overrides: {}, createdAt: F.serverTimestamp() });
      await F.setDoc(D(ref.id, 'secret', 'invite'), { code: invite });
      await F.setDoc(D(ref.id, 'secret', 'recovery'), { code: recovery });
      await F.setDoc(D(ref.id, 'members', uid), { name: myName, status: 'active', carryover: 0, prevUids: [], joinedAt: F.serverTimestamp() });
      return ref.id;
    },
    async getLeague(L) { return withId(await F.getDoc(D(L))); },
    watchLeague(L, cb) { return F.onSnapshot(D(L), s => cb(withId(s)), () => cb(null)); },
    async updateLeague(L, patch) { await F.updateDoc(D(L), patch); },

    async getSecrets(L) {
      const [i, r] = await Promise.all([F.getDoc(D(L, 'secret', 'invite')), F.getDoc(D(L, 'secret', 'recovery'))]);
      return { invite: i.data()?.code, recovery: r.data()?.code };
    },
    async setSecret(L, which, code) { await F.setDoc(D(L, 'secret', which), { code }); },
    async claimCommish(L, code) {
      await F.setDoc(D(L, 'claims', uid), { code });
      await F.updateDoc(D(L), { commissionerUid: uid });
    },

    async getMember(L, u) { return withId(await F.getDoc(D(L, 'members', u))); },
    watchMember(L, u, cb) { return F.onSnapshot(D(L, 'members', u), s => cb(withId(s)), () => cb(null)); },
    watchMembers(L, cb) { return F.onSnapshot(C(L, 'members'), qs => cb(qs.docs.map(withId)), () => cb([])); },
    async requestJoin(L, name, code) {
      await F.setDoc(D(L, 'members', uid), { name, status: 'pending', carryover: 0, prevUids: [], joinedAt: F.serverTimestamp(), code });
    },
    async addSelfAsCommish(L, data) {
      await F.setDoc(D(L, 'members', uid), { name: data.name, status: 'active', carryover: data.carryover || 0, prevUids: data.prevUids || [], joinedAt: F.serverTimestamp() });
    },
    async updateMember(L, u, patch) { await F.updateDoc(D(L, 'members', u), patch); },
    async deleteMember(L, u) { await F.deleteDoc(D(L, 'members', u)); },

    async getWeek(L, id) { return weekOut((await F.getDoc(D(L, 'weeks', id))).data()); },
    async createWeek(L, id, w) {
      // Create-only: a transaction makes sure we never overwrite an existing schedule.
      await F.runTransaction(db, async tx => {
        const s = await tx.get(D(L, 'weeks', id));
        if (s.exists()) throw Object.assign(new Error('exists'), { code: 'exists' });
        tx.set(D(L, 'weeks', id), weekIn(w));
      });
    },
    async setWeek(L, id, w) { await F.setDoc(D(L, 'weeks', id), weekIn(w)); },

    // My picks for a week: from this device, or from a device I moved from (newest first).
    async getMyPicks(L, id, gids, prevUids = []) {
      const out = {};
      await Promise.all(gids.map(async g => {
        for (const u of [uid, ...prevUids]) {
          try {
            const s = await F.getDoc(D(L, 'weeks', id, 'games', g, 'picks', u));
            if (s.exists()) { out[g] = { team: s.data().team, total: s.data().total }; return; }
          } catch { return; }
        }
      }));
      return out;
    },
    async setPick(L, id, g, team) { await F.setDoc(D(L, 'weeks', id, 'games', g, 'picks', uid), { team, at: F.serverTimestamp() }, { merge: true }); },
    async setTotal(L, id, g, team, total) { await F.setDoc(D(L, 'weeks', id, 'games', g, 'picks', uid), { team, total, at: F.serverTimestamp() }, { merge: true }); },
    async getGamePicks(L, id, g) {
      const qs = await F.getDocs(C(L, 'weeks', id, 'games', g, 'picks'));
      const out = {}; qs.forEach(d => { out[d.id] = { team: d.data().team, total: d.data().total }; }); return out;
    },

    async listMembers(L) { return (await F.getDocs(C(L, 'members'))).docs.map(withId); },
    async setPin(L, u, pin) { await F.setDoc(D(L, 'pins', u), { pin }); },
    async deleteSelfPending(L) { await F.deleteDoc(D(L, 'members', uid)); },
    // Move an existing player onto this device using their PIN.
    async moveHere(L, from, pin) {
      const old = withId(await F.getDoc(D(L, 'members', from)));
      const lgDoc = (await F.getDoc(D(L))).data();
      await F.setDoc(D(L, 'moves', uid), { from, pin });                       // rejected if PIN is wrong
      await F.setDoc(D(L, 'members', uid), { name: old.name, status: 'active', carryover: old.carryover || 0,
        prevUids: [from, ...(old.prevUids || [])], joinedAt: F.serverTimestamp() });
      if (lgDoc.commissionerUid === from) await F.updateDoc(D(L), { commissionerUid: uid });
      await F.updateDoc(D(L, 'members', from), { status: 'replaced' });
      await F.setDoc(D(L, 'pins', uid), { pin });
    }
  };
}
