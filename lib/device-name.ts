// Default device names: device_1, device_2, … Highest-suffix + 1 (not a count)
// so deleting a device never makes the next claim collide with a survivor.

const DEFAULT_RE = /^device_(\d+)$/;

export function defaultDeviceName(existingNames: string[]): string {
  let max = 0;
  for (const n of existingNames) {
    const m = DEFAULT_RE.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `device_${max + 1}`;
}
