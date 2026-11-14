// The certway case study (design.md DS-08; D-030, D-043 to D-049). Every statement below is signed off word for word in
// the decision of its section: D-044 What it does, D-045 How it is built, D-046 Design choices, D-047 How it is tested,
// D-048 How it is released, D-049 Known limits. A wording change that alters a claim, or a new line range, needs a new decision.
// Each permalink points at one commit of certway, so a later change in certway cannot move it.

/** The certway version this page describes (D-043). */
export const version = "v1.0.1";

/** The pinned certway commit: tag v1.0.1 (D-043). Every permalink uses it. */
export const sha = "cb74da823223b7aa837063b30d9b0d4da92f29fe";

export const repoUrl = "https://github.com/MrAryanCode/certway";
export const releaseUrl = `${repoUrl}/releases/tag/${version}`;
export const commitUrl = `${repoUrl}/commit/${sha}`;
export const shortSha = sha.slice(0, 7);

/** The six signed sections, in page order (COPY_AT_STEP_3_CERTWAY_SECTIONS). */
export const COPY_AT_STEP_3_CERTWAY_SECTIONS = [
  { id: "what-it-does", heading: "What it does" },
  { id: "how-it-is-built", heading: "How it is built" },
  { id: "design-choices", heading: "Design choices" },
  { id: "how-it-is-tested", heading: "How it is tested" },
  { id: "how-it-is-released", heading: "How it is released" },
  { id: "known-limits", heading: "Known limits" },
] as const;

export type SectionId = (typeof COPY_AT_STEP_3_CERTWAY_SECTIONS)[number]["id"];

/** The pin line (COPY_AT_STEP_3_CERTWAY_PIN_LINE). On the page `shortSha` is the link to `commitUrl`. */
export const COPY_AT_STEP_3_CERTWAY_PIN_LINE = `This page describes certway ${version}. Every link below points to the code at commit ${shortSha}.`;

export interface Statement {
  section: SectionId;
  /** One plain sentence. Text between backticks is code and is shown in monospace. */
  statement: string;
  /** A commit-pinned blob URL: `${repoUrl}/blob/${sha}/<path>#L<a>` or `#L<a>-L<b>`. */
  permalink: string;
}

/** A commit-pinned blob URL for `path` and a line range written `a` or `a-b`. */
function blob(path: string, lines: string): string {
  const [from, to] = lines.split("-");
  return `${repoUrl}/blob/${sha}/${path}#L${from}${to ? `-L${to}` : ""}`;
}

/** The link text of a permalink: the path and the line range, for example `crates/cli/src/args.rs:536-561`. */
export function permalinkLabel(permalink: string): string {
  const [path, anchor] = permalink.slice(`${repoUrl}/blob/${sha}/`.length).split("#L");
  return `${path}:${anchor.replace("-L", "-")}`;
}

export const statements: Statement[] = [
  { section: "what-it-does", statement: "The argument parser routes seven commands: issue, renew, list, install, export, rollback and version.", permalink: blob("crates/cli/src/args.rs", "536-561") },
  { section: "what-it-does", statement: "`issue` proves control of a domain with DNS-01 when `--dns` or `--dns-hook` is given, and with HTTP-01 otherwise.", permalink: blob("crates/cli/src/cmd/issue.rs", "276") },
  { section: "what-it-does", statement: "HTTP-01 is answered by a minimal standalone responder that certway binds itself.", permalink: blob("crates/core/src/challenge.rs", "15-24") },
  { section: "what-it-does", statement: "`install` sets up a systemd timer when systemd is present, and a cron job when only cron is.", permalink: blob("crates/cli/src/env.rs", "270-279") },
  { section: "what-it-does", statement: "In a container, `install` schedules nothing and points to an external scheduler or to `renew --watch` instead.", permalink: blob("crates/cli/src/env.rs", "264-269") },
  { section: "what-it-does", statement: "Editing nginx is opt-in: certway changes an nginx configuration only when `--edit-nginx` is given.", permalink: blob("crates/cli/src/cmd/issue.rs", "115-119") },
  { section: "how-it-is-built", statement: "The code is a Cargo workspace of two crates, `crates/core` and `crates/cli`.", permalink: blob("Cargo.toml", "1-3") },
  { section: "how-it-is-built", statement: "The core crate holds the ACME protocol, ARI, crypto, CSR, DNS and HTTP modules.", permalink: blob("crates/core/src/lib.rs", "4-16") },
  { section: "how-it-is-built", statement: "`certway-core` forbids unsafe code and is not allowed to print; only the binary crate writes output.", permalink: blob("crates/core/src/lib.rs", "1-2") },
  { section: "how-it-is-built", statement: "HTTP is written by hand over a standard-library TCP stream wrapped in rustls, with no HTTP client library and no async runtime.", permalink: blob("crates/core/src/http.rs", "254-266") },
  { section: "how-it-is-built", statement: "TLS is rustls with the ring crypto provider and default features turned off.", permalink: blob("Cargo.toml", "12") },
  { section: "how-it-is-built", statement: "The toolchain is pinned to Rust 1.96.0.", permalink: blob("rust-toolchain.toml", "1-3") },
  { section: "how-it-is-built", statement: "Release builds are tuned for size: opt-level z, fat LTO, one codegen unit, symbols stripped.", permalink: blob("Cargo.toml", "27-31") },
  { section: "design-choices", statement: "One exclusive lock per data directory, so a renewal timer that overlaps a manual run cannot place two orders and burn two rate-limit slots.", permalink: blob("crates/cli/src/store/lock.rs", "3-8") },
  { section: "design-choices", statement: "The lock is released by process exit, never by deleting the file, so a crashed run's lock recovers on its own.", permalink: blob("crates/cli/src/store/lock.rs", "10-15") },
  { section: "design-choices", statement: "`config.json` is written 0600 because hook command lines often carry a credential.", permalink: blob("crates/cli/src/store/cert.rs", "19-26") },
  { section: "design-choices", statement: "The certificate directory is 0700; nginx still reads the certificates because its master process opens them as root before dropping privileges.", permalink: blob("crates/cli/src/store/cert.rs", "28-36") },
  { section: "design-choices", statement: "The ARI renewal-information request is a plain unsigned GET, as RFC 9773 section 4.1 requires.", permalink: blob("crates/core/src/ari.rs", "6-9") },
  { section: "design-choices", statement: "After editing nginx, validation checks stderr as well as the exit code, because a duplicate server_name passes `nginx -t` with exit code 0.", permalink: blob("crates/cli/src/webserver/nginx/transaction.rs", "23-38") },
  { section: "how-it-is-tested", statement: "`scripts/test.sh` is the test gate: workspace tests, clippy with warnings as errors, a check that no crate appears twice, and a check that aws-lc never enters the dependency tree.", permalink: blob("scripts/test.sh", "25-42") },
  { section: "how-it-is-tested", statement: "The same script runs the SIGTERM test on the x86_64 musl target, the target the signal handling depends on.", permalink: blob("scripts/test.sh", "44-49") },
  { section: "how-it-is-tested", statement: "Unit tests sit beside the code in both crates; one checks the ARI certificate id against RFC 9773's worked example.", permalink: blob("crates/core/src/ari.rs", "323-324") },
  { section: "how-it-is-tested", statement: "Golden tests compare rendered output byte for byte with stored fixtures, using a stubbed backend instead of a network call.", permalink: blob("crates/cli/tests/golden.rs", "3-12") },
  { section: "how-it-is-tested", statement: "End-to-end issuance tests run against Pebble, Let's Encrypt's test ACME server, through `tests/pebble/run.sh`.", permalink: blob("tests/pebble/run.sh", "57-68") },
  { section: "how-it-is-released", statement: "Pushing a version tag runs the release workflow.", permalink: blob(".github/workflows/release.yml", "41-45") },
  { section: "how-it-is-released", statement: "Releases are built with cargo-dist 0.32.0.", permalink: blob("dist-workspace.toml", "7") },
  { section: "how-it-is-released", statement: "Four targets: x86_64 and aarch64 Linux (musl), and x86_64 and aarch64 macOS.", permalink: blob("dist-workspace.toml", "15") },
  { section: "how-it-is-released", statement: "There is no Windows build, because the code uses Unix-only standard-library APIs unconditionally.", permalink: blob("dist-workspace.toml", "10-12") },
  { section: "how-it-is-released", statement: "The installer is a shell script, and no self-updater is installed.", permalink: blob("dist-workspace.toml", "13-19") },
  { section: "how-it-is-released", statement: "Each release publishes its built artifacts to a GitHub Release.", permalink: blob(".github/workflows/release.yml", "279") },
  { section: "known-limits", statement: "P-256 ECDSA is the only key type: no RSA and no Ed25519.", permalink: blob("README.md", "326") },
  { section: "known-limits", statement: "PKCS#12 export is not implemented; `--format pkcs12` prints the equivalent openssl command instead.", permalink: blob("README.md", "327") },
  { section: "known-limits", statement: "There is no Windows release; use WSL or the server itself.", permalink: blob("README.md", "328") },
  { section: "known-limits", statement: "Cloudflare is the only built-in DNS provider; any other goes through `--dns-hook`.", permalink: blob("README.md", "329") },
  { section: "known-limits", statement: "A wildcard name needs DNS-01: without `--dns` or `--dns-hook` it is rejected before any network call.", permalink: blob("crates/cli/src/args.rs", "801-806") },
  { section: "known-limits", statement: "IP identifiers do not work with DNS-01: the order is created first and fails at the challenge step.", permalink: blob("README.md", "331") },
  { section: "known-limits", statement: "Any other known command name (check, doctor, import, revoke, delete, account, status) answers \"not built yet\" at v1.0.1.", permalink: blob("crates/cli/src/args.rs", "563-565") },
  { section: "known-limits", statement: "`install` has no `--json` output.", permalink: blob("README.md", "333") },
];
