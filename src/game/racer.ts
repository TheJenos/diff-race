import { Car } from './car/car';
import { newDamage, type DamageState } from './car/damage';
import { newTurret, type TurretState } from './car/turret';
import { newGun, type GunState } from './combat/rules/heat';
import type { DefenceKind } from './combat/rules/weapons';
import { newDriverState, type DriverState } from './bot/driver';
import { newGunnerState, type GunnerState } from './bot/gunner';
import { SKILLS, type BotSkill, type SkillParams } from './bot/skills';
import { neutralInput, type CarInput } from './input/carInput';
import { newLocation, type TrackLocation } from './track/locate';
import { newProgress, type Progress } from './race/progress';
import type { PhysicsWorld } from './physics';
import { NameTag } from './world/nameTag';
import type { Impact } from './racers';
import { CarTrack } from './car/carTrack';
import { newSnapshot, type CarSnapshot } from '../net/carCodec';

/*
 * One car in the race and everything it carries: the body and mesh, its armour, guns, turret,
 * missiles and defence, where it is on the track and how far round the race. The player's racer
 * is driven by the input router; a bot's by its brain (bot/driver.ts, bot/gunner.ts).
 */

export interface BotBrain {
  skill: SkillParams;
  level: BotSkill;
  driver: DriverState;
  gunner: GunnerState;
  /** Seconds until the next decision (bots think at 30 Hz, not every physics step) */
  think: number;
  /** The last decision, held between them */
  input: CarInput;
  /** Lane choice roll, re-rolled every few seconds */
  roll: number;
}

export interface Pickup {
  /** Pad index → time (s) it can be taken again by this car */
  cooldowns: Map<number, number>;
}

export class Racer {
  readonly car: Car;
  readonly damage: DamageState;
  readonly gun: GunState = newGun();
  readonly turret: TurretState = newTurret();
  missiles = 0;
  defence: DefenceKind | null = null;
  /** Seconds of ram spikes left, and of flamethrower */
  spikes = 0;
  flaming = 0;
  /** Out of an Elimination race (wrecked), and when (race time, s) */
  out = false;
  outAt = 0;
  readonly pickups: Pickup = { cooldowns: new Map() };
  readonly loc: TrackLocation = newLocation();
  progress: Progress;
  /** What drives it this step */
  input: CarInput = neutralInput();
  /** Where the turret wants to point (world), or null: straight ahead */
  aim: { x: number; y: number; z: number } | null = null;
  brain: BotBrain | null;
  readonly tag: NameTag | null;
  /** Wrecked: hidden until `respawnAt` (s) */
  wreckedAt: number | null = null;
  /** Ghosted after a respawn until this time (s): passes through cars, takes no damage */
  ghostUntil = 0;
  kills = 0;
  deaths = 0;
  /** Velocity at the start of the physics step (for crash damage) */
  readonly vPre = { x: 0, y: 0, z: 0 };
  /** Seconds since the last scrape tick with each other car or barrier */
  readonly scraping = new Map<string, number>();
  /** Crashes in progress, by the other car's id (or 'barrier') */
  readonly impacts = new Map<string, Impact>();
  /**
   * Simulated by another client (a remote player, or a bot the room owner runs): drawn from its
   * snapshots (track) as a puppet, its damage and wrecks decided over there.
   */
  remote: boolean;
  readonly track = new CarTrack();
  /** The latest snapshot of a remote car (armour, turret, flags) */
  readonly snap: CarSnapshot = newSnapshot();
  /** Damage this (local) car has dealt to each remote car, cumulative: sent so the victims apply it */
  readonly dealt = new Map<string, number>();
  /** Cumulative damage each remote attacker has reported dealing to this (local) car */
  readonly taken = new Map<string, number>();
  /** Finish time from a remote car's record (s), and its kills */
  remoteFinish: number | null = null;

  constructor(
    physics: PhysicsWorld,
    readonly id: string,
    readonly name: string,
    readonly color: number,
    readonly stripe: number,
    gridS: number,
    lapLength: number,
    armour: number,
    bot: BotSkill | null,
    remote = false,
  ) {
    this.remote = remote;
    this.car = new Car(physics, color, stripe);
    if (remote) this.car.body.setPuppet(true);
    this.damage = newDamage(armour);
    this.progress = newProgress(gridS, lapLength);
    this.brain = bot && !remote ? {
      skill: SKILLS[bot], level: bot, driver: newDriverState(), gunner: newGunnerState(), think: 0, input: neutralInput(), roll: Math.random(),
    } : null;
    this.tag = bot || remote ? new NameTag(name) : null;
    if (this.tag) this.car.view.group.add(this.tag.sprite);
  }

  /** Has ram spikes on right now (its own state, or a remote car's snapshot) */
  get spiked(): boolean {
    return this.remote ? (this.snap.flags & 128) !== 0 : this.spikes > 0;
  }

  /** A bot (simulated here or by the room owner) */
  get isBot(): boolean {
    return this.id.startsWith('b_');
  }

  /** Simulated on this client */
  get local(): boolean {
    return !this.remote;
  }

  get wrecked(): boolean {
    return this.wreckedAt !== null;
  }

  ghost(now: number): boolean {
    return now < this.ghostUntil;
  }

  /** Give a (promoted) bot a brain to drive with */
  adoptBrain(skill: BotSkill): void {
    this.brain = { skill: SKILLS[skill], level: skill, driver: newDriverState(), gunner: newGunnerState(), think: 0, input: neutralInput(), roll: Math.random() };
  }

  dispose(): void {
    this.tag?.dispose();
    this.car.dispose();
  }
}
