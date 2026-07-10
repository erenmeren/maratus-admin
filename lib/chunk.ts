// Pure array chunking. Used to batch large multi-row upserts (factory-registry
// import) into a bounded number of statements instead of one round trip per row.

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
