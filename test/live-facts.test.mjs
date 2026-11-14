// The live read of src/live.ts (A-6, P-06.4a) in Node, under a mocked fetch, a mocked clock and a fake document root.
// Asserts algorithms.md A-6 "Verification": the twelve worked-example rows, the carry across pages, malformed and
// throwing storage, the clamp at both ends and the 90-load budget run. Also the count formatter (design.md DS-03).
import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { formatCount } from "../src/facts.ts";
import { runLiveFacts } from "../src/live.ts";

const KEY = "gh-api-rate-reset";
const FULL = "MrAryanCode/certway";
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const T0_S = T0 / 1000;

const repoBody = {
  private: false,
  full_name: FULL,
  html_url: `https://github.com/${FULL}`,
  stargazers_count: 12,
  pushed_at: "2026-11-09T10:00:00Z",
  description: "x",
  license: { spdx_id: "MIT", name: "MIT License" },
};
const relBody = { tag_name: "v1.4.0", html_url: `https://github.com/${FULL}/releases/tag/v1.4.0`, published_at: "2026-11-01T09:00:00Z" };
const build = {
  repo: { fullName: FULL, htmlUrl: `https://github.com/${FULL}`, stars: 10, pushedAt: "2026-11-01T00:00:00Z", license: "MIT", description: "x" },
  release: { tag: "v1.3.0", url: `https://github.com/${FULL}/releases/tag/v1.3.0`, publishedAt: "2026-11-01T00:00:00Z" },
  asOf: "2026-11-08T00:00:00.000Z",
  live: false,
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const resetIn = (s) => String(T0_S + s);
const okRepo = () => Promise.resolve(json(200, repoBody, { "x-ratelimit-remaining": "57", "x-ratelimit-reset": resetIn(1800) }));
const okRel = () => Promise.resolve(json(200, relBody, { "x-ratelimit-remaining": "56", "x-ratelimit-reset": resetIn(1800) }));
const limited = (seconds) => () =>
  Promise.resolve(json(403, { message: "API rate limit exceeded for 203.0.113.7." }, { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": resetIn(seconds) }));
const hang = (init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

// fetch is replaced for one test; `calls` records every request (url and init).
let calls = [];
function mockFetch(repoReply, relReply) {
  calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    return (url.endsWith("/releases/latest") ? relReply : repoReply)(init);
  };
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const withStorage = (storage) => {
  globalThis.window = { sessionStorage: storage };
};

afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
  delete globalThis.fetch;
});

class El {
  constructor() {
    this.attrs = new Map();
    this.textContent = "";
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
}

/** A fake document root holding the certway card: four facts, the note, the as-of sentence. */
function makeRoot({ facts = true, license = true } = {}) {
  const tag = new El();
  tag.textContent = "v1.3.0";
  tag.setAttribute("href", build.release.url);
  const licenseEl = new El();
  licenseEl.textContent = "MIT";
  const row = new El();
  licenseEl.closest = (sel) => (sel === ".tile" ? row : null);
  const stars = new El();
  stars.textContent = "10";
  const pushedAt = new El();
  pushedAt.textContent = "2026-11-01";
  const time = new El();
  time.setAttribute("datetime", build.asOf);
  time.textContent = "2026-11-08 00:00 UTC";
  const para = new El();
  para.nodes = ["Facts from the GitHub API as of ", time, ", when this page was built."];
  para.replaceChildren = (...nodes) => {
    para.nodes = nodes;
  };
  time.parentElement = para;
  const note = new El();
  note.setAttribute("hidden", "");
  const byName = { tag, license: license ? licenseEl : null, stars, pushedAt };
  const root = {
    querySelector(sel) {
      if (sel === "[data-fact]") return facts ? tag : null;
      const m = /^\[data-fact="(\w+)"\]$/.exec(sel);
      if (m) return byName[m[1]] ?? null;
      if (sel === "time[data-as-of]") return time;
      if (sel === "p[data-live-fail]") return note;
      throw new Error(`unexpected selector ${sel}`);
    },
  };
  const sentence = () => para.nodes.map((n) => (typeof n === "string" ? n : n.textContent)).join("");
  return { root, tag, licenseEl, row, stars, pushedAt, time, note, sentence, all: [tag, licenseEl, row, stars, pushedAt, time, para, note] };
}

const noteShown = (r) => !r.note.attrs.has("hidden");
const stopS = (st) => (st.m.has(KEY) ? Number(st.m.get(KEY)) - T0_S : null);

/** Runs runLiveFacts at the page clock `nowMs` (Date mocked). Returns the facts, the fake page and the number of requests it made. */
async function run(st, nowMs = T0, page = makeRoot()) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: nowMs });
  withStorage(st);
  const before = calls.length;
  const facts = await runLiveFacts(build, page.root);
  return { facts, page, requests: calls.length - before };
}

describe("A-6 worked-example rows", () => {
  const rows = [
    ["both 200", okRepo, okRel, { applied: true }],
    ["release 404 (no release)", okRepo, () => Promise.resolve(json(404, { message: "Not Found" })), { applied: false }],
    ["repo 403 limited, reset in 1500 s", limited(1500), okRel, { applied: false, stop: 1500 }],
    ["both 403, reset in 20 s", limited(20), limited(20), { applied: false, stop: 60 }],
    ["both 403, reset 3 h ahead (clock 2 h slow)", limited(10800), limited(10800), { applied: false, stop: 3600 }],
    ["repo 503", () => Promise.resolve(json(503, { message: "Server Error" })), okRel, { applied: false }],
    ["network TypeError", () => Promise.reject(new TypeError("Failed to fetch")), okRel, { applied: false }],
    ["200 with an HTML body", () => Promise.resolve(new Response("<html>", { status: 200 })), okRel, { applied: false }],
    [
      "WebKit-style DOMException SyntaxError",
      () => Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => Promise.reject(new DOMException("The string did not match", "SyntaxError")) }),
      okRel,
      { applied: false },
    ],
    ["full_name differs (renamed repository)", () => Promise.resolve(json(200, { ...repoBody, full_name: "X/y" })), okRel, { applied: false }],
    ["license null", () => Promise.resolve(json(200, { ...repoBody, license: null })), okRel, { applied: true, licenseHidden: true }],
  ];
  for (const [name, repoReply, relReply, want] of rows) {
    test(name, async () => {
      const st = memStorage();
      mockFetch(repoReply, relReply);
      const { facts, page, requests } = await run(st);
      assert.equal(requests, 2, "both calls are made");
      assert.equal(stopS(st), want.stop ?? null, "the stop stored, in seconds from the page clock");
      assert.equal(noteShown(page), !want.applied, "the failure note is shown exactly when the build facts stay");
      if (want.applied) {
        assert.notEqual(facts, build);
        assert.equal(facts.live, true);
        assert.equal(facts.asOf, new Date(T0).toISOString());
        assert.equal(page.tag.textContent, "v1.4.0");
        assert.equal(page.tag.getAttribute("href"), relBody.html_url);
        assert.equal(page.stars.textContent, "12");
        assert.equal(page.pushedAt.textContent, "2026-11-09");
        assert.equal(page.time.getAttribute("datetime"), new Date(T0).toISOString());
        assert.equal(page.time.textContent, "2026-11-11 12:00 UTC");
        assert.equal(page.sentence(), "Facts read live from the GitHub API at 2026-11-11 12:00 UTC.", "the live wording");
        assert.equal(page.row.attrs.has("hidden"), want.licenseHidden === true, "the License row is hidden exactly when the live license is null");
        if (!want.licenseHidden) assert.equal(page.licenseEl.textContent, "MIT");
      } else {
        assert.equal(facts, build, "the very same build object");
        assert.equal(page.tag.textContent, "v1.3.0");
        assert.equal(page.stars.textContent, "10");
        assert.equal(page.time.getAttribute("datetime"), build.asOf);
        assert.equal(page.sentence(), "Facts from the GitHub API as of 2026-11-08 00:00 UTC, when this page was built.", "the build wording");
        assert.equal(page.row.attrs.has("hidden"), false);
      }
    });
  }

  test("both calls hang: both time out after 8,000 ms, then build facts and the note", async () => {
    const st = memStorage();
    mockFetch(hang, hang);
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    withStorage(st);
    const page = makeRoot();
    let result = null;
    const pending = runLiveFacts(build, page.root).then((f) => (result = f));
    assert.equal(calls.length, 2, "both calls are made at once");
    mock.timers.tick(7999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result, null, "undecided at 7,999 ms");
    mock.timers.tick(1);
    await pending;
    assert.equal(result, build);
    assert.equal(noteShown(page), true);
    assert.equal(stopS(st), null);
  });
});

describe("what is sent and what is not", () => {
  test("only Accept and X-GitHub-Api-Version, GET, no credentials, no body (D-022)", async () => {
    mockFetch(okRepo, okRel);
    await run(memStorage());
    assert.deepEqual(calls.map((c) => c.url).sort(), [`https://api.github.com/repos/${FULL}`, `https://api.github.com/repos/${FULL}/releases/latest`]);
    for (const { init } of calls) {
      assert.deepEqual(Object.keys(init.headers).sort(), ["Accept", "X-GitHub-Api-Version"]);
      assert.equal(init.headers.Accept, "application/vnd.github+json");
      assert.equal(init.headers["X-GitHub-Api-Version"], "2026-03-10");
      assert.ok(init.method === undefined || init.method === "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.credentials, undefined);
    }
  });

  test("a root with no [data-fact] element makes no request and returns the build facts", async () => {
    mockFetch(okRepo, okRel);
    const { facts, requests } = await run(memStorage(), T0, makeRoot({ facts: false }));
    assert.equal(facts, build);
    assert.equal(requests, 0);
  });

  test("the fact region is not made a live region", async () => {
    mockFetch(okRepo, okRel);
    const { page } = await run(memStorage());
    for (const el of page.all) {
      for (const name of el.attrs.keys()) assert.ok(!name.startsWith("aria-") && name !== "role", `${name} set by the live update`);
    }
  });

  test("a build without a license row: a live license does not add one", async () => {
    mockFetch(okRepo, okRel);
    const { facts, page } = await run(memStorage(), T0, makeRoot({ license: false }));
    assert.equal(facts.live, true);
    assert.equal(page.stars.textContent, "12");
  });
});

describe("the stop carried across pages", () => {
  test("stored with the reset in 1,500 s: +60 s sends nothing and shows the note; +1,501 s sends two and shows live facts", async () => {
    const st = memStorage();
    mockFetch(limited(1500), limited(1500));
    const first = await run(st);
    assert.equal(first.requests, 2);
    assert.equal(stopS(st), 1500);

    mockFetch(okRepo, okRel);
    const a = await run(st, T0 + 60_000);
    assert.equal(a.requests, 0, "skipped while the stored time is in the future");
    assert.equal(a.facts, build);
    assert.equal(noteShown(a.page), true);

    const b = await run(st, T0 + 1_501_000);
    assert.equal(b.requests, 2);
    assert.equal(b.facts.live, true);
    assert.equal(noteShown(b.page), false);
  });

  test("a stored reset time in the past is no stop", async () => {
    const st = memStorage();
    st.setItem(KEY, String(T0_S - 3600));
    mockFetch(okRepo, okRel);
    const { requests, facts } = await run(st);
    assert.equal(requests, 2);
    assert.equal(facts.live, true);
  });

  for (const bad of ["garbage", "", "0", "-5", "1.5", "12abc"]) {
    test(`a malformed stored value ${JSON.stringify(bad)} is removed and read as no stop`, async () => {
      const st = memStorage();
      st.setItem(KEY, bad);
      mockFetch(okRepo, okRel);
      const { requests, facts } = await run(st);
      assert.equal(requests, 2);
      assert.equal(facts.live, true);
      assert.equal(st.m.has(KEY), false, "the malformed value is removed");
    });
  }

  test("storage whose every method throws: two requests, the note, no exception", async () => {
    const throwing = {
      getItem() {
        throw new DOMException("denied", "SecurityError");
      },
      setItem() {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem() {
        throw new DOMException("denied", "SecurityError");
      },
    };
    mockFetch(limited(1500), limited(1500));
    const { requests, facts, page } = await run(throwing);
    assert.equal(requests, 2);
    assert.equal(facts, build);
    assert.equal(noteShown(page), true);
  });

  test("a sessionStorage getter that throws SecurityError, and no window at all: the read proceeds", async () => {
    mockFetch(okRepo, okRel);
    mock.timers.enable({ apis: ["Date"], now: T0 });
    globalThis.window = {
      get sessionStorage() {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    assert.equal((await runLiveFacts(build, makeRoot().root)).live, true);
    delete globalThis.window;
    assert.equal((await runLiveFacts(build, makeRoot().root)).live, true);
    assert.equal(calls.length, 4);
  });

  test("a network failure stores nothing", async () => {
    const st = memStorage();
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.reject(new TypeError("Failed to fetch")));
    const { facts } = await run(st);
    assert.equal(facts, build);
    assert.equal(st.m.has(KEY), false);
  });

  test("a limited read with no readable reset header stores nothing", async () => {
    const st = memStorage();
    const noReset = () => Promise.resolve(json(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" }));
    mockFetch(noReset, noReset);
    const { facts, page } = await run(st);
    assert.equal(facts, build);
    assert.equal(noteShown(page), true);
    assert.equal(st.m.has(KEY), false);
  });
});

describe("the stop is clamped to 60..3,600 s after the page clock", () => {
  const cases = [
    ["20 s becomes 60", 20, 60],
    ["a reset already in the past (fast clock) becomes 60", -7200, 60],
    ["1,500 s stays 1,500", 1500, 1500],
    ["exactly 3,600 s stays 3,600", 3600, 3600],
    ["10,800 s becomes 3,600", 10800, 3600],
  ];
  for (const [name, seconds, want] of cases) {
    test(name, async () => {
      const st = memStorage();
      mockFetch(limited(seconds), limited(seconds));
      await run(st);
      assert.equal(stopS(st), want);
    });
  }
});

describe("the 90-load budget run", () => {
  test("one IP, one home page load a minute for 90 minutes: 60 live, 30 build facts, 122 requests", async () => {
    // A fixed 60-minute window opens at the first counted request; 60 requests are free, then every request answers 403.
    let remaining = 60;
    let windowEnd = null;
    let now = T0;
    const answer = (body) => () => {
      if (windowEnd !== null && now >= windowEnd) {
        remaining = 60;
        windowEnd = null;
      }
      if (windowEnd === null) windowEnd = now + 3_600_000;
      const reset = String(Math.floor(windowEnd / 1000));
      if (remaining === 0) return Promise.resolve(json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset }));
      remaining--;
      return Promise.resolve(json(200, body, { "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": reset }));
    };
    mockFetch(answer(repoBody), answer(relBody));
    const st = memStorage();
    let live = 0;
    let kept = 0;
    let skipped = 0;
    for (let i = 0; i < 90; i++) {
      now = T0 + i * 60_000;
      const { facts, requests } = await run(st, now);
      if (facts.live) live++;
      else kept++;
      if (requests === 0) skipped++;
    }
    assert.equal(live, 60);
    assert.equal(kept, 30);
    assert.equal(skipped, 29, "29 of the 30 build-fact loads are skipped by the carried stop; one is answered 403");
    assert.equal(calls.length, 122);
  });
});

describe("formatCount", () => {
  test("groups counts above 999 with a comma and leaves the rest alone", () => {
    assert.equal(formatCount(3), "3");
    assert.equal(formatCount(999), "999");
    assert.equal(formatCount(1000), "1,000");
    assert.equal(formatCount(12345), "12,345");
    assert.equal(formatCount(1234567), "1,234,567");
    assert.equal(formatCount(0), "0");
  });
});
