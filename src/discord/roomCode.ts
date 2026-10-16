const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A room code for this Activity instance, so everyone in the voice channel shares one room. */
export function roomCodeFor(instanceId: string): string {
  let h = 2166136261;
  let code = 'DC';
  for (let i = 0; i < 8; i++) {
    for (const ch of instanceId + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    code += CODE_CHARS[h % CODE_CHARS.length];
  }
  return code;
}
