import { describe, expect, it } from 'vitest';
import { applyDamage, handlingOf, KILL_WINDOW, newDamage, patch, regen, REGEN_DELAY, zoneAt } from '../damage';
import { barrierDamage, crashDamage, scrapeDamage } from '../collisionDamage';

describe('armour and zones', () => {
  it('takes damage, levels up zones, and wrecks at zero with the kill credited', () => {
    const d = newDamage(100);
    const a = applyDamage(d, 20, 'left', 'bob', 'ram', 1);
    expect(d.armour).toBe(80);
    expect(a.levelUp).toBe('left');
    expect(d.levels.left).toBe(1);
    const b = applyDamage(d, 90, 'left', 'bob', 'gun', 2);
    expect(b.wrecked).toBe(true);
    expect(b.killer).toBe('bob');
    expect(d.levels.left).toBe(3);
  });

  it('credits the last attacker for a wreck by the world within the window, and nobody after it', () => {
    const d = newDamage(50);
    applyDamage(d, 30, 'rear', 'alice', 'ram', 10);
    const r = applyDamage(d, 40, 'front', null, 'barrier', 10 + KILL_WINDOW - 0.5);
    expect(r.killer).toBe('alice');
    expect(r.source).toBe('ram');
    const e = newDamage(50);
    applyDamage(e, 30, 'rear', 'alice', 'ram', 10);
    expect(applyDamage(e, 40, 'front', null, 'barrier', 10 + KILL_WINDOW + 1).killer).toBeNull();
  });

  it('regenerates only after a quiet spell, and a patch mends the worst zone', () => {
    const d = newDamage(100);
    applyDamage(d, 50, 'front', null, 'barrier', 0);
    regen(d, REGEN_DELAY - 1, 1);
    expect(d.armour).toBe(50);
    regen(d, REGEN_DELAY + 1, 2);
    expect(d.armour).toBeGreaterThan(50);
    expect(d.levels.front).toBe(2);
    patch(d, 25);
    expect(d.levels.front).toBe(1);
  });

  it('knows which zone a point is in, and level-3 zones cost handling', () => {
    expect(zoneAt(0, 0, -2.1)).toBe('front');
    expect(zoneAt(0, 0, 2.1)).toBe('rear');
    expect(zoneAt(-0.9, 0, 0)).toBe('left');
    expect(zoneAt(0.9, 0, 0)).toBe('right');
    expect(zoneAt(0, 0.8, 0)).toBe('roof');
    const d = newDamage(200);
    applyDamage(d, 80, 'front', null, 'barrier', 0);
    expect(handlingOf(d).steer).toBeLessThan(1);
  });
});

describe('crash damage', () => {
  it('does nothing for a nudge and grows with the impact', () => {
    expect(crashDamage(2, 'left', { rule: 1 })).toBe(0);
    const small = crashDamage(6, 'left', { rule: 1 });
    const big = crashDamage(12.5, 'left', { rule: 1 });
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small * 3);
  });

  it('a T-bone at 25 m/s closing speed: victim side ~37, rammer front much less', () => {
    const dv = 12.5;
    const victim = crashDamage(dv, 'left', { rule: 1 });
    const rammer = crashDamage(dv, 'front', { rule: 1 });
    expect(victim).toBeGreaterThan(30);
    expect(victim).toBeLessThan(45);
    expect(rammer).toBeLessThan(victim * 0.45);
  });

  it('honours nitro, armed, ghosts and the room rule', () => {
    const base = crashDamage(10, 'rear', { rule: 1 });
    expect(crashDamage(10, 'rear', { rule: 1, otherNitro: true })).toBeCloseTo(base * 1.3);
    expect(crashDamage(10, 'rear', { rule: 1, ghost: true })).toBe(0);
    expect(crashDamage(10, 'rear', { rule: 0 })).toBe(0);
    expect(crashDamage(10, 'rear', { rule: 2 })).toBeCloseTo(base * 2);
  });

  it('ram spikes hurt the other car more and spare the spiked front', () => {
    const base = crashDamage(12, 'left', { rule: 1 });
    expect(crashDamage(12, 'left', { rule: 1, otherSpikes: true })).toBeCloseTo(base * 1.6);
    const front = crashDamage(12, 'front', { rule: 1 });
    expect(crashDamage(12, 'front', { rule: 1, selfSpikes: true })).toBeCloseTo(front * 0.5);
    expect(crashDamage(12, 'rear', { rule: 1, selfSpikes: true })).toBeCloseTo(crashDamage(12, 'rear', { rule: 1 }));
  });

  it('barriers only hurt real impacts; scraping grinds steadily', () => {
    expect(barrierDamage(8, 'front', 1)).toBe(0);
    expect(barrierDamage(20, 'front', 1)).toBeGreaterThan(0);
    expect(scrapeDamage(1, 1)).toBe(4);
    expect(scrapeDamage(1, 0)).toBe(0);
  });
});
