import * as fs from 'fs';
import * as path from 'path';
import { readTaggingFile, getAudioFilesInDir, findLocalCoverArt } from '../filesystem';
import {
  checkMetaflac,
  applyTagsToFlac,
  applyCoverArt,
  writeCoverArtToDisk,
  findAudioFileForTrack,
} from '../tagger';
import { downloadCoverArt } from '../discogs';
import { TaggingFile, AlbumTags, TrackTags } from '../types';

export interface ApplyOptions {
  albumFolder: string;
  verbose: boolean;
  dryRun: boolean;
  preloaded?: TaggingFile; // Passed in by 'tag' command to avoid re-reading disk
}

export interface ApplyResult {
  tagged: number;
  errors: number;
}

/**
 * Applies tags from .music-tags.yaml to all FLAC files in the album folder.
 */
export async function runApply(options: ApplyOptions): Promise<ApplyResult> {
  const { albumFolder, verbose, dryRun } = options;

  if (!dryRun) checkMetaflac();

  // ── Load tagging data ─────────────────────────────────────────────────────
  const data = options.preloaded ?? readTaggingFile(albumFolder);

  if (!data.album || !data.discs) {
    throw new Error(
      `.music-tags.yaml has not been generated yet.\n` +
        `Run the 'generate' command first, or use 'tag' to do both.`
    );
  }

  // ── Resolve cover art ───────────────────────────────────────────────────
  // Priority: local cover.xxx file > URL from coverArtUrl property
  let coverArt: Buffer | null = null;

  if (!dryRun) {
    const localCoverPath = findLocalCoverArt(albumFolder);

    if (localCoverPath) {
      coverArt = fs.readFileSync(localCoverPath);
      if (verbose) {
        console.log(
          `  Cover art: using local file ${path.basename(localCoverPath)} ` +
            `(${Math.round(coverArt.length / 1024)} KB)`
        );
      }
    } else if (data.coverArtUrl) {
      try {
        coverArt = await downloadCoverArt(data.coverArtUrl);
        if (verbose) {
          console.log(
            `  Cover art: downloaded from Discogs ` +
              `(${Math.round(coverArt.length / 1024)} KB)`
          );
        }

        // No local cover.* file existed (that's why we're in this branch —
        // findLocalCoverArt returned null above), so write the downloaded
        // image to disk as cover.<ext>. This means media servers that scan
        // for a cover file on disk (rather than reading embedded FLAC art)
        // find one too, and it also means subsequent `apply` runs on this
        // album will find the local file and skip re-downloading entirely.
        try {
          const writtenPath = writeCoverArtToDisk(albumFolder, coverArt);
          if (verbose) {
            console.log(`  Cover art: saved to disk as ${path.basename(writtenPath)}`);
          }
        } catch (writeErr) {
          console.warn(`  ⚠  Could not save cover art to disk: ${String(writeErr)}`);
          // Not fatal — embedding into the FLAC files still proceeds below
          // using the in-memory buffer regardless of whether this succeeded.
        }
      } catch (err) {
        console.warn(`  ⚠  Cover art download failed: ${String(err)}`);
      }
    } else {
      if (verbose) console.log(`  Cover art: none found`);
    }
  }

  // ── Apply disc by disc ────────────────────────────────────────────────────
  let tagged = 0;
  let errors = 0;

  for (const disc of data.discs) {
    const discDir =
      disc.folder === '.' ? albumFolder : path.join(albumFolder, disc.folder);

    if (!fs.existsSync(discDir)) {
      console.warn(`  ⚠  Disc folder not found: ${discDir} — skipping disc ${disc.discNumber}`);
      errors++;
      continue;
    }

    const audioFiles = getAudioFilesInDir(discDir);

    // Disc-level tag additions
    const discTags: { DISCNUMBER?: string; DISCTOTAL?: string; DISCSUBTITLE?: string } = {};
    const totalDiscs = parseInt(data.album.DISCTOTAL ?? '1', 10);
    if (totalDiscs > 1) {
      discTags.DISCNUMBER = String(disc.discNumber).padStart(2, '0');
      discTags.DISCTOTAL = data.album.DISCTOTAL;
    }
    if (disc.discSubtitle) discTags.DISCSUBTITLE = disc.discSubtitle;

    for (const trackTags of disc.tracks) {
      const trackNum = parseInt(trackTags.TRACKNUMBER, 10);
      const audioFilename = findAudioFileForTrack(audioFiles, trackNum);

      if (!audioFilename) {
        console.warn(
          `  ⚠  No audio file matched track ${trackTags.TRACKNUMBER}: "${trackTags.TITLE}"`
        );
        errors++;
        continue;
      }

      const audioPath = path.join(discDir, audioFilename);
      const ext = path.extname(audioFilename).toLowerCase();
      const label = `${trackTags.TRACKNUMBER}. ${trackTags.TITLE}`;

      if (ext !== '.flac') {
        console.warn(`  ⚠  Non-FLAC file skipped: ${audioFilename}`);
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] ${label}`);
        if (verbose) {
          printTagSummary(data.album, discTags, trackTags);
        }
        tagged++;
        continue;
      }

      try {
        applyTagsToFlac(audioPath, data.album, discTags, trackTags, verbose);
        if (coverArt) applyCoverArt(audioPath, coverArt);
        if (verbose) {
          console.log(`  ✓  ${label}`);
        } else {
          console.log(`    ${label}`);
        }
        tagged++;
      } catch (err) {
        console.error(`  ✗  ${label}: ${String(err)}`);
        errors++;
      }
    }
  }

  return { tagged, errors };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function printTagSummary(
  album: AlbumTags,
  disc: Record<string, string | undefined>,
  track: TrackTags
): void {
  const all: Record<string, unknown> = {
    ...(album as unknown as Record<string, unknown>),
    ...(disc as Record<string, unknown>),
    ...(track as unknown as Record<string, unknown>),
  };
  for (const [k, v] of Object.entries(all)) {
    if (v !== undefined && !k.startsWith('_')) {
      const display = Array.isArray(v) ? (v as string[]).join(' | ') : String(v);
      console.log(`      ${k.toUpperCase()}=${display}`);
    }
  }
}
