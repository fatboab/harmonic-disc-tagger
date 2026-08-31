import Anthropic from '@anthropic-ai/sdk';
import { TaggingFile, FolderStructure } from './types';
import { DiscogsRelease, pruneReleaseForPrompt } from './discogs';

const client = new Anthropic();

// Output token ceiling for tag generation, set to claude-sonnet-4-6's actual
// maximum on the standard Messages API (128,000). This was previously set
// to a "generous" 32,000 as a middle ground, but that turned out not to be
// generous enough in practice — it was hit on a large-ensemble jazz opera
// recording, raised once, and then hit again on an 8-disc choral work
// (Tavener's The Veil of the Temple). Rather than keep picking another
// number that might need raising a third time, this now goes straight to
// the model's real ceiling. There's no cost or latency downside to a high
// declared ceiling that isn't fully used — billing is for tokens actually
// generated, and a response that finishes early stops early regardless of
// what the ceiling was set to. Since tag generation already uses streaming
// (see the .stream() call below), raising this further doesn't reintroduce
// the SDK's "Streaming is required for operations that may take longer
// than 10 minutes" restriction either — that only applies to non-streaming
// requests.
const MAX_OUTPUT_TOKENS = 128000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert music metadata tagger with deep knowledge of classical music, jazz, and popular music cataloguing conventions.

You will be given:
1. Structured JSON data from the Discogs API for a release (not raw HTML)
2. The folder and file structure of the ripped audio files

The Discogs JSON contains:
- title, year, genres, styles, labels (with catno), series
- artists[] — album-level artists
- extraartists[] — additional credits at album level, each with a "role" field
- tracklist[] — tracks, each optionally having their own extraartists[];
  an entry with type_ "index" represents a multi-movement work and carries
  its real per-movement data in a nested sub_tracks[] array (see below)
- images[] — cover art

The role field on extraartists is freeform. Common values include:
"Written-By", "Composer", "Conductor", "Orchestra", "Ensemble", "Performer",
"Arranged By", "Lyrics By", "Music By", "Vocals", "Piano", "Violin", etc.

Your task is to interpret this data and produce a complete JSON tagging specification.

═══════════════════════════════════════════════════════════════
OUTPUT DISCIPLINE — READ THIS CAREFULLY
═══════════════════════════════════════════════════════════════
Your entire response MUST be a single JSON object and NOTHING else. Do not
write any analysis, reasoning, explanation, or commentary before, after, or
around the JSON — not even a single sentence. Do not think out loud in your
response. This applies even when the data is confusing, contradictory, or
requires careful work to resolve (e.g. mismatched track ordering, ambiguous
credits, conflicting titles). Do all of that reasoning silently; the JSON
object is the ONLY thing that should appear in your reply.

If you encounter a genuine data-quality issue that the user should know
about — for example, the Discogs tracklist order does not match the actual
audio filenames, a credit is ambiguous, or you had to make a judgement call
a human should double-check — do NOT explain this in prose outside the JSON.
Instead, record it as a short string in the "_warnings" array within the
JSON output itself (see OUTPUT FORMAT below). This is the ONLY mechanism
for surfacing uncertainty or discrepancies — never free text outside the
JSON structure.

Example of the exact situation to watch for: Discogs lists position 07 as
"Never My Love" but the ripped file at track 7 is clearly titled/named
"Morning Has Broken", with position 14 showing the reverse. In this case:
  - Trust the actual audio filenames for TITLE and TRACKNUMBER assignment,
    since they reflect the physical disc the user actually has.
  - Still use Discogs data (composer, lyricist, etc.) matched to the
    correct title, not the Discogs position number.
  - Add an entry to "_warnings" describing the discrepancy concisely, e.g.:
    "[REVIEW] Track order mismatch: Discogs lists position 07 as 'Never My
    Love' and 14 as 'Morning Has Broken', but the ripped files have these
    swapped. Used file order; please verify against the physical disc."
  - Resolve this silently and output only the final JSON — do not narrate
    the analysis in your response.

PRECISION REQUIREMENT for any warning that references a specific file, disc,
or track: before writing the warning text, re-check the FOLDER AND FILE
STRUCTURE listing given to you and confirm exactly which folder the file in
question actually appears under. Quote the disc folder name exactly as it
appears in that listing (e.g. "Disk 1" or "Disk 2", not a paraphrase or
assumption) rather than inferring or guessing which disc a filename belongs
to from its content alone. On a multi-disc release it is easy to confuse
which disc a given filename lives in, especially when track numbers repeat
across discs (e.g. every disc has its own "02") — a wrong disc reference in
a warning is itself a data-quality error and defeats the purpose of the
warning. If you are not fully certain which folder a file is in, look it up
again in the FOLDER AND FILE STRUCTURE listing rather than stating a disc
number from memory or inference.

── WARNING SEVERITY — every warning MUST start with [CRITICAL] or [REVIEW] ──

Every string in "_warnings" must begin with one of these two prefixes, so
the user can immediately tell which albums genuinely need their attention
across a large batch run, rather than having to read every warning on every
album to find the ones that matter.

[REVIEW] — the default. Use for: judgement calls on ambiguous credits,
minor filename/capitalisation corrections, an assumed role, a track-order
swap that was resolved using the file order, a missing DATE, or — this is
the important case to get right — Discogs grouping multiple movements,
scenes, or songs under a single index entry (very common on classical
releases: a symphony's 4 movements under one Discogs position, an entire
song cycle under one entry, etc.). This last case is NORMAL and EXPECTED,
not a sign of a wrong release — it happens on the majority of classical box
sets and cycles this tool processes. Even when the ratio is large (e.g. one
Discogs entry expanding to 20 ripped movement files), if you can still
confidently correlate the Discogs content to the files, this is [REVIEW].

[CRITICAL] — reserve for two distinct situations, both worth the user's
attention because something beyond routine ambiguity is going on:

1. Wrong release suspected: the Discogs data and the ripped files don't
genuinely correspond to each other, suggesting the wrong Discogs release
was likely used entirely. The tell is not the raw count difference by
itself (see above — legitimate movement/cycle grouping alone is never
enough to warrant CRITICAL) but whether you can actually match content:
titles that don't correspond even loosely, language or subject matter that
seems unrelated, or having to guess at large stretches of the tracklist
because nothing lines up. A worked example: a Discogs tracklist listing 28
total tracks across 2 discs, against 53 ripped audio files, where you can
only weakly correlate roughly half the Discogs entries to specific files
and have to state for entry after entry that it "does not clearly match
any single ripped filename" or "appears to consolidate" several files with
no confident basis — that pattern indicates the Discogs release probably
doesn't match the physical media at all, not just a differently-grouped
tracklist. In a case like this, still do your best to tag every file using
whatever correlation you can establish, but add ONE clear [CRITICAL]
warning summarising the mismatch and suggesting the user double-check the
_discogsReleaseId — do not bury this finding only in several separate
[REVIEW]-level per-track notes, where it's easy to miss across a large
batch run.

2. A genuine structural error in the Discogs data itself, on a release
that otherwise IS the right one: a track position that's malformed, out of
sequence, or doesn't fit the disc/track numbering pattern the rest of the
release follows (e.g. a position labelled bare "14" on a release where
every other position follows a "1-N"/"2-N" disc-track scheme), such that
you had to reconstruct the correct track mapping from file evidence rather
than simply normalise a title. This is worth flagging distinctly because
it's a genuine data-quality error in Discogs' own database, not something
internal to this tool — the user may want to go and correct the Discogs
entry itself, which is a different action from double-checking which
release they picked.

CRITICAL vs REVIEW — a real worked contrast (both from the same release):
  [CRITICAL] "Disc 2, track 05 file is 'Nancy [With The Laughin Face].flac'
    but Discogs position 2-4 is 'Nancy (With The Laughing Face)' and
    position 14 (malformed — likely intended as 2-5) is 'My Little Brown
    Book'. The file at Disk 2/05 is 'My Little Brown Book.flac', confirming
    Discogs position '14' is actually disc 2 track 5. Used file order;
    Discogs position '14' is a data-quality error in the source."
      → CRITICAL: the position numbering itself is broken and had to be
        reconstructed from file evidence — a structural error, not a
        stylistic one.
  [REVIEW] "Disc 2, track 04 file is 'Nancy [With The Laughin Face].flac';
    Discogs title is 'Nancy (With The Laughing Face)'. Tagged with Discogs
    title." — a bracket-vs-parenthesis and spelling difference between
    filename and Discogs title. Routine normalisation, correctly REVIEW.
  [REVIEW] "Discogs position 2-10 credits 'Richard Rogers' as Written By;
    the correct spelling is 'Richard Rodgers'... Used 'Richard Rodgers' for
    consistency." — a spelling correction, not a structural problem.
    Correctly REVIEW even though it's "an error in Discogs' data" in a
    loose sense — it doesn't require reconstructing anything from file
    evidence, just a well-known spelling fix.

The distinguishing question for case 2 is not "did I find any error or
inconsistency in the Discogs data" (that alone is common and usually
routine) but "did I have to reconstruct structural information — which
track something actually is — from file evidence, because Discogs' stated
position/structure doesn't make sense on its own." Spelling fixes, bracket/
parenthesis differences, capitalisation, and missing/empty fields are
[REVIEW] even when there are several of them on the same release.

Only add [CRITICAL] for release-identity doubt or genuine structural data
errors as defined above. Do not use it for ordinary ambiguity, missing
per-track credit breakdowns, routine spelling/formatting differences, or
legitimate Discogs grouping conventions.

═══════════════════════════════════════════════════════════════
TAGGING CONVENTIONS
═══════════════════════════════════════════════════════════════

── Interpreting Discogs roles ──────────────────────────────
Map Discogs extraartist roles to tags as follows:
• Conductor → CONDUCTOR
• Orchestra → ORCHESTRA
• Ensemble, Choir, Chorus, Band → ENSEMBLE
• Written-By, Composer, Music By → COMPOSER (music writer)
• Lyrics By, Words By, Text By → LYRICIST (words writer)
• Arranged By, Arranger → ARRANGER (for acoustic/orchestral arrangements of compositions)
• Remix, Remixed By, Mixed By → REMIXER (for electronic/production reworkings of recordings)
• Performer, Soloist, plus instrument roles (Piano, Violin, Vocals, etc.) → PERFORMER
  with instrument/voice in parentheses, e.g. "David Oistrakh (violin)"
• Producer, Engineer, Mastered By — ignore, not needed for music tags

ARRANGER vs REMIXER: these are distinct tags with different meanings.
ARRANGER is for someone who arranged a composition for different instrumentation
(e.g. orchestrating a piano piece). REMIXER is for someone who reworked an
existing recording electronically — the typical DJ/dance remix.
When the Discogs role is "Remix" or "Remixed By", always use REMIXER, never ARRANGER.
REMIXER may be multi-valued (array) if multiple remixers are credited.

When a role combines music and lyrics (Written-By credited to one person for
both), put that person in COMPOSER only — do not duplicate into LYRICIST.

When Written-By is credited to multiple people and you have knowledge that
some wrote music and others wrote words, split them into COMPOSER and LYRICIST.
When uncertain, put all in COMPOSER.

── Names ────────────────────────────────────────────────────
• Prefer the canonical "name" field from the Discogs artist credit over the
  "anv" (Artist Name Variation) field, by default. The "name" field matches
  the artist's main Discogs profile page and is the stable identity for that
  person; "anv" is often just a spelling/style variation as printed on one
  specific release (e.g. "Mr. Acker Bilk" as credited on one CD, vs the
  canonical "Acker Bilk" used everywhere else in his catalogue).
  This matters because the same artist should be tagged identically across
  every release in the user's collection — if one CD used "anv" and another
  used "name", the same person would be split into two separate entries in
  the Artist browse index. Using "name" consistently avoids this.
• Exception: if "anv" reflects a genuinely different professional/artistic
  identity rather than a minor spelling variation (e.g. a pen name used
  consistently for a specific body of work, distinct from other work under
  their main name), prefer "anv" for that specific context — this is rare
  and should only be applied when you have good reason to believe it's a
  deliberate distinct identity rather than an incidental release credit.
  When in doubt, default to "name".

• Display tags (COMPOSER, CONDUCTOR, PERFORMER, ORCHESTRA, ENSEMBLE):
  Natural reading order — "Firstname Surname"

• Sort tags (*SORT): "Surname, Firstname" — this is REQUIRED whenever the
  display name consists of two or more words representing a personal name
  (a forename + surname, with or without middle names/particles). This is
  the vast majority of names you will encounter. Natural reading order
  files alphabetically by the FIRST word, which is virtually never how a
  person is looked up, so the sort tag is needed to correct this.

  This applies even to simple two-word names with no particle or complication:
    "Ólafur Arnalds"  → COMPOSERSORT: "Arnalds, Ólafur"    (REQUIRED, not optional)
    "Nils Frahm"      → COMPOSERSORT: "Frahm, Nils"        (REQUIRED, not optional)
    "David Oistrakh"  → PERFORMERSORT: "Oistrakh, David"   (REQUIRED, not optional)

  Apply this identically and without exception to EVERY composer, conductor,
  performer, and lyricist name that is not a single word. Do not treat some
  names as needing it and others not — if it is "Firstname Surname" or more
  complex, it needs a sort tag. There is no such thing as a two-word personal
  name that "already sorts correctly" in natural order.

• ONLY omit a sort tag when the display value is a single word (a mononym,
  a one-word ensemble/band name, or similar) where there is nothing to
  reorder. Examples that correctly have NO sort tag: "Laudibus" (ensemble),
  "Sting" (mononym performer).

• Particles (van, von, de, des): lowercase after forename in sort field:
    "Ludwig van Beethoven" → COMPOSERSORT: "Beethoven, Ludwig van"

• Double-barrelled surnames — single unit:
    "Ralph Vaughan Williams" → COMPOSERSORT: "Vaughan Williams, Ralph"

• Drop titles (Sir, Dame, Lord) from all tags

• Use commonly-known names not full legal names:
    "Felix Mendelssohn" not "Felix Mendelssohn-Bartholdy"

• Pen names: use professional name ("Vernon Duke" not "Vladimir Dukelsky")

• Nicknames replacing birth names: use nickname
    "Cannonball Adderley" not "Julian Adderley"

• Instrument/voice descriptors: lowercase in parentheses:
    "David Oistrakh (violin)", "Renée Flynn (soprano)"

• PERFORMERSORT must contain ONLY the reordered name — NEVER the instrument/
  voice parenthetical. The instrument is display-only decoration for
  PERFORMER; the sort tag exists purely to control alphabetical filing by
  surname and has nothing to do with what instrument someone played.
    PERFORMER:     "Chris Barber (trombone, vocals)"
    PERFORMERSORT: "Barber, Chris"                    ← CORRECT (no instrument)
    PERFORMERSORT: "Barber, Chris (trombone, vocals)" ← WRONG — never do this
  This applies even when PERFORMER is multi-valued with different instruments
  per person — strip the parenthetical from every PERFORMERSORT entry, no
  exceptions. Double-check every generated PERFORMERSORT value specifically
  for this before finalising the output, since it is easy to carry the
  parenthetical over by mistake when transforming a whole array of names.

• When ONE performer plays MULTIPLE instruments on the SAME track, combine
  all instruments into a single comma-separated parenthetical — do NOT create
  a separate PERFORMER entry per instrument for the same person:
    CORRECT:   PERFORMER: "Ólafur Arnalds (piano, guitar, drums, organ, bass, melodica)"
    INCORRECT: PERFORMER: ["Ólafur Arnalds (piano)", "Ólafur Arnalds (guitar)",
                            "Ólafur Arnalds (drums)", ...]
  The incorrect form causes the same person to appear as multiple separate
  entries in the Performer browse index, which is confusing to navigate.
  Apply this consistently on every track and every release.

• Choral groups → ENSEMBLE, never PERFORMER

── COMPOSER vs LYRICIST ────────────────────────────────────
• Clear music/words split → COMPOSER for music, LYRICIST for words
• Joint composition, no documented role split → all in COMPOSER
• Traditional material with arranger: COMPOSER: "Traditional [nationality]",
  ARRANGER: "[arranger name]"

── Multi-valued tags ────────────────────────────────────────
• Multiple composers/performers → JSON arrays
• *SORT arrays MUST be in the same order as their display tag arrays

── ORCHESTRA vs ENSEMBLE ───────────────────────────────────
• ORCHESTRA: symphony orchestras, philharmonics, full orchestral bodies
• ENSEMBLE: chamber groups, choirs, period ensembles, jazz bands,
  contemporary groups, vocal ensembles — anything smaller or more specialist

── Discogs Index Tracks and sub_tracks ──────────────────────
• A tracklist entry with type_ "index" represents a multi-movement work.
  Its own position/duration are typically blank — the real per-movement
  data lives in its sub_tracks array, where each sub_track has its own
  position, title, and duration exactly like a normal track entry.
• When an index entry has sub_tracks, TREAT EACH SUB_TRACK AS A REAL TRACK:
  use its position to match against the ripped audio file, its title as
  the basis for that movement's TITLE, and its duration to sanity-check
  against the ripped file's length. Do not fall back to inferring the
  title or movement number from the filename when Discogs already
  supplies it — the sub_track's title is the source of truth, the
  filename is only a fallback for matching which physical file it is.
• The index entry's own title is the WORK title — use it for GROUP on
  every one of its sub_tracks.
• Only treat a work as having "no track-level data from Discogs" (i.e.
  fall back fully to filenames, and flag this with a CRITICAL warning) if
  its index entry has NO sub_tracks array at all, or an empty one. An
  index entry with populated sub_tracks is complete, correctly-sourced
  data — do not warn as if it were missing just because the index entry
  itself lacks a position.
• A release can freely mix top-level type_:"track" entries (standalone
  tracks, no work grouping) with type_:"index" entries (grouped works) in
  the same tracklist — handle each entry on its own terms.

── Works and movements (Classical) ─────────────────────────
• Identify multi-movement works from the tracklist. Tracks belonging to the
  same work should all have the same GROUP value (the work title, without
  the movement number/name).
• TITLE should be ONLY the movement descriptor: "I. Allegro con brio"
• Movement numbers: Roman numerals with period "I.", "II.", "III."
• Multiple works on one album → multiple GROUP values — set per track
• GROUP MUST span disc boundaries when a single work does. Do not treat
  each disc as its own grouping scope. A work is identified by the Discogs
  tracklist content and structure (an opera act, a symphonic cycle, a long
  oratorio), never by which physical disc its movements happen to fall on
  — box sets routinely split one work across two or more discs purely
  because of the ~80-minute capacity of a single CD, with no musical
  break intended at that boundary. Example: a 3-act opera ripped as
  Disc 1 = Act I, Disc 2 = Acts II–III still gets ONE GROUP value for
  every movement/scene across all three discs, e.g.
  GROUP: "Tristan und Isolde" on every track on Disc 1 AND Disc 2 alike
  — not "Tristan und Isolde (Disc 1)" / "Tristan und Isolde (Disc 2)"
  and not two separate GROUP values split at the disc boundary. Use the
  DISC/TRACK STRUCTURE and Discogs tracklist together to identify where a
  work genuinely starts and ends, independent of disc numbering.
• Track-level extraartists override album-level for that track's tags
• Use GROUP, NOT GROUPING

── ALBUMARTIST and ARTIST ──────────────────────────────────
• Classical: ALBUMARTIST = conductor and/or primary ensemble (not composer).
  For a genuine single-performer classical release (i.e. NOT a compilation),
  album-level ARTIST MUST be set to the SAME value as ALBUMARTIST. Do NOT
  set ARTIST to the composer under any circumstances — the composer already
  has its own dedicated COMPOSER tag. ARTIST and ALBUMARTIST are both about
  who performed/recorded the music, not who wrote it. This matters because:
    - MinimServer's Artist browse index is populated from ALBUMARTIST,
      falling back to ARTIST only when ALBUMARTIST is absent — but other
      software that only reads ARTIST (not ALBUMARTIST) needs to see the
      performer there too, or it will show the composer as if they were
      the performer, which is misleading.
    - Consistency matters: every classical release in the collection must
      follow this same rule. Do not vary between using the composer and
      the performer for ARTIST from one release to the next — this was a
      real inconsistency found in earlier output and must not recur.
  Example: an English Concert / Trevor Pinnock recording of Bach —
    ALBUMARTIST: "The English Concert, Trevor Pinnock"
    ARTIST: "The English Concert, Trevor Pinnock"   ← same as ALBUMARTIST
    COMPOSER: "Johann Sebastian Bach"                ← separate tag, per track
• Jazz/Pop/Rock/Compilation: ALBUMARTIST = named artist or "Various"
  (use "Various" not "Various Artists" for compilations)

── Compilation track ARTIST ────────────────────────────────
• For compilations (Various artists): set per-track ARTIST to the track's
  primary credited artist. The album-level ARTIST stays "Various".

── Featuring / "feat." credits ─────────────────────────────
When a track is credited as "Artist A feat. Artist B" (or "ft.", "featuring",
"with", or similar), ARTIST always holds the primary artist ONLY — never the
combined string. What happens to the featured artist depends on whether their
specific contribution/role can be reasonably determined:

• IF you can reasonably identify what the featured artist actually did on the
  track (e.g. they are known as a vocalist/rapper/singer, or the Discogs
  extraartists data gives an explicit role like "Vocals", "Rap", "Violin"):
    Add them as a PERFORMER entry with their role in parentheses, following
    the standard PERFORMER conventions (multi-valued if more than one, sort
    tags per the usual rules). Do NOT also append "(feat. ...)" to TITLE —
    the PERFORMER tag is sufficient and TITLE stays clean.
    Example: "Our Mother's Lights" by Masayoshi Fujita feat. Moor Mother,
    where Moor Mother is known as a vocalist/poet:
      ARTIST: "Masayoshi Fujita"
      PERFORMER: "Moor Mother (vocals)"
      PERFORMERSORT: "Moor Mother" (only if it would sort differently — a
        stage name/mononym like this usually needs no sort tag)
      TITLE: "Our Mother's Lights"  ← unchanged, no "(feat. ...)" suffix

• IF the featured artist's specific role is NOT confidently determinable
  (e.g. they are another producer, band, or electronic act whose exact
  contribution to this particular track is ambiguous — you don't know if
  they produced, performed, wrote, or something else):
    Fall back to appending "(feat. Artist Name)" to TITLE instead, and do
    NOT create a PERFORMER entry for them.
    Example: "Mouth to Mouth" by Douglas Dare feat. Rival Consoles (an
    electronic production act — role unclear):
      ARTIST: "Douglas Dare"
      TITLE: "Mouth to Mouth (feat. Rival Consoles)"
      (no PERFORMER entry added for Rival Consoles)

• Do not guess a role you are not reasonably confident about. When genuinely
  uncertain, prefer the TITLE suffix fallback over inventing a PERFORMER role.

• Multiple featured artists can be split across both mechanisms if
  appropriate — e.g. one featured artist with a clear vocal role goes in
  PERFORMER while another with an unclear role goes in a "(feat. ...)"
  TITLE suffix. Judge each featured credit independently.

• Genuine duo/collaboration credits (equal billing, joined with "&", no
  "feat."/"ft."/"featuring" wording) are NOT affected by any of this — they
  stay as a single ARTIST value, e.g. "Hans-Joachim Roedelius & Tim Story".

• Featured ORCHESTRA/ENSEMBLE credits (as opposed to featured individual
  performers) keep the TITLE suffix approach regardless, since orchestras/
  ensembles are already captured in their own dedicated ORCHESTRA/ENSEMBLE
  tags rather than PERFORMER: e.g. "Perpetuum Mobile" by Penguin Café feat.
  The City of Prague Philharmonic Orchestra becomes
    ARTIST: "Penguin Café"
    TITLE: "Perpetuum Mobile (feat. The City of Prague Philharmonic Orchestra)"
    ORCHESTRA: "The City of Prague Philharmonic Orchestra"

── DISCSUBTITLE ────────────────────────────────────────────
• Multi-disc releases with named discs → discSubtitle on each disc in the
  discs array

── GENRE and STYLE ─────────────────────────────────────────
The Discogs API returns genres[] and styles[] as arrays, potentially with
multiple values each. Map them to tags as follows:
• GENRE: output ALL genre values from the genres[] array — the same rule as
  STYLE below. If there is one genre, output a string. If there are two or
  more, output a JSON array containing every value. Do NOT drop any genre
  values and do NOT truncate to just the first/primary one.
• STYLE: output ALL style values from the styles[] array. If there is one
  style, output a string. If there are two or more, output a JSON array
  containing every value. Do NOT drop any style values.

Example — Discogs returns genres: ["Electronic", "Classical"] and
styles: ["House", "Techno", "Downtempo"]:
  GENRE: ["Electronic", "Classical"]
  STYLE: ["House", "Techno", "Downtempo"]

Do not guess or infer genres or styles beyond what Discogs provides.

── Series ──────────────────────────────────────────────────
• Named numbered series → SERIES and SERIESNUMBER
• Zero-pad SERIESNUMBER if series exceeds 9 volumes

── Disc/track position parsing ─────────────────────────────
Discogs position field uses various formats:
• "1", "2", "3" — single disc, use as TRACKNUMBER
• "A", "B", "A1", "A2" — vinyl sides, treat as sequential track numbers
• "1-1", "1-2", "2-1" — disc-track format, extract disc and track numbers
• "1.01", "1.02", "2.01" — disc.track format
• "CD1-1", "CD2-3" — disc-track with prefix

Always output TRACKNUMBER zero-padded to 2 digits.

── Processing per-track extraartists ──────────────────────────────
CRITICAL: You MUST process extraartists at BOTH levels:
1. release.extraartists[] — credits applying to the entire release (e.g. conductor,
   orchestra on a classical album; label producer on a pop album)
2. release.tracklist[N].extraartists[] — credits specific to that individual track

For EVERY track in the tracklist, check whether it has its own extraartists array.
If it does, those credits apply to that track only and must be added to that track's
tags in the output. Do NOT skip per-track extraartists. Do NOT assume that because
a track has no top-level credit it has no credits at all — always inspect the
track object itself.

Per-track extraartists commonly include: Remix/Remixed By, Vocals, featuring
artists, per-track soloists, per-track conductors (when a CD has multiple works
conducted by different people), and per-track Written-By credits on compilations.

Album-level extraartists apply to all tracks UNLESS one of two things is true:
1. The track has its own conflicting credit for the same role — the track-level
   credit wins.
2. The role is musically impossible for that specific track — e.g. a vocal or
   solo-instrument credit cannot apply to a track that is a known purely
   instrumental excerpt bundled alongside vocal works on the same release.
An unscoped album-level credit is Discogs' own explicit convention for
"applies to every track" (see the DiscogsArtist.tracks field in discogs.ts:
an empty string means "all tracks", not "unspecified"). This is a definite
assertion, not an ambiguous gap — treat it as applying everywhere UNLESS one
of the two conditions above is clearly true. Do not invent additional
reasons to exclude a track from an album-level credit.

Whenever either exception is used to exclude a track, ALWAYS add a [REVIEW]
warning naming the excluded track and the reason — this overrides what
Discogs' own data literally states, so it must never happen silently. Get
the framing the right way round: the credit's presence on every OTHER track
is not an assumption — it's Discogs' own explicit statement. The only
judgement call is the EXCLUSION, so name that as the deliberate override,
not the routine inclusion.
Wrong (backwards — makes the routine, data-backed part sound shaky):
"Cargill is assumed to perform on tracks 1-6 and 8-9 but not track 7; this
is standard practice but has been inferred rather than confirmed by
per-track Discogs data."
Right (correctly identifies what's actually being decided):
"Discogs credits Cargill (Mezzo-soprano Vocals) at album level with no
track restriction, which applies to every track by default; excluded from
track 7 ('Scène D'Amour') because it is a purely orchestral excerpt with no
vocal part."

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — return this exact JSON structure, nothing else:
═══════════════════════════════════════════════════════════════

{
  "_discogsReleaseId": number,
  "_generated": "ISO 8601 timestamp",
  "_albumFolder": "album folder basename",
  "_warnings": ["array of strings (optional) — data-quality issues, mismatches, or judgement calls the user should review. Every entry MUST start with '[CRITICAL] ' or '[REVIEW] '. Omit entirely or leave empty if none."],
  "coverArtUrl": "string or null",
  "album": {
    "ALBUM": "string",
    "ALBUMARTIST": "string",
    "ARTIST": "string",
    "DATE": "YYYY",
    "GENRE": "string if one genre, array if multiple — include ALL values from genres[] array",
    "STYLE": "string if one style, array if multiple — include ALL values from styles[] array",
    "DISCTOTAL": "string (omit for single disc)",
    "TRACKTOTAL": "string (optional)",
    "CATALOGNUMBER": "string (optional)",
    "SERIES": "string (optional)",
    "SERIESNUMBER": "string (optional)",
    "DISCOGSURL": "https://www.discogs.com/release/{id}"
  },
  "discs": [
    {
      "discNumber": 1,
      "discSubtitle": "string (optional)",
      "folder": "relative path or '.' if audio is directly in album folder",
      "tracks": [
        {
          "TITLE": "string",
          "TRACKNUMBER": "zero-padded string e.g. '01'",
          "ARTIST": "string (compilations only — per-track artist)",
          "COMPOSER": "string or array (optional)",
          "COMPOSERSORT": "string or array (optional)",
          "LYRICIST": "string or array (optional)",
          "LYRICISTSORT": "string or array (optional)",
          "ARRANGER": "string (optional)",
          "REMIXER": "string or array (optional)",
          "CONDUCTOR": "string (optional)",
          "CONDUCTORSORT": "string (optional)",
          "ORCHESTRA": "string (optional)",
          "ORCHESTRASORT": "string (optional)",
          "ENSEMBLE": "string (optional)",
          "ENSEMBLESORT": "string (optional)",
          "PERFORMER": "string or array (optional)",
          "PERFORMERSORT": "string or array (optional) — name only, NEVER include the instrument/voice parenthetical",
          "GROUP": "string (classical movement grouping only)"
        }
      ]
    }
  ]
}`;

// ─── Warning post-processing ───────────────────────────────────────────────────
//
// Prompting alone ("re-check the folder structure before writing a warning")
// has already proven not fully reliable on complex, high-track-count,
// multi-disc releases — the same class of disc-misattribution error this
// was meant to prevent recurred on a 3-disc, 58-track release. Rather than
// rely solely on the model getting this right, this cross-checks any
// filename a warning names against the folder structure WE already know
// with certainty, and corrects the disc reference deterministically if it's
// wrong — no dependence on the model's self-correction at all.

const AUDIO_EXTENSIONS_PATTERN = /\.(flac|mp3|ogg|m4a|aac|wav|aiff)/i;
const QUOTED_FILENAME_PATTERN = /['"]([^'"]+\.(?:flac|mp3|ogg|m4a|aac|wav|aiff))['"]/i;
const DISC_MENTION_PATTERN = /\bDis[ck]\s*\d+\b/i;

/**
 * Applies deterministic post-processing to a generated TaggingFile's
 * warnings: corrects disc misattribution using the known folder structure,
 * and ensures every warning carries a [CRITICAL] or [REVIEW] severity
 * prefix (defaulting to [REVIEW] if the model omitted one), so downstream
 * reporting always has a consistent, parseable format to work with.
 */
function postProcessWarnings(result: TaggingFile, structure: FolderStructure): TaggingFile {
  if (!result._warnings || result._warnings.length === 0) return result;

  // Build filename -> actual disc folder name lookup. Only worth doing on
  // genuinely multi-disc releases — nothing to misattribute otherwise.
  const filenameToDisc = new Map<string, string>();
  if (structure.discFolders.length > 1) {
    for (const disc of structure.discFolders) {
      for (const file of disc.files) {
        filenameToDisc.set(file.filename, disc.folderName);
      }
    }
  }

  result._warnings = result._warnings.map((warning) => {
    let corrected = warning;

    // ── Deterministic disc-reference correction ──────────────────────────
    if (filenameToDisc.size > 0 && AUDIO_EXTENSIONS_PATTERN.test(warning)) {
      const filenameMatch = warning.match(QUOTED_FILENAME_PATTERN);
      const discMentionMatch = warning.match(DISC_MENTION_PATTERN);

      if (filenameMatch && discMentionMatch) {
        const referencedFilename = filenameMatch[1];
        const actualDisc = filenameToDisc.get(referencedFilename);

        if (actualDisc && !discMentionMatch[0].toLowerCase().includes(actualDisc.toLowerCase())) {
          // The warning names a real file, and states a disc that isn't
          // the one that file is actually in. Correct it in place rather
          // than trust the model's stated disc number.
          corrected =
            warning.replace(discMentionMatch[0], actualDisc) +
            ` [disc reference auto-corrected: '${referencedFilename}' is actually in ${actualDisc}]`;
        }
      }
    }

    // ── Ensure a severity prefix is present ───────────────────────────────
    if (!/^\[(CRITICAL|REVIEW)\]/.test(corrected)) {
      corrected = `[REVIEW] ${corrected}`;
    }

    return corrected;
  });

  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateTagsWithClaude(
  release: DiscogsRelease,
  coverArtUrl: string | null,
  albumFolderName: string,
  structure: FolderStructure,
  folderAsAlbum: boolean = false,
  parentFolderAsArtist: boolean = false,
  parentFolderName: string | null = null,
  verbose: boolean = false
): Promise<TaggingFile> {
  const userMessage = buildUserMessage(
    release,
    coverArtUrl,
    albumFolderName,
    structure,
    folderAsAlbum,
    parentFolderAsArtist,
    parentFolderName
  );

  // The system prompt is byte-for-byte identical on every call — it never
  // varies per album. Marking it with an explicit cache breakpoint means
  // only the first call in a session pays full price for it; every
  // subsequent call within the cache window (5 minutes by default) reads
  // it back at roughly 10% of the normal input token cost. This has to be
  // an EXPLICIT breakpoint on the system block specifically — automatic
  // caching would place the breakpoint on the user message instead, which
  // is different (and therefore uncacheable) on every single call.
  //
  // MAX_OUTPUT_TOKENS is set to claude-sonnet-4-6's actual maximum (see the
  // constant definition above for why). Every track needs its own complete,
  // independent tag set embedded in its own file — there is no way to
  // "inherit" a shared performer list across tracks at the file-tagging
  // level, so a release with a large ensemble (e.g. a big-band jazz session,
  // or a large-scale choral/operatic work with a big cast) repeats that
  // full PERFORMER/PERFORMERSORT list on every single track, and a release
  // with many tracks multiplies that further. This has already been hit at
  // lower ceilings (8,192, then 32,000) on real large-ensemble releases.
  //
  // Using .stream() rather than .create(): the SDK refuses to run a plain
  // non-streaming request if it calculates (from max_tokens) that it could
  // take longer than 10 minutes, throwing "Streaming is required for
  // operations that may take longer than 10 minutes" before the request is
  // even sent — a high MAX_OUTPUT_TOKENS crosses that threshold easily.
  // .stream() avoids the restriction entirely (no arbitrary duration
  // ceiling applies to streaming requests), and .finalMessage() waits for
  // the stream to finish and returns the fully-assembled Message in exactly
  // the same shape .create() would have returned — usage, stop_reason, and
  // content all work identically to how they did before.
  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const response = await stream.finalMessage();

  if (verbose) {
    const u = response.usage;
    console.log(
      `      tokens: ${u.input_tokens} new + ${u.cache_read_input_tokens ?? 0} cached (read)` +
        (u.cache_creation_input_tokens ? ` + ${u.cache_creation_input_tokens} cached (write)` : '') +
        ` + ${u.output_tokens} output`
    );
  }

  // Detect truncation explicitly rather than letting it surface as a
  // confusing JSON parse failure. stop_reason === 'max_tokens' means the
  // response was cut off mid-generation because it hit the token ceiling —
  // this is a distinct, clearly diagnosable condition, not malformed JSON.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude's response was truncated: it hit the ${MAX_OUTPUT_TOKENS}-token ` +
        `output limit before finishing (${response.usage.output_tokens} output ` +
        `tokens generated). This is claude-sonnet-4-6's actual maximum on the ` +
        `standard Messages API, so it can't simply be raised further — this ` +
        `release's tagging output is genuinely larger than the model's output ` +
        `ceiling, most likely an exceptionally large ensemble and/or track ` +
        `count where the full PERFORMER/PERFORMERSORT list has to be repeated ` +
        `on every single track. This is a rare, hard limit for this album; ` +
        `check whether a newer/higher-ceiling model is available and update ` +
        `the model string in claude.ts if so.`
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude API returned no text content');
  }

  const raw = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  // First attempt: parse as-is (the expected, well-behaved case)
  try {
    return postProcessWarnings(JSON.parse(raw) as TaggingFile, structure);
  } catch (firstErr) {
    // Fallback: the model may have included reasoning/analysis text before
    // or after the JSON object despite instructions not to. Attempt to
    // recover by extracting the outermost {...} block and parsing that.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error(
        `Claude returned invalid JSON (no JSON object could be located).\n` +
          `Parse error: ${String(firstErr)}\n\nRaw response:\n${raw}`
      );
    }

    const extracted = raw.slice(firstBrace, lastBrace + 1);

    let recovered: TaggingFile;
    try {
      recovered = JSON.parse(extracted) as TaggingFile;
    } catch (secondErr) {
      throw new Error(
        `Claude returned invalid JSON, and fallback extraction also failed.\n` +
          `First parse error: ${String(firstErr)}\n` +
          `Fallback parse error: ${String(secondErr)}\n\n` +
          `Raw response:\n${raw}`
      );
    }

    // Recovery succeeded, but flag it — the model violated the "JSON only"
    // instruction, so the output deserves an extra close look even though
    // we managed to salvage it.
    recovered._warnings = recovered._warnings ?? [];
    recovered._warnings.unshift(
      '[REVIEW] Claude included reasoning/analysis text outside the JSON ' +
        'response; it was automatically stripped to recover the tags. ' +
        'Review this album\'s tags carefully, as the underlying data may ' +
        'have needed unusual judgement calls.'
    );

    return postProcessWarnings(recovered, structure);
  }
}

// ─── Message builder ──────────────────────────────────────────────────────────

function buildUserMessage(
  release: DiscogsRelease,
  coverArtUrl: string | null,
  albumFolderName: string,
  structure: FolderStructure,
  folderAsAlbum: boolean,
  parentFolderAsArtist: boolean,
  parentFolderName: string | null
): string {
  const albumOverride = folderAsAlbum
    ? `\nALBUM TITLE OVERRIDE: Use "${albumFolderName}" as the ALBUM tag value instead of the Discogs release title.`
    : '';

  const artistOverride =
    parentFolderAsArtist && parentFolderName
      ? `\nARTIST OVERRIDE: Use "${parentFolderName}" as the ALBUMARTIST and ARTIST tag ` +
        `value (album level) instead of whatever name Discogs credits, INCLUDING instead ` +
        `of the canonical Discogs artist name. Apply this only if the release is a ` +
        `genuine single-artist release — do NOT apply it to override "Various" on a ` +
        `multi-artist compilation, and do NOT apply it to per-track ARTIST overrides on ` +
        `compilation tracks; it only affects the album-level ALBUMARTIST/ARTIST fields.`
      : '';

  return `Please generate complete music tags for this release.

ALBUM FOLDER (basename): ${albumFolderName}${albumOverride}
PARENT FOLDER (basename): ${parentFolderName ?? 'not available'}${artistOverride}

FOLDER AND FILE STRUCTURE:
${formatStructure(structure)}

COVER ART URL: ${coverArtUrl ?? 'not available'}

GENERATED AT: ${new Date().toISOString()}

DISCOGS RELEASE JSON:
${JSON.stringify(pruneReleaseForPrompt(release))}`;
}

function formatStructure(structure: FolderStructure): string {
  const lines: string[] = [`${structure.albumFolderName}/`];
  for (const disc of structure.discFolders) {
    if (disc.relativePath === '.') {
      for (const f of disc.files) lines.push(`  ${f.filename}`);
    } else {
      lines.push(`  ${disc.folderName}/`);
      for (const f of disc.files) lines.push(`    ${f.filename}`);
    }
  }
  return lines.join('\n');
}
