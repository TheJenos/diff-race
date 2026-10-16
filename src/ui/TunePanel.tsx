import { useEffect, useState } from 'react';
import { CAR, type CarParams } from '../game/car/params';

/**
 * DEV only (`?tune` in the URL): sliders bound live to the car's tuning numbers, for finding the
 * feel by driving. Values are edited in place on the shared CAR params; copy the result back into
 * car/params.ts (the Copy button puts the changed numbers on the clipboard).
 */

type NumKey = { [K in keyof CarParams]: CarParams[K] extends number ? K : never }[keyof CarParams];

const KNOBS: { key: NumKey; min: number; max: number; step: number }[] = [
  { key: 'engineForce', min: 6000, max: 30000, step: 100 },
  { key: 'topSpeed', min: 30, max: 80, step: 1 },
  { key: 'grip', min: 0.6, max: 3, step: 0.05 },
  { key: 'peakSlip', min: 0.05, max: 0.35, step: 0.01 },
  { key: 'slideGrip', min: 0.3, max: 1, step: 0.01 },
  { key: 'lateralStiffness', min: 0.2, max: 1, step: 0.01 },
  { key: 'handbrakeGrip', min: 0.05, max: 1, step: 0.01 },
  { key: 'steerLock', min: 0.2, max: 0.9, step: 0.01 },
  { key: 'steerLockFast', min: 0.03, max: 0.4, step: 0.01 },
  { key: 'steerRate', min: 1, max: 8, step: 0.1 },
  { key: 'yawDamping', min: 0, max: 3, step: 0.05 },
  { key: 'spring', min: 15000, max: 80000, step: 500 },
  { key: 'damperBump', min: 500, max: 8000, step: 100 },
  { key: 'damperRebound', min: 500, max: 8000, step: 100 },
  { key: 'antiRollFront', min: 0, max: 60000, step: 500 },
  { key: 'antiRollRear', min: 0, max: 60000, step: 500 },
  { key: 'forceLift', min: 0, max: 0.8, step: 0.01 },
  { key: 'downforce', min: 0, max: 5, step: 0.1 },
  { key: 'brakeForce', min: 8000, max: 50000, step: 500 },
  { key: 'nitroForce', min: 1, max: 3, step: 0.05 },
];

export const TUNING = import.meta.env.DEV && new URLSearchParams(location.search).has('tune');

export function TunePanel() {
  const [, redraw] = useState(0);
  const [open, setOpen] = useState(true);
  const [initial] = useState(() => ({ ...CAR }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Backquote') setOpen((o) => !o); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  const changed = KNOBS.filter((k) => CAR[k.key] !== initial[k.key]);
  return (
    <div id="tune-panel" onPointerDown={(e) => e.stopPropagation()}>
      <b>Car tuning</b> <small>(` hides)</small>
      {KNOBS.map((k) => (
        <label key={k.key}>
          <span>{k.key}</span>
          <input type="range" min={k.min} max={k.max} step={k.step} value={CAR[k.key]}
            onChange={(e) => { (CAR as unknown as Record<string, number>)[k.key] = Number(e.target.value); redraw((n) => n + 1); }} />
          <output>{CAR[k.key]}</output>
        </label>
      ))}
      <button type="button" disabled={!changed.length}
        onClick={() => void navigator.clipboard?.writeText(changed.map((k) => `${k.key}: ${CAR[k.key]},`).join('\n'))}>
        Copy {changed.length} changed
      </button>
    </div>
  );
}
