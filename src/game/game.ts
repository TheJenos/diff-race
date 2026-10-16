import * as THREE from 'three';
import { applyQuality, createRenderer } from './renderer';
import { HudStore } from './hudStore';
import { GROUP, loadPhysics, PhysicsWorld, type RayHit } from './physics';
import { settings, speedIn } from './settings';
import { TOUCH } from './device';
import { DynamicResolution } from './dynamicResolution';
import { gearAt } from './car/drivetrain';
import { InputRouter } from './input/router';
import { neutralInput, type CarInput } from './input/carInput';
import { ChaseCamera, type ChaseTarget } from './camera/chase';
import { Environment } from './world/environment';
import { buildTrackMesh, type TrackMesh } from './world/trackMesh';
import { buildTrackPhysics } from './world/trackPhysics';
import { buildScenery, NightLights, type SceneryMesh } from './world/sceneryMesh';
import { THEMES } from './track/themes';
import type { TrackData } from './track/types';
import { placeOnTrack } from './race/placement';
import { basis } from './math/vec3';
import { formatDelta, formatTime } from './race/clock';
import { Minimap } from './world/minimap';
import { CarSounds } from './sfx';
import { initAudio } from './audio';
import { Effects } from './world/effects';
import { RaceSession, type SessionSetup } from './raceSession';
import { rayBox, type Box } from './combat/rules/hitTest';
import { arm } from './combat/rules/heat';
import type { DefenceKind } from './combat/rules/weapons';
import type { Racer } from './racer';
import { Replay } from './replay';
import { AutoAim } from './autoAim';

/*
 * One race on one track: owns the renderer, the scene, the physics world and the frame loop, and
 * draws what the race session (raceSession.ts) simulates. Kept to orchestration: each system
 * lives in its own module.
 */

export interface GameOptions {
  track: TrackData;
  setup: SessionSetup;
}

/** Live numbers the HUD shows without going through React */
export interface Readouts {
  speed?: HTMLElement | null;
  gear?: HTMLElement | null;
  fps?: HTMLElement | null;
  time?: HTMLElement | null;
  gapAhead?: HTMLElement | null;
  gapBehind?: HTMLElement | null;
  /** The auto-aim lock marker, moved over the locked car */
  lock?: HTMLElement | null;
}

/** `?debug` in the URL: the frame-rate chip also shows draw calls and triangles */
const DEBUG = new URLSearchParams(location.search).has('debug');

/** How far the crosshair's aim reaches (m) */
const AIM_RANGE = 200;
/** Aim assist pulls toward a car this close to the crosshair (rad) */
const ASSIST_CONE = 0.07;

export class Game {
  readonly hud = new HudStore();
  readonly track: TrackData;
  private readonly abort = new AbortController();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2500);
  private readonly chase = new ChaseCamera();
  private readonly timer = new THREE.Timer();
  readonly inputs: InputRouter;
  private input: CarInput = neutralInput();
  /** One-shot buttons (respawn, missile, defence) go to the first physics step of a frame only */
  private oneShotsTaken = false;
  /** Seconds since the player last aimed (the camera swings back behind the car after a while) */
  private sinceAim = 99;
  /** The pause menu toggles when the gamepad's Start is pressed or the pointer is released */
  onPauseRequest: (() => void) | null = null;
  private readonly env: Environment;
  private readonly trackMesh: TrackMesh;
  private readonly scenery: SceneryMesh;
  private readonly effects: Effects;
  private readonly nightLights: NightLights | null;
  private readonly dynamicRes: DynamicResolution | null;
  private readonly minimap: Minimap;
  private physics: PhysicsWorld | null = null;
  session: RaceSession | null = null;
  private sounds: CarSounds | null = null;
  private readouts: Readouts = {};
  private fpsFrames = 0;
  private fpsTime = 0;
  private disposed = false;
  private paused = false;
  /** The turret held on a racer (the e2e tests) */
  private testAim: string | null = null;
  private autoAim: AutoAim | null = null;
  /** The car auto aim has locked onto this frame */
  private locked: Racer | null = null;
  private readonly lockAt = new THREE.Vector3();
  private readonly replay = new Replay();
  private wasWrecked = false;
  private readonly resize: ResizeObserver;
  private readonly unsubSettings: () => void;
  private readonly ray = new THREE.Raycaster();
  private readonly hit: RayHit = { toi: 0, nx: 0, ny: 1, nz: 0, collider: 0 };
  private readonly box: Box = { cx: 0, cy: 0, cz: 0, qx: 0, qy: 0, qz: 0, qw: 1, hx: 1, hy: 1, hz: 1 };

  constructor(private readonly container: HTMLElement, private readonly options: GameOptions) {
    this.track = options.track;
    const quality = settings.get().quality;
    this.renderer = createRenderer(quality);
    container.appendChild(this.renderer.domElement);
    this.env = new Environment(this.scene, THEMES[this.track.theme], quality);
    this.trackMesh = buildTrackMesh(this.track, quality !== 'low');
    this.scene.add(this.trackMesh.group);
    this.scenery = buildScenery(this.track, quality, quality === 'high');
    this.scene.add(this.scenery.group);
    this.effects = new Effects(quality);
    this.scene.add(this.effects.group);
    const night = THEMES[this.track.theme].night;
    this.nightLights = night ? new NightLights(this.scene, this.scenery.floodlights, quality === 'low' ? 2 : 5) : null;
    this.inputs = new InputRouter(this.renderer.domElement, this.abort.signal, () => this.hud.get().phase === 'ready' && !this.paused,
      (locked) => {
        this.hud.update({ locked });
        // Esc while aiming releases the pointer without a keydown reaching the page: treat it as pause.
        if (!locked && !this.paused && !this.session?.player.progress.finished) this.onPauseRequest?.();
      });
    this.inputs.touch.autoAccelerate = settings.get().autoAccelerate;
    this.dynamicRes = TOUCH ? new DynamicResolution({ max: this.renderer.getPixelRatio() }) : null;
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.fit();
    this.unsubSettings = settings.subscribe(() => {
      if (this.disposed) return;
      const s = settings.get();
      applyQuality(this.renderer, s.quality);
      this.env.setQuality(s.quality);
      this.inputs.touch.autoAccelerate = s.autoAccelerate;
    });
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.hud.update({ phase: 'failed', status: 'The graphics driver reset. Reload to keep racing.' });
    }, { signal: this.abort.signal });
    this.minimap = new Minimap(this.track);
    this.hud.update({ trackName: this.track.name, laps: options.setup.rules.laps });
  }

  /** Put the minimap's canvas into the HUD's host element */
  mountMinimap(host: HTMLElement | null): void {
    if (host) host.appendChild(this.minimap.canvas);
    else this.minimap.canvas.remove();
  }

  /** Load the physics engine, build the world, line the cars up on the grid and start the loop. */
  async start(): Promise<void> {
    this.renderer.setAnimationLoop(() => this.frame());
    try {
      await loadPhysics();
    } catch {
      this.hud.update({ phase: 'failed', status: "Couldn't load the physics engine. Check your connection and reload." });
      return;
    }
    if (this.disposed) return;
    const physics = new PhysicsWorld();
    this.physics = physics;
    const colliders = buildTrackPhysics(physics, this.track);
    const session = new RaceSession(physics, this.scene, this.track, this.options.setup, colliders.barriers, this.effects, this.hud,
      () => this.playerInput());
    this.session = session;
    this.autoAim = new AutoAim(physics, session);
    if (THEMES[this.track.theme].night) session.player.car.addHeadlights();
    session.player.car.render(1);
    this.chase.snap(this.chaseTarget(session.player));
    initAudio();
    this.sounds = CarSounds.create();
    this.hud.update({ phase: 'ready', status: '', nitroTank: session.player.car.body.params.nitroTank });
  }

  /** The HUD's live text nodes */
  bindReadouts(r: Readouts): void {
    this.readouts = r;
  }

  /** Freeze the race behind the pause menu (offline modes only: a room race goes on). */
  setPaused(paused: boolean): void {
    this.paused = paused && !this.options.setup.room;
    this.inputs.clear();
    if (paused) this.inputs.mouse.unlock();
  }

  private fit(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.setViewport(h);
  }

  /** The player's input for a physics step; one-shot presses reach only the frame's first step */
  private playerInput(): CarInput {
    if (!this.oneShotsTaken) {
      this.oneShotsTaken = true;
      return this.input;
    }
    return { ...this.input, respawn: false, missile: false, defence: false };
  }

  private chaseTarget(r: Racer): ChaseTarget {
    const fwd = { x: 0, y: 0, z: 0 };
    basis(r.car.view.group.quaternion, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fwd);
    return {
      pos: r.car.position,
      fwd,
      vel: r.car.body.body.linvel(),
      speedRatio: Math.min(1, Math.abs(r.car.body.speed) / r.car.body.params.topSpeed),
      nitro: r.car.body.nitroActive,
      lookBack: r === this.session?.player && this.input.lookBack,
    };
  }

  private frame(): void {
    this.timer.update();
    const frameTime = this.timer.getDelta();
    const dt = Math.min(frameTime, 0.05);
    if (this.dynamicRes) {
      const ratio = this.dynamicRes.update(frameTime * 1000);
      if (ratio !== null) this.renderer.setPixelRatio(ratio);
    }
    const session = this.session;
    const physics = this.physics;
    if (session && physics) {
      this.input = this.inputs.read(dt);
      this.oneShotsTaken = false;
      if (this.inputs.pause) this.onPauseRequest?.();
      const alpha = this.paused ? 1 : physics.update(dt);
      session.racers.eye.x = this.camera.position.x;
      session.racers.eye.z = this.camera.position.z;
      session.frame(this.paused ? 0 : dt, alpha);
      this.effects.update(this.paused ? 0 : dt);
      this.aim(dt);
      const player = session.player;
      const now = performance.now() / 1000;
      // The player just got wrecked: replay it (if the setting's on).
      if (player.wrecked && !this.wasWrecked && settings.get().replays && this.replay.start(now, player)) {
        this.hud.update({ replay: true });
      }
      this.wasWrecked = player.wrecked;
      if (this.replay.active) {
        if (this.input.respawn || this.input.fire || this.input.throttle || !player.wrecked || !this.replay.apply(dt, this.camera)) {
          this.replay.stop();
          this.hud.update({ replay: false });
        } else {
          this.drawLock(null);
          this.renderer.render(this.scene, this.camera);
          this.countFps(frameTime);
          return;
        }
      }
      this.replay.record(now, session.racers.list);
      // Wrecked: the camera watches whoever did it; knocked out of an Elimination race, the leader.
      const watch = player.wrecked ? (session.wreckCam && !session.wreckCam.wrecked ? session.wreckCam : session.spectating() ?? player) : player;
      this.chase.update(this.chaseTarget(watch), dt);
      this.camera.position.set(this.chase.pos.x, this.chase.pos.y, this.chase.pos.z);
      this.camera.lookAt(this.chase.look.x, this.chase.look.y, this.chase.look.z);
      const fov = this.chase.fov + (settings.get().fov - 72);
      if (Math.abs(this.camera.fov - fov) > 0.05) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      const held = this.testAim ? session.racers.get(this.testAim) : undefined;
      const auto = !held && !player.wrecked && settings.get().autoAim && this.options.setup.rules.weapons;
      this.locked = auto && this.autoAim ? this.autoAim.update(player, this.camera, dt) : null;
      const target = held ?? this.locked;
      if (!player.wrecked) player.aim = target ? { x: target.car.position.x, y: target.car.position.y + 0.3, z: target.car.position.z } : this.aimPoint(player);
      this.drawLock(player.progress.finished ? null : this.locked);
      this.env.follow(player.car.position, this.camera);
      this.nightLights?.update(player.car.position);
      this.writeReadouts(session);
      this.sounds?.update(player.car.body, player.input.throttle, dt);
    } else {
      // Loading: a slow orbit over the start line.
      const g = this.track.grid[0]!;
      const p = { x: 0, y: 0, z: 0 };
      placeOnTrack(this.track, g.s, 0, p, { x: 0, y: 0, z: 0, w: 1 }, 0);
      const a = performance.now() / 6000;
      this.camera.position.set(p.x + Math.cos(a) * 30, p.y + 12, p.z + Math.sin(a) * 30);
      this.camera.lookAt(p.x, p.y, p.z);
      this.env.follow(new THREE.Vector3(p.x, p.y, p.z), this.camera);
    }
    this.renderer.render(this.scene, this.camera);
    this.countFps(frameTime);
  }

  /** The player's aim orbits the camera; left alone for a while, it swings back behind the car. */
  private aim(dt: number): void {
    const c = this.chase;
    const r = this.inputs;
    if (r.aimed) {
      this.sinceAim = 0;
      c.aimYaw -= r.aimX;
      c.aimPitch = Math.max(-0.3, Math.min(0.55, c.aimPitch + r.aimY));
    } else {
      this.sinceAim += dt;
      if (settings.get().recentre && this.sinceAim > 1.5) {
        const k = 1 - Math.exp(-2.5 * dt);
        c.aimYaw = Math.atan2(Math.sin(c.aimYaw), Math.cos(c.aimYaw)) * (1 - k);
        c.aimPitch += (0 - c.aimPitch) * k;
      }
    }
  }

  /**
   * Where the crosshair points: the first thing a ray from the camera through the screen's centre
   * meets (the track, a barrier, a car). On gamepad and touch, aim assist pulls it onto a car near
   * the crosshair.
   */
  private aimPoint(player: Racer): { x: number; y: number; z: number } {
    const session = this.session!;
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    // Start the ray past the player's own car.
    const skip = Math.max(0, this.chase.pos.y > 0 ? o.distanceTo(player.car.position) - 1.5 : 0);
    const start = { x: o.x + d.x * skip, y: o.y + d.y * skip, z: o.z + d.z * skip };
    let range = AIM_RANGE;
    if (this.physics!.castRay(start, d, range, GROUP.WORLD | GROUP.BARRIER, this.hit)) range = this.hit.toi;
    let best: { x: number; y: number; z: number } | null = null;
    const assist = settings.get().aimAssist && this.inputs.lastDevice !== 'keyboard';
    let bestAngle = ASSIST_CONE;
    for (const r of session.racers.list) {
      if (r === player || r.wrecked) continue;
      const t = rayBox(start, d, range, session.racers.boxOf(r, this.box));
      if (t !== null && t < range) {
        range = t;
        best = null;
      }
      if (assist) {
        const p = r.car.position;
        const to = new THREE.Vector3(p.x - o.x, p.y + 0.3 - o.y, p.z - o.z);
        const dist = to.length();
        const angle = to.angleTo(d);
        if (dist < 120 && angle < bestAngle) {
          bestAngle = angle;
          best = { x: p.x, y: p.y + 0.3, z: p.z };
        }
      }
    }
    return best ?? { x: start.x + d.x * range, y: start.y + d.y * range, z: start.z + d.z * range };
  }

  /** The lock marker over the car auto aim is on (hidden with none, or when it's behind the camera) */
  private drawLock(target: Racer | null): void {
    const el = this.readouts.lock;
    if (!el) return;
    const v = this.lockAt;
    if (target) v.set(target.car.position.x, target.car.position.y + 0.5, target.car.position.z).project(this.camera);
    const show = target !== null && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    el.hidden = !show;
    if (!show) return;
    const canvas = this.renderer.domElement;
    el.style.transform = `translate(${((v.x + 1) / 2) * canvas.clientWidth}px, ${((1 - v.y) / 2) * canvas.clientHeight}px) translate(-50%, -50%)`;
  }

  private writeReadouts(session: RaceSession): void {
    const r = this.readouts;
    const car = session.player.car.body;
    if (r.speed) r.speed.textContent = String(Math.round(speedIn(car.speed)));
    if (r.gear) r.gear.textContent = car.speed < -0.5 ? 'R' : String(gearAt(car.speed).gear);
    const p = session.player.progress;
    if (r.time) r.time.textContent = formatTime(p.finished ? (p.finishTime ?? 0) : Math.max(0, session.clock.raceTime));
    if (r.gapAhead || r.gapBehind) {
      const g = session.gaps();
      if (r.gapAhead) r.gapAhead.textContent = g.ahead === null ? '' : formatDelta(-g.ahead);
      if (r.gapBehind) r.gapBehind.textContent = g.behind === null ? '' : formatDelta(g.behind);
    }
    this.hud.update({ nitro: Math.round(car.nitro * 20) / 20, nitroActive: car.nitroActive });
    this.minimap.draw(performance.now(), session.racers.list.filter((x) => !x.wrecked).map((x) => {
      const fwd = { x: 0, y: 0, z: 0 };
      if (x === session.player) basis(x.car.view.group.quaternion, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fwd);
      return {
        x: x.car.position.x, z: x.car.position.z,
        color: x === session.player ? '#ff7a1a' : `#${x.color.toString(16).padStart(6, '0')}`,
        self: x === session.player, fx: fwd.x, fz: fwd.z,
      };
    }));
  }

  /** Where damage came from, as an angle round the screen (0: ahead) for the HUD's damage arc */
  hurtAngle(): number | null {
    const from = this.session?.hurtFrom;
    if (!from) return null;
    const c = this.camera.position;
    const yaw = Math.atan2(from.x - c.x, from.z - c.z);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const cam = Math.atan2(dir.x, dir.z);
    return Math.atan2(Math.sin(cam - yaw), Math.cos(cam - yaw));
  }

  private countFps(frameTime: number): void {
    this.fpsFrames++;
    this.fpsTime += frameTime;
    if (this.fpsTime >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      if (this.readouts.fps) {
        // ?debug adds what the frame cost the GPU: draw calls and triangles.
        const info = this.renderer.info.render;
        this.readouts.fps.textContent = DEBUG ? `${fps} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris` : `${fps} fps`;
      }
      this.stats = { fps, draws: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  /** The last half-second's frame rate and the last frame's draw calls and triangles */
  stats = { fps: 0, draws: 0, triangles: 0 };

  /** What the end-to-end tests drive (exposed as window.game in dev and e2e builds only). */
  get test() {
    const session = () => this.session;
    const player = () => this.session?.player ?? null;
    return {
      /** Hold these inputs (merged with the keyboard) until changed */
      hold: (input: Partial<CarInput>) => { this.inputs.test = { ...neutralInput(), ...input }; },
      release: () => { this.inputs.test = neutralInput(); },
      state: () => {
        const p = player();
        const t = p?.car.body.body.translation();
        return {
          phase: this.hud.get().phase,
          speed: p?.car.body.speed ?? 0,
          grounded: p?.car.body.grounded ?? 0,
          s: p?.loc.s ?? 0,
          u: p?.loc.u ?? 0,
          pos: t ? { x: t.x, y: t.y, z: t.z } : null,
          trackHash: this.track.hash,
          armour: p?.damage.armour ?? 0,
          wrecked: p?.wrecked ?? false,
          kills: p?.kills ?? 0,
          /** The car auto aim is locked onto */
          locked: this.locked?.id ?? null,
          place: this.hud.get().place,
        };
      },
      teleport: (s: number, u = 0) => {
        const p = player();
        if (p) this.session!.racers.respawn(p, performance.now() / 1000, false);
        if (p) { this.session!.racers.place(p, s, u); p.ghostUntil = 0; p.car.body.setGhost(false); }
      },
      /** Put the car at race distance D as if it had driven there (laps already done stay done) */
      teleportToProgress: (D: number, u = 0) => {
        const p = player();
        if (!p) return;
        const L = this.track.lapLength;
        this.session!.racers.place(p, D, u);
        p.progress.D = D;
        p.progress.maxD = Math.max(p.progress.maxD, D);
        p.progress.lastS = ((D % L) + L) % L;
        p.progress.lostFor = 0;
      },
      race: () => {
        const p = player()?.progress;
        return p ? { D: p.D, lapsDone: p.lapsDone, lapTimes: [...p.lapTimes], finished: p.finished, wrongWay: p.wrongWay, phase: this.session!.clock.phase } : null;
      },
      racers: () => session()?.racers.list.map((r) => ({
        id: r.id, name: r.name, bot: r.isBot, armour: r.damage.armour, wrecked: r.wrecked, kills: r.kills, D: r.progress.D,
        pos: { x: r.car.position.x, y: r.car.position.y, z: r.car.position.z },
        levels: { ...r.damage.levels },
      })) ?? [],
      /** Put bot `id` at (s, u) on the track, ghost-free */
      placeRacer: (id: string, s: number, u = 0) => {
        const r = session()?.racers.get(id);
        if (!r) return;
        session()!.racers.place(r, s, u);
        r.ghostUntil = 0;
        r.car.body.setGhost(false);
      },
      freezeBots: (on: boolean) => { if (this.session) this.session.bots.frozen = on; },
      give: (what: 'missiles' | 'armed' | DefenceKind) => {
        const p = player();
        if (!p) return;
        if (what === 'missiles') p.missiles = 4;
        else if (what === 'armed') arm(p.gun);
        else p.defence = what;
      },
      /** Damage a racer (the player when no id) as if `by` hit it */
      damage: (amount: number, id?: string, by?: string) => {
        const s = session();
        const r = id ? s?.racers.get(id) : player();
        if (s && r) s.racers.hurt(r, amount, 'left', by ? s.racers.get(by) ?? null : null, 'gun', performance.now() / 1000);
      },
      /** Hold the turret on racer `id` (null: back to the crosshair) */
      aimAt: (id: string | null) => { this.testAim = id; },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.abort.abort();
    this.resize.disconnect();
    this.unsubSettings();
    this.inputs.clear();
    this.inputs.mouse.unlock();
    this.sounds?.dispose();
    this.session?.dispose();
    this.physics?.dispose();
    this.trackMesh.dispose();
    this.scenery.dispose();
    this.effects.dispose();
    this.nightLights?.dispose();
    this.env.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
