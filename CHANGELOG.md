# Changelog

All notable changes to harmonic-disc-tagger are documented here.

Versioning follows [Semantic Versioning](https://semver.org/): MAJOR.MINOR.PATCH.
Format inspired by [Keep a Changelog](https://keepachangelog.com/).

---

## [2.12.1] — Fix "Streaming is required" error introduced by v2.12.0

### Fixed
- Raising `MAX_OUTPUT_TOKENS` to 32,000 in v2.12.0 introduced a new failure:
  `generate` would immediately fail with "Streaming is required for
  operations that may take longer than 10 minutes" before even reaching
  the Discogs/Claude calls. This is a client-side safety check built into
  `@anthropic-ai/sdk` — it refuses to run a plain non-streaming request
  when it calculates, from `max_tokens`, that the request could exceed 10
  minutes, and 32,000 crosses that threshold. Switched tag generation from
  `client.messages.create()` to `client.messages.stream()` with
  `.finalMessage()`, which waits for the complete response exactly like
  `.create()` did (no incremental/partial handling was needed or added)
  but isn't subject to the same duration restriction. `usage`,
  `stop_reason`, and `content` all behave identically to before, so no
  other code needed to change.

---

## [2.12.0] — Fix response truncation on large/heavily-credited releases

### Fixed
- `generate` could fail with a confusing "Claude returned invalid JSON, and
  fallback extraction also failed" error on releases with unusually large
  ensembles and/or many tracks (e.g. a big-band jazz session with ~20
  credited musicians across 15+ tracks). Root cause: `max_tokens` was set
  to 8,192, far below what such a release actually needs. Every track
  requires its own complete, independent tag set — there's no way to
  "inherit" a shared performer list across tracks at the file-tagging
  level — so a large ensemble's full `PERFORMER`/`PERFORMERSORT` list gets
  repeated near-verbatim on every single track, and this scales with track
  count. The response was being cut off mid-generation, mid-JSON-string,
  well before completion. `claude-sonnet-4-6` actually supports up to
  128,000 output tokens on the standard Messages API; `max_tokens` is now
  set to 32,000 — a generous ceiling comfortably clear of what any
  realistic release should need, without approaching the model's actual
  limit unnecessarily.
- Added explicit `stop_reason === 'max_tokens'` detection immediately
  after the API call, before any JSON parsing is attempted. If a response
  is ever still truncated despite the higher ceiling, the tool now fails
  with a specific, immediately actionable error identifying it as a
  token-limit truncation (including how many output tokens were actually
  generated and where to raise the limit further), rather than a generic
  JSON parse failure that requires manually inspecting the raw response
  to work out what happened.

---

## [2.11.0] — Prompt caching and Discogs payload pruning

### Added
- Prompt caching for the system prompt. The full tagging conventions
  (~5,500 tokens) are identical on every call, so they're now marked with
  an explicit `cache_control` breakpoint. Only the first call in a session
  pays full input-token price for it; subsequent calls within the 5-minute
  cache window read it back at roughly 10% of the normal cost. An explicit
  breakpoint on the system block is required here rather than automatic
  caching — automatic caching would place the breakpoint on the user
  message instead, which is different (and therefore uncacheable) on
  every single call, since it embeds that album's specific Discogs data.
- `pruneReleaseForPrompt()` in `discogs.ts`, which strips the Discogs
  release object down to only the fields the tagging conventions actually
  use before it's sent to Claude. The raw API response carries far more
  than the code's `DiscogsRelease` TypeScript interface implies — since
  TypeScript types don't remove fields at runtime, the object returned by
  `db.getRelease()` still includes community stats, every image variant,
  video links, and a full `resource_url` on every artist credit (repeated
  per track on long tracklists). The Discogs JSON is also now serialized
  compactly rather than pretty-printed. This payload is different for
  every album and can never benefit from caching, so trimming it is the
  more impactful lever for the part of the input cost that's billed fresh
  on every single call.
- `--verbose` now prints a per-album token breakdown (new / cached-read /
  cached-write / output), so cache effectiveness is directly visible while
  running a batch.

### Notes
- Batching multiple albums into a single API call was considered and
  rejected in favour of the above: it would raise the blast radius of a
  malformed response (several albums' tags in one JSON object instead of
  one), push against the `max_tokens` ceiling faster on large multi-disc
  classical releases, and complicate per-album warning/error reporting.
  Caching removes the main cost of the current one-call-per-album design
  without introducing that fragility.
- Skill-style dynamic instruction loading (as used by Claude Code/Claude.ai
  to load reference material on demand) was also considered and rejected —
  nearly every rule in the system prompt applies to every album this tool
  processes, so there's no meaningful subset to selectively load, and this
  direct API integration has no harness for that loading protocol anyway.

---

## [2.10.0] — PERFORMERSORT instrument leakage fix

### Fixed
- `PERFORMERSORT` was incorrectly including the instrument/voice
  parenthetical carried over from the corresponding `PERFORMER` entry, e.g.
  `PERFORMERSORT: "Barber, Chris (trombone, vocals)"` instead of the
  correct `PERFORMERSORT: "Barber, Chris"`. Sort tags exist purely to
  control alphabetical filing by surname; the instrument is display-only
  decoration on `PERFORMER` and has no bearing on how a name should sort.
  The system prompt now explicitly requires `PERFORMERSORT` to contain the
  reordered name only, with a worked correct/incorrect example, and asks
  the model to specifically double-check this before finalising output —
  it was an easy mistake to make when transforming a whole array of names
  at once and carrying the parenthetical along by habit.

---

## [2.9.0] — Warning text precision fix (disc/file misattribution)

### Fixed
- On multi-disc releases, a `_warnings` entry could incorrectly state which
  disc folder a referenced file actually belongs to — e.g. describing a
  file that physically lives in `Disk 1/` as being in `Disk 2/`. The
  underlying tags were unaffected (track-to-title matching was correct);
  the error was confined to the descriptive warning text itself, most
  likely arising when the model cross-referenced multiple discs' track
  numbers (which repeat across discs, e.g. every disc has its own track
  "02") while composing the warning summary.
- The system prompt now includes an explicit precision requirement: before
  writing any warning that references a specific file, disc, or track, the
  model must re-check the FOLDER AND FILE STRUCTURE listing and quote the
  disc folder name exactly as given there, rather than inferring or
  recalling it from memory. A wrong disc reference in a warning defeats
  the purpose of flagging it in the first place, so this is treated as a
  data-quality error in its own right.

---

## [2.8.0] — Classical ARTIST tag consistency fix

### Fixed
- Album-level `ARTIST` on classical (non-compilation) releases was being
  set inconsistently — sometimes to the composer (e.g. "Johann Sebastian
  Bach"), sometimes mirroring `ALBUMARTIST` (the conductor/ensemble, e.g.
  "The English Concert, Trevor Pinnock"), varying unpredictably between
  releases with otherwise identical performers and composer. Root cause:
  the system prompt defined `ALBUMARTIST` for classical explicitly, but
  never once stated what album-level `ARTIST` should be, leaving Claude to
  improvise a different answer each time. The system prompt now explicitly
  states that `ARTIST` must mirror `ALBUMARTIST` for genuine single-performer
  classical releases, and must never be set to the composer — the composer
  already has its own dedicated `COMPOSER` tag. This closes a gap between
  the code's actual behaviour and the rule already documented (but never
  wired into the prompt) in the standalone Music Tagging Guide.

---

## [2.7.0] — Artist name consistency: prefer canonical Discogs name

### Changed
- Tags now default to the canonical `name` field from a Discogs artist
  credit rather than the `anv` (Artist Name Variation) field. Previously
  `anv` was preferred, on the reasoning that it reflects "how the artist
  was credited on this specific release" — but this caused the same artist
  to be tagged inconsistently across a collection whenever different
  releases credited them slightly differently (e.g. "Mr. Acker Bilk" on
  one CD's Discogs entry vs the canonical "Acker Bilk" used everywhere
  else). `name` matches the artist's main Discogs profile page and is
  the stable identity to tag against, keeping one artist as one entry in
  the Artist browse index across the whole collection.
- A narrow exception remains for cases where `anv` reflects a genuinely
  distinct professional identity (e.g. a deliberate pen name used for a
  specific body of work) rather than an incidental release-specific
  spelling — `name` remains the default in all other cases.

### Added
- `--parent-folder-as-artist` flag for `generate` and `tag`. Uses the name
  of the album folder's parent directory as the album-level `ALBUMARTIST`/
  `ARTIST`, overriding even the canonical Discogs name. Intended for cases
  where the user's own folder structure (e.g. `Acker Bilk/Stranger On The
  Shore/`) already reflects their preferred artist name regardless of how
  Discogs credits that particular release. Only applies to genuine
  single-artist releases — has no effect on `ALBUMARTIST: Various`
  compilations, and does not touch per-track `ARTIST` overrides on
  compilation tracks.
- README updated with a new "Artist name consistency" section explaining
  the `name`/`anv` distinction and when to reach for the new flag.

---

## [2.6.0] — Data-quality warnings and JSON parsing resilience

### Added
- `_warnings` field on `.music-tags.yaml`. When Claude identifies a
  data-quality issue during `generate` — most commonly a mismatch between
  the Discogs tracklist order and the actual ripped audio filenames, but
  also ambiguous credits or other judgement calls — it is now recorded as
  a string in a `_warnings` array rather than left unflagged or expressed
  as free-form reasoning text that broke JSON parsing.
- Warnings are printed to the console immediately after `generate` (and
  again after `apply`, in case a previously-generated file is being applied
  later), and persisted in `.music-tags.yaml` so they remain visible on
  review long after the terminal output has scrolled past.
- The final run summary now includes a warning count (`⚠ N warning(s)
  flagged`) alongside the succeeded/skipped/failed counts, so a warning on
  one album in a large batch run doesn't go unnoticed.
- A warning does not stop an album being tagged — `generate` still writes
  a complete `.music-tags.yaml` using its best judgement (e.g. trusting
  actual audio filenames over a mismatched Discogs position number), with
  the warning flagging that the album deserves a closer look.

### Fixed
- Root cause of a failure mode where Claude, faced with a genuinely
  confusing case (Discogs tracklist order not matching the physical rip),
  responded with prose analysis before the JSON object, causing the whole
  album to fail with a JSON parse error and 0 tags being written. The
  system prompt now explicitly forbids any text outside the JSON object
  under all circumstances, with a concrete worked example matching this
  exact failure mode, and directs this kind of finding into `_warnings`
  instead of prose.
- `generateTagsWithClaude` JSON parsing is now defensive as a second line
  of protection: if the model still includes stray text around the JSON
  object despite the instruction, the outermost `{...}` block is extracted
  and parsed as a fallback, with an automatic warning appended noting that
  recovery was needed, rather than failing the whole album outright.

---

## [2.5.0] — Featuring credits: PERFORMER vs TITLE refinement

### Changed
- Refines the v2.4.0 featuring-artist behaviour. Rather than always moving
  a "feat."/"ft."/"featuring" credit into a `TITLE` suffix, the featured
  artist's contribution is now assessed individually:
  - If their role is reasonably identifiable (e.g. known as a vocalist or
    rapper, or explicitly credited with a role such as "Vocals" in the
    Discogs data), they are added as a `PERFORMER` entry with the role in
    parentheses (e.g. `PERFORMER: "Moor Mother (vocals)"`), and `TITLE` is
    left unchanged with no suffix.
  - If their role cannot be confidently determined (e.g. another producer
    or act whose specific contribution is unclear), the credit falls back
    to the v2.4.0 behaviour: `(feat. Artist Name)` appended to `TITLE`,
    with no `PERFORMER` entry created.
  - Multiple featured artists on one track may be split across both
    mechanisms independently, judged case by case.
- `ARTIST` continues to always hold the primary artist only, regardless of
  which mechanism the featured artist ends up in.
- Featured orchestras/ensembles are unaffected by this refinement and
  continue to always use the `TITLE` suffix approach, since they already
  have dedicated `ORCHESTRA`/`ENSEMBLE` tags separate from `PERFORMER`.
- Genuine duo/collaboration credits (joined with "&", no featuring wording)
  remain unaffected, as in v2.4.0.
- README and the standalone Music Tagging Guide updated with a three-way
  worked example (unclear-role fallback, identifiable-role PERFORMER case,
  and the genuine-duo exception) using tracks from the same release.

---

## [2.4.0] — Featuring-artist handling

### Changed
- Tracks credited as "Artist A feat. Artist B" (or "ft.", "featuring", "with")
  no longer put the combined string into `ARTIST`. The primary artist alone
  now goes in `ARTIST`, with the featured artist(s) appended to `TITLE` in
  parentheses, e.g. `TITLE: "Mouth to Mouth (feat. Rival Consoles)"`,
  `ARTIST: "Douglas Dare"`. Previously the whole "Artist A feat. Artist B"
  string was placed in `ARTIST` unchanged, which cluttered the Artist browse
  index with compound entries that don't match how either artist would
  actually be looked up.
- Genuine duo/collaboration credits (equal billing, joined with "&", no
  "feat."/"ft."/"featuring" wording) are explicitly exempted from this rule
  and continue to be tagged as a single `ARTIST` value, e.g.
  `ARTIST: "Hans-Joachim Roedelius & Tim Story"`.
- The same splitting rule extends to tracks featuring a credited orchestra
  or ensemble (e.g. "Penguin Café feat. The City of Prague Philharmonic
  Orchestra") — `ARTIST` holds the primary act, the featured
  orchestra/ensemble is appended to `TITLE`, and `ORCHESTRA`/`ENSEMBLE` is
  still populated separately as normal.
- README and the standalone Music Tagging Guide updated with examples of
  this convention, including the duo/collaboration exception.

---

## [2.3.0] — Tagging consistency fixes and documentation update

### Fixed
- Sort tags (`COMPOSERSORT`, `CONDUCTORSORT`, `ORCHESTRASORT`, `ENSEMBLESORT`,
  `PERFORMERSORT`, `LYRICISTSORT`) were being applied inconsistently — the
  same style of two-word personal name (e.g. "Ólafur Arnalds") would
  sometimes get a sort tag and sometimes not, across different releases.
  The system prompt now states explicitly that any display name of two or
  more words requires a sort tag, since natural reading order always files
  alphabetically under the first word. Sort tags are only omitted for
  genuine single-word names (mononyms, one-word ensemble names).
- `PERFORMER` formatting was inconsistent when one person was credited on
  multiple instruments on the same track — sometimes combined into one
  entry (`"Name (piano, guitar)"`), sometimes split into a separate entry
  per instrument (`"Name (piano)"`, `"Name (guitar)"`). Standardised on
  combining all instruments for the same performer into a single
  comma-separated parenthetical, avoiding the same person appearing
  repeatedly in the Performer browse index.
- `GENRE` was previously limited to the first/primary value from the
  Discogs `genres[]` array. It is now treated the same way as `STYLE`:
  all genre values are included, output as a YAML array when a release
  has more than one credited genre.
- README and CLI `--help` text were still describing the pre-2.0.0
  `_discogsUrl` stub format and had not been updated for the switch to
  `_discogsReleaseId`. Both now correctly document the Discogs Release ID
  workflow, `DISCOGS_USER_TOKEN`, local cover art priority, `REMIXER`, and
  `--folder-as-album`.

### Changed
- `AlbumTags.GENRE` type widened from `string` to `string | string[]` to
  match `STYLE`, so metaflac tag application (already generic over arrays)
  handles multi-valued genres without further code changes.

---

## [2.2.0] — Genre/style fix and folder-as-album option

### Added
- `--folder-as-album` flag for the `generate` and `tag` commands. When set,
  the album folder name is used as the `ALBUM` tag value instead of the
  Discogs release title. Useful when you have named the folder differently
  from the official release title and want your library to reflect that name.

### Fixed
- `STYLE` values were being truncated to a single entry when the Discogs API
  returned multiple styles. All style values are now preserved and output as
  a YAML array when more than one is present.
- `GENRE` handling clarified: the primary (first) genre from the Discogs
  `genres[]` array is used as a single string value, consistent with how
  music servers expect the field to be populated.

---

## [2.1.0] — Remixer tag and per-track credits

### Added
- `REMIXER` tag support. Discogs credits with role `Remix` or `Remixed By`
  are now mapped to `REMIXER` rather than `ARRANGER`. Supports multiple
  values (array) where more than one remixer is credited on a track.
- Per-track `extraartists` are now explicitly processed for every track.
  Previously, credits nested inside `tracklist[N].extraartists[]` (such as
  remix credits, featured vocalists, and per-track soloists) were being
  silently dropped. The Claude system prompt now explicitly mandates
  inspecting each track's own extraartists array.

### Changed
- Clear distinction between `ARRANGER` (acoustic/orchestral arrangements of
  compositions) and `REMIXER` (electronic reworkings of existing recordings)
  documented in the system prompt and applied consistently.

---

## [2.0.0] — Discogs API and Claude API integration

This release replaces the HTML scraping approach with proper API integrations.
The stub `.music-tags.yaml` format changes from `_discogsUrl` to
`_discogsReleaseId`, which is a breaking change.

### Added
- Discogs API integration via the `disconnect` Node.js client. Release data
  is now fetched as structured JSON from the Discogs v2 database API,
  replacing the previous HTML fetch and parse approach.
- Claude AI API integration via `@anthropic-ai/sdk`. The structured Discogs
  JSON is sent to `claude-sonnet-4-6` with a detailed system prompt encoding
  all tagging conventions. Claude interprets credits, applies naming
  conventions, determines composer/lyricist splits, and generates `GROUP`
  values for classical multi-movement works.
- `DISCOGS_USER_TOKEN` environment variable support. When set, authenticated
  Discogs API requests return full-resolution cover art URLs rather than
  150px thumbnails.
- Two-stage pipeline: the Discogs API handles straightforward field mapping
  (`ALBUM`, `DATE`, `GENRE`, `CATALOGNUMBER` etc.); Claude handles everything
  requiring musical knowledge (credits interpretation, naming conventions,
  classical works grouping, composer/lyricist role determination).
- `REMIXER`, `ENSEMBLE`, `ENSEMBLESORT`, `PERFORMER`, `PERFORMERSORT`,
  `LYRICIST`, `LYRICISTSORT`, `ARRANGER` tags generated from Discogs
  `extraartists[]` role data.
- Per-track `ARTIST` override for compilations, populated from each track's
  credited artist rather than the album-level artist.

### Changed
- Stub `.music-tags.yaml` format: `_discogsUrl` (string) replaced by
  `_discogsReleaseId` (integer). The release ID is the numeric portion of
  the Discogs release URL, e.g. `https://www.discogs.com/release/707363`
  → `_discogsReleaseId: 707363`.
- `axios` dependency removed; replaced by the `disconnect` Discogs client
  and Node.js built-in `https` for cover art download.
- Claude system prompt now receives clean structured JSON rather than raw
  HTML, making responses more reliable and API calls cheaper.

### Removed
- HTML page fetching (`fetchDiscogsPage`) — Discogs was blocking automated
  HTTP requests to release pages. The API is the correct and stable interface.
- `axios` package dependency.

---

## [1.3.0] — Local cover art priority

### Added
- Local cover art support. If a `cover.jpg`, `cover.jpeg`, `cover.png`,
  `cover.gif`, `cover.bmp`, or `cover.webp` file is found in the album
  folder, it is used in preference to downloading cover art from the URL
  in `coverArtUrl`. JPEG variants are checked first. This allows
  higher-resolution or manually sourced artwork to be used without
  modifying the tagging file.

---

## [1.2.0] — Workflow redesign: stub-file driven

This release fundamentally changes how the tool is invoked. Rather than
passing a folder and Discogs URL as command-line arguments, the tool now
walks a directory tree looking for `.music-tags.yaml` stub files.

### Added
- Tree-walking mode. The tool scans a root folder recursively, finding every
  folder that contains a `.music-tags.yaml` file and processing each one.
  Descending stops at album folders — their subfolders (disc folders) are
  not walked for further stubs.
- Stub-driven workflow. A minimal stub containing only `_discogsUrl` triggers
  the generate step. The user creates the stub manually after ripping,
  keeping the Discogs URL as the sole configuration needed per album.
- `isTaggingFileComplete()` check. Albums whose `.music-tags.yaml` already
  contains populated `album` and `discs` sections are skipped on `generate`
  unless `--force` is passed. Allows the tool to be run repeatedly against
  a whole library without redundant API calls.
- Progress reporting across multiple albums: `[N/M]` prefix per album,
  final summary of succeeded/skipped/failed counts.

### Changed
- The `tag` command (formerly `automatic`) now operates on a root folder
  containing multiple album subfolders rather than a single album folder
  with a Discogs URL argument.
- `--discogs` flag removed from CLI — the URL is now read from the stub file.
- `DISCOGSURL` tag in the tagging file now derived from `_discogsUrl` in the
  stub rather than passed as a command-line argument.

---

## [1.1.0] — Command rename and cover art improvements

### Added
- `tag` command (replaces `automatic`). Runs `generate` then `apply` in a
  single pass, leaving the `.music-tags.yaml` on disk for review.
- Cover art is now removed and re-embedded cleanly on each `apply` run.
  Existing `PICTURE` blocks are stripped before import to prevent duplicates
  accumulating on repeated apply runs.
- `--dry-run` flag for `apply` and `tag` commands. Shows which files would
  be tagged and (with `--verbose`) what tag values would be written, without
  modifying any files.
- `--force` flag for `generate` and `tag`. Re-generates tags even if a
  complete `.music-tags.yaml` already exists.
- `--verbose` flag. Prints per-track progress and detailed tag values during
  apply.

### Changed
- `automatic` command renamed to `tag` — more concise and descriptive of
  the actual operation.
- Cover art embedded into every tagged FLAC file individually rather than
  just the first track per disc.

### Fixed
- Temp file for cover art import now uses PID in filename to prevent
  collisions if multiple instances run concurrently.

---

## [1.0.0] — Initial release

### Added
- `generate` command. Fetches a Discogs release page by URL, sends the HTML
  to the Claude API with a tagging system prompt, and writes the resulting
  tag data to a `.music-tags.yaml` file in the specified album folder.
- `apply` command. Reads a `.music-tags.yaml` file and applies all tags to
  FLAC files in the album folder using `metaflac`. Downloads and embeds
  cover art from `coverArtUrl`.
- `automatic` command. Runs `generate` then `apply` in sequence, keeping
  the `.music-tags.yaml` on disk.
- `.music-tags.yaml` format. YAML file containing album-level tags, per-disc
  structure, and per-track tags. Acts as the editable intermediate between
  tag generation and tag application, allowing manual correction before
  writing to files.
- Tag application via `metaflac`. All existing Vorbis comments are cleared
  before new tags are written, making each apply run deterministic.
- Support for single-disc and multi-disc folder layouts. Multi-disc releases
  use subfolders named `<Album> (Disc N)` or `<Album> (Disk N)`.
- Audio file to track number matching by numeric filename prefix
  (e.g. `01 - `, `01.`, `01_`), with positional fallback.
- Tags supported: `ALBUM`, `ALBUMARTIST`, `ARTIST`, `DATE`, `GENRE`,
  `STYLE`, `TRACKNUMBER`, `DISCNUMBER`, `DISCTOTAL`, `DISCSUBTITLE`,
  `CATALOGNUMBER`, `DISCOGSURL`, `SERIES`, `SERIESNUMBER`, `COMPOSER`,
  `COMPOSERSORT`, `CONDUCTOR`, `CONDUCTORSORT`, `ORCHESTRA`,
  `ORCHESTRASORT`, `ENSEMBLE`, `ENSEMBLESORT`, `PERFORMER`,
  `PERFORMERSORT`, `GROUP`, `LYRICIST`, `LYRICISTSORT`, `ARRANGER`.
- Naming conventions: natural reading order display tags with separate sort
  tags (`*SORT`) only where the sort value differs from display; name
  particles handled correctly; titles dropped; pen names and commonly-known
  names used in preference to legal names.
- `ANTHROPIC_API_KEY` environment variable for Claude API authentication.
- `metaflac` prerequisite check on `apply` startup.
