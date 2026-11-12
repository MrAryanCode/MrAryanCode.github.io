// Print helpers for the build-time GitHub facts. The one `Facts` type lives in facts/github-facts.ts.
// Pure code: it runs in the build script's bundle and in the browser.
export type { Facts } from "./facts/github-facts.ts";

/** "2026-11-09T11:50:03.123Z" -> "2026-11-09 11:50 UTC". Deterministic: no Intl, no locale, no time zone. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** The commit and the time the build started: the same pair on every page of one build, or null for a local build. */
export interface Build {
  /** The full 40-character commit, from GITHUB_SHA. */
  sha: string;
  /** ISO-8601 UTC instant at which the build started. */
  builtAt: string;
}
