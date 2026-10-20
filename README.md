<p align="center"><img src="public/brand/logo.svg" alt="Diff Race logo" width="112"></p>

# Diff Race

A multiplayer car-combat racer for the browser and Discord, in the spirit of *Death Race*: heavy
armoured muscle cars with roof turrets, weapon pads on procedurally generated industrial circuits.
Every bump hurts. Race, ram, get diffed.

Built with **Three.js**, **Rapier** physics (WebAssembly), **React** for the menus and HUD,
**Firebase Realtime Database** for rooms, and the **Discord Embedded App SDK** to run as an
Activity, on the same stack and conventions as Arena FPS. `plans/` holds the design.

## Quick start (offline, no accounts needed)

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

The menus share Arena FPS's look:
- **Layout:** a flight along a generated track behind glass panels, a rail of menu entries on the left, and the chosen view on the right.
- **Phones:** the rail stacks above the view.

What's in them:
- **▶ Quick race**, at the top of the rail: 3 laps against 7 bots on today's track (the same for everyone on the same day).
- **Custom race**, in three steps:
  1. **Mode:** Death Race or Elimination against bots, Time Trial or Test Drive.
  2. **Track:** any seed (🎲 for a random one), length and theme, with a turning 3D preview.
  3. **Race:** laps, bots, their skill and crash damage.
- **Rooms and Create room** (with a database): the open rooms, live, and the same steps to make one. Join by code from the rail.
- **Settings**, at the foot of the rail:
  - controls, video, camera and sound;
  - wreck replays, high-visibility car outlines (bright rims in each car's colour, easier to tell apart than paint alone) and the 3D models (Kenney's and the realistic ones).
- **The pause menu (Esc)** is the same menu over the race: Resume, the standings, the controls, Restart, Settings and Leave.

| | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate / brake, reverse | W / S (↑ / ↓) | RT / LT | automatic / BRAKE |
| Steer | A D (← →) | left stick | drag on the left half |
| Machine gun | J (hold) | RB | FIRE |
| Missile | K | LB | MSL |
| Rear defence | F | X | DROP |
| Handbrake / nitro | Space / Shift | A / B | SLIDE / NOS |
| Look back / respawn / pause | C / R / Esc | Y / Back / Start | — / ↺ / — |

## How a race works

### Weapons and pads
- **Pickups:** every pad shows its pickup hovering over a glowing ring, as in Arena FPS. Drive through to take it. It's gone from your view while it recharges for you (6 s), then fades back.
- **Gun pads (amber):** nobody can shoot until they've picked up a gun.
  - A pad loads 150 rounds (15 s of fire), up to 300. A wreck loses them.
  - A row of three sits across the road just after the start, and two or three more round the lap.
- **Machine gun:** hold to fire. It overheats after about 3 s and locks out for 1.5 s.
- **The turret aims itself.** There's no manual aim; you drive and pull the trigger.
  - It locks onto the car nearest the middle of your view, within 110 m and in sight, and orange brackets mark it. With nothing locked it points straight down the road.
  - The crosshair follows the turret. To cover your rear, look back: the lock and the turret swing round with the camera.
  - Smoke, barriers and hills break the lock, and so does a car that's just respawned.
- **Sword pads (red):** +2 missiles (up to 4), and the guns are *armed* for 8 s: harder hits and no overheating.
- **Missiles are heat-seeking.**
  - At launch a missile locks onto the car nearest its line of fire, within 140 m and in sight.
  - It turns after the car at a limited rate and bursts when it gets within 2.4 m.
  - A hard swerve at close range can make it overshoot. Driving into smoke, or dropping it behind you, shakes it off, and so does a wreck or a respawn.
  - With nothing to lock onto, it flies straight.
- **Sword pads (red)** sometimes bolt **ram spikes** onto your nose for 12 s: your rams hit ×1.6 harder, and your front takes half.
- **Shield pads (blue):** patch 25 armour and mend the worst-damaged panel. You also get one rear defence: oil slick, smoke screen, napalm, three mines or a **flamethrower** (3 s of fire out the back, 14 m long). Leaders tend to get oil, mines and the flamethrower, the back of the pack smoke and napalm.
- **Skull pads (green):** a trap for whoever's ahead. A wall of fire springs up across the road 85 m on, for 5 s. Its kills are yours.
- **Placement:** about half the pads sit off the racing line, so grabbing one costs you position.
- **Grace period:** weapons go hot 3 s after the start.

### Crash damage
- **Every car-to-car hit damages both cars,** by how hard it was (the velocity change) and where it landed.
- **Zones:** the armoured front takes ×0.4, sides ×1, the rear ×1.2. The rammer comes off far better.
- **Grinding** door to door wears both cars down. Barriers hurt only real impacts.
- **Visible damage:** the car deforms where each blow lands (`src/game/car/deform.ts`).
  - A hard ram caves a panel in, a missile or mine leaves a wide crater, and bullets pit the paint. Each one's depth and width follow how much it hurt, crumpled in smooth folds, up to about 30 cm deep however often it's hit.
  - The body, glass and trim deform together, so nothing comes apart. The rear wing hangs loose, then falls off.
  - Other players' cars dent too: each car sends its damage per side with its position, and other clients dent that side to match.
  - A wreck brings a fresh car; being put back after a flip keeps the dents.
  - A smashed front, rear or side makes the car steer, top out or pull worse until you respawn.
- **Crash rule** in a room: off ("bumper cars"), normal, or carnage (×2).

### Wrecks and kills
- **Wreck:** at zero armour the car explodes. It respawns 15 m back after 3 s, ghosted for 2 s.
- **Kill credit:** whoever hurt you last, within 5 s, gets the kill, even if a wall or a fall finished you.
- **DIFFED:** your wreck shows **DIFFED by Name**; your kill shows **YOU DIFFED Name**. Being lapped is **LAPPED — massive diff**.
- **Live diffs:** the HUD shows the gap to the car ahead and behind, and each lap's delta against your best.
- **Wreck replay** (a setting, on by default): the last few seconds before your wreck, replayed slowly while you wait. Accelerate or fire to skip.

### Elimination
- **No respawns:** a wreck puts you out of the race for good, and you watch the rest.
- **How it ends:** whoever crosses the line first wins. If everyone else is wrecked first, the last car still running wins.
- **Order:** finishers by time, then cars still running by distance, then wrecked cars, the last wrecked placed highest.
- In a room, the host picks Death Race or Elimination.

## Multiplayer rooms

Rooms appear in the lobby once a database is configured.
- **Create room:** you're the host. You pick the track, laps, bots and crash rule, then start the race.
- **Join:** with the room's code, or by opening its invite link (`…/#CODE`).
- **Who simulates what:**
  - Each player's own car runs on their own computer; the host's computer also runs the bots.
  - If the host leaves mid-race, the next player takes over the bots and the race goes on.
- **Results:** they go final for everyone once all cars are home, or a while after the winner, and update the global leaderboard. Podiums and wins count only against other humans.

### Locally, with the emulator (no Firebase account)

Needs Java, for the Firebase emulator.

```bash
npm run emulator      # terminal 1: Realtime Database on :9000
npm run dev:emu       # terminal 2: the game, using it
```

Open the game in two browser windows. Create a room in one and join it from the other.

### With a real Firebase project

1. Create a project at https://console.firebase.google.com. Then, under **Build → Realtime Database**, create a database near your players.
2. In **Project settings → Your apps → Web app**, copy the config. Run `cp .env.example .env` and fill it in. `VITE_FIREBASE_DATABASE_URL` is the one that matters.
3. Put your project id in `.firebaserc` and deploy the rules: `npm run deploy:rules`. You can also paste `database.rules.json` into the console.
4. `npm run build` gives a static `dist/`. Netlify serves it, per `netlify.toml`.

The free Spark plan allows 100 simultaneous connections; use Blaze for more.

#### Deploying the database rules
`.github/workflows/database-rules.yml` tests the rules on every change, then deploys them from `main`. To set it up:
1. Create a Google Cloud service account with the **Firebase Realtime Database Admin** role.
2. Add its JSON key as the `FIREBASE_SERVICE_ACCOUNT` secret on GitHub.

## The Discord Activity

1. Create an application at https://discord.com/developers/applications, and enable **Activities** for it.
2. Under **OAuth2**, copy the client id and secret.
3. Set the site's environment:
   - **Netlify**: `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. These are for `netlify/functions/discord-token.mjs`, which trades the sign-in code for a token.
   - **Build**: `VITE_DISCORD_CLIENT_ID`, and `VITE_FUNCTIONS_URL` (your site's `/.netlify/functions`).
4. Under **Activities → URL Mappings**:

   | Prefix | Target |
   | --- | --- |
   | `/` | your Netlify site |
   | `/firebase` | your database host (e.g. `your-project-default-rtdb.region.firebasedatabase.app`) |
   | `/api` | your Netlify site + `/.netlify/functions` |

5. Launch the Activity from a voice channel. Everyone in the channel shares one room, whose code comes from the Activity instance. The first in is the host.

Inside Discord, `src/discord/patch.ts` routes Firebase and the functions through Discord's proxy. It's imported before anything else, as in Arena FPS.

## Kit models

Cars and some scenery use models from three of Kenney's CC0 packs (https://kenney.nl/assets): **Car Kit**, **City Kit Industrial** and **Racing Kit**. They're built into `public/models/` (about 750 KB), which belongs in the repo, unlike the packs themselves.
- **Turning them off:** in **Settings → Video**, from the next race.
- **What stays procedural:** anything without a kit model (cranes, pipes, tyre walls, barrels, rocks, fire barrels, furnaces and floodlights), and everything when `public/models/` is missing.

### Rebuilding them
1. Unzip the packs anywhere under `assets-src/kenney/`. The folder is git-ignored, and the scripts find models by file name.
2. Run `npm run build:cars` and `npm run build:props`.

What each script does:
- **`build:cars`** takes eight of the kit's cars.
  - Their colours are baked from the kit's palette texture, and each car's main colour becomes the racer's paint.
  - The game scales each body to the physics car's length and width, lowering the tall cartoon roofs by up to a fifth. The kit wheels stay in their arches and ride the physics suspension.
  - The armour plates, ram, wing and turret stay procedural, and the guns fire from where the turret sits. The physics car and its hitbox don't change.
- **`build:props`** follows `scripts/props.config.mjs`, which maps scenery kinds to models, sizes and copies (a container stack, a row of grandstand sections). `npm run build:props -- --list` shows every model in the packs.
- **Both** quantise the meshes (KHR_mesh_quantization), which halves the download.

## Realistic models

Where `public/models/real/` is there (about 2.9 MB, in the repo), realistic models take over from the kit ones:
- **Props** (Poly Haven, CC0), on Medium and High: red hazard drums (`Barrel_01`), a rusty fire barrel (`Barrel_02`, still with the game's flames), stacks of worn tyres (`old_tyre`) and the quarry's rocks (`rock_07`, `rock_09`, made matte and red). They keep their own textures. Containers, cranes, warehouses and the rest stay Kenney's or procedural.
- **The car**, on High: Khronos's [Car Concept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) (Eric Chadwick, CC BY 4.0), in every racer's paint. It's clear-coated metallic and reflects the theme's sky (`src/game/world/sky.ts`). The physics car, the hitbox, the armour, the turret and the dents are the same as on any kit car. It's about 43k triangles, roughly ten times a kit car, so lower tiers keep the Kenney cars.
- **Turning them off:** the same **Settings → Video** toggle as the Kenney models. The e2e tests skip them, as they skip the photo textures.

### Rebuilding them
1. Put the sources in `assets-src/` (git-ignored):
   - each Poly Haven prop's glTF (1k: `<id>.gltf`, `<id>.bin` and `textures/`) in `assets-src/polyhaven-models/<id>/`;
   - `CarConcept.glb` (from `Models/CarConcept/glTF-Binary/` in the Khronos repo) in `assets-src/khronos/`.
2. Run `npm run build:real` (macOS: it uses `sips`).

It simplifies the meshes with meshoptimizer (the car from 213k triangles to 43k) and shrinks the textures to JPEGs. It also strips the car's interior, wipers, number plate, brake callipers and the Khronos logos (on the tyre walls, the rims and the plate), and makes its materials plain PBR. Its parts come out in car space, like a kit car's: `paint`, `trim` (one primitive per material) and `wheel`.

## Photo textures

The road, verge, ground, concrete barriers and metal (ramps, armour plates) use photo-scanned textures from Poly Haven (CC0, https://polyhaven.com): `asphalt_track`, `sandy_gravel`, `dirt_aerial_02`, `concrete_wall_008` and `metal_plate`. They're built into `public/textures/` (about 3.2 MB), which belongs in the repo.
- **Each surface** has a colour map, a normal map (grit, cracks and seams catch the light) and an ARM map (occlusion and roughness).
- **Theme colours:** each surface is tinted so its average matches what the procedural texture gave, so the themes keep their palettes.
- **No visible tiling:** the road, verge and ground hide their repeats with noise bands that shift the texture by a different offset in each band (`breakUpTiling` in `src/game/surfaces.ts`).
- **What stays procedural:** everything on **Low** quality (to save video memory on phones), in the e2e tests, and when `public/textures/` is missing. Kerbs, hazard stripes and the start line keep their painted patterns, with the concrete or asphalt relief under them.

### Rebuilding them
1. Download each texture's 1k JPGs from Poly Haven (colour, OpenGL normal and ARM: `<id>_diff_1k.jpg`, `<id>_nor_gl_1k.jpg`, `<id>_arm_1k.jpg`) into `assets-src/polyhaven/`.
2. Run `npm run build:textures` (macOS: it uses `sips`). It resizes and recompresses the maps, evens out each colour map's brightness so dark asphalt keeps its detail, and writes `public/textures/manifest.json` with each surface's size in metres and average colour.

## Checks

```bash
npm run typecheck     # the game and the e2e tests
npm run check:arch    # file-size budget and pure-module import rules
npm test              # unit tests (Node): track maths, car feel on Rapier, combat, race rules, codecs, the model build
npm run test:tracks   # 100 seeds × 3 lengths: valid, deterministic, unchanged (golden hashes)
npm run sim:bots      # bots race generated tracks headless: finish, unstuck, skill shows
npm run test:rules    # database rules against the emulator (needs Java)
npm run test:e2e      # Playwright, against the emulator (needs Java)
```

**E2E setup:** run `npx playwright install chromium` once. If the emulator is already running (`npm run emulator`), use `npx playwright test` directly.

**How the tests work:**
- They drive the game through `window.game.test` (dev and e2e builds only): hold inputs, teleport, give weapons, freeze bots, read state.
- They wait on state, not time: software WebGL is slow.

**Useful flags:**
- `npm run check:tracks -- --dump SEED` writes pictures of a seed's tracks.
- `?tune` in a dev build opens the car tuning panel.
- `?touch` forces the touch controls on.
- `?debug` shows the frame rate, draw calls and triangles.

## How it's built

- **The car** (`src/game/car/`) is a Rapier dynamic body on four ray-cast wheels.
  - Each 120 Hz step, every wheel's spring holds the chassis up, and its tyre pushes along and across the road.
  - Tyre grip peaks and falls away past a slip angle, which is what makes slides work.
  - The maths is pure and pinned by feel tests (`car/__tests__/feel.test.ts`).
- **Tracks** (`src/game/track/`) are generated from a seed with deterministic maths only (`dmath.ts`: no `Math.sin`), so every client builds the same track.
  - The stages: a star-shaped layout (it can't cross itself), a centripetal spline, even sampling, hills, banking, validation, the racing line, pads and ramps, scenery.
  - The layout's bends come from points swinging in and out, notches, hairpins (sometimes two), chicanes and a long start straight. Bends tighter than a 25 m radius are relaxed open.
  - Typical laps: about 10 corners on a short track, 12 on a medium and 15 on a long one. `npm run test:tracks` prints these numbers.
  - Generation runs in a worker.
- **The race** (`src/game/raceSession.ts`) holds the cars (`racers.ts`), weapons (`combat/combat.ts`), bots (`bot/botHost.ts`), the clock and the standings. `game.ts` renders and runs the loop.
- **Bots** (`src/game/bot/`) are pure brains:
  - pure pursuit along the racing line, against a speed profile;
  - passing and pad routing; a gunner with skill-based aim.
  - They drive the same `CarInput` a player does.
- **Rooms** (`src/net/`) follow Arena FPS: presence with `onDisconnect`, owner election, transactions for the race record, and events.
- **Remote cars** are shown at the present time:
  - each snapshot is predicted forward and blended (`car/carTrack.ts`);
  - snapshots are sent only when that prediction would drift (`net/sendPolicy.ts`);
  - each is stand-in physics body of the right mass, so rams feel right (`carBody.setPuppet`).
- **Damage across clients:**
  - Gunfire damage rides in each sender's own record (`d`) and is applied by the victim.
  - Missiles and mines are events, and each client applies a blast's splash to its own cars.
- **Rendering budget:**
  - Each car's fixed parts are merged into one mesh per material.
  - Past 40–80 m (by quality), a car drops its small parts and its four moving wheels for one fixed wheel mesh.
  - Track chunks cover 128 samples; all kerbs are one mesh.
  - Once the field spreads out, a race is about 125 draw calls on low quality and 165 on high. The grid costs more, because every car is close.
- **The music** (`src/game/music.ts`) is synthesised on the spot: a 132 BPM industrial loop that builds from the grid to the final lap.
- **Pure code stays pure.** The track, race rules, car maths, bot brains and codecs import no three.js, React or Firebase, so they run in Node. `npm run check:arch` enforces this.
