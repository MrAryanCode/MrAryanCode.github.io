# MrAryanCode.github.io

Source code of [mraryancode.github.io](https://mraryancode.github.io/), the personal site of Aryan Miri, full-stack developer.

The site goes live only when every one of these checks passes:

- Unit tests
- Acceptance tests in Chromium, Firefox and WebKit
- Accessibility check on every page (axe-core)
- Performance check (Lighthouse)
- HTML validation (Nu Html Checker)
- Link check (lychee)

The [Engineering report](https://mraryancode.github.io/report/) shows the numbers from the build that is live now.

## Stack

TypeScript, SolidJS, Vite, Node.js, Playwright, HTML and CSS, GitHub Actions. Every page is rendered to static HTML at build time and served by GitHub Pages.

## How it ships

- `.github/workflows/pages.yml` runs two jobs, `Test site` and `Build site`, on every pull request and every push to `main`. It deploys only from `main`, and only when both jobs pass.
- `main` accepts changes only through pull requests that pass both jobs. The rule has no bypass, for the owner either.
- `.github/workflows/refresh.yml` starts a rebuild every hour, so the GitHub facts on the site stay current. GitHub may delay or skip scheduled runs.

## Run it locally

You need the Node.js version in `.nvmrc` and the npm version in `package.json` (`devEngines`).

```sh
npm ci --strict-peer-deps --engine-strict --no-audit --no-fund
npx playwright install chromium
npm run dev        # development server
npm run typecheck  # type check, writes no files
npm test           # unit, build and hydration tests against a local stand-in for the GitHub API
npm run build      # the static site in dist/, with facts read from the GitHub API
```

`npm run build` reads two public GitHub API endpoints and needs no token; if `SITE_GITHUB_TOKEN` is set, it sends it. The acceptance tests in three browsers and the quality checks run in the `Test site` and `Build site` jobs.

## Privacy

The site sets no cookies and has no analytics. On the home page, your browser sends two requests to the public GitHub API (`api.github.com`), without a token or cookies, to show current facts about certway; GitHub sees your IP address for those two requests. Nothing else on the site contacts another server.

## License

The code is licensed under the [MIT License](LICENSE). The text and images are © 2026 Aryan Miri and are not licensed for reuse.

## Contact

[Message me on Telegram](https://t.me/aryan_61_04)
