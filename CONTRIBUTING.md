# Contributing to GIRP Backend-SOCView

Thank you for your interest in contributing to the GIRP (Guided Incident
Response Platform) project.

## Workflow

- Development happens in an internal repository; this GitHub repository is a
  **snapshot mirror** of the latest release with a single `main` branch and no
  history.
- Open pull requests against `main`. Accepted changes are applied to the
  internal repository by the maintainers (with credit in the changelog) and
  appear here with the next release snapshot — your PR is closed once adopted,
  not merged directly.
- **Note:** every release replaces `main` (force push). Re-sync your fork
  before starting new work:
  `git fetch upstream && git reset --hard upstream/main`
- Keep pull requests focused — one feature or fix per PR.
- Make sure `npm run lint` and `npm test` pass before submitting.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/), e.g.
`feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`, `refactor: ...`.

## Development Setup

See the [README](README.md) for setup instructions (`.env` configuration,
`npm install`, `npm run dev`).

## License

This project is source-available under the
[Sustainable Use License](LICENSE.md). By submitting a contribution, you agree
that it will be distributed under the same license.

## Security Vulnerabilities

Please do **not** report security vulnerabilities via public issues or pull
requests. Email **security@bavariabyte.com** instead — see
[SECURITY.md](SECURITY.md) for details.
