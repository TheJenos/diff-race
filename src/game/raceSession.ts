import * as THREE from 'three';
import type { PhysicsWorld } from './physics';
import type { HudStore, StandingRow } from './hudStore';
import { Racers, type RaceRules } from './racers';
import type { Racer } from './racer';
import { Combat } from './combat/combat';
import { BotHost } from './bot/botHost';
import { botLineup } from './bot/roster';
import type { BotSkill } from './bot/skills';
import { clockAt, COUNTDOWN_MS, formatTime, type ClockState } from './race/clock';
import { INTRO_MS } from './race/localRace';
import { displayLap } from './race/progress';
import { gapSeconds, rank, type Standing } from './race/ranking';
import { WEAPONS_HOT_AFTER, type DefenceKind } from './combat/rules/weapons';
import type { DamageSource } from './car/damage';
import { neutralInput, type CarInput } from './input/carInput';
import type { Effects } from './world/effects';
import type { TrackData } from './track/types';
import { bestFor, saveTimes } from './records';
import * as sfx from './sfx';
import { Music } from './music';
import type { RoomConnection } from '../net/room';
import type { PlayerRecord } from '../net/records';
import { NetSync } from './netSync';
import { currentProfileId, recordRace } from '../net/leaderboard';
import { setDiscordActivity } from '../discord/discord';
import { IN_DISCORD } from '../discord/patch';

/*
 * One race on this client: the player and the bots on the grid, the clock, weapons and pads,
 * standings, the kill feed and the DIFFED banners. The Game owns the renderer and the loop; this
 * owns what happens in the race. (Offline every car is simulated here; in a room, other players'
 * cars arrive over the network.)
 */

export interface SessionSetup {
  rules: RaceRules;
  countdown: boolean;
  bots: number;
  botSkill: BotSkill | 'mixed';
  playerName: string;
  color: number;
  stripe: number;
  /** Racing in a room (otherwise offline, every car simulated here) */
  room?: RoomSetup;
}

/** One car on a room's grid */
export interface GridEntry {
  id: string;
  name: string;
  /** Index into PAINTS (records carry it as `c`) */
  paint: number;
  color: number;
  stripe: number;
  /** Bots' skill (null: a player) */
  bot: BotSkill | null;
  slot: number;
}

export interface RoomSetup {
  conn: RoomConnection;
  /** Race number, and when the lights go green (server ms) */
  n: number;
  startAt: number;
  grid: GridEntry[];
}

const WEAPON_NAMES: Record<DamageSource, string> = {
  gun: 'guns', missile: 'missile', ram: 'ram', scrape: 'grind', barrier: 'wall', napalm: 'napalm', mine: 'mine', fall: 'knocked off',
};
const DEFENCE_NAMES: Record<DefenceKind, string> = { oil: 'Oil slick', smoke: 'Smoke screen', napalm: 'Napalm', mines: 'Mines', flame: 'Flamethrower' };

/** Time after the winner (s, at least) before the rest are called DNF */
const DNF_GRACE = 25;
/** A remote car whose record is gone is shown wrecked (it left) */
const FLAG_GONE = 4;

export class RaceSession {
  readonly racers: Racers;
  readonly combat: Combat;
  readonly bots: BotHost;
  readonly clock: ClockState = { phase: 'intro', count: null, raceTime: 0 };
  readonly startAt: number;
  readonly player: Racer;
  private order: string[] = [];
  private readonly debris: { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private readonly held: CarInput = { ...neutralInput(), brake: 1, handbrake: true };
  private readonly coast: CarInput = { ...neutralInput(), brake: 0.25 };
  private bestLapBefore: number | null;
  private lastCount: number | null = null;
  private lapsBehind = 0;
  /** Where the last hit on the player came from (world), for the damage arc */
  hurtFrom: { x: number; z: number } | null = null;
  /** The racer whose wreck cam the camera shows (the player's killer), while the player is wrecked */
  wreckCam: Racer | null = null;
  private over = false;
  private finalRows: StandingRow[] | null = null;
  readonly net: NetSync | null = null;
  /** The clock everything in the race runs on (ms): the server's in a room, ours offline */
  private readonly now: () => number;
  private called = false;
  private presenceAt = -Infinity;
  private readonly music = Music.create();

  constructor(
    physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly track: TrackData,
    readonly setup: SessionSetup,
    barriers: ReadonlySet<number>,
    private readonly effects: Effects,
    private readonly hud: HudStore,
    private readonly playerInput: () => CarInput,
  ) {
    const room = setup.room;
    this.now = room ? () => room.conn.serverNow() : () => performance.now();
    const now = this.now();
    this.startAt = room ? room.startAt : setup.countdown ? now + INTRO_MS + COUNTDOWN_MS : now;
    let combat: Combat | null = null;
    this.racers = new Racers(physics, track, setup.rules, barriers, {
      hurt: (victim, attacker) => this.onHurt(victim, attacker),
      wrecked: (victim, killer, source) => this.onWreck(victim, killer, source),
      respawned: (r) => { if (r === this.player) this.wreckCam = null; },
      lap: (r, n, time) => { if (r === this.player) this.onLap(n, time); },
      finished: (r) => {
        if (r === this.player) this.onPlayerFinish();
        if (room) this.writeResult(r, false);
      },
    }, (x, z) => combat?.surfaceAt(x, z) ?? null, this.now);
    if (room) {
      // The room's grid: our car and (if we own the room) the bots run here, the rest arrive over the network.
      const owner = room.conn.isOwner;
      for (const g of [...room.grid].sort((a, b) => a.slot - b.slot)) {
        const local = g.id === room.conn.playerId || (g.bot !== null && owner);
        this.racers.add(g.id, g.name, g.color, g.stripe, g.slot, g.bot, !local);
      }
      if (!this.racers.player) throw new Error('Not on the grid');
      this.player = this.racers.player;
    } else {
      // The player starts at the back of the grid; the bots ahead.
      const lineup = botLineup(setup.bots, setup.botSkill);
      lineup.forEach((b, i) => this.racers.add(`b_${i}`, b.profile.name, b.profile.color, b.profile.stripe, i, b.skill));
      this.player = this.racers.add('me', setup.playerName, setup.color, setup.stripe, lineup.length, null);
    }
    for (const r of this.racers.list) scene.add(r.car.view.group);
    combat = new Combat(physics, track, this.racers, effects, {
      hit: (shooter) => {
        if (shooter === this.player) {
          this.hud.update({ hits: this.hud.get().hits + 1 });
          sfx.hitTick();
        }
      },
      fired: (shooter) => sfx.gunBurst(this.volumeAt(shooter)),
      missile: (shooter) => sfx.missileLaunch(this.volumeAt(shooter)),
      explosion: (x, _y, z, size) => sfx.explosion(this.volumeAtPoint(x, z) * Math.min(1, size / 4)),
      pickup: (r, kind, defence, spikes) => {
        if (r !== this.player) return;
        sfx.pickup(kind === 'shield' ? 'shield' : kind === 'gun' ? 'gun' : 'sword');
        if (kind === 'gun') this.hud.announce('GUNS', `${r.gun.ammo} rounds loaded`, 'pickup', 1400);
        else if (kind === 'skull') this.hud.announce('TRAP SPRUNG', 'a wall of fire on the road ahead', 'pickup', 1600);
        else if (kind === 'sword') this.hud.announce(spikes ? 'RAM SPIKES' : 'ARMED', spikes ? '+2 missiles · spiked ram' : '+2 missiles · guns hot', 'pickup', 1400);
        else this.hud.announce('SHIELDED', `${DEFENCE_NAMES[defence!]} · armour patched`, 'pickup', 1400);
      },
      dropped: (r, kind) => { if (r === this.player) this.hud.toast(DEFENCE_NAMES[kind]); },
    }, (r) => this.order.indexOf(r.id) + 1 || this.racers.list.length);
    this.combat = combat;
    scene.add(combat.group);
    this.bots = new BotHost(physics, track, this.racers, combat);
    this.bestLapBefore = bestFor(track.spec).lap;
    if (room) {
      this.net = new NetSync(room.conn, room.n, this.racers, combat, {
        wrecked: (victim, killer, source) => this.showWreck(victim, killer, source),
      }, () => this.nowS);
      void this.net.start();
      if (room.conn.isOwner) {
        const bots = new Map<string, PlayerRecord>();
        for (const g of room.grid) if (g.bot) bots.set(g.id, { name: g.name, c: g.paint, n: room.n, k: 0 });
        if (bots.size) void room.conn.adoptBots(bots);
      }
    }
    physics.onBeforeStep((dt) => this.before(dt));
    physics.onStep((dt) => this.after(dt));
    this.hud.update({ cars: this.racers.list.length, laps: setup.rules.laps, bestLap: this.bestLapBefore, armourMax: setup.rules.armour });
  }

  private get nowS(): number {
    return performance.now() / 1000;
  }

  private get racing(): boolean {
    return this.clock.phase === 'racing';
  }

  private inputFor(r: Racer): CarInput {
    if (!this.racing) return this.held;
    if (r.progress.finished) return this.coast;
    return r === this.player ? this.playerInput() : r.brain!.input;
  }

  private before(dt: number): void {
    clockAt(this.now(), this.startAt, this.clock);
    this.combat.hot = this.setup.rules.weapons && this.racing && this.clock.raceTime > WEAPONS_HOT_AFTER;
    this.bots.think(dt, this.nowS, this.racing);
    this.racers.before(dt, (r) => this.inputFor(r));
  }

  private after(dt: number): void {
    const now = this.nowS;
    this.racers.after(dt, now, this.clock.raceTime, this.racing);
    this.combat.fixed(dt, now);
  }

  // ---------------------------------------------------------------- events

  private onHurt(victim: Racer, attacker: Racer | null): void {
    if (victim === this.player) {
      this.hud.update({ hurt: this.hud.get().hurt + 1 });
      if (attacker) {
        const t = attacker.car.body.body.translation();
        this.hurtFrom = { x: t.x, z: t.z };
      }
    }
  }

  /** One of our cars was wrecked: tell the room, and show it */
  private onWreck(victim: Racer, killer: Racer | null, source: DamageSource): void {
    this.net?.announceWreck(victim, killer, source);
    this.showWreck(victim, killer, source);
  }

  /** A wreck, ours or someone else's: the blast, the feed, the banners */
  private showWreck(victim: Racer, killer: Racer | null, source: DamageSource): void {
    const t = victim.car.view.group.position;
    this.combat.blast(t.x, t.y, t.z, 5);
    for (let k = 0; k < 14; k++) this.effects.emit(t.x, t.y + 0.6, t.z, (Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4, 1, 0.5, 0.12, 1.6, 0.8, 0.9, 1.5);
    const how = WEAPON_NAMES[source];
    if (killer) {
      const you = victim === this.player || killer === this.player;
      this.hud.pushFeed(`${killer.name} ✕ ${victim.name} · ${how}`, you ? 'you' : 'kill');
    } else {
      this.hud.pushFeed(`${victim.name} wrecked · ${how}`, victim === this.player ? 'you' : 'info');
    }
    if (victim === this.player) {
      this.wreckCam = killer;
      this.hud.update({ wreckedBy: killer?.name ?? null });
      if (this.setup.rules.elimination) this.hud.announce('ELIMINATED', killer ? `diffed by ${killer.name} · ${how}` : how, 'diffed', 3200);
      else this.hud.announce(killer ? 'DIFFED' : 'WRECKED', killer ? `by ${killer.name} · ${how}` : how, 'diffed', 2800);
      sfx.diffedSting();
    } else if (killer === this.player) {
      this.hud.announce('YOU DIFFED', `${victim.name} · ${how}`, 'diffing', 2200);
      sfx.killSting();
    }
  }

  private onLap(n: number, time: number): void {
    const p = this.player.progress;
    const best = Math.min(...[this.bestLapBefore, ...p.lapTimes.slice(0, -1)].filter((v): v is number => v !== null));
    const delta = Number.isFinite(best) ? time - best : null;
    sfx.lapChime(delta !== null && delta < 0);
    saveTimes(this.track.spec, time, null, this.setup.rules.laps);
    const laps = this.setup.rules.laps;
    if (laps && n === laps - 1) this.hud.toast('Final lap', 2200);
    else if (!laps || n < laps) this.hud.toast(`Lap ${n}  ${formatTime(time)}`, 2200);
    this.hud.update({ lapTimes: [...p.lapTimes], lapDelta: delta });
  }

  private onPlayerFinish(): void {
    const p = this.player.progress;
    const total = p.finishTime ?? 0;
    const bestLap = Math.min(...p.lapTimes);
    const fresh = saveTimes(this.track.spec, bestLap, total, this.setup.rules.laps);
    this.hud.update({ results: { total, lapTimes: [...p.lapTimes], bestLap, newLap: fresh.lap, newTotal: fresh.total } });
  }

  // ---------------------------------------------------------------- every frame

  frame(dt: number, alpha: number): void {
    const now = this.nowS;
    this.racers.render(alpha, now);
    this.combat.frame(dt, now);
    this.debrisFrame(dt);
    for (const r of this.racers.list) {
      if (r.wrecked) continue;
      this.effects.fromCar(r.car.body, dt);
      // Damaged cars smoke, badly damaged ones burn.
      const k = r.damage.armour / r.damage.max;
      if (k < 0.5 && Math.random() < dt * (k < 0.25 ? 26 : 12)) {
        const g = r.car.view.group;
        const front = new THREE.Vector3(0, 0.5, -1.4).applyQuaternion(g.quaternion).add(g.position);
        if (k < 0.25) this.effects.emit(front.x, front.y, front.z, 0, 2, 0, 1, 0.5, 0.1, 0.7, 0.45, 0.9, 1.2);
        this.effects.emit(front.x, front.y + 0.3, front.z, 0, 1.6, 0, 0.18, 0.17, 0.16, 0.9, 1.6, 0.55, 1.8);
      }
    }
    if (this.clock.count !== this.lastCount && this.clock.count !== null) sfx.countdownBeep(this.clock.count);
    this.lastCount = this.clock.count;
    this.score();
    this.takeOverBots();
    this.net?.frame();
    this.standings();
  }

  /** The owner left mid-race and the room picked us: the bots run here from now on */
  private takeOverBots(): void {
    const room = this.setup.room;
    if (!room || !room.conn.isOwner) return;
    const promoted = new Map<string, PlayerRecord>();
    for (const g of room.grid) {
      const r = g.bot ? this.racers.get(g.id) : undefined;
      if (!r || !r.remote || !g.bot) continue;
      this.racers.promote(r, g.bot, this.nowS);
      promoted.set(g.id, { name: g.name, c: g.paint, n: room.n, k: r.kills });
    }
    if (promoted.size) {
      void room.conn.adoptBots(promoted);
      this.hud.pushFeed('You took over the bots', 'info');
    }
  }

  /** The music follows the race: a pulse on the grid, the full loop racing, everything on the final lap, gone at the end */
  private score(): void {
    const m = this.music;
    if (!m) return;
    const p = this.player.progress;
    const laps = this.setup.rules.laps;
    if (p.finished || this.player.out || this.over) {
      m.stop();
      return;
    }
    m.start();
    m.setIntensity(!this.racing ? 0 : laps > 1 && p.lapsDone >= laps - 1 ? 2 : 1);
  }

  /** A car of ours is done (finished, or out of time): its line in the room's results */
  private writeResult(r: Racer, dnf: boolean): void {
    const room = this.setup.room;
    if (!room || r.remote) return;
    const p = r.progress;
    void room.conn.writeResult(room.n, r.id, {
      name: r.name, k: r.kills,
      ...(dnf || p.finishTime === null ? { dnf: true } : { ms: Math.round(p.finishTime * 1000) }),
      ...(p.lapTimes.length ? { best: Math.round(Math.min(...p.lapTimes) * 1000) } : {}),
      ...(r.isBot ? { bot: true } : {}),
    });
  }

  /**
   * The room owner calls the race: once every car is home (or gone), or the stragglers have had
   * long enough after the winner. The unfinished are DNF; everyone's standings go final.
   */
  private callRace(leaderTime: number | null): void {
    const room = this.setup.room;
    if (!room || this.called || !room.conn.isOwner || this.setup.rules.laps <= 0) return;
    const list = this.racers.list;
    const done = (r: Racer) => r.progress.finished || r.out || (r.remote && (r.snap.flags & FLAG_GONE) !== 0 && !room.conn.players.has(r.id) && !room.conn.bots.has(r.id));
    const all = list.every(done);
    const late = leaderTime !== null && this.clock.raceTime > leaderTime + Math.max(DNF_GRACE, leaderTime * 0.25);
    if (!all && !late) return;
    this.called = true;
    for (const r of list) if (!r.progress.finished && r.local) this.writeResult(r, true);
    void room.conn.mutateRace((race) => {
      if (race.n !== room.n || race.phase !== 'grid') return false;
      race.phase = 'results';
      race.endAt = room.conn.serverNow();
      return true;
    }).then(() => room.conn.setRacing(false));
  }

  private debrisFrame(dt: number): void {
    for (const r of this.racers.list) {
      for (const d of r.car.view.debris.splice(0)) {
        this.scene.add(d.mesh);
        this.debris.push(d);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.life -= dt;
      d.vel.y -= 16 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < this.track.killY + 8) d.vel.set(0, 0, 0);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Places, gaps, the player's numbers and the standings table */
  private standings(): void {
    const list = this.racers.list;
    this.lastOneStanding();
    const stand: Standing[] = list.map((r) => ({ id: r.id, D: r.progress.D, finishTime: r.progress.finishTime, speed: Math.abs(r.car.body.speed), outAt: r.out ? r.outAt : null }));
    this.order = rank(stand, this.order);
    const p = this.player;
    const place = this.order.indexOf(p.id) + 1;
    const laps = this.setup.rules.laps;
    // Lapped: someone a whole lap further round than the player.
    let lead = 0;
    for (const r of list) if (r !== p) lead = Math.max(lead, r.progress.D - p.progress.D);
    const behind = Math.floor(lead / this.track.lapLength);
    if (behind > this.lapsBehind && !p.progress.finished) this.hud.announce('LAPPED', 'massive diff', 'lapped', 2000);
    this.lapsBehind = behind;

    const winner = list.find((r) => r.id === this.order[0]);
    const leaderTime = winner?.progress.finishTime ?? null;
    const room = this.setup.room;
    if (room) {
      // In a room the owner calls it; everyone goes final together.
      this.callRace(leaderTime);
      const race = room.conn.view().race;
      if (!this.over && race && race.n === room.n && race.phase === 'results') this.over = true;
    } else if (!this.over && laps > 0) {
      const all = list.every((r) => r.progress.finished || r.out);
      const late = leaderTime !== null && this.clock.raceTime > leaderTime + Math.max(DNF_GRACE, leaderTime * 0.25);
      if (all || late) this.over = true;
    }
    const rows: StandingRow[] = this.finalRows ?? this.order.map((id) => {
      const r = list.find((x) => x.id === id)!;
      const time = r.progress.finishTime;
      return {
        id, name: r.name, color: `#${r.color.toString(16).padStart(6, '0')}`, self: r === p, time,
        diff: time !== null && leaderTime !== null ? time - leaderTime : null,
        bestLap: r.progress.lapTimes.length ? Math.min(...r.progress.lapTimes) : null,
        kills: r.kills, laps: r.progress.lapsDone, dnf: this.over && time === null && !r.out, out: r.out,
      };
    });
    if (this.over && !this.finalRows) {
      this.finalRows = rows;
      this.recordOnBoard(rows);
    }
    if (IN_DISCORD && this.clock.raceTime - this.presenceAt > 15) {
      this.presenceAt = this.clock.raceTime;
      const humans = list.filter((r) => !r.isBot).length;
      setDiscordActivity({
        details: `Death Race · ${this.track.name}`,
        state: p.progress.finished ? `Finished ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}` : `Lap ${laps ? displayLap(p.progress, laps) : 1}/${laps} · P${place} · ${p.kills} kills`,
        partySize: humans, partyMax: 12,
      });
    }
    const g = p.gun;
    this.hud.update({
      place, count: this.clock.count, lap: laps ? displayLap(p.progress, laps) : p.progress.lapsDone + 1, wrongWay: p.progress.wrongWay,
      armour: Math.ceil(p.damage.armour), heat: Math.round(g.heat * 20) / 20, gunLocked: g.locked > 0, ammo: g.ammo, armed: Math.ceil(g.armed),
      missiles: p.missiles, defence: p.defence ? DEFENCE_NAMES[p.defence] : null, weaponsHot: this.combat.hot,
      standings: rows, over: this.over, wreckedBy: p.wrecked ? this.hud.get().wreckedBy : null,
    });
  }

  /**
   * Elimination: the last car still running wins there and then (it's "finished" at this moment).
   * Each client decides for its own cars; the owner for its bots.
   */
  private lastOneStanding(): void {
    if (!this.setup.rules.elimination || this.racers.list.length < 2 || !this.racing) return;
    const alive = this.racers.list.filter((r) => !r.out && !r.progress.finished);
    const anyFinished = this.racers.list.some((r) => r.progress.finished);
    if (alive.length !== 1 || anyFinished) return;
    const r = alive[0]!;
    if (r.remote) return;
    r.progress.finished = true;
    r.progress.finishTime = this.clock.raceTime;
    if (r === this.player) {
      this.onPlayerFinish();
      this.hud.announce('LAST ONE STANDING', 'everyone else got diffed', 'diffing', 3000);
    }
    if (this.setup.room) this.writeResult(r, false);
  }

  /** Who the camera watches once the player is out of an Elimination race: the leader still in it */
  spectating(): Racer | null {
    if (!this.player.out) return null;
    for (const id of this.order) {
      const r = this.racers.get(id);
      if (r && !r.out && !r.wrecked && r !== this.player) return r;
    }
    return null;
  }

  /** A room race is over: our line on the global leaderboard */
  private recordOnBoard(rows: StandingRow[]): void {
    const room = this.setup.room;
    if (!room) return;
    const place = rows.findIndex((r) => r.self) + 1;
    const humans = rows.filter((r) => !r.id.startsWith('b_')).length;
    recordRace(currentProfileId(), { name: this.player.name, place, humans, kills: this.player.kills })
      .catch((err: unknown) => console.warn('Could not update the leaderboard', err));
  }

  /** Gaps (s) to the car ahead and behind the player, for the HUD's live diffs */
  gaps(): { ahead: number | null; behind: number | null } {
    const i = this.order.indexOf(this.player.id);
    const at = (k: number) => this.racers.list.find((r) => r.id === this.order[k]);
    const me = { id: this.player.id, D: this.player.progress.D, finishTime: null, speed: Math.abs(this.player.car.body.speed) };
    const a = i > 0 ? at(i - 1) : undefined;
    const b = at(i + 1);
    return {
      ahead: a && !a.progress.finished ? gapSeconds({ id: a.id, D: a.progress.D, finishTime: null, speed: 0 }, me) : null,
      behind: b ? gapSeconds(me, { id: b.id, D: b.progress.D, finishTime: null, speed: Math.abs(b.car.body.speed) }) : null,
    };
  }

  /** Sound volume for something a racer did: full at the player, silent 120 m away */
  private volumeAt(r: Racer): number {
    const t = r.car.view.group.position;
    return this.volumeAtPoint(t.x, t.z);
  }

  private volumeAtPoint(x: number, z: number): number {
    const p = this.player.car.view.group.position;
    return Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / 120);
  }

  dispose(): void {
    this.music?.dispose();
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.net?.dispose();
    this.combat.dispose();
    this.racers.dispose();
  }
}
