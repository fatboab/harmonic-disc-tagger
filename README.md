# harmonic-disc-tagger

Automated FLAC tagging tool. You create a minimal `.music-tags.yaml` stub file in each ripped album folder containing just the numeric Discogs release ID. The tool walks a directory tree, finds all stubs, fetches the release from the **Discogs API**, calls the **Claude API** to generate a complete set of Vorbis comment tags, and applies them using `metaflac`.

Tags are generated following the conventions established for MinimServer and the Linn audio ecosystem, with full support for classical music (composer, conductor, orchestra, ensemble, performer, works/movements grouping), jazz (composer/lyricist split, ensemble, style), and popular music (remixer, featured artists, compilations).

---

## Requirements

- **Node.js 18+**
- **metaflac** — `sudo apt install flac` on Kubuntu/Debian/Ubuntu
- **An Anthropic API key** — for the `generate` and `tag` commands
- **A Discogs personal access token** (recommended) — for the `generate` and `tag` commands, needed for full-resolution cover art

---

## Installation

```bash
cd harmonic-disc-tagger
npm install
npm run build
```

Make the script executable and optionally add it to your PATH:

```bash
chmod +x dist/index.js
# Optional: symlink to somewhere on your PATH
ln -s "$(pwd)/dist/index.js" ~/.local/bin/tagger
```

Set your API keys (add to `~/.bashrc` for permanence):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DISCOGS_USER_TOKEN=your-discogs-token
```

Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com) → API Keys.

Get a Discogs personal access token from [discogs.com/settings/developers](https://www.discogs.com/settings/developers) → Generate new token. Without this token the tool still works, but cover art will only be available as 150×150px thumbnails rather than full resolution.

---

## Workflow

### Step 1 — Rip the CD

Use `abcde` as normal. The ripped files will end up in a folder structure like:

```
/mnt/nas/Music/
  Ella Fitzgerald/
    The Jazz Sides/
      01 - Let's Do It (Let's Fall In Love).flac
      02 - ...
```

### Step 2 — Find the release on Discogs and note its ID

Find the release on discogs.com. The ID is the number in the URL:

```
https://www.discogs.com/release/6670784-Ella-Fitzgerald-The-Jazz-Sides-Verve-Jazz-Masters-46
                                 ^^^^^^^
                                 this is the release ID
```

Make sure the URL says `/release/`, not `/master/`. Discogs also has **Master releases**, which group together every pressing/version of an album (different countries, vinyl vs CD, reissues, etc.) rather than being a specific physical disc:

```
https://www.discogs.com/master/12345-Some-Artist-Some-Album
                                ^^^^^
                                a MASTER ID — do NOT use this
```

Master and release IDs are separate, unrelated numbering sequences on Discogs, so a master ID can't be used in place of a release ID. If you're on a master page, look for the specific pressing that matches your physical disc (usually under a "Versions" tab) and use the release ID from *that* page instead. If a master ID does end up in `.music-tags.yaml` by mistake, `generate` detects it and fails with a specific error telling you so, rather than a bare "not found".

### Step 3 — Create the stub

Create a `.music-tags.yaml` file in the **album folder** (the folder that contains the disc subfolder(s), or the audio files directly):

```bash
cat > "/mnt/nas/Music/Ella Fitzgerald/The Jazz Sides/.music-tags.yaml" << 'EOF'
_discogsReleaseId: 6670784
EOF
```

That's all you need to put in it — just the number, no quotes needed.

### Step 4 — Run the tagger

```bash
tagger tag /mnt/nas/Music
```

The tool walks `/mnt/nas/Music`, finds your stub, fetches the release from the Discogs API, asks Claude to generate all the tags, applies them with `metaflac`, and embeds the cover art. The `.music-tags.yaml` is left on disk, fully populated, for your review.

---

## Commands

### `generate`

Walk the tree, find stub `.music-tags.yaml` files, and populate them with tags from the Discogs API + Claude. Does **not** modify any audio files.

```bash
tagger generate /mnt/nas/Music
tagger generate /mnt/nas/Music --force                     # Re-generate even if already done
tagger generate /mnt/nas/Music --folder-as-album           # Use the album folder name as ALBUM instead of the Discogs title
tagger generate /mnt/nas/Music --parent-folder-as-artist   # Use the parent folder name as ALBUMARTIST/ARTIST
tagger generate /mnt/nas/Music --verbose                   # Show detailed progress
```

### `apply`

Walk the tree, find complete `.music-tags.yaml` files (already generated), and apply their tags to the FLAC files using `metaflac`. Embeds cover art — a local `cover.jpg` (or `.jpeg`/`.png`/`.gif`/`.bmp`/`.webp`) takes priority if present, otherwise the `coverArtUrl` from Discogs is downloaded.

```bash
tagger apply /mnt/nas/Music
tagger apply /mnt/nas/Music --dry-run   # Show what would happen; don't modify files
tagger apply /mnt/nas/Music --verbose   # Show per-tag detail
```

### `tag`

Generate and apply in a single pass. The `.music-tags.yaml` is kept on disk.

```bash
tagger tag /mnt/nas/Music
tagger tag /mnt/nas/Music --dry-run             # Generate only, show apply preview
tagger tag /mnt/nas/Music --force               # Re-generate even for already-tagged albums
tagger tag /mnt/nas/Music --folder-as-album
tagger tag /mnt/nas/Music --parent-folder-as-artist
tagger tag /mnt/nas/Music --verbose
```

---

## CLI options reference

| Flag | Commands | Meaning |
|---|---|---|
| `--force` | `generate`, `tag` | Re-generate tags even if `.music-tags.yaml` is already complete |
| `--dry-run` | `apply`, `tag` | Show what would be tagged; don't modify any files |
| `--folder-as-album` | `generate`, `tag` | Use the album folder name as `ALBUM` instead of the Discogs release title |
| `--parent-folder-as-artist` | `generate`, `tag` | Use the album folder's parent directory name as `ALBUMARTIST`/`ARTIST`, instead of whatever Discogs credits (including instead of the canonical Discogs artist name). Only affects genuine single-artist releases — has no effect on "Various" compilations or per-track `ARTIST` overrides |
| `--verbose` / `-v` | all | Print detailed per-track progress and tag values |
| `--help` / `-h` | — | Show usage |

---

## Folder structure

The tool handles three layouts inside each album folder:

**Single disc — audio files directly in the album folder:**
```
Ella Fitzgerald/
  The Jazz Sides/
    .music-tags.yaml        ← stub goes here
    cover.jpg                ← optional, takes priority over Discogs art
    01 - Let's Do It.flac
    02 - ...
```

**Single disc — audio files in a subfolder:**
```
My Artist/
  My Album/
    .music-tags.yaml        ← stub goes here
    My Album/
      01 - Track One.flac
```

**Multi-disc — one subfolder per disc:**
```
Chris Barber/
  The Complete Decca Sessions/
    .music-tags.yaml                          ← stub goes here
    cover.jpg                                  ← optional, applies to the whole release
    The Complete Decca Sessions (Disc 1)/
      01 - Bobby Shaftoe.flac
    The Complete Decca Sessions (Disc 2)/
      01 - Lord Lord Lord.flac
```

Disc subfolders must follow the pattern `<Album Name> (Disc N)` or `<Album Name> (Disk N)`.

Cover art is only ever looked for in the album folder itself — there's no per-disc override. A multi-disc release uses one shared `cover.jpg` for every disc.

---

## The .music-tags.yaml file

### Stub (what you create manually)

```yaml
_discogsReleaseId: 6670784
```

Just the numeric release ID — the part of the Discogs URL after `/release/`.

### After generate runs

The stub is replaced with a fully populated file. Example (jazz):

```yaml
_discogsReleaseId: 6670784
_generated: '2025-01-15T14:30:00.000Z'
_albumFolder: The Jazz Sides
coverArtUrl: 'https://i.discogs.com/...'
album:
  ALBUM: The Jazz Sides
  ALBUMARTIST: Ella Fitzgerald
  ARTIST: Ella Fitzgerald
  DATE: '1995'
  GENRE: Jazz
  STYLE: Vocal Jazz
  CATALOGNUMBER: 527 655-2
  SERIES: Verve Jazz Masters
  SERIESNUMBER: '46'
  DISCOGSURL: 'https://www.discogs.com/release/6670784'
discs:
  - discNumber: 1
    folder: The Jazz Sides
    tracks:
      - TITLE: Let's Do It (Let's Fall In Love)
        TRACKNUMBER: '01'
        COMPOSER: Cole Porter
        COMPOSERSORT: 'Porter, Cole'
```

Example (classical, with movement grouping and multiple genres):

```yaml
album:
  ALBUM: 'Peer Gynt / Symphony No. 2'
  ALBUMARTIST: Hannu Lintu
  ARTIST: Hannu Lintu
  DATE: '2015'
  GENRE:
    - Classical
  STYLE:
    - Romantic
    - Orchestral
discs:
  - discNumber: 1
    folder: .
    tracks:
      - TITLE: I. Allegro ma non troppo
        TRACKNUMBER: '01'
        COMPOSER: Ludwig van Beethoven
        COMPOSERSORT: 'Beethoven, Ludwig van'
        CONDUCTOR: Ian Whyte
        CONDUCTORSORT: 'Whyte, Ian'
        ORCHESTRA: BBC Scottish Symphony Orchestra
        PERFORMER: Yehudi Menuhin (violin)
        PERFORMERSORT: 'Menuhin, Yehudi'
        GROUP: Violin Concerto in D, Op. 61
```

Example (a performer credited on multiple instruments on the same track — combined into one entry):

```yaml
      - TITLE: '0040'
        TRACKNUMBER: '01'
        COMPOSER: Ólafur Arnalds
        COMPOSERSORT: 'Arnalds, Ólafur'
        PERFORMER:
          - 'Ólafur Arnalds (piano, guitar, drums, organ, bass, melodica)'
          - 'Sigurdur Bjarki Gunnarsson (cello)'
        PERFORMERSORT:
          - 'Arnalds, Ólafur'
          - 'Gunnarsson, Sigurdur Bjarki'
```

Example (a compilation with "feat." credits — ARTIST always holds the primary artist only; the featured artist goes into `PERFORMER` if their role is identifiable, or a `TITLE` suffix otherwise):

```yaml
album:
  ALBUM: Erased Tapes 17
  ALBUMARTIST: Various
  ARTIST: Various
discs:
  - discNumber: 1
    folder: .
    tracks:
      - TITLE: Mouth to Mouth (feat. Rival Consoles)
        TRACKNUMBER: '02'
        ARTIST: Douglas Dare
      - TITLE: Our Mother's Lights
        TRACKNUMBER: '09'
        ARTIST: Masayoshi Fujita
        PERFORMER: Moor Mother (vocals)
      - TITLE: Graffiti Octaves
        TRACKNUMBER: '13'
        ARTIST: Hans-Joachim Roedelius & Tim Story
```

Three different cases side by side:
- **Track 2** — Rival Consoles is an electronic production act; their specific contribution isn't clearly identifiable, so the credit falls back to a `(feat. ...)` suffix on `TITLE`, and no `PERFORMER` entry is added.
- **Track 9** — Moor Mother is known as a vocalist, so her role is clear: she becomes a `PERFORMER` entry with `(vocals)`, and `TITLE` stays clean with no suffix.
- **Track 13** — a genuine duo credited with "&" (equal billing, no "feat."/"ft."/"featuring" wording) stays as a single `ARTIST` value and isn't affected by any of this — it's not a featuring credit at all.

A featured orchestra or ensemble (as opposed to an individual performer) always keeps the `TITLE` suffix approach, since orchestras/ensembles already have their own dedicated `ORCHESTRA`/`ENSEMBLE` tags rather than `PERFORMER`.

**Edit this file freely** before running `apply`. Add, correct, or remove any tags. Then re-run `apply` to apply your changes — it is fully idempotent (clears all existing tags and rewrites from scratch each time).

---

## Artist name consistency

Discogs credits often differ from release to release for the same artist — a spelling variation, an honorific, a slightly different style ("Mr. Acker Bilk" on one CD, "Acker Bilk" on another). Discogs itself tracks this via two separate fields on every artist credit:

- `name` — the canonical name matching that artist's main Discogs profile page
- `anv` (Artist Name Variation) — how they happen to be credited on this one specific release

By default, tags use the canonical `name` rather than `anv`, specifically so the same artist stays consistent across your whole collection rather than fragmenting into several different spellings depending on which CD happened to credit them differently. This matches the naming conventions established for composers and performers elsewhere in this document (use the commonly-known name, not an incidental variation).

If even the canonical Discogs name isn't what you want — for example, your own folder structure already reflects the name you prefer — use `--parent-folder-as-artist`:

```bash
# Folder layout:
#   Acker Bilk/
#     Stranger On The Shore/
#       .music-tags.yaml

tagger tag "/mnt/nas/Music/Acker Bilk" --parent-folder-as-artist
```

This sets `ALBUMARTIST` and `ARTIST` (album level) to `Acker Bilk` — the name of the album folder's parent directory — regardless of what Discogs credits on that specific release. It only applies to genuine single-artist releases: it has no effect on `ALBUMARTIST: Various` compilations, and doesn't touch per-track `ARTIST` overrides on compilation tracks.

---

## Tags generated

All tags are Vorbis comments applied with `metaflac`. Tags produced include:

| Tag | Used for |
|---|---|
| `ALBUM`, `ALBUMARTIST`, `ARTIST`, `DATE` | All releases |
| `GENRE` | Genre — string if one value, array if multiple (all Discogs genres included) |
| `STYLE` | Sub-style — string if one value, array if multiple (all Discogs styles included) |
| `TRACKNUMBER`, `DISCNUMBER`, `DISCTOTAL` | Sequencing |
| `DISCSUBTITLE` | Per-disc subtitle on multi-disc sets |
| `CATALOGNUMBER`, `DISCOGSURL` | Release identification |
| `SERIES`, `SERIESNUMBER` | Named release series |
| `COMPOSER`, `COMPOSERSORT` | Classical, jazz, and pop where known |
| `LYRICIST`, `LYRICISTSORT` | Jazz and pop, where words/music are separately credited |
| `CONDUCTOR`, `CONDUCTORSORT` | Classical |
| `ORCHESTRA`, `ORCHESTRASORT` | Classical — full orchestras |
| `ENSEMBLE`, `ENSEMBLESORT` | Classical — chamber groups, choirs, jazz bands |
| `PERFORMER`, `PERFORMERSORT` | Soloists with instrument/voice |
| `GROUP` | Classical — groups movements into a Work |
| `ARRANGER` | Acoustic/orchestral arrangement of a composition |
| `REMIXER` | Electronic/production rework of an existing recording |

**Sort tags (`*SORT`)** are added whenever the display name is more than one word (i.e. almost every personal name — "Firstname Surname" always needs a sort tag since natural order files under the first name). They are only omitted for single-word names (mononyms, one-word ensemble names).

**Multiple instruments, one performer:** if the same person is credited on several instruments on one track, they get a single `PERFORMER` entry with all instruments comma-separated in the parentheses, not a separate entry per instrument.

---

## Re-applying after edits

```bash
# Edit the YAML
nano "/mnt/nas/Music/Ella Fitzgerald/The Jazz Sides/.music-tags.yaml"

# Re-apply (no API calls needed — reads from disk)
tagger apply /mnt/nas/Music
```

## After tagging

Trigger a MinimServer rescan so it picks up the new tags:

- Open MinimWatch → click **Rescan**
- Or from the Linn app: refresh the library source

---

## Data-quality warnings

Sometimes the Discogs data doesn't quite match the physical disc — for example the tracklist order on Discogs disagreeing with the actual ripped files, or a credit that's ambiguous. When Claude spots this kind of issue during `generate`, it's flagged rather than silently guessed or left to cause a hard failure.

### Severity: [REVIEW] vs [CRITICAL]

Every warning is one of two severities:

- **`[REVIEW]`** — the routine case. Judgement calls, minor corrections, a track-order swap resolved using file order, spelling/formatting differences between a filename and the Discogs title, or (very common on classical releases) Discogs grouping several movements/scenes/songs under one index entry. This last case is normal and expected, not a sign of anything wrong.
- **`[CRITICAL]`** — reserved for two situations: (1) the Discogs data and the ripped files don't genuinely correspond to each other at all, which usually means the wrong `_discogsReleaseId` was used — the signal isn't a raw track-count mismatch (that's normal for classical grouping, see above), it's whether content can actually be correlated; or (2) a genuine *structural* error in Discogs' own data on a release that otherwise is the right one — a track position that's malformed or doesn't fit the disc/track numbering pattern the rest of the release follows, requiring the track mapping to be reconstructed from file evidence rather than just normalising a title.

Case (2) is worth knowing about specifically: it means the release you picked is correct, but Discogs' own database has an error worth going and fixing there. A real example, from the same release:

```
[CRITICAL] Disc 2, track 05 file is 'Nancy [With The Laughin Face].flac' but
  Discogs position 2-4 is 'Nancy (With The Laughing Face)' and position 14
  (malformed — likely intended as 2-5) is 'My Little Brown Book'. The file
  at Disk 2/05 is 'My Little Brown Book.flac', confirming Discogs position
  '14' is actually disc 2 track 5. Used file order; Discogs position '14'
  is a data-quality error in the source.

[REVIEW] Disc 2, track 04 file is 'Nancy [With The Laughin Face].flac';
  Discogs title is 'Nancy (With The Laughing Face)'. Tagged with Discogs
  title.
```

Both warnings found something "wrong" in the Discogs data, but only the first required reconstructing structural information (which track something actually is) from file evidence — a bracket-vs-parenthesis title difference is routine and stays `[REVIEW]` even though it's technically also a discrepancy.

```
[1/1] Stranger On The Shore
       generate: fetching Discogs + calling Claude... ✓
              Album:  Stranger On The Shore
              Artist: Mr. Acker Bilk
       ⚠  1 warning(s) flagged for this album:
          - Track order mismatch: Discogs lists position 07 as "Never My
            Love" and 14 as "Morning Has Broken", but the ripped files have
            these swapped. Used file order; please verify against the
            physical disc.
```

A `[CRITICAL]` warning is shown with a 🔴 marker inline, and — critically for a large batch run — surfaced again by folder path in a dedicated section at the very end of the run, so you never have to scroll back through a long log to find out which album needs a second look:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEEDS ATTENTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ FAILED (1):
   Shostakovich/Lady Macbeth Of Mtsensk
      Discogs API returned HTTP 404 for release 9999999: ...

🔴 CRITICAL (1) — review these before trusting the tags:
   Shostakovich/Lady Macbeth Of Mtsensk
      Significant track order/grouping mismatch: Discogs lists 28 tracks
      total but the ripped files have 53. Many entries could not be
      confidently matched. Please verify _discogsReleaseId is correct.
```

Hard failures (an album that couldn't be tagged at all) and `[CRITICAL]` warnings (an album that *was* tagged, but with data serious enough to need your review) are listed separately, since they mean different things — a failure needs re-running, a `[CRITICAL]` warning needs you to check the tags that were written and quite possibly re-run with a corrected `_discogsReleaseId`.

### Disc/file reference correction

When a warning names a specific disc and filename (e.g. "Disk 3 file '02 - Track.flac'"), the disc reference is cross-checked against the actual known folder structure and corrected automatically if it's wrong — this doesn't rely on Claude getting it right, since the tool already knows with certainty which disc every file is actually in. If you ever see `[disc reference auto-corrected: ...]` appended to a warning, that's this check catching and fixing a misattributed disc number.

### General behaviour

- Printed to the console immediately after `generate` (and again on `apply`, in case you're applying a previously-generated file)
- Persisted in the `_warnings` field of `.music-tags.yaml`, so they remain visible on review even after the terminal output has scrolled away
- Counted in the final run summary, with `[CRITICAL]`-flagged albums also called out by count and listed by path in the needs-attention section
- A warning does **not** stop the album being tagged — `generate` still writes a complete `.music-tags.yaml`, using its best judgement. The warning is there so you know to double-check that specific album, not a failure state.

If you ever see a warning saying reasoning text had to be stripped from Claude's response, the tags were still recovered successfully, but it's worth reviewing that album a little more carefully than usual.

---

## Resilience on large batch runs

Discogs occasionally returns a transient server error (a 500, or a 429 when rate-limited), and on a run spanning dozens or hundreds of albums it's also realistic to hit a brief local network or DNS hiccup (e.g. `EAI_AGAIN`, `ECONNRESET`, `ETIMEDOUT`) partway through. Discogs API requests are made directly over HTTPS rather than through a third-party client library, with the HTTP status checked before any parsing is attempted, and up to 4 attempts with exponential backoff (1s, 2s, 4s between attempts — 7 seconds total) for both transient server errors and transient network-level failures. If all retries are exhausted, or the failure isn't a transient kind, that one album fails cleanly and the batch moves on to the next — a problem with one album's Discogs data, or a brief network dropout, never takes down the rest of the run. Albums that failed can simply be re-run later with `generate` (or `tag`) — already-completed albums are skipped automatically.

---

## Token usage and cost

Two optimizations keep API costs down when tagging a large collection:

**Prompt caching.** The system prompt (the full set of tagging conventions — around 5,500 tokens) is identical on every single call, regardless of which album is being tagged. It's marked with an explicit cache breakpoint, so only the first call in a session pays full price for it; every subsequent call within the 5-minute cache window reads it back at roughly 10% of the normal input token cost. Run `generate` or `tag` across a batch of albums and only the first one pays full price for the shared instructions — every album after that is markedly cheaper.

**Pruned Discogs payload.** The Discogs API returns far more data per release than the tagger actually needs — community stats, every image variant, video links, and a full `resource_url` on every single artist credit (repeated per track on long tracklists). This gets stripped down to only the fields the tagging conventions actually reference before being sent to Claude, and serialized as compact JSON rather than pretty-printed. Unlike the system prompt, this data is different for every album and can never be cached, so trimming it is the more impactful lever for the part of the bill that's paid fresh on every single request.

Run with `--verbose` to see the token breakdown per album:

```
       generate: fetching Discogs + calling Claude...
      tokens: 340 new + 5501 cached (read) + 1847 output
```

A `cached (write)` figure instead of `cached (read)` means that particular call was the one that populated the cache (the first call in a session, or the first call after the cache has expired) — you'll see this on the first album of a batch run, then `cached (read)` on every album after that within the same session.

### Output token ceiling

Every track needs its own complete, self-contained tag set — there's no way for one file to "inherit" a shared performer list from another at the file-tagging level. On a release with a large ensemble and many tracks (a large-scale choral/operatic work with a big cast is the extreme case — Tavener's *The Veil of the Temple*, an 8-disc set, is a real example this hit) the same lengthy `PERFORMER`/`PERFORMERSORT` list ends up repeated near-verbatim on every single track, which can add up to a substantial amount of output.

`max_tokens` for tag generation is set to 128,000 — `claude-sonnet-4-6`'s actual maximum on the standard Messages API. This was previously set to smaller "generous" values (8,192, then 32,000) that turned out not to be generous enough in practice on real large-ensemble releases, so it's now set to the model's true ceiling directly rather than picking another number that might need raising again. There's no cost or latency downside to a high declared ceiling that goes unused — billing is for tokens actually generated, and a response that finishes early stops early regardless of the ceiling. If a response is ever still cut off at 128,000 tokens, that's a genuinely exceptional case (the release's tagging output is larger than the model's real output limit) and fails with a clear, specific error rather than a confusing "invalid JSON" failure.

Tag generation uses the SDK's streaming API (`client.messages.stream()` with `.finalMessage()`) rather than a plain non-streaming call. This isn't about wanting incremental output — the tool still waits for the complete response before doing anything with it — it's because the Anthropic SDK refuses to run a non-streaming request if it calculates, from `max_tokens`, that the request could take longer than 10 minutes. A high `max_tokens` crosses that threshold easily, so streaming is required regardless of how long any individual response actually takes to generate.

---

### Why not batch multiple albums into one API call?

This was considered, but rejected in favour of caching + payload pruning, for reasons worth knowing about if you're tempted to change it: batching would need each response to carry several albums' worth of tags in one JSON object, meaningfully raising the risk that a single malformed or truncated section brings down the whole batch rather than just one album (something this tool has already needed several rounds of resilience fixes for even at one-album-per-call). It also pushes against the `max_tokens` ceiling faster on large multi-disc classical releases, and complicates the per-album warning/error reporting this tool relies on. Caching already removes the main cost of doing one call per album — the repeated system prompt — without any of that added fragility.

### Why not use Skill-style dynamic instruction loading?

Products like Claude Code and Claude.ai support loading reference material on demand via Skills — reading a relevant `SKILL.md` file only when a task actually needs it, rather than always keeping it in context. That pattern doesn't fit well here: nearly every rule in the system prompt (naming conventions, sort tags, `ARTIST`/`ALBUMARTIST` handling, genre/style rules, warnings discipline) is relevant to *every* album this tool processes — there's no meaningful subset to selectively load, unlike e.g. choosing between a docx skill and a pptx skill for different document types. Prompt caching already gets the same practical outcome — pay once, reuse cheaply — without the added complexity of a dynamic-loading protocol that this direct API integration doesn't have a harness for anyway.

---

## Notes

- Tags are applied **destructively** — all existing Vorbis comments are cleared and replaced. Use `--dry-run` to preview before committing.
- Cover art priority: a local `cover.jpg`/`.jpeg`/`.png`/`.gif`/`.bmp`/`.webp` file in the album folder is used if present; otherwise the `coverArtUrl` from Discogs is downloaded. Existing `PICTURE` blocks are removed before import to avoid duplicates. The embedded image's actual format (JPEG/PNG/GIF/BMP/WEBP) is detected from its file contents and tagged with the correct MIME type — not assumed to always be JPEG.
- When cover art is downloaded from Discogs (i.e. no local `cover.*` file existed), it's also **saved to the album folder as `cover.<ext>`** — the extension matches the image's actual detected format. This is for media servers that look for a cover file on disk rather than reading embedded FLAC art (Plex, Jellyfin, Kodi, and others all do this). It also means the next `apply` run on that album finds the local file and skips the Discogs download entirely.
- Only **FLAC** files are tagged. MP3 and other formats are skipped with a warning.
- The `generate` step costs a small amount per release (typically a fraction of a cent using `claude-sonnet-4-6`).
- Without `DISCOGS_USER_TOKEN`, cover art from Discogs is limited to 150×150px thumbnails — a local `cover.jpg` avoids this limitation entirely.
