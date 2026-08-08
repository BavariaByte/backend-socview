# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

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
