import { useEffect, useRef } from 'react';
import type { TouchInput } from '../game/input/touch';

interface Props {
  touch: TouchInput;
}

/** Pixels of drag from where the thumb landed to full steering lock */
const STEER_RANGE = 70;

/**
 * Touch controls: the left half of the screen steers (drag left and right from wherever the
 * thumb lands), and buttons on the right fire, brake, slide, boost and respawn (the turret aims
 * itself). The car accelerates on its own unless braking (a setting). Pointer events with
 * capture, so a thumb sliding off a button still lets go of it.
 */
/** Keep a thumb's moves coming to where it went down. Some browsers throw for a pointer they don't track (synthetic ones); then it just isn't captured. */
function capture(e: React.PointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Not captured: moves outside the element are missed, nothing worse.
  }
}

export function TouchControls({ touch }: Props) {
  const knob = useRef<HTMLDivElement>(null);
  const steer = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => () => touch.clear(), [touch]);

  const steerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    capture(e);
    steer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    touch.setSteer(0);
    if (knob.current) {
      knob.current.style.left = `${e.clientX}px`;
      knob.current.style.top = `${e.clientY}px`;
      knob.current.hidden = false;
    }
  };
  const steerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = steer.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = Math.max(-STEER_RANGE, Math.min(STEER_RANGE, e.clientX - s.x));
    touch.setSteer(dx / STEER_RANGE);
    if (knob.current) knob.current.style.setProperty('--dx', `${dx}px`);
  };
  const steerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (steer.current?.id !== e.pointerId) return;
    steer.current = null;
    touch.setSteer(0);
    if (knob.current) knob.current.hidden = true;
  };
  /** A button that's held: down on press, up on release or when the thumb is lost */
  const hold = (set: (on: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      capture(e);
      e.stopPropagation();
      set(true);
    },
    onPointerUp: () => set(false),
    onPointerCancel: () => set(false),
    onLostPointerCapture: () => set(false),
  });

  return (
    <div id="touch-controls">
      <div className="touch-steer" onPointerDown={steerDown} onPointerMove={steerMove} onPointerUp={steerUp} onPointerCancel={steerUp} />
      <div ref={knob} className="touch-knob" hidden><span /></div>
      <div className="touch-combat">
        <button type="button" id="touch-fire" className="touch-btn fire" {...hold((on) => touch.setFire(on))}>FIRE</button>
        <button type="button" id="touch-missile" className="touch-btn" onPointerDown={(e) => { e.stopPropagation(); touch.tapMissile(); }}>MSL</button>
        <button type="button" id="touch-defence" className="touch-btn" onPointerDown={(e) => { e.stopPropagation(); touch.tapDefence(); }}>DROP</button>
      </div>
      <div className="touch-buttons">
        <button type="button" id="touch-brake" className="touch-btn big" {...hold((on) => touch.setBrake(on))}>BRAKE</button>
        <button type="button" id="touch-handbrake" className="touch-btn" {...hold((on) => touch.setHandbrake(on))}>SLIDE</button>
        <button type="button" id="touch-nitro" className="touch-btn nitro" {...hold((on) => touch.setNitro(on))}>NOS</button>
        <button type="button" id="touch-gas" className="touch-btn" {...hold((on) => touch.setThrottle(on))}>GAS</button>
        <button type="button" id="touch-respawn" className="touch-btn small" onPointerDown={(e) => { e.stopPropagation(); touch.tapRespawn(); }}>↺</button>
      </div>
    </div>
  );
}
