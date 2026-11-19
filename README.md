# Office Pick 'Em

A no-money NFL pick 'em site for the office. Players pick the winner of every game, picks lock at each game's kickoff, scores come from ESPN automatically, and one Commissioner controls who's in.

Same setup as Shopping Man: static files on **GitHub Pages**, with live shared data in **Firebase** (Firestore plus anonymous sign-in). It's free at this size.

---

## Try it first (demo mode)

While `config.js` has an empty `apiKey`, the site runs in **demo mode**: made-up games, and all data stays in that one browser. Use **Add sample players** and **Act as…** in the yellow bar to see the site the way a player sees it.

## Go live: about 20 minutes, one time

### 1. Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it, for example `office-pickem`. Google Analytics can be off.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
3. **Build → Firestore Database → Create database** → *Start in production mode* → location `us-east1` (or any).
4. In Firestore, open the **Rules** tab, delete what's there, paste the whole of `firestore.rules`, and click **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → nickname "Pick Em" → **Register app**. Copy the values in `firebaseConfig` into `config.js`.

> Use a new project rather than Shopping Man's (`shopping-man-koji`). Each project has a single rules file, and these rules would replace Shopping Man's.

### 2. GitHub Pages
1. On GitHub, create a new **public** repository, for example `office-pickem`.
2. Upload every file in this folder (Add file → Upload files) and commit to `main`.
3. **Settings → Pages → Build and deployment →** Source: *Deploy from a branch*, Branch: `main` / `(root)` → **Save**.
4. In a minute or two the site is live at `https://smccormack-blip.github.io/office-pickem/`.

The Firebase config being visible in a public repository is normal. Those values only identify the project; the security rules decide who can read or change what.

### 3. Start the league and name the Commissioner
Whoever clicks **Start a new league** becomes the Commissioner. There are two ways to give the job to someone else:

- **They start it.** Send the Commissioner-to-be the site address and have them click **Start a new league** (league name, their name, a 4-digit PIN, and **"Start counting with"** = the first week played on the new site).
- **You start it and hand it off.** Start the league yourself, invite them, click **Let in** when they ask to join, then go to **Commish → League settings → Hand off the Commissioner job**. The site makes a brand-new recovery link that only the new Commissioner sees, and your old one stops working.

After that, the Commissioner:
1. **Saves the recovery link** shown on their first visit (emails it to themselves). It's the backup if their PIN ever fails them.
2. **Commish → Invite players → Copy** the link and sends it out.
3. Clicks **Let in** as requests arrive.
4. Under **Players**, types each person's season total from Splash Sports into **Points before**. It's added to their total.

---

## How the rules work

| Who | Can |
|---|---|
| Anyone with the invite link | *Ask* to join (display name + a 4-digit PIN). Nothing else until let in. |
| Players | Make and change their own picks until each game's kickoff, plus a weekly tiebreaker guess. See everyone's picks for a game once it kicks off. See the leaderboard. Change their own name and PIN. Sign in on a new device with their PIN. |
| Commissioner | Everything players can do, plus: let in or decline requests, remove or reinstate players, rename players, **reset a player's PIN**, set carried-over points, overrule a result (winner / tie / no contest), make a new invite link, and hand the job to someone else. |

All of this is enforced by `firestore.rules` on Google's servers, not just hidden in the page.

- **Scoring:** 1 point per correct pick. Ties and "no contest" games count for nobody. A missing pick scores 0.
- **Tiebreaker:** each week, players guess the total points in the week's last game (usually Monday night). The closest guess wins ties for **Picker of the Week**. On the Leaderboard, tied totals go to the smallest combined tiebreaker miss for the season.
- **New phone or cleared browser?** The player opens the site there, taps **Sign in with my PIN**, and picks their name. Their picks and points come along, and the old device is signed out. If they forgot the PIN, the Commissioner uses **Reset PIN** and tells them the new one.
- **Pick security:** each browser holds a secret key, and Google's servers accept a pick only from the player it belongs to, and only before kickoff. A PIN is never shown to anyone, including the Commissioner, who can only replace it.
- **Extras:** your photo on the splash, join and waiting pages, in the header, and next to Picker of the Week. Also: a reminder about real-money gambling once a week, the Legal Mumbo Jumbo button with Shopping Man's sound, football sounds (whistle at kickoff, crowd roar when your picks are all in, cheers or groans on results, a fanfare for Picker of the Week) with a 🔊 mute button, and footer links to Shopping Man and Knight School.
- **Flexed or moved games:** whenever the Commissioner opens a week, kickoff times re-sync from ESPN.
- **Playoffs** are included (Wild Card through Super Bowl).

### Limits to know
- A 4-digit PIN can't be rate-limited by the database. A determined coworker with a script could guess one, which is accepted as fine for an office game.
- The schedule for each week is saved from ESPN the first time anyone in the league opens that week. A tech-savvy player who opened a week first *could* tamper with kickoff times, and the Commissioner's next visit to that week would correct them. For an office pool with no money involved, that's an acceptable trade-off.
- ESPN's scoreboard feed is free and unofficial. If it ever changes or goes down, results can still be entered with the Commissioner's rulings.

## Files
- `index.html`, `style.css`, `app.js`: the site
- `espn.js`: schedule and scores from ESPN
- `sounds.js`: football sound effects (generated in the browser); `legal-mumbo-jumbo.mp3`: from Shopping Man
- `coach.jpg`, `coach-face.jpg`: the photo
- `data-firebase.js`: live database; `data-demo.js`: demo mode
- `config.js`: **your Firebase settings go here**
- `firestore.rules`: security rules (paste into the Firebase console)
- `manifest.json`, `icon.svg`: "Add to Home Screen" support
