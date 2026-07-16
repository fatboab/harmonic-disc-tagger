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
tagger generate /mnt/nas/Music --force             # Re-generate even if already done
tagger generate /mnt/nas/Music --folder-as-album   # Use the album folder name as ALBUM instead of the Discogs title
tagger generate /mnt/nas/Music --verbose           # Show detailed progress
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
tagger tag /mnt/nas/Music --verbose
```

---

## CLI options reference

| Flag | Commands | Meaning |
|---|---|---|
| `--force` | `generate`, `tag` | Re-generate tags even if `.music-tags.yaml` is already complete |
| `--dry-run` | `apply`, `tag` | Show what would be tagged; don't modify any files |
| `--folder-as-album` | `generate`, `tag` | Use the album folder name as `ALBUM` instead of the Discogs release title |
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
    cover.jpg                                  ← optional, album-level
    The Complete Decca Sessions (Disc 1)/
      cover.jpg                                ← optional, per-disc override
      01 - Bobby Shaftoe.flac
    The Complete Decca Sessions (Disc 2)/
      01 - Lord Lord Lord.flac
```

Disc subfolders must follow the pattern `<Album Name> (Disc N)` or `<Album Name> (Disk N)`.

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

Sometimes the Discogs data doesn't quite match the physical disc — for example the tracklist order on Discogs disagreeing with the actual ripped files, or a credit that's ambiguous. When Claude spots this kind of issue during `generate`, it's flagged rather than silently guessed or left to cause a hard failure:

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

Warnings are:
- Printed to the console immediately after `generate` (and again on `apply`, in case you're applying a previously-generated file)
- Persisted in the `_warnings` field of `.music-tags.yaml`, so they remain visible on review even after the terminal output has scrolled away
- Counted in the final run summary (`⚠ N warning(s) flagged`) so a batch run across many albums doesn't let one quietly slip past

A warning does **not** stop the album being tagged — `generate` still writes a complete `.music-tags.yaml`, using its best judgement (e.g. trusting the actual audio filenames over a mismatched Discogs position). The warning is there so you know to double-check that specific album, not a failure state.

If you ever see a warning saying reasoning text had to be stripped from Claude's response, the tags were still recovered successfully, but it's worth reviewing that album a little more carefully than usual.

---

## Notes

- Tags are applied **destructively** — all existing Vorbis comments are cleared and replaced. Use `--dry-run` to preview before committing.
- Cover art priority: a local `cover.jpg`/`.jpeg`/`.png`/`.gif`/`.bmp`/`.webp` file in the album (or disc) folder is used if present; otherwise the `coverArtUrl` from Discogs is downloaded. Existing `PICTURE` blocks are removed before import to avoid duplicates.
- Only **FLAC** files are tagged. MP3 and other formats are skipped with a warning.
- The `generate` step costs a small amount per release (typically a fraction of a cent using `claude-sonnet-4-6`).
- Without `DISCOGS_USER_TOKEN`, cover art from Discogs is limited to 150×150px thumbnails — a local `cover.jpg` avoids this limitation entirely.
