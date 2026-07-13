# music-tagger

Automated FLAC tagging tool. You create a minimal `.music-tags.yaml` stub file in each ripped album folder containing just the Discogs release ID. The tool walks a directory tree, finds all stubs, calls the Claude API to generate a complete set of Vorbis comment tags from the Discogs page, and applies them using `metaflac`.

Tags are generated following the conventions established for MinimServer and the Linn audio ecosystem, with full support for classical music (composer, conductor, orchestra, ensemble, performer, works/movements grouping), jazz (composer/lyricist split, ensemble, style), and popular music.

---

## Requirements

- **Node.js 18+**
- **metaflac** — `sudo apt install flac` on Kubuntu/Debian/Ubuntu
- **An Anthropic API key** — for the `generate` and `tag` commands

---

## Installation

```bash
cd music-tagger
npm install
npm run build
```

Make the script executable and optionally add it to your PATH:

```bash
chmod +x dist/index.js
# Optional: symlink to somewhere on your PATH
ln -s "$(pwd)/dist/index.js" ~/.local/bin/tagger
```

Set your API key (add to `~/.bashrc` for permanence):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

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

### Step 2 — Create the stub

Create a `.music-tags.yaml` file in the **album folder** (the folder that contains the disc subfolder, or the audio files directly):

```bash
cat > "/mnt/nas/Music/Ella Fitzgerald/The Jazz Sides/.music-tags.yaml" << 'EOF'
_discogsUrl: 'https://www.discogs.com/release/6670784-Ella-Fitzgerald-The-Jazz-Sides-Verve-Jazz-Masters-46'
EOF
```

That's all you need to put in it.

### Step 3 — Run the tagger

```bash
tagger tag /mnt/nas/Music
```

The tool walks `/mnt/nas/Music`, finds your stub, fetches the Discogs page, asks Claude to generate all the tags, applies them with `metaflac`, and embeds the cover art. The `.music-tags.yaml` is left on disk, fully populated, for your review.

---

## Commands

### `generate`

Walk the tree, find stub `.music-tags.yaml` files, and populate them with tags from Discogs + Claude. Does **not** modify any audio files.

```bash
tagger generate /mnt/nas/Music
tagger generate /mnt/nas/Music --force    # Re-generate even if already done
tagger generate /mnt/nas/Music --verbose  # Show detailed progress
```

### `apply`

Walk the tree, find complete `.music-tags.yaml` files (already generated), and apply their tags to the FLAC files using `metaflac`. Downloads and embeds cover art.

```bash
tagger apply /mnt/nas/Music
tagger apply /mnt/nas/Music --dry-run   # Show what would happen; don't modify files
tagger apply /mnt/nas/Music --verbose   # Show per-tag detail
```

### `tag`

Generate and apply in a single pass. The `.music-tags.yaml` is kept on disk.

```bash
tagger tag /mnt/nas/Music
tagger tag /mnt/nas/Music --dry-run     # Generate only, show apply preview
tagger tag /mnt/nas/Music --force       # Re-generate even for already-tagged albums
tagger tag /mnt/nas/Music --verbose
```

---

## Folder structure

The tool handles three layouts inside each album folder:

**Single disc — audio files directly in the album folder:**
```
Ella Fitzgerald/
  The Jazz Sides/
    .music-tags.yaml        ← stub goes here
    01 - Let's Do It.flac
    02 - ...
```

**Single disc — audio files in a subfolder:**
```
My Artist/
  My Album/
    .music-tags.yaml        ← stub goes here
    01 - Track One.flac
    02 - ...
```

**Multi-disc — one subfolder per disc:**
```
Chris Barber/
  The Complete Decca Sessions/
    .music-tags.yaml                          ← stub goes here
    The Complete Decca Sessions (Disc 1)/
      01 - Bobby Shaftoe.flac
    The Complete Decca Sessions (Disc 2)/
      01 - Lord Lord Lord.flac
```

Disc subfolders must follow the pattern `<Album Name> (Disc N)` or `<Album Name> (Disk N)`.

---

## The .music-tags.yaml file

### Stub (what you create manually)

```yaml
_discogsUrl: 'https://www.discogs.com/release/...'
```

### After generate runs

The stub is replaced with a fully populated file. Example (jazz):

```yaml
_discogsUrl: 'https://www.discogs.com/release/6670784-...'
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
  DISCOGSURL: 'https://www.discogs.com/release/6670784-...'
discs:
  - discNumber: 1
    folder: The Jazz Sides
    tracks:
      - TITLE: Let's Do It (Let's Fall In Love)
        TRACKNUMBER: '01'
        COMPOSER: Cole Porter
        COMPOSERSORT: 'Porter, Cole'
```

Example (classical, with movement grouping):

```yaml
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

**Edit this file freely** before running `apply`. Add, correct, or remove any tags. Then re-run `apply` to apply your changes — it is fully idempotent (clears all existing tags and rewrites from scratch each time).

---

## Tags generated

All tags are Vorbis comments applied with `metaflac`. Tags produced include:

| Tag | Used for |
|---|---|
| `ALBUM`, `ALBUMARTIST`, `ARTIST`, `DATE`, `GENRE` | All releases |
| `STYLE` | Genre sub-style (multi-valued) |
| `TRACKNUMBER`, `DISCNUMBER`, `DISCTOTAL` | Sequencing |
| `DISCSUBTITLE` | Per-disc subtitle on multi-disc sets |
| `CATALOGNUMBER`, `DISCOGSURL` | Release identification |
| `SERIES`, `SERIESNUMBER` | Named release series |
| `COMPOSER`, `COMPOSERSORT` | Classical and jazz |
| `CONDUCTOR`, `CONDUCTORSORT` | Classical |
| `ORCHESTRA`, `ORCHESTRASORT` | Classical — full orchestras |
| `ENSEMBLE`, `ENSEMBLESORT` | Classical — chamber groups, choirs, jazz bands |
| `PERFORMER`, `PERFORMERSORT` | Soloists with instrument/voice |
| `GROUP` | Classical — groups movements into a Work |
| `LYRICIST`, `LYRICISTSORT` | Jazz and pop |
| `ARRANGER` | Where a named arranger is credited |

Sort tags (`*SORT`) are only included when the sort value actually differs from the display value — they're not redundantly duplicated.

---

## Re-applying after edits

```bash
# Edit the YAML
nano "/mnt/nas/Music/Ella Fitzgerald/The Jazz Sides/.music-tags.yaml"

# Re-apply (no API call needed — reads from disk)
tagger apply /mnt/nas/Music
```

## After tagging

Trigger a MinimServer rescan so it picks up the new tags:

- Open MinimWatch → click **Rescan**
- Or from the Linn app: refresh the library source

---

## Notes

- Tags are applied **destructively** — all existing Vorbis comments are cleared and replaced. Use `--dry-run` to preview before committing.
- Cover art is downloaded from Discogs and embedded as a PICTURE block. Existing PICTURE blocks are removed first to avoid duplicates.
- Only **FLAC** files are tagged. MP3 and other formats are skipped with a warning.
- The `generate` step costs a small amount per release (typically a fraction of a cent using `claude-sonnet-4-6`).
