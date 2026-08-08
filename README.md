# GIRP — Backend-SOCView

Express/Mongoose backend for the GIRP Security Operations Center. Serves as the
central API for incident lifecycle management, analyst workflows, playbook
administration, and platform configuration.

Built with **Express 5**, **Mongoose**, **Better-Auth**, and **Pino**.

Part of the **GIRP (Guided Incident Response Platform)** — see the other
repositories: Formbuilder, Frontend-Inputform, Backend-Inputform,
Frontend-SOCView, Launcher and GIRP Stack.

## Technology Stack

- **Runtime**: Node.js >= 22.16
- **Framework**: Express 5 (ESM)
- **Database**: MongoDB via Mongoose; file attachments in GridFS (via Multer)
- **Authentication**: Multi-provider — Microsoft Entra ID (JWT via JWKS),
  Auth0, Better-Auth session cookies (social OAuth), and hashed API tokens;
  CSRF protection via double-submit cookie
- **Logging**: Pino + pino-pretty
- **Shared Models**: `@girp/database-models` (npm package)
- **API Spec**: OpenAPI 3.1 (`dist/openapi.yaml`)

## Setup

**Prerequisites:** Node.js >= 22.16 and a running MongoDB instance
(a replica set is required for ticket live updates via change streams).

```bash
cp .env.example .env
npm install
npm run dev      # development server with hot reload
npm start        # production
```

The server listens on `http://localhost:3000` by default.

> **Important:** the server refuses to start without an explicit `NODE_ENV`.
> Set `NODE_ENV=production` for deployments — development mode enables
> conveniences (auto-admin for users without roles) that must never run in
> production. `DEMO_MODE` and `AUTH_EMAIL_PASSWORD_ENABLED` are rejected in
> production; they exist only for local demos (e.g. the GIRP Launcher).

## Environment Variables

`.env.example` is the authoritative, fully commented reference. Key variables:

| Variable | Description |
|---|---|
| `NODE_ENV` | **Required.** `production` or `development` |
| `MONGODB_URI` | MongoDB connection string |
| `PORT` | HTTP port (default: `3000`) |
| `PLATFORM_URL` | Public URL of the GIRP SOCView frontend (CORS/CSRF/trusted origin) |
| `INPUTFORM_URL` | Public URL of the Frontend-Inputform (trusted origin) |
| `FORMBUILDER_URL` | URL of the Formbuilder editor ("Edit Playbook" deep link); defaults to the hosted editor `https://builder.girp.bavariabyte.com` in production |
| `AUTH_AZURE_ENABLED` / `AUTH_BETTERAUTH_ENABLED` / `AUTH_AUTH0_ENABLED` | Which auth providers are active |
| `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` | Entra App Registration (single-tenant GUID strongly recommended; multi-tenant requires `ALLOWED_TENANTS`) |
| `BETTER_AUTH_SECRET` | Secret for Better-Auth session signing |
| `BETTER_AUTH_COOKIE_DOMAIN` | Cross-subdomain cookie domain (e.g. `.girp.example.com`) |
| `CSRF_SECRET` | Stable secret for CSRF tokens (required for multi-replica deployments) |
| `SUPER_ADMIN_EMAIL` | Email address that always receives admin privileges |
| `SMTP_*` | SMTP credentials for email notifications |
| `DEMO_MODE` / `AUTH_EMAIL_PASSWORD_ENABLED` | Demo login (local demos only, blocked in production) |

## API Overview

All `/api` routes require an authenticated identity (Entra/Auth0 JWT,
Better-Auth session cookie, or API token) unless noted. Authorization is
enforced per endpoint via permission scopes (`lib/permissions.js`). The full
contract lives in `dist/openapi.yaml`.

### Tickets

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/tickets` | `tickets:read` |
| `POST` | `/api/tickets` | `tickets:create` |
| `GET` / `PATCH` / `DELETE` | `/api/tickets/:id` | `tickets:read` / `tickets:edit` / `tickets:delete` |
| `GET` | `/api/tickets/:id/timeline` | `tickets:read` |
| `POST` | `/api/tickets/:id/comments` | `tickets:edit` (supports file attachments) |
| `GET` | `/api/tickets/deleted`, `POST /api/tickets/:id/restore`, `DELETE /api/tickets/:id/permanent` | `tickets:delete` |

### Forms & Playbook Versions

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/forms`, `/api/forms/:formId/results`, `/api/forms/:formId/results/:resultId` | `forms:read` |
| `POST` / `PATCH` | form results | `forms:submit` |
| `GET` | `/api/playbooks/:playbookId/versions`, `.../version/:version` | `tickets:read` (historical question lookup) |

### Users

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/users`, `/api/users/:id` | `users:read` |
| `POST` / `PATCH` / `DELETE` | user management, `POST /api/users/:id/roles` | `users:manage` |

### Admin (`/api/admin`, scope `playbooks:manage` or `admin:access`)

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` | `/api/admin/playbooks` | List / create playbooks |
| `GET` / `PATCH` / `DELETE` | `/api/admin/playbooks/:id` | Manage a playbook |
| `POST` | `/api/admin/playbooks/smart-import`, `.../:id/import` | Import playbook definitions |
| `GET` | `/api/admin/playbooks/:id/export` | Export a playbook |
| `GET` / `PATCH` | `/api/admin/settings` | Platform settings (admin) |
| CRUD | `/api/admin/tokens` | API token management (tokens stored hashed) |

### Utility

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Public: feature flags + public OAuth identifiers for the frontends |
| `GET` | `/api/healthz` | Public: liveness probe |
| `GET` | `/api/metrics` | Counter metrics (scope `admin:access`) |
| `GET` | `/api/counters/:name` | Counter admin (scope `admin:access`) |

## Playbook Format

Playbooks are JSON documents authored in the Formbuilder. The format is
documented in the Formbuilder repository:
[`docs/playbook-schema.json`](https://github.com/BavariaByte/formbuilder/blob/main/docs/playbook-schema.json)
(JSON Schema) and
[`docs/playbook-syntax.md`](https://github.com/BavariaByte/formbuilder/blob/main/docs/playbook-syntax.md)
(syntax reference).

## Role Model

Roles map to permission scopes in `lib/permissions.js`:

| Role | Scopes |
|---|---|
| `admin` | `*` (everything) |
| `playbook_manager` | `playbooks:manage`, `tickets:read`, `forms:read` |
| `user` | `tickets:read/create/edit`, `forms:read/submit`, `users:read` |
| `auditor` | read-only (`tickets:read`, `forms:read`, `users:read`) |
| `pending` / `deactivated` | no access |
| Superuser | `SUPER_ADMIN_EMAIL` always has admin privileges |

Roles can also be derived from Entra group memberships or email allowlists
configured via the settings API.

## Services

Background services in `services/` handle asynchronous work:

- **`automationService.js`**: evaluates automation rules triggered by ticket state changes.
- **`notificationService.js`**: dispatches notifications via email, Slack, Teams or PagerDuty. All channels are configured via environment variables.
- **`ticketWatcher.js`**: monitors new tickets via a MongoDB change stream (requires a replica set) and is the primary source of `ticket.created` notifications — including tickets inserted directly into the shared database by other services (e.g. the InputForm backend). The create-ticket API route only notifies itself while the watcher is unavailable.

## Development

```bash
npm run lint   # ESLint
npm test       # Node.js built-in test runner
npm run sbom   # CycloneDX SBOM
```

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

Licensed under the [Sustainable Use License](LICENSE.md) (source-available).
