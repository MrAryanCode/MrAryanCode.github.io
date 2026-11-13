// Test-only module. Reached only through the `if (__SEEK_HOOK__)` guard in src/entry-client.tsx.
// Stand-in for the real hook while the plumbing is checked.
function parseFx(search: string): Record<string, string> {
  const raw = new URLSearchParams(search).get("fx");
  const out: Record<string, string> = {};
  if (raw === null) return out;
  for (const tok of raw.split(",")) {
    if (!tok) continue;
    const [k, v] = tok.split(":");
    if (!k || !v) throw new Error("T3_FX_OVERRIDE: bad token " + tok);
    out[k] = v;
  }
  return out;
}

export function installSeekHook(): void {
  (globalThis as unknown as Record<string, unknown>).__T3_SEEK__ = { fx: parseFx(location.search) };
}
