# Contributing to StreamForge

Thanks for helping out! A few conventions keep releases automatic.

## Development

```bash
cp .env.example .env
npm install
npm run dev          # API on :4000, UI on :5173
npm run typecheck    # must pass before opening a PR
npm run build
```

## Commit messages and PR titles

Releases, version numbers and the changelog are generated from
[Conventional Commits](https://www.conventionalcommits.org/). PRs are
squash-merged, so **the PR title becomes the commit message** and is checked by CI.

| Prefix | Example | Release |
| --- | --- | --- |
| `fix:` | `fix: handle Sonarr v4 queue pagination` | patch (1.2.**3**) |
| `feat:` | `feat: add Lidarr integration` | minor (1.**3**.0) |
| `feat!:` / `BREAKING CHANGE:` footer | `feat!: rename SEERR_URL to REQUESTS_URL` | major (**2**.0.0) |
| `perf:`, `revert:`, `deps:` | `perf: cache library counts` | patch |
| `docs:`, `refactor:`, `test:`, `ci:`, `build:`, `chore:`, `style:` | `ci: speed up Docker cache` | no release |

A scope is optional: `fix(radarr): …`.

Breaking changes include anything that requires users to change their `.env`,
volumes or reverse-proxy setup.

## How releases happen

1. Merging to `main` makes Release Please open or update a **release PR**. That
   PR bumps `package.json` and updates `CHANGELOG.md`.
2. Merging the release PR tags `vX.Y.Z` and publishes a GitHub Release.
3. The same workflow then builds and pushes a multi-arch image (`amd64` +
   `arm64`) to `ghcr.io/ashveebee/streamforge`, with an SBOM and signed build
   provenance.

Nobody edits version numbers by hand.
