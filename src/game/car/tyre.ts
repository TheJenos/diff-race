/*
 * The arcade tyre: how much a contact patch pushes the car forward and sideways. Pure.
 *
 * Sideways, the tyre tries to cancel the patch's sliding (most of it, every step) up to what the
 * grip allows. Grip rises with slip angle to a peak, then falls away: past the peak the car slides
 * and keeps sliding until the driver catches it, which is what makes handbrake turns and
 * oversteer work. Lengthways it drives and brakes, and both share one friction circle.
 */

export interface TyreParams {
  peakSlip: number;
  slideGrip: number;
  lateralStiffness: number;
}

/** Fraction of peak grip at slip angle `slip` (rad, ≥0) */
export function gripCurve(slip: number, p: TyreParams): number {
  if (slip <= p.peakSlip) return 0.55 + 0.45 * (slip / p.peakSlip);
  // Past the peak: down to slideGrip by three times the peak angle, then flat.
  const t = Math.min(1, (slip - p.peakSlip) / (p.peakSlip * 2));
  return 1 - (1 - p.slideGrip) * t;
}

export interface TyreInput {
  /** Contact patch velocity along the wheel and across it (m/s) */
  vLong: number;
  vLat: number;
  /** Load on the tyre (N) */
  load: number;
  /** Friction coefficient (tyre grip × surface) */
  mu: number;
  /** Lateral grip multiplier (handbrake on a rear wheel) */
  latGrip: number;
  /** The mass this wheel steadies (a quarter of the car) and the step (s) */
  mass: number;
  dt: number;
  /** Engine force along the wheel (N, signed) */
  drive: number;
  /** Braking force (N, ≥0): against the direction of travel */
  brake: number;
  /** Rolling resistance (N, ≥0) */
  rolling: number;
}

export interface TyreOutput {
  long: number;
  lat: number;
  /** 0..1: how far into a slide (for smoke, skid marks and the screech) */
  slide: number;
}

export function tyreForces(t: TyreInput, p: TyreParams, out: TyreOutput): TyreOutput {
  const speed = Math.abs(t.vLong);
  // Slip angles mean nothing at a crawl; there the tyre just holds.
  const slip = speed + Math.abs(t.vLat) < 1.5 ? 0 : Math.atan2(Math.abs(t.vLat), speed);
  const curve = gripCurve(slip, p);
  const limit = t.mu * t.load;
  const latLimit = limit * curve * t.latGrip;

  // Sideways: cancel most of this step's slide, within grip.
  let lat = (-t.vLat * t.mass * p.lateralStiffness) / t.dt;
  if (lat > latLimit) lat = latLimit;
  else if (lat < -latLimit) lat = -latLimit;

  // Lengthways: drive, then brakes and rolling resistance, which slow but never reverse the wheel.
  const stopForce = (speed * t.mass) / t.dt;
  const resist = Math.min(t.brake + t.rolling, stopForce);
  let long = t.drive - Math.sign(t.vLong) * resist;

  // One friction circle for both: if they ask for more than the grip, scale both back.
  const total = Math.sqrt(long * long + lat * lat);
  const circle = limit * Math.max(curve, 0.85);
  if (total > circle && total > 0) {
    const k = circle / total;
    long *= k;
    lat *= k;
  }
  out.long = long;
  out.lat = lat;
  out.slide = latLimit > 0 ? Math.min(1, Math.max(0, (slip - p.peakSlip) / (p.peakSlip * 2))) : 0;
  return out;
}
