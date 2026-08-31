# Contributing to harmonic-disc-tagger

This file records the working process for this repo, so it's the same
regardless of which chat session, tool, or person is making a change.
Read this before starting any change.

---

## Branching and merging

- **One branch per task**, named after the task in `Title-Case-With-Hyphens`
  form (e.g. `Per-disc-cover-art-support`, `Raise-output-token-ceiling-to-
  the-models-actual-maximum`). The branch name should describe *what*
  changed, not a ticket number or generic label.
- **Never push directly to `main`.** All changes land via a pull request.
- **A PR is only merged after explicit approval from the repo owner**,
  given in whatever chat/session opened it. A PR being open and passing
  checks is not itself approval to merge.
- If two branches are worked on concurrently from the same `main` commit,
  whichever merges second must be **rebased onto the post-merge `main`**
  and have its version number renumbered before merging, to avoid two PRs
  claiming the same version number. Check `main`'s actual current version
  immediately before merging, don't assume it's still what it was when the
  branch was created.
- Delete the branch (both remote and local) once its PR is merged.

## Versioning

- Every merged branch bumps the version — [Semantic Versioning](https://semver.org/),
  already declared in `package.json`/`package-lock.json` and enforced by
  convention rather than tooling.
- MAJOR: breaking changes (e.g. the `.music-tags.yaml` stub format change
  in v2.0.0).
- MINOR: new capability, or a meaningful behavioural change — including
  system-prompt-only changes that alter what Claude actually does during
  `generate` (see v2.17.0, v2.19.0), not just code changes.
- PATCH: bug fixes, and process/documentation-only changes with no effect
  on tool behaviour (see this file's own PR).
- Bump **both** `package.json` and `package-lock.json` (the lockfile has
  the version in two places — the root object and the empty-string entry
  under `packages`).

## Documentation that must stay in sync with `main`

- **`README.md`** — user-facing usage docs. Update whenever a flag,
  command, file layout, or resolution-order behaviour changes.
- **`CHANGELOG.md`** — one entry per merged version, newest at the top,
  following the existing format (`## [x.y.z] — Title`, then `### Added` /
  `### Changed` / `### Fixed` / `### Removed` subsections as relevant).
  Explain *why*, not just *what*, matching the existing entries' level of
  detail — future readers (including future Claude sessions) rely on this
  history to understand prior decisions instead of re-litigating them.
- **`CONTRIBUTING.md`** (this file) — update if the process itself
  changes.

## Tagging decisions

Any decision about **how a file should be tagged** — naming conventions,
sort-tag rules, `GROUP`/works-grouping semantics, genre/style handling,
credit interpretation, and anything else that affects the actual Vorbis
comment values `generate` produces — is recorded in `Music-Tagging-
Guide.md`, not just in code comments or the system prompt.

**`Music-Tagging-Guide.md` is not part of this repo.** It lives in the
Claude project's knowledge, alongside a read-only copy of this file. A
Claude session working in this repo cannot push to it directly — when a
tagging decision changes, edit a working copy and hand the updated file
back to the user to re-upload to the project themselves. Say so explicitly
when this happens, so it isn't mistaken for something that's already
synced.

When a tagging-decision change also requires a system-prompt change in
`src/claude.ts` (the common case — a new rule needs the model to actually
follow it), both changes belong in the same PR: the guide documents the
decision, the system prompt implements it.

## Working with the GitHub repo from a Claude session

- The sandbox environment resets between chat sessions (and may reset
  within a long-running one). Nothing installed, cloned, or configured
  persists across sessions automatically — expect to re-clone the repo
  and receive a fresh GitHub token at the start of every session.
- Authentication uses a **fine-grained GitHub personal access token**,
  scoped to this repo only, with `Contents: Read and write` and
  `Pull requests: Read and write` permissions, a short expiry, and no
  broader account access. A new token needs to be generated and provided
  each session (or whenever the previous one expires) — treat this as
  routine, not a one-off setup step.
- `gh` CLI is not available in the sandbox. Git operations authenticate
  via the token embedded in the HTTPS remote URL; PR creation, merging,
  and branch deletion go through the GitHub REST API directly with `curl`.
- Store the token in a file outside the repo (never commit it, never log
  it in a way that ends up in a commit message or PR body), and re-read it
  fresh in each shell command rather than relying on an exported
  environment variable persisting between tool calls — environment
  variables do not reliably persist between separate tool invocations in
  this environment.
- Before resuming any in-progress work at the start of a session, check
  the actual state of `main` and any open PRs/branches on GitHub directly,
  rather than trusting a prior session's summary of where things were
  left — a session can be interrupted mid-task (e.g. by a tooling outage)
  without that being reflected anywhere except conversation history.

## Testing changes before opening a PR

There's no automated test suite in this repo yet. Before opening a PR:

- Run `npx tsc --noEmit` and `npm run build` — both must succeed cleanly.
- For any change to `apply`/`tag` behaviour, build a small synthetic test
  fixture (real FLAC files via `flac`, tagged with the real `metaflac`
  binary) that exercises the change, rather than reasoning about the code
  in the abstract. Verify the actual output (e.g. extract and inspect
  embedded cover art, read back applied tags) rather than only checking
  that the command exits successfully.
- For a change to the Claude system prompt only (no code path affected),
  static review — confirming the prompt text says what's intended, and
  that nothing in the code contradicts or scopes the new instruction — is
  the practical substitute, since there's no way to unit-test model
  behaviour directly from this repo.
