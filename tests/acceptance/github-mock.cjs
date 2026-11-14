// Answers the browser's live read of https://api.github.com for the acceptance specs (P-06.4a, P-10).
// A CommonJS port of the github-mock.ts of references/github-rest-api-from-browser-unauthenticated-tests.md.
// Every spec installs it with `mockGithub(page, mode)` before it opens a page. No acceptance test reaches the real API.
//
// Modes (the second argument of mockGithub):
//   'default'     the build fixtures (test/fixtures): the live read returns the values the page was built with
//   'live'        the live fixtures (test/fixtures/live): different tag, stars, push date and release date
//   '500'         both calls answer 500
//   '403'         both calls answer the rate-limit 403, with X-RateLimit-Reset one hour ahead and exposed
//   'abort'       both calls are aborted: the page's fetch rejects with a TypeError, as for an offline visitor
//   'not-json'    both calls answer 200 with a body that is not JSON
//   'private'     the repository call answers a body with `private: true`
//   'hang'        no call is ever answered, so the page's own 8 s timeout must fire
// The route handler never sees the OPTIONS preflight, so a spec cannot assert it here.
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');
const read = (...p) => fs.readFileSync(path.join(FIXTURES, ...p), 'utf8');

const REPO_PATH = '/repos/MrAryanCode/certway';
const RELEASE_PATH = '/repos/MrAryanCode/certway/releases/latest';

// The Access-Control-Expose-Headers value api.github.com sends on a 200 response.
const EXPOSE =
  'ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset, Warning';

// A reply is { status, body, headers?, expose? }, or 'abort', or 'hang'.
function jsonReply(status, body, extra = {}, expose = true) {
  const reset = String(Math.floor(Date.now() / 1000) + 3600);
  return {
    status,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    expose,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '58',
      'x-ratelimit-used': '2',
      'x-ratelimit-resource': 'core',
      'x-ratelimit-reset': reset,
      ...extra,
    },
  };
}

// The body GitHub returned with 403 when the IP had used all 60 requests (visitor IP replaced by 203.0.113.7).
const RATE_LIMITED_BODY = {
  message:
    "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
  documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting',
};

function rateLimited() {
  return jsonReply(403, RATE_LIMITED_BODY, { 'x-ratelimit-remaining': '0', 'x-ratelimit-used': '60' });
}

function repliesFor(mode) {
  switch (mode) {
    case 'default':
      return {
        [REPO_PATH]: jsonReply(200, read('repo-certway.json')),
        [RELEASE_PATH]: jsonReply(200, read('release-latest-certway.json')),
      };
    case 'live':
      return {
        [REPO_PATH]: jsonReply(200, read('live', 'repo-certway.json')),
        [RELEASE_PATH]: jsonReply(200, read('live', 'release-latest-certway.json')),
      };
    case '500': {
      const r = jsonReply(500, { message: 'Server Error (fixture)' });
      return { [REPO_PATH]: r, [RELEASE_PATH]: r };
    }
    case '403': {
      const r = rateLimited();
      return { [REPO_PATH]: r, [RELEASE_PATH]: r };
    }
    case 'abort':
      return { [REPO_PATH]: 'abort', [RELEASE_PATH]: 'abort' };
    case 'not-json': {
      const r = { status: 200, body: '<html><body>not json</body></html>', headers: { 'content-type': 'text/html; charset=utf-8' } };
      return { [REPO_PATH]: r, [RELEASE_PATH]: r };
    }
    case 'private':
      return {
        [REPO_PATH]: jsonReply(200, read('repo-certway-private.json')),
        [RELEASE_PATH]: jsonReply(200, read('release-latest-certway.json')),
      };
    case 'hang':
      return { [REPO_PATH]: 'hang', [RELEASE_PATH]: 'hang' };
    default:
      throw new Error('unknown mock mode: ' + mode);
  }
}

// Installs the route on `page` (or on a browser context: both have .route) and returns the list of requests it saw.
// A pathname with no reply gets 404. Playwright turns the HTTP cache off for a page with a route.
async function mockGithub(page, mode = 'default') {
  const replies = repliesFor(mode);
  const seen = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    seen.push({ method: req.method(), path: pathname, url: req.url(), headers: req.headers() });
    const reply = replies[pathname] ?? jsonReply(404, { message: 'Not Found', status: '404' });
    if (reply === 'abort') return route.abort('connectionrefused');
    if (reply === 'hang') return; // neither fulfill nor abort: the request never completes
    await route.fulfill({
      status: reply.status,
      body: reply.body,
      headers: {
        'access-control-allow-origin': '*',
        ...(reply.expose === false ? {} : { 'access-control-expose-headers': EXPOSE }),
        ...reply.headers,
      },
    });
  });
  return seen;
}

module.exports = { mockGithub, jsonReply, rateLimited, RATE_LIMITED_BODY, EXPOSE, REPO_PATH, RELEASE_PATH };
