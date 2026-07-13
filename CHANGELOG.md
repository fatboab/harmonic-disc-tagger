# Changelog

All notable changes to harmonic-disc-tagger are documented here.

Versioning follows [Semantic Versioning](https://semver.org/): MAJOR.MINOR.PATCH.
Format inspired by [Keep a Changelog](https://keepachangelog.com/).

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
