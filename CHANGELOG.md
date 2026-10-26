# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-10-25

### Security
- Pin the Node.js base images to 22.23.4 (Docker build/runtime stages and CI
  jobs), picking up the Node.js security release of 2026-10-21
  (CVE-2026-111497 Brotli out-of-bounds write, CVE-2026-105482 dns.resolve NUL
  truncation, CVE-2026-106069 TLS IPv4 cert check bypass, CVE-2026-105481
  keep-alive request smuggling, updated c-ares, OpenSSL, Undici and root
  certificates).
- Update the dependencies flagged by `npm audit`: multer 2.2.0 → 2.5.0
  (GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-qvfw-j98x-7q72,
  GHSA-535w-7cp7-47q4, GHSA-3pph-fpjx-jg34, GHSA-q7qp-rjg7-q26m), morgan
  1.11.0 → 1.12.1 (GHSA-jxfw-x594-9x9m, GHSA-9f6g-j8ch-79g4), nodemailer
  9.0.3 → 9.1.1 (GHSA-8m3c-c648-2xjj, GHSA-wmmp-3585-3rmp, GHSA-2x7j-588g-ccc2,
  GHSA-cc9r-2j5m-2m83) and the transitive body-parser 2.4.0
  (GHSA-27r3-jxmh-p828), proxy-addr 2.0.8 (GHSA-jqcg-44mw-7w3h), qs 6.16.1
  (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g), zod 4.6.7 (GHSA-mrhx-c7xc-m3w5),
  ip-address 10.7.5 (GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc,
  GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw, GHSA-rxp7-6hxx-x8q5), fast-copy
  4.3.0 (GHSA-jggr-w7fw-pc2j) and brace-expansion 5.0.12 (GHSA-q2hr-2g5m-vwhr,
  GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p).
- Update nodemailer 9.1.1 → 10.2.1 (major; requires Node.js 20+, already
  satisfied) to close the remaining advisories: cross-transport TLS server
  name reuse in the DNS cache (GHSA-6vj9-mwq6-2f5v), addressparser recipient
  mis-parsing (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h,
  GHSA-g57g-f23g-4646) and denial of service (GHSA-8vvx-rff5-p5rq,
  GHSA-v53p-9fqp-m79j, GHSA-prgh-xp8r-p3m5, GHSA-39m8-27wv-hr27).

## [1.0.0] - 2026-08-09

### Added
- First public release: central admin API of the GIRP platform — tickets with
  audit changelog and live updates, playbook management, users and granular
  permission scopes, multi-provider authentication (Entra ID, Auth0,
  Better-Auth, API tokens) and notification integrations.
- Admin notification mails (update available, new user awaiting approval) go
  to `SUPER_ADMIN_EMAIL` and to every admin who enabled email notifications in
  their personal settings, each in the recipient's preferred language (German
  or English).
- Periodic update check that reads the `org.opencontainers.image.version` OCI
  label from the published images in the container registry and compares it
  with the running version (default every 3 days, configurable via
  `UPDATE_CHECK_*` env vars). On a newer version it mails the admins once and
  exposes the state via `GET /api/update-status`; `POST /api/admin/update-check`
  runs a throttled check on demand.
- Playbook trash: deleted playbooks are soft-deleted and restorable, hidden
  from every read path including the runtime lookups used by Backend-Inputform,
  purged automatically after `TICKET_RETENTION_DAYS`, and purgeable early only
  by the protected `super_admin` role. Their version snapshots are always
  retained, so tickets created from a playbook keep rendering their questions
  after the playbook itself is gone.
- Demo instances: `DEMO_MODE=true` enables the demo login (email/password
  sign-in without email verification) and may be combined with
  `NODE_ENV=production`, in which case startup logs a loud warning.
  `AUTH_EMAIL_PASSWORD_ENABLED` without `DEMO_MODE` aborts startup in
  production.
