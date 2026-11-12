// Live repository facts from the unauthenticated GitHub REST API, read in the visitor's browser.
// Never throws: every failure is a value, so the caller can keep the prerendered facts.
// Also imported by scripts/github.mjs (Node strips the types), which maps the build's own responses with
// parseRepo and parseRelease, so the build and the browser share one mapping and one `Facts` shape.

export const API_VERSION = '2026-03-10';
const API_ORIGIN = 'https://api.github.com';

export interface RateInfo {
  limit: number | null;
  remaining: number | null;
  /** When the counter resets; null when the header was absent. */
  resetAt: Date | null;
}

export type FailureReason =
  | 'rate-limited' // 403 or 429 caused by a primary or secondary limit
  | 'not-found' // 404
  | 'http-error' // any other non-2xx status, including 5xx and a 403 that is not a rate limit
  | 'network' // fetch rejected with TypeError: offline, DNS, blocked, or a CORS failure
  | 'timeout' // our own AbortController fired
  | 'bad-shape'; // 2xx but not JSON, or a field missing or of the wrong type

export type Loaded<T> =
  | { ok: true; data: T; rate: RateInfo }
  | { ok: false; reason: FailureReason; status?: number; rate?: RateInfo };

export interface RepoFacts {
  fullName: string;
  htmlUrl: string;
  stars: number;
  pushedAt: string;
  license: string | null;
  description: string | null;
}

export interface ReleaseFacts {
  tag: string;
  url: string;
  publishedAt: string | null;
}

function headerNumber(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rateOf(res: Response): RateInfo {
  const reset = headerNumber(res, 'x-ratelimit-reset');
  return {
    limit: headerNumber(res, 'x-ratelimit-limit'),
    remaining: headerNumber(res, 'x-ratelimit-remaining'),
    resetAt: reset === null ? null : new Date(reset * 1000),
  };
}

async function getJson<T>(
  origin: string,
  path: string,
  parse: (json: unknown) => T | null,
  timeoutMs: number,
): Promise<Loaded<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(origin + path, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
      signal: controller.signal,
    });
    const rate = rateOf(res);
    if (!res.ok) {
      let message = '';
      try {
        message = String(((await res.json()) as { message?: unknown }).message ?? '');
      } catch {
        /* body is not JSON: keep the empty message */
      }
      const limited =
        res.status === 429 ||
        (res.status === 403 &&
          (rate.remaining === 0 || res.headers.has('retry-after') || /rate limit/i.test(message)));
      if (limited) return { ok: false, reason: 'rate-limited', status: res.status, rate };
      if (res.status === 404) return { ok: false, reason: 'not-found', status: 404, rate };
      return { ok: false, reason: 'http-error', status: res.status, rate };
    }
    const data = parse(await res.json());
    if (data === null) return { ok: false, reason: 'bad-shape', status: res.status, rate };
    return { ok: true, data, rate };
  } catch (e) {
    if (timedOut) return { ok: false, reason: 'timeout' };
    // res.json() on a non-JSON body throws a SyntaxError in Chromium and Firefox but a DOMException
    // named SyntaxError in WebKit, so compare the name, not the class.
    if ((e as { name?: unknown }).name === 'SyntaxError') return { ok: false, reason: 'bad-shape' };
    return { ok: false, reason: 'network' }; // TypeError, or an abort we did not cause
  } finally {
    clearTimeout(timer);
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// CR2-B1: exported (the reference keeps it private) so scripts/github.mjs can map the build's responses with it.
export function parseRepo(expectedFullName: string) {
  return (j: unknown): RepoFacts | null => {
    if (!isRec(j)) return null;
    const lic = j.license;
    if (
      j.private !== false ||
      j.full_name !== expectedFullName ||
      !isStr(j.html_url) ||
      typeof j.stargazers_count !== 'number' ||
      !isStr(j.pushed_at) ||
      !(j.description === null || isStr(j.description)) ||
      !(lic === null || isRec(lic))
    )
      return null;
    const licName = lic === null ? null : isStr(lic.spdx_id) ? lic.spdx_id : isStr(lic.name) ? lic.name : null;
    return {
      fullName: j.full_name,
      htmlUrl: j.html_url,
      stars: j.stargazers_count,
      pushedAt: j.pushed_at,
      license: licName,
      description: j.description,
    };
  };
}

// CR2-B1: exported for the same reason as parseRepo.
export function parseRelease(j: unknown): ReleaseFacts | null {
  if (!isRec(j)) return null;
  if (!isStr(j.tag_name) || !isStr(j.html_url) || !(j.published_at === null || isStr(j.published_at))) return null;
  return { tag: j.tag_name, url: j.html_url, publishedAt: j.published_at };
}

// CR2-B1: the API origin is a parameter (default api.github.com) so a test can point the browser code at a fixture server.
export async function loadLiveFacts(
  fullName = 'MrAryanCode/certway',
  timeoutMs = 8000,
  origin = API_ORIGIN,
): Promise<{ repo: Loaded<RepoFacts>; release: Loaded<ReleaseFacts> }> {
  const [repo, release] = await Promise.all([
    getJson(origin, `/repos/${fullName}`, parseRepo(fullName), timeoutMs),
    getJson(origin, `/repos/${fullName}/releases/latest`, parseRelease, timeoutMs),
  ]);
  return { repo, release };
}

/** One consistent set of facts to render, with the moment it describes. */
export interface Facts {
  repo: RepoFacts;
  release: ReleaseFacts;
  /** ISO time: the build time for prerendered facts, the time the responses were read for live ones. */
  asOf: string;
  live: boolean;
}

/**
 * Replaces the prerendered facts only when both calls succeeded. If either failed, for any reason,
 * the very same prerendered object is returned, so values and date never come from two moments.
 */
export function applyLive(
  build: Facts,
  live: { repo: Loaded<RepoFacts>; release: Loaded<ReleaseFacts> },
  now: Date = new Date(),
): Facts {
  if (!live.repo.ok || !live.release.ok) return build;
  return { repo: live.repo.data, release: live.release.data, asOf: now.toISOString(), live: true };
}
