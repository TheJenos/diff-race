# Diff Race: a multiplayer Death Race–style car combat racer for the browser and Discord, on the Arena FPS stack

## Context

`/Users/nadun/Private/discord-race` is empty. The goal is **Diff Race**: a **multiplayer 3D car-combat racer in the spirit of the film *Death Race***. Heavy armoured cars race around brutal industrial circuits. Each car's roof turret is aimed freely, and pads on the track arm weapons and defences. Wrecked cars respawn and the first across the line wins.

It runs in the browser and as a **Discord Activity**, and reuses the stack, architecture and conventions of `TheJenos/shootup-area-fps` (the "FPS repo" below).

**Decisions (from the user):**
- **Name: Diff Race.** You get "diffed" (outclassed, wrecked) while racing.
- **Vehicles:** cars, not karts. Weighty arcade muscle cars on 4-wheel raycast suspension. Ramming, PIT spins and handbrake slides are in; cars can roll over, with auto-righting and a respawn if stuck.
- **Crash damage:** cars bump into each other, and **every car-to-car hit damages both cars**.
  - Damage grows with how hard the hit is and depends on where each car is struck: the armoured front takes less, sides and rear take more.
  - Grinding door-to-door wears both cars down.
  - Damage shows as dents and panels falling off.
  - A wreck caused by a ram credits the rammer with the kill.
  - See design section 5.
- **Weapons:** track pads, as in the film.
  - A **sword pad** arms offence (missiles plus a damage boost).
  - A **shield pad** arms one rear defence (oil, smoke, napalm or mines) and patches armour.
  - The **machine gun** is always available but overheats, so the free turret always matters.
- **Aiming:** free turret aim with the mouse (pointer lock, as in the FPS), the right stick, or a touch drag. Optional aim assist on gamepad and touch.
- **Winning:** race to the finish. Wrecked cars respawn after about 3 s on the track, losing ground. Kills count for the leaderboard and the DIFFED banners.
- **Tracks:** procedural from a seed, like the FPS mapgen.
- **Delivery:** a full vertical slice in phases, playable after each.
- **Input:** keyboard + mouse, gamepad, and touch.

**Stack copied from the FPS repo:**

| Area | What |
| --- | --- |
| Runtime libraries | three ^0.186.1, @dimforge/rapier3d and -compat **0.21.0** (pinned exactly, using the `#rapier` alias: compat in Node, wasm in the browser), firebase ^12.19.0 (Realtime Database, no auth, validation-only rules), @discord/embedded-app-sdk ^2.5.0, react/react-dom ^19.3.0 |
| Build and tests | vite ^8.3.2 (rolldown, separate chunks for three/firebase/react), vite-plugin-wasm, @vitejs/plugin-react, typescript ^7.0.2 (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), vitest ^5.0.3, @playwright/test ^1.63.0, firebase-tools (emulator), @gltf-transform/core+functions, pngjs |
| Hosting and CI | Netlify (static `dist/`, plus `netlify/functions/discord-token.mjs`); GitHub Actions `checks.yml`, `e2e.yml`, `database-rules.yml` |

**Naming across the project:**
- npm package `diff-race`. Page title, `og:` tags, Discord application name and README: **Diff Race**.
- Every localStorage and sessionStorage key starts with `diffrace-`, so none clashes with the FPS's `fps-` keys.
- Firebase emulator project: `demo-diff-race`. Logo: a "Δ" chevron with a skull notch (`public/brand/logo.svg`).

**"Diff" as the signature mechanic:**
- **Live gaps:** the HUD shows the gap to the car ahead (`−0.84`) and behind (`+1.20`), coloured by whether it is shrinking or growing.
- **Lap delta:** each lap is shown green or red against your best lap.
- **DIFFED banners:**
  - **DIFFED by Name** when someone wrecks you.
  - **YOU DIFFED Name** when you wreck someone.
  - **LAPPED — massive diff** when you are lapped.
  - Overtakes are smaller feed lines.
- **Results:** the screen shows each racer's diff to the winner and their kills.

**Lessons from the FPS repo:**
- Its `game.ts` reached 5.6k lines. Here, subsystems are split from day one, and a CI script enforces a file limit of about 700 lines and the import boundaries of the pure folders.
- Remote players in the FPS are drawn 120 ms in the past. At 50 m/s that is 6 m, which would wreck both turret aim and ramming. Remote cars are shown at **present time** by prediction instead (see Netcode).
- Much of the FPS's combat design carries over:
  - the shooter decides hits;
  - the victim applies damage and reports its own death;
  - kill credit, the kill feed, hitmarkers and damage flashes from `hudStore`;
  - the crosshair;
  - pointer lock, with its fallback inside Discord;
  - touch drag-to-look.

## Architecture

**Rules:**
- Pure folders import no three.js, React, Firebase or DOM. These are `game/track`, `game/race`, `game/math`, `game/combat/rules`, and the pure files in `car/`, `bot/` and `net/`. They run in Node for unit tests and for the headless bot sim.
- Every subsystem exposes `fixed(dt)`, `frame(dt, alpha)` and `dispose()`.

```
src/
  main.tsx  start.tsx  style.css  types.ts      bootstrap copied from FPS (patch first, then dynamic import; no StrictMode)
  discord/  patch.ts discord.ts roomCode.ts fakeSdk.ts
  net/      link.ts (RoomLink interface)  localLink.ts (in-memory + LocalHub for tests)  firebase.ts
            roomConnection.ts  lobby.ts  raceRecord.ts  carCodec.ts  sendPolicy.ts  damageLedger.ts
            hazards.ts  leaderboard.ts  session.ts
  game/
    game.ts (≤500-line orchestrator)  loop.ts  renderer.ts  dynamicResolution.ts  device.ts  physics.ts
    settings.ts  hudStore.ts  audio.ts  sfx.ts  perfStats.ts  testApi.ts  textures.ts
    math/     vec3.ts quat.ts smooth.ts
    input/    carInput.ts keyboard.ts mouse.ts (pointer lock, from FPS) gamepad.ts touch.ts router.ts
    car/      params.ts carState.ts suspension.ts tyre.ts drivetrain.ts nitro.ts stability.ts   (pure)
              turret.ts (pure: slew, limits, aim-point solve)  damage.ts (pure: armour, regen, zone levels)
              collisionDamage.ts (pure: impact Δv + contact zone → damage; scrape)  ramHandshake.ts (pure: dedupe)
              carTrack.ts (pure: remote prediction + convergence)
              carBody.ts (Rapier chassis + 4 wheel rays)  puppet.ts (dynamic proxy for remote cars)
              car.ts  carMesh.ts  turretMesh.ts  carFx.ts (tyre smoke, skids, sparks, damage smoke/fire, explosion)
              remoteCar.ts  deform.ts (vertex dents, detaching panels)  wreck.ts (local debris on wreck)  nameTag.ts
    combat/   rules/{weapons.ts heat.ts hitTest.ts killCredit.ts aimAssist.ts pads.ts}   (pure)
              machineGun.ts  missiles.ts  defences.ts (oil/smoke/napalm/mines)  hazards.ts  tracers.ts  combat.ts
    track/    index.ts spec.ts types.ts rng.ts dmath.ts hash.ts names.ts themes.ts layout.ts spline.ts resample.ts
              elevation.ts frames.ts validate.ts features.ts racingLine.ts scenery.ts generate.ts fallback.ts
              spatialGrid.ts locate.ts surface.ts worker.ts client.ts golden.json
    world/    trackMesh.ts trackPhysics.ts sceneryMesh.ts padMesh.ts environment.ts minimap.ts startGantry.ts
    race/     progress.ts ranking.ts clock.ts raceRules.ts start.ts respawn.ts results.ts raceDirector.ts
    bot/      driver.ts speedProfile.ts skills.ts rubberBand.ts gunner.ts botDefences.ts padRouting.ts
              avoid.ts roster.ts botHost.ts sim/headless.ts
    camera/   chase.ts (pure: orbit-by-aim, recentre, FOV kick)  cameraRig.ts (intro, wreck cam, spectate)
  ui/       App GameView Lobby RoomBrowser CreateWizard StepBar TrackPicker TrackPreview DiscordLobby PauseMenu
            SettingsPanel KeybindRow Results Leaderboard Hud Crosshair TouchControls TouchIntro MenuShell
            MenuBackdrop TunePanel (DEV ?tune) ErrorBoundary + colors/errors/playerName/useCountdown/
            useDialogFocus/useTrackData/useGamepadNav
scripts/   check-tracks.ts sim-bots.ts check-arch.mjs test-rules.mjs build-cars.mjs build-props.mjs props.config.mjs
netlify/functions/discord-token.mjs     e2e/ support/{db,fixtures,player,ui}.ts + specs
```

**`RoomLink` interface** (`net/link.ts`)
- The race director, bot host and combat system talk only to `RoomLink`, which provides selfId, isOwner, serverNow, players, race, events, hazards and the damage ledger.
- Offline phases use `localLink.ts`. Phase 3 adds Firebase `roomConnection.ts` with no changes upstream.
- `LocalHub` wires several in-memory links together, so phase flow, damage and owner migration can be unit-tested without the emulator.

### Files copied or adapted from the FPS repo

| FPS file | Becomes here |
| --- | --- |
| `package.json` | scripts and `#rapier` imports, plus explicit `rolldown` |
| `tsconfig.json`, `e2e/tsconfig.json` | copied |
| `vite.config.ts` (wasm plugin, `optimizeDeps.exclude`, codeSplitting groups) | copied |
| `vitest.config.ts`, `playwright.config.ts` (swiftshader flags, `vite --mode e2e`) | copied |
| `netlify.toml`, `firebase.json`, `.env.example`, `.env.emulator`, `.env.e2e` | copied |
| `src/main.tsx`, `src/start.tsx`, `src/ui/ErrorBoundary.tsx`, `src/ui/errors.ts`, `src/ui/playerName.ts`, `src/ui/colors.ts` | copied nearly verbatim |
| `src/discord/patch.ts`, `src/discord/discord.ts` (with `step()` timeouts), `netlify/functions/discord-token.mjs` | copied verbatim; activity text adapted |
| `src/game/physics.ts` | `loadPhysics`, `getRapier`, `PhysicsWorld`, collision groups, `castRay`; add `onBeforeStep` and a contact-force event drain |
| `src/game/dynamicResolution.ts`, `src/game/device.ts` | copied |
| `src/game/hudStore.ts` | pattern plus `pushKill`, `hitmarker`, `flashDamage`, `announce` |
| `src/game/settings.ts` | key `diffrace-settings` |
| `src/game/audio.ts`, `src/game/canvas.ts`, `src/game/textures.ts` | copied |
| `src/game/fullscreen.ts`, and pointer-lock handling from `src/game/player.ts` / `game.ts` (with the free-mouse fallback in Discord) | copied |
| `src/ui/Crosshair.tsx` | copied; the hitmarker is reused |
| `src/game/bot/aim.ts` (aim error and reaction ideas) | basis for `bot/gunner.ts` |
| `src/game/mapgen/rng.ts`, `dmath.ts`, `hash.ts` | moved to `track/`; add `sinCosTurns` |
| `src/game/mapgen/worker.ts`, `client.ts`, `index.ts` (LRU), `scripts/check-maps.ts` | `track/worker.ts`, `track/client.ts`, `track/index.ts`, `scripts/check-tracks.ts` |
| `src/game/poseBuffer.ts` | extended into `car/carTrack.ts` |
| `src/net/firebase.ts` | emulator switch and `forceWebSockets` |
| `src/net/network.ts` | split into `roomConnection.ts` (presence, onDisconnect, reRegister, owner election, server clock, events, `sendStatesAs`, `creditKill`) and `lobby.ts` (`randomId`/`CODE_CHARS`, `watchRooms`, `createRoom(WithCode)`) |
| `src/net/leaderboard.ts`, `src/game/session.ts` | copied and adapted |
| `src/ui/MenuShell.tsx`, `MenuBackdrop.tsx`, `CreateWizard.tsx`, `StepBar.tsx`, `DiscordLobby.tsx` (`roomCodeFor`), `RoomBrowser.tsx` (`useRooms`), `TouchControls.tsx` (drag-to-look), `useDialogFocus.ts`, `useCountdown.ts` | copied and adapted |
| `e2e/support/db.ts`, `fixtures.ts`, `player.ts` | adapted; `duel` becomes `race` |
| `scripts/test-rules.mjs` | table format kept |
| `.github/workflows/*` | copied |

## Key designs

### 1. Car physics: a weighty arcade car on custom raycast suspension

The car is a Rapier dynamic body with **custom** 4-wheel raycast suspension and an arcade tyre model, written in pure, testable functions.
- **Why not Rapier's built-in vehicle:** `DynamicRayCastVehicleController` is a Bullet port. Handbrake slides are hard to tune on it, and its behaviour stays inside Rapier where it can't be unit-tested.
- **Fallback:** if the custom suspension proves unstable, swap `carBody.ts` to the built-in controller behind the same interface.

**Chassis** (`carBody.ts`)
- Shape: a cuboid 2.0 × 1.1 × 4.4 m plus a cabin cuboid. Mass about 1,500 kg via `setMassProperties`, with the centre of mass lowered 0.35 m for stability.
- Collision: CCD on, contact force events on, group `CAR`.
- **Physics step 1/120** (FPS accumulator, `MAX_STEPS` 8), so stiff springs stay stable. Only local cars (yours, plus bots on the owner) run the suspension.

**Wheels:** each wheel per step does:
- **Suspension** (`suspension.ts`):
  - a downward raycast from its mount point (`castRayAndGetNormal`, WORLD only);
  - a spring-damper force (stiffness about 35 kN/m, damping about 0.3 critical, rest length 0.45 m, wheel r 0.38 m);
  - an anti-roll bar per axle.
- **Tyre** (`tyre.ts`):
  - slip velocity at the contact patch, then a lateral force from a grip curve (rising to a peak at a small slip angle, then falling, which is what lets the car slide);
  - longitudinal drive and brake force, capped by the friction circle, scaled by load and surface (road 1.0, verge 0.6, oil 0.15).
- Forces are applied with `applyImpulseAtPoint`.

**Drivetrain** (`drivetrain.ts`):
- rear-wheel drive with a torque curve against speed;
- fake gears, used for audio pitch and a small torque dip on shifts;
- top speed about 50 m/s (180 km/h); 0–100 km/h in about 3.5 s; braking; reverse.

**Arcade assists** (`stability.ts`):
- steering lock falls with speed;
- yaw damping when not sliding;
- **handbrake** (rear grip ×0.35) for slides;
- countersteer help;
- air control (pitch and roll torque, 0.3 authority);
- auto-righting torque when on its side for 1 s;
- **respawn** after 3 s upside-down or stuck.

**Nitro** (`nitro.ts`): a meter, about 4 s from full. It fills slowly over time, plus extra from slides, near misses and kills. While active: +12 m/s cap and ×1.8 drive force.

**Step order:**
1. **`beforeStep`**:
   - read input;
   - wheel raycasts;
   - `locate` and `surfaceAt`;
   - pure suspension, tyre, drivetrain and stability maths;
   - apply impulses;
   - drive the puppets (below).
2. **`world.step()`**.
3. **`afterStep`**:
   - move the current pose to previous (render lerps by alpha);
   - progress;
   - drain contact-force events into ram damage;
   - hazard overlaps, pad pickups, respawn checks.

**Tuning:** all constants live in `car/params.ts`. The DEV `?tune` panel edits them live and shows telemetry: speed, slip angles, wheel loads, grip use and surface.

**Tests:**
- Pure maths is unit-tested.
- Whole-car feel is tested in Node with the Rapier compat build on a flat slab:
  - time to 100 km/h and top speed;
  - turning circle;
  - handbrake slide angle;
  - stopping distance;
  - no rollover at full lock at top speed;
  - auto-righting from 90° within 2 s.

### 2. Procedural tracks (`game/track/`, deterministic)

**Determinism:**
- FPS `dmath` rules apply. `scripts/check-tracks.ts` bans `Math.sin/cos/atan2/exp/pow/hypot/random` and `**` in this folder.
- Trig comes from `sinCosTurns(t)` in `dmath.ts`, a polynomial using only `+` and `*` after reduction to a quarter turn.
- Every output is quantised to centimetres.

**Spec:** `TrackSpec { seed (≤16 chars), length 's'|'m'|'l', theme?, gen }`. Car-scale lengths: s 1.2–1.5 km, m 1.8–2.2 km, l 2.6–3.2 km. A medium lap takes about 55 s.

**Stages.** Each stage gets its own random stream from `rng.fork(label)`. Up to 24 attempts are made, then the generator falls back to a guaranteed-valid stadium in `fallback.ts`.
1. **`layout`:** a star-shaped polar polygon with strictly increasing angles, so it can't self-intersect. Random radii, an optional hairpin pull, an optional aligned straight and an aspect stretch.
2. **`spline`:** closed centripetal Catmull-Rom (only `sqrt` needed), scaled to the target length.
3. **`resample`:** arc length, with a step of about 2 m, so the loop closes exactly.
4. **`elevation`:** periodic value-noise hills, a slope limiter, and a flat start zone.
5. **`frames`:**
   - tangent, right and up vectors per sample;
   - signed curvature;
   - banking without trig;
   - width profile: half-width 9 ± 2 m, 6 m verge, concrete barriers outside.
6. **`validate`:** each check returns a reason string.
   - wall clearance between distant samples (spatial grid);
   - min radius ≥ 25 m, max slope, crest change;
   - closure and bounds;
   - a start straight of at least 120 m.
7. **`features`:**
   - start/finish on the best straight, with a 12-slot staggered grid;
   - 8 sector checkpoints for HUD splits;
   - **weapon pads:**
     - 3–5 sword pads and 3–5 shield pads per lap;
     - about half placed off the racing line (risk against reward);
     - often in pairs across the road, so you choose one;
   - 0–2 ramps with clear landings;
   - kerbs on tight bends.
   - All are stored in track coordinates (distance along the track, lateral offset).
8. **`racingLine`:** elastic-band lateral offsets for bots. The bot speed profile is computed at runtime from car params, so retuning cars doesn't change track hashes.
9. **`scenery`:**
   - placed outside the barriers with spatial-grid rejection;
   - **themes** (Death Race industrial): `docks` (containers, cranes, floodlights), `quarry` (dust, rock walls, oil drums), `foundry` (night, fire barrels, smokestacks);
   - chunked along the track for culling.

**Output:**
- `TrackData` holds typed arrays (`pos`, `fwd`, `right`, `up`, `halfWidth`, `curvature`, `line`) plus feature lists.
- The worker transfers them; the client dedupes by `specKey`, with a main-thread fallback (FPS `client.ts`).

**Integrity:**
- `trackHash` is an FNV hash over centimetre integers, guarded by `GENERATOR_VERSION`.
- `golden.json` holds hashes for 30 seeds × 3 lengths.
- Network check: the first client records the hash by transaction; later clients compare, and show a toast on mismatch.

### 3. Race logic (`game/race/`, pure)

- **`locate(pos, hint)`:** searches samples near the last match, with a global grid fallback. Returns the distance along the track and the lateral offset.
- **Progress** (`progress.ts`):
  - race distance `D` changes only through wrapped deltas that are physically possible;
  - laps are counted as `max(lapsDone, floor(D/L))`, so reversing over the line never counts twice;
  - lap times are interpolated within the step;
  - **wrong way:** heading against the track for 1 s, or `D` 8 m below its recent maximum.
- **Respawn** (`respawn.ts`), for wrecks, flips, stuck cars and out of bounds:
  - the car is placed 15 m behind its last valid `D`, mid-road, facing along the track;
  - it is **ghosted for 2 s**: no collisions, no damage taken or dealt.
- **Ranking** (`ranking.ts`):
  - finished cars by finish time, then the rest by distance, with 0.5 m hysteresis so places don't flicker;
  - computes the **diffs**: gaps to the car ahead and behind (difference in `D` ÷ speed, smoothed) and the lap delta;
  - emits overtake and `lapped` events.
- **Clock** (`clock.ts`):
  - the stored phases are `lobby | grid | finishing | results`;
  - `intro`, `countdown` and `racing` are derived from `startAt` and server time;
  - **weapons are locked until GO + 3 s**, so the start isn't a massacre;
  - rocket start: throttle in a window just before GO.
- **End of race** (`results.ts`):
  - DNF deadline: the leader's finish + max(25 s, 25 %), or 6 s after the last human finishes;
  - wins and podiums count for the leaderboard only with at least 2 humans in the race;
  - kills always count.

### 4. Combat (`game/combat/`)

**Turret** (`car/turret.ts`, pure)
- **Aim point:** the crosshair sits at screen centre. Each frame, a ray from the camera through the crosshair finds the aim point (world, or a car's box). The turret slews toward that point at about 400°/s, within pitch −8°…+25°, rotating fully around in yaw. Turret-to-point convergence makes what you aim at what you hit.
- **Aim assist** (`aimAssist.ts`): on by default for gamepad and touch, off for the mouse. Aim slows over targets, with slight magnetism inside 4°.

**Weapons** (`rules/weapons.ts`, `heat.ts`)

| Weapon | How you get it | Behaviour |
| --- | --- | --- |
| **Machine gun** | always | Hitscan at 10 rounds/s with small spread; 4 damage, falling off past 80 m. A heat meter overheats after 3 s of fire, then locks out for 1.5 s. Tracers are cosmetic. |
| **Missiles** | sword pad, 2 per pad, holds up to 4 | Projectile at 70 m/s with a 4 m splash: 35 damage at the centre, plus an impulse that can flip cars. |
| **Armed boost** | sword pad | Machine-gun damage ×1.5 and no overheat for 8 s. |
| **Oil slick** | shield pad (rear defence, one at a time; random kind weighted against your place) | Drops a patch; grip ×0.15 for 1.5 s. |
| **Smoke screen** | shield pad | A 6 s cloud behind you. Blocks aim assist and bot vision; visual fog for others. |
| **Napalm** | shield pad | A 5 s fire patch: 12 damage/s plus a burn after-effect. |
| **Mines** | shield pad | Drops 3, each lasting 30 s. Proximity blast: 30 damage plus an upward impulse. |
| **Armour patch** | shield pad | +25 armour. |

- **Pads** (`rules/pads.ts`): each car has its own local cooldown on each pad (6 s); pads aren't shared claims. Pickups show on the HUD and on the minimap as icons.

**Armour and damage** (`car/damage.ts`, pure)
- Armour is 150 by default (a rule, 75–300). It regenerates 3/s after 6 s without taking damage.
- **Bumps, rams and scrapes** are a full damage source of their own (section 5).
- **Visual damage:** dents and loose panels per zone (section 5), smoke below 50 %, fire below 25 %, sparks on hits.
- **Wreck:** an explosion, the car tumbles as local debris, then a respawn after 3 s (wreck cam on the killer).

**Kill credit** (`rules/killCredit.ts`, pure)
- The last attacker within 5 s gets the kill, whatever the cause: bullets, missiles, a ram, napalm, a mine, oil leading to a barrier hit, or being knocked off the track.
- Kills go to the kill feed (FPS `pushKill`) and to the DIFFED banners.
- Kills refill nitro, and +10 armour.

**Hit authority**, as in the FPS:
- **The shooter decides hits.** Machine-gun rays are tested against the world (Rapier) and against remote cars' **displayed present-time boxes** (pure ray-vs-box in `hitTest.ts`), so what you see is what you hit.
- Missiles are simulated by the shooter, who decides the splash victims.
- Hazards (oil, napalm, mines) are detected by the victim against its own car.
- **The victim applies damage to its own armour, reports its own wreck and names the killer.**

### 5. Car-to-car collisions and crash damage

Cars are solid. They push, spin and flip each other through real Rapier contacts (section 1, with puppets in multiplayer, section 6), and **every hit damages both cars**.

**Measuring the impact** (`carBody.ts` → `collisionDamage.ts`)
- Each step, contact-force events on your car are filtered to car-vs-car pairs (and car-vs-barrier).
- For each pair, the contact point comes from the `contactPair` manifold.
- The impact strength is your car's **velocity change Δv** across the step, minus the expected drive and gravity acceleration.
- The damage maths in `collisionDamage.ts` is pure, taking `(Δv, contact point in car space, flags)`. It is unit-tested without Rapier.

**Damage formula**
- `damage = K × max(0, Δv − 3 m/s)^1.3 × zone × modifiers`, with K ≈ 2.
- Light nudges under about 3 m/s do no damage: just sparks and a thud. Trading paint chips armour. A hard T-bone takes about a third of a car's armour.

| Where your car is hit | Zone factor |
| --- | --- |
| Front (armoured ram plate) | ×0.4 |
| Sides (doors) | ×1.0 |
| Rear | ×1.2 |
| Roof / underside (rollovers, landing on a car) | ×1.0 |

- **Ram modifiers:**
  - the other car on nitro: ×1.3;
  - the other car armed by a sword pad: ×1.2;
  - your car ghosted after respawn: ×0 (ghosted cars pass through).
- **Who rammed whom:** front-armour maths makes the attacker take far less. For example, in a T-bone at 25 m/s closing speed between equal masses, each car gets Δv ≈ 12.5. The victim's side takes about 37 damage; the rammer's front takes about 15. Head-ons are symmetric and hurt both.
- **Scrape** (door-to-door grinding):
  - triggered by sustained contact with sliding speed over 3 m/s;
  - **4 damage/s to both cars** while it lasts, with a spark stream and metal-screech audio;
  - pushing someone into a barrier grinds them twice: once against you, once against the wall.
- **Barriers:** Δv over 10 m/s does ×0.5 of the formula, and only scrapes above 15 m/s, so clean racing isn't punished.
- **Kill credit:** being rammed or scraped makes the other driver your last attacker (5 s window, section 4). A wreck from a ram, a scrape or a shove into a barrier credits them, and shows **DIFFED by Name**.
- **Rule:** `crash` (0–2, default 1) in the room rules. **0** gives "bumper cars" (pushes but no damage); **2** gives demolition-derby carnage.

**Visible damage** (`damage.ts` zone levels + `deform.ts`)
- Each zone (front, rear, left, right, roof) builds up damage levels 0–3 from the hits it takes.
- `deform.ts` dents the car mesh locally: vertices near the contact point are pushed inward, capped per zone.
  - At level 2 the bumper or hood hangs loose.
  - At level 3 that panel detaches as debris.
  - Smoke and fire at low armour.
- **Mild handling effects at level 3:**
  - front: −10 % steering;
  - rear: −5 % top speed;
  - one side: a slight pull.
- These keep a battered car feeling battered. Respawn resets them, and a shield pad's armour patch repairs one level on the worst zone.
- Zone levels travel in the pose (10 bits), so other players see your dents too: each zone's dent is drawn at the zone's centre on remote cars.

**Multiplayer: the ram handshake** (`ramHandshake.ts`, pure)
- Each client is authoritative for **its own** car's damage, as the FPS victim is. It applies damage from its own contacts against the other car's puppet.
- **The problem:** prediction differences can mean one side registers a hit the other missed.
- **The fix:**
  - On any hit over the threshold, your client adds a **bump hint** to its next pose write: the other car's id, the time, Δv, and the zone on the other car. It costs no extra write.
  - A car that sees a hint naming it, but registered no contact of its own with that car within ±200 ms, applies the damage from the hint.
  - Damage is applied **once per pair per 300 ms window**, from whichever comes first: its own contact or the hint. Hits are never double-counted, and one-sided misses still hurt.
- The room owner does the same for bots.

### 6. Netcode (client-authoritative, as in the FPS)

**Pose encoding** (`carCodec.ts`)
- One string leaf `p` of base-36 integers holding:
  - position (cm);
  - orientation quaternion, smallest-three, ×1000;
  - linear velocity (cm/s);
  - angular velocity;
  - turret yaw and pitch;
  - race distance `D`;
  - armour;
  - damage-zone levels (5 × 2 bits);
  - flags: firing, handbrake, nitro, wrecked, ghost, smoke, armed, finished.
- About 100 characters, plus `t` (server ms).
- An optional `b` leaf carries the bump hint (`id.t.dv.zone`), written only after a hard hit.
- Name, colour and finish time are written only when they change.

**Send policy** (`sendPolicy.ts`)
- The sender runs the receivers' predictor on its own last-sent snapshot.
- It sends when the error passes 0.3 m, 0.05 rad, or 2° of turret aim, when flags change, or when 200 ms pass. Capped at 20 Hz; expect an average of about 12–15 Hz.

**Remote cars** (`carTrack.ts`, extending `poseBuffer`)
- Shown at present time by prediction:
  - constant linear and angular velocity, ballistic in the air;
  - stops 300 ms after the last snapshot;
  - each new snapshot is blended in over 100 ms (cubic Hermite for position, slerp for rotation);
  - snaps if the error is over 8 m or the ghost or wrecked flag changes.
- Tracers and muzzle flashes come from the `firing` flag plus turret aim. There are no per-bullet network events.

**Ramming without double push** (`car/puppet.ts`)
- Each remote car has a **dynamic puppet body** of the same mass and shape in your local world. It collides only with local cars.
- Every step the puppet's velocity is set to steer it toward the predicted pose (`v = vPred + (pPred − p)/0.1 s`, angular velocity likewise).
- Contacts with it exchange momentum realistically, so your own car gets a believable share, including PIT spins from off-centre hits. The puppet's deviation is thrown away.
- Each client applies results only to its own car. Both see near-present poses, so the outcome is roughly symmetric.
- Crash damage to yourself comes from your own contacts with puppets, backed by the ram handshake (section 5). Credit goes to the puppet's owner.
- The room owner does the same for bots.

**Damage ledger** (`damageLedger.ts`)
- Writing an event for every bullet would cost far too many writes.
- Instead, each shooter keeps cumulative damage dealt per target, `players/{pid}/d/{targetId}`, and it **rides along in the shooter's normal pose `update()`**, so it costs no extra writes.
- Victims watch every player's `d/{selfId}` and apply the increases (recording a baseline on join or reconnect).
- Damage to bots works the same way, applied by the owner.

**Events** (push, removed by the sender after 3 s, as in the FPS)
- Used only for rare things: `missile` (spawn for everyone's visuals), `boom` (the shooter's splash result: position plus victims and damage), `wreck` (victim, killer, weapon), and `smoke`.
- Kill counts go through FPS `creditKill` transactions.

**Hazards:** `rooms/{code}/hazards/{hid}` holds `{k: oil|napalm|mine, x, y, z, by, until}`.
- Every client renders them; each detects them only against its own car (the owner also for bots).
- Mines are removed by a claim transaction when they go off.

**Race record:** `rooms/{code}/race` is owner-written by `runTransaction`, guarded on race number `n` and phase. It holds:
- `n`, the track spec, laps;
- weapons on/off, armour;
- `startAt = serverNow + 6.5 s`;
- `trackHash`, grid order.

Each finisher writes its own result once to `results/{n}/{pid}`.

**Copied from FPS `network.ts`:**
- presence and onDisconnect;
- reRegister;
- lowest-id owner election;
- `.info/serverTimeOffset`;
- events with a 3 s TTL that start at a new key;
- `sendStatesAs`, so every bot goes in one multi-path write;
- session resume.

**Late joiners and owner handover:**
- Late joiners spectate until the next grid.
- When the owner changes, the new owner rebuilds bots from their last pose and armour.

### 7. Bots, camera, rendering, audio, HUD, input

**Bots**
- **Driving:**
  - `speedProfile.ts`: `vmax = sqrt(aLat/|κ|)`, with backward (braking) and forward (acceleration) passes;
  - `driver.ts`: pure pursuit on the racing line with handbrake use in hairpins;
  - `avoid.ts`: offsets for passing;
  - stuck recovery.
- **`padRouting.ts`:** whether to leave the line for a pad, depending on skill and what the bot already has.
- **`gunner.ts`** (from FPS `bot/aim.ts`):
  - targets the nearest visible car within 90 m, with line of sight raycast and blocked by smoke;
  - leads moving targets;
  - aim error and reaction time set by skill;
  - lets the machine gun cool before overheating;
  - fires missiles at close targets.
- **`botDefences.ts`:** drops a defence when a car is within 25 m behind.
- **Ramming** (in `driver.ts` / `avoid.ts`):
  - hard and expert bots **shove**: side-swipe a car alongside, PIT a car just ahead with a rear-quarter nudge, or push a rival into the barrier when they have the armour advantage;
  - all bots back off from ramming when their own armour is low;
  - easy bots mostly avoid contact.
- **Skills** (easy/normal/hard/expert) set speed, line error, accuracy, reaction time and pad greed. Rubber-banding of 0.92–1.08 based on the gap to the nearest human.
- **Headless sim** (`bot/sim/headless.ts` + `npm run sim:bots`):
  - runs in Node with the compat build, using the same car code and combat rules;
  - fails CI if:
    - a bot doesn't finish;
    - a bot is stuck too long;
    - respawns per lap exceed a limit;
    - expert doesn't beat easy;
    - the wreck rate per lap falls outside a target band.

**Camera** (`chase.ts`, pure)
- An orbit rig 7 m back and 2.8 m up.
- The mouse, right stick or touch drag orbits the camera, and the turret follows the crosshair.
- After 1.5 s without aiming, it recentres behind the car (a setting).
- Extras: FOV kick on nitro, look-back, and shake on hits and rams (a setting).
- `cameraRig.ts` adds the grid intro orbit, the **wreck cam** (2 s on the killer) and spectate cycling.

**Rendering**
- FPS renderer quality tiers. One sun whose shadow frustum follows your car (off on low).
- Night or dusk lighting for `foundry`, with floodlight cards.
- Track meshes chunked by 64 samples:
  - asphalt and an atlas with vertex colours;
  - instanced concrete jersey barriers and fences;
  - glowing pad decals (red sword, blue shield).
- Instanced scenery, with density by quality tier.
- **Phase 1 cars** are procedural low-poly armoured muscle cars: box chassis, bolt-on plates, a roof turret, and per-player colour stripes.
- **Effects:** tyre smoke, skid marks, sparks, muzzle flashes, tracers (instanced line segments), missile trails, explosions, damage smoke and fire, a wreck debris burst.

**Audio** (FPS `audio.ts`)
- Your own engine is synthesised (sawtooth plus square through a lowpass, pitched by RPM through the fake gears).
- Positional engines for the 3 nearest remote cars.
- Gun loops, then a heat whine; missile launches and explosions; metal crunches scaled by impact Δv; a scrape screech loop while grinding; panels clattering off; tyre screech; nitro; pad pickup stingers; countdown beeps.
- Kenney CC0 impact and sci-fi packs for one-shots.

**HUD**
- **`hudStore` fields:**
  - race: place, lap and laps, lap times, lap delta, wrong way, final lap, countdown, results, spectating;
  - combat: armour, heat, missiles, defence slot, armed timer, nitro;
  - feeds: kill feed, DIFFED banners.
- **Bypassing React:** speed, race time, heat and the live diffs are written straight to DOM refs.
- **Crosshair:** FPS `Crosshair.tsx` with hitmarker, plus damage-direction arcs and a health bar over the target under the crosshair.
- **Minimap:** an engine-owned canvas showing cars, pads and hazards.
- **Element IDs for e2e:** `#hud-position`, `#hud-lap`, `#hud-time`, `#hud-speed`, `#hud-diff`, `#hud-lap-delta`, `#hud-armour`, `#hud-heat`, `#hud-weapons`, `#hud-nitro`, `#crosshair`, `#killfeed`, `#diffed`, `#countdown`, `#wrong-way`, `#minimap`, `#results`.

**Input** (`input/router.ts`)
- **The input struct:** every source is merged into a neutral `CarInput`:
  ```
  {throttle, brake, steer, handbrake, nitro, fire, missile, defence, lookBack, aimDX, aimDY}
  ```
  Bots and tests drive the same struct.
- **Merging:** the largest steer wins, throttle is clamped, buttons are OR'd. Presses are latched until the next fixed step.

| Action | Keyboard + mouse | Gamepad (standard mapping) |
| --- | --- | --- |
| Accelerate / brake | W / S | RT / LT |
| Steer | A / D | left stick |
| Handbrake | Space | A |
| Nitro | Shift | L3 or B |
| Aim turret | mouse (pointer lock) | right stick (radial deadzone, response curve, aim assist) |
| Machine gun | LMB | RB |
| Missile | RMB | LB |
| Rear defence | F | X |
| Look back | C | Y |
| Respawn | R | Back |
| Pause | Esc | Start |

- **Keyboard:** bindings are in settings, with swap-on-clash, as in the FPS.
- **Gamepad:** rumble on hits.
- **Touch:**
  - left half: a drag-to-steer pad;
  - right half: drag to aim (FPS touch look);
  - buttons: fire (hold), missile, defence, handbrake, nitro, brake;
  - auto-accelerate on by default; aim assist on.
- **Menus:** `useGamepadNav.ts` lets a gamepad drive them.
- **Inside Discord**, if pointer lock fails, the FPS free-mouse fallback is used.

### 8. Firebase layout and rules

No auth; the rules only validate, as in the FPS. Unknown keys (`$other`) are rejected everywhere.

```
lobby/{code}                      name, mode race|tt, seed, length, theme docks|quarry|foundry, gen, laps 1..9,
                                  weapons bool, armour 75..300, crash 0..2, hostId, createdAt, state,
                                  members{pid:name}, bots{slot:{skill,at}}
rooms/{code}/players/{pid}        name, c, p (≤160, /^[-0-9a-z.]+$/), b? (≤40, same charset: bump hint), t, fin, spec, kills,
                                  d/{targetId}: number ≥ previous, ≤ previous + 2000 (damage ledger)
rooms/{code}/race                 n, phase lobby|grid|finishing|results, spec fields, laps, weapons, armour, crash,
                                  startAt, trackHash, grid{pid:slot}, dnfAt?, endAt?
rooms/{code}/results/{n}/{pid}    name, ms, best ≤ ms, kills 0..50, dnf, bot — write-once
rooms/{code}/hazards/{hid}        k oil|napalm|mine, x/y/z bounded, by, until
rooms/{code}/events/{eid}         k missile|boom|wreck|smoke, by, t, to?, w?, pos/dir?, hits{pid:dmg ≤ 60}?
leaderboard/{profileId}           races +1 exactly, podiums +0..1, wins +0..1 (≤ podium delta), kills +0..50,
                                  score === races*5 + podiums*20 + wins*50 + kills*10
guildboard/{guildId}/{profileId}  same
records/{trackKey}/{profileId}    best lap/total ms ≥ 15 s; may only get faster; indexOn ms
```

- **Rules tests:** every field gets allow/deny cases in `scripts/test-rules.mjs`, using the FPS table format `[desc, path, value, allowed]`.
- **Firebase:** use a **new Firebase project**, or at least a separate RTDB instance. The root `lobby/` and `leaderboard/` paths would collide with the FPS's.
- **Discord:** a **new Discord application**. URL mappings: `/` → Netlify, `/firebase` → RTDB host, `/api` → Netlify functions.

### 9. UI

**Routing:** no router, as in the FPS. `App.tsx` shows `GameView` when there is a session, else `DiscordLobby` when `IN_DISCORD`, else `Lobby`.

**Lobby** (MenuShell tabs):
- **Play:** Quick Race vs 7 bots on the "seed of the day", Time Trial (weapons off), Join by code.
- **Create room:** the CreateWizard, three steps:
  1. Mode: Death Race / Time Trial / Clean Race (no weapons).
  2. Track: seed with 🎲, length, theme, and a `TrackPreview` orbit showing name and hash.
  3. Launch: laps, armour, crash damage (off / normal / carnage), bots, room name.
- **Rooms:** cards showing the track outline.
- **Leaderboard:** global, per-server, per-track records, and most kills.
- **Settings:**
  - controls: keybinds, mouse sensitivity, invert Y, deadzones, aim assist, touch layout, auto-accelerate;
  - video;
  - audio;
  - camera: recentre, shake, FOV kick;
  - units.

**Other screens:**
- `PauseMenu`.
- `Results`: place, time, diff to the winner, kills, best lap, DNF, points.
- `MenuBackdrop`: a 30 fps fly-along of the seed of the day, with parade cars trading tracer fire.

**Style:** one global `style.css` with `:root` variables, as in the FPS. A gritty dark theme with hazard-orange `--accent`. No UI library.

## Risks and mitigations

- **Car feel and stability:** this is the biggest risk.
  - A 1/120 physics step, a lowered centre of mass, anti-roll bars and stability assists.
  - All constants live in `params.ts`, with the `?tune` panel.
  - Node feel tests pin the targets: 0–100, turning circle, slide angle, no rollover at full lock.
  - A play-test gate at the end of Phase 1.
  - If the custom suspension fights back, swap to Rapier's `DynamicRayCastVehicleController` behind the `carBody` interface.
- **Fair hits and rams between clients:**
  - Present-time prediction, with sending driven by prediction error to keep it close.
  - The shooter decides against what it displays (as in the FPS).
  - Equal-mass puppets prevent double push.
  - The ram handshake (bump hints, deduped once per pair per 300 ms) means a hit one side missed still damages, and nothing is counted twice.
  - Ghosting after respawn.
  - Remaining risk: victims sometimes feel hit "around a corner" at high latency. Accepted for a casual game.
- **Firebase cost and limits:**
  - About 15 KB/s per client in a 12-car race.
  - Per-bullet damage rides on pose writes (the damage ledger); events are only for rare things.
  - Bots are batched into one write.
  - About 120–180 writes/s per full room, against a soft limit of about 1,000 writes/s per RTDB instance.
  - Launch on Blaze (Spark allows 100 simultaneous connections). Shard rooms across RTDB instances later if needed.
- **Free aim on touch and gamepad:** aim assist, generous machine-gun spread, and missile splash. Bots are tuned so touch players aren't farmed. Test on a real phone in Phase 2.
- **Discord iframe:**
  - Reuse `patch.ts`: WebSocket shard rewrite, cleared host cache, `forceWebSockets`.
  - Pointer lock may be refused; use the FPS free-mouse fallback.
  - Check that the worker and `.wasm` load through the `/` mapping.
  - Gamepad `SecurityError` falls back to other inputs. No fullscreen.
- **Mobile performance:**
  - Low tier: no shadows, pixel ratio 1, dynamic resolution, 35 % scenery, pooled particles, under 100 draw calls.
  - Only local cars run suspension; puppets are cheap.
  - Profile on a mid-range Android phone in Phase 1.
- **Track generation:**
  - The star-shaped layout can't self-intersect.
  - 24 forked retries, then the stadium fallback.
  - `check-tracks` reports failure reasons and fallback rates, and `--dump SEED` writes PNGs.
  - A `track-hash` e2e runs on chromium, webkit and firefox.
- **Toolchain:**
  - TS 7 is the native compiler, so avoid tools that import `typescript`.
  - Add `rolldown` as an explicit devDependency.
  - Pin Rapier and its compat build to the same version.
  - Copy the FPS lockfile's resolved versions.
  - Typed-array accessors keep `noUncheckedIndexedAccess` noise down.

## Phased delivery (playable after each phase)

**Phase 0: scaffold and tooling**
- `git init`. Copy the configs above, renamed for Diff Race.
- Write:
  - the bootstrap and `App` with a "Test drive" stub;
  - `physics.ts` (with `beforeStep` and contact events);
  - `renderer` and `loop`, `device`, a settings skeleton;
  - `track/rng`, `dmath` and the `fallback` stadium, with basic `trackMesh` and `trackPhysics`;
  - **`carBody` with raycast suspension plus a basic tyre model**;
  - the chase camera, `checks.yml` and `check-arch.mjs`.
- **Exit:**
  - drive a box car round the stadium at 60 fps;
  - `npm test` passes, including Rapier compat car tests (it settles on its suspension and doesn't drift at rest);
  - a Netlify preview loads the wasm;
  - CI is green.

**Phase 1: solo time trial on procedural tracks**
- The full generator: golden hashes, `check-tracks`, worker and client, industrial themes.
- `locate` and `surface`.
- The full car: tyre grip curve, handbrake, nitro, stability assists, air control, auto-righting, ramps, barriers.
- Respawn, `progress` and `clock`.
- HUD: lap, time, speed, diffs (vs ghost-free splits), minimap, countdown, wrong way.
- `InputRouter`: keyboard, mouse orbit camera, gamepad, touch.
- `SettingsPanel`, synth engine audio, a Time Trial wizard with `TrackPreview`, local best laps, `TunePanel`.
- **Exit:**
  - 300 seeds × 3 lengths give 0 invalid tracks and under 0.5 % fallbacks;
  - a 3-lap time trial works on keyboard, gamepad and a real phone;
  - the car feel tests pass;
  - the `time-trial`, `touch`, `gamepad` and `settings` e2e specs pass;
  - **the car-feel play-test passes**.

**Phase 2: Death Race vs bots (the offline vertical slice)**
- **Combat:** turret free aim, crosshair, machine gun with heat, sword and shield pads, missiles, the four defences, armour, wrecks, respawns, kill credit, kill feed, DIFFED banners, wreck cam.
- **Crash damage:** car-to-car bump and ram damage by zone, scrape grinding, barrier damage, dents and detaching panels, level-3 handling effects, the `crash` rule.
- **Bots:** driver, speed profile, gunner, pad routing, defences, skills, rubber-banding.
- **Supporting work:**
  - `sim:bots` in CI;
  - ranking, the position HUD and live diffs;
  - `raceDirector` over `LocalLink`;
  - the Results screen, full sfx, `MenuBackdrop`, car colours.
- **Exit:**
  - Quick Race: 3 laps vs 7 bots with guns, ending on results;
  - `sim:bots` over 20 seeds × 3 lengths passes;
  - the `solo-race`, `laps` and `combat` (offline) e2e specs pass;
  - a touch play-test of aiming passes.

**Phase 3: Firebase multiplayer rooms**
- **Networking:** `firebase.ts`, `roomConnection`, `lobby`, `raceRecord`, `carCodec`, `sendPolicy`, `carTrack`, `remoteCar`, `puppet`, the ram handshake (bump hints), `damageLedger`, `hazards`, the event set.
- **Room play:** `botHost` with handover; spectating for late joiners.
- **Lobby side:** `RoomBrowser`, invites, leaderboard, guildboard, records.
- **Rules and CI:** `database.rules.json`, `test-rules.mjs`, `e2e.yml`, `database-rules.yml`, the multiplayer e2e specs.
- **Exit:**
  - 2 desktops + 1 phone race and fight with bots, and the results and kills agree;
  - the owner leaving mid-race doesn't break it;
  - the rules and e2e suites pass;
  - download is ≤ 20 KB/s per client in a 12-car race.

**Phase 4: Discord Activity**
- `patch.ts`, `discord.ts`, the `discord-token` function, `roomCodeFor(instanceId)`.
- `DiscordLobby` (the host starts the race); `setActivity` ("Diff Race · Lap 2/3 · 3rd · 4 kills", party size).
- Inside Discord: the pointer-lock fallback; touch and low quality by default on mobile.
- `fakeSdk.ts` for e2e; README notes on the URL mappings.
- **Exit:**
  - voice-channel participants on desktop and mobile Discord auto-join the same room and race;
  - the activity status and the per-server leaderboard update;
  - the `discord` specs pass.

**Phase 5: content and polish**
- Kenney Car Kit and industrial props (CC0) through `build-cars.mjs` and `build-props.mjs` (FPS gltf-transform pipeline), with procedural armour plates.
- **Skull trap pads** (track hazards ahead), more weapons (rear flamethrower, ram spikes), an Elimination mode.
- Wreck replays (FPS `replay.ts` pattern), music.
- Colour-blind outlines and a low-end Android performance pass.

## Verification

**Unit tests** (vitest, Node, `__tests__/` folders)

| Area | Tests |
| --- | --- |
| Track generation | rng snapshot; `sinCosTurns` error < 1e-13; spline closure and C1 continuity; resample uniformity; orthonormal frames; `validate` rejects crafted bad tracks; 200 seeds × 3 lengths valid and deterministic; golden hashes; pad and ramp placement; racing line in bounds |
| Car (pure) | spring-damper and anti-roll; tyre grip curve and friction circle; drivetrain curve; nitro; turret slew, limits and aim-point solve; damage (front-armour factor, regeneration) |
| Car (Rapier compat, flat slab) | 0–100 km/h; top speed; turning circle; handbrake slide angle; stopping distance; no rollover at full lock; auto-right within 2 s; puppet bump gives a believable share and no double push |
| Combat | ray-vs-box hits; heat and lockout; missile splash falloff; kill credit (5 s window, environmental kills); aim-assist bounds; pad cooldowns |
| Crash damage (pure) | under 3 m/s does nothing; damage curve; zone factors (front vs side vs rear); nitro and armed modifiers; ghost ×0; scrape rate; barrier thresholds; `crash` rule 0/1/2; zone levels and level-3 handling effects; ram handshake (own contact only, hint only, both → applied once; outside the ±200 ms window → ignored) |
| Crash damage (Rapier compat) | T-bone at 25 m/s: victim side within band, rammer front much less; head-on symmetric; a nudge at 2 m/s gives zero; a door-to-door grind gives the scrape rate to both; push-into-barrier double grind |
| Netcode | `carTrack` prediction, continuity, quaternion blend, out-of-order snapshots; `carCodec` round trip matches the rules regex; `sendPolicy`; `damageLedger` (deltas, baseline on join, monotonic) |
| Race | progress (reverse over the line, teleport clamp, sub-step lap times); respawn and ghosting; ranking and diffs; clock (weapons locked until GO + 3 s); DNF and results |
| Systems | `raceDirector` and the damage flow over `LocalHub` with 3 clients, including owner migration and bot handover |
| Other | bot speed profile and gunner; a 2-seed headless sim; hudStore; settings; input deadzones and edge latching; `chase` convergence |

**e2e** (Playwright against the emulator)
- **Test API** (`window.game.test`): `play`, `state`, `teleportToProgress`, `hold`, `autopilot`, `aimAt(id)`, `fire(ms)`, `giveWeapon`, `dropDefence`, `damage`, `forceFinish`, `skipCountdown`, `freezeBots`, `respawn`.
- **Fixture:** a `race` fixture mirrors the FPS `duel` fixture.
- **Specs:**
  - lobby, create-room, invite, settings;
  - time-trial, solo-race, laps;
  - `race` (two players finish in an agreed order), `track-hash`;
  - `combat`: the machine gun damages the target; a wreck credits the killer and shows DIFFED; respawn and ghosting;
  - pads, hazards;
  - `crash`:
    - Alice rams Bob's side at speed: Bob's armour drops more than Alice's, and both see Bob's side dent;
    - a wreck by ramming credits Alice and shows DIFFED;
    - `crash: 0` gives pushes with no damage;
    - a ghosted car takes none;
  - `ram-handshake`: drop Bob's contact on his side with a test hook, and he still takes the damage exactly once;
  - bots, room-owner, late-join, connection;
  - leaderboard, records;
  - touch, gamepad (stubbed `getGamepads`);
  - discord (`?frame_id=…`, plus a two-player `?fakeDiscord`).
- As in the FPS: wait on state with `expect.poll`, not on time.

**Commands:**
```
npm ci
npm run typecheck            # tsc && tsc -p e2e
npm test                     # vitest (incl. Rapier-compat car feel tests)
npm run test:tracks          # check-tracks --count 100 --golden  (also: -- --dump SEED)
npm run sim:bots -- --seeds 20 --lengths s,m,l --laps 2 --bots 8
npm run check:arch           # file-size budget + pure-folder import boundaries
npm run test:rules           # emulator + scripts/test-rules.mjs
npm run test:e2e             # emulator + Playwright
npm run build && npm run preview
npm run emulator & npm run dev:emu   # local multiplayer in two windows; ?tune, ?touch, ?debug
```

**Manual checks:**
- **Phase 1:** car-feel play-test on keyboard+mouse, gamepad and a real phone.
- **Phase 2:** combat play-test, including touch aiming.
- **Phase 3:** two desktops + one phone in one room.
- **Phase 4:** deploy to Netlify, set the Discord URL mappings, and launch the Activity in a voice channel on desktop and mobile.
- **Browser runs:** use the Claude-in-Chrome tools against the dev server. As in the FPS's `.claude/settings.json`, allow-list the dev ports and the app's `*.discordsays.com` host.
