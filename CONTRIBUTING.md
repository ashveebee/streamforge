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

## Translations

UI text lives in `src/i18n/locales/<language>/`, split by area of the app
(`core.ts`, `widgets.ts`, `media.ts`, `sec.ts` for the Settings sections, and so
on). English (`en/`) is the source; every other language has the same keys, and
`npm run typecheck` fails if one is missing.

- **In a component:** `const t = useT();` then `t('nav.overview')`, or
  `t('dashboard.streams', { count: 3 })`. Outside React, or in a label map at
  the top of a file, import `t` from `@/i18n` (the app re-renders fully when
  the language changes, so this stays current). For a constant object, use a
  getter: `{ get label() { return t('ui.status.healthy'); } }`.
- **New text:** add the key to the English file and to the same file in every
  other language. If you can't translate it, copy the English for now; it can
  be fixed later.
- **Placeholders:** `{name}` is filled from the second argument. Keep the same
  placeholders in every language.
- **Plurals:** use `{ one: '…', other: '…' }` and pass `count`. Each language's
  own plural rules choose the form. Never name a key `other` inside a group of
  messages, or the group is read as a plural.
- **Dates and numbers:** use the helpers in `src/lib/format.ts` (`weekdays()`
  for day names), or pass `getLocale()` to `Intl` / `toLocale…String`, never
  `undefined`.
- **Text from the server** (API errors, audit entries, rule summaries, buffering
  findings, notifications) is English. Where the server sends a fixed set of
  names, such as rule conditions or request statuses, the page translates them
  by id and falls back to the server's text for anything new.
- **New area:** add `<area>.ts` to `en/` and every other language, and list it
  in each language's `index.ts`.
- **Adding a language:** copy an existing translation folder such as `es/` to
  `<code>/` (for example `it/`), translate every file, and add it to `LOCALES`
  in `src/i18n/index.tsx`. Each file is typed as `Messages['<area>']`, so the
  type checker points out anything missing.

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
