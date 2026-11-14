// Build-time GitHub REST access. Runs only in the Node build process: nothing here is imported by src/.
// Two GETs (repository, latest release), each made once. Any problem throws, and the build stops.
// The responses are mapped to `Facts` by the same parseRepo and parseRelease the browser uses (CR2-B1).
import { parseRelease, parseRepo } from "../src/facts/github-facts.ts";

const API = process.env.SITE_GITHUB_API_URL || "https://api.github.com";
const REPO = process.env.SITE_GITHUB_REPO || "MrAryanCode/certway";
const TOKEN = process.env.SITE_GITHUB_TOKEN; // optional; an empty string counts as absent
const TIMEOUT_MS = 15_000;
const TOKEN_ORIGIN = "https://api.github.com";

async function get(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "mraryancode.github.io-build",
  };
  if (TOKEN) {
    // The token goes to api.github.com and nowhere else. Checked before fetch, so it never leaves the process.
    const origin = new URL(API + path).origin;
    if (origin !== TOKEN_ORIGIN) throw new Error(`GitHub API ${path}: refusing to send the token to origin ${origin}`);
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  let res;
  try {
    // redirect: "error" turns a renamed or transferred repository (301) into a failure.
    res = await fetch(API + path, { headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const cause = err?.cause?.message ?? err?.cause?.code ?? err?.message;
    throw new Error(`GitHub API ${path}: request failed (${cause})`);
  }
  console.log(`[github] GET ${path} -> ${res.status}, x-ratelimit-remaining ${res.headers.get("x-ratelimit-remaining")}`);
  if (res.status !== 200) {
    throw new Error(`GitHub API ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`GitHub API ${path} answered 200 with a body that is not JSON`);
  }
}

const need = (cond, what) => {
  if (!cond) throw new Error(`GitHub API response is missing or has a bad field: ${what}`);
};

/** Resolves to a `Facts` object (live: false, asOf = the time both reads finished) or rejects. */
export async function fetchFacts() {
  const repoJson = await get(`/repos/${REPO}`);
  const releaseJson = await get(`/repos/${REPO}/releases/latest`); // 404 here (no release yet) also fails the build
  need(typeof repoJson?.full_name === "string" && repoJson.full_name.toLowerCase() === REPO.toLowerCase(), "repo.full_name");
  need(repoJson.private === false, "repo.private must be false");
  const repo = parseRepo(repoJson.full_name)(repoJson);
  need(repo !== null, "repo (full_name, private, html_url, stargazers_count, pushed_at, description or license)");
  const release = parseRelease(releaseJson);
  need(release !== null, "release (tag_name, html_url or published_at)");
  return { repo, release, asOf: new Date().toISOString(), live: false };
}
