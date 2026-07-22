import * as path from 'path';
import { fetchDiscogsRelease, extractCoverArtUrl } from '../discogs';
import { generateTagsWithClaude } from '../claude';
import {
  readTaggingFile,
  writeTaggingFile,
  scanFolderStructure,
} from '../filesystem';
import { TaggingFile } from '../types';

export interface GenerateOptions {
  albumFolder: string;
  verbose: boolean;
  force: boolean;
  folderAsAlbum: boolean;
  parentFolderAsArtist: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<TaggingFile> {
  const { albumFolder, verbose, force, folderAsAlbum, parentFolderAsArtist } = options;
  const folderName = path.basename(albumFolder);
  const parentFolderName = path.basename(path.dirname(albumFolder));

  // ── Read stub ─────────────────────────────────────────────────────────────
  const stub = readTaggingFile(albumFolder);

  if (stub.album && stub.discs && !force) {
    if (verbose) console.log(`  ↩  Already generated — skipping (--force to redo)`);
    return stub;
  }

  const releaseId = stub._discogsReleaseId;
  if (!releaseId) {
    throw new Error(
      `.music-tags.yaml is missing required field: _discogsReleaseId\n` +
      `Add the Discogs release ID as a number, e.g.:\n` +
      `  _discogsReleaseId: 1188509`
    );
  }

  if (verbose) console.log(`  Discogs release ID: ${releaseId}`);

  // ── Scan folder structure ─────────────────────────────────────────────────
  const structure = scanFolderStructure(albumFolder);
  const totalFiles = structure.discFolders.reduce((n, d) => n + d.files.length, 0);
  if (verbose) {
    console.log(`  Files: ${totalFiles} across ${structure.discFolders.length} disc folder(s)`);
  }

  // ── Fetch from Discogs API ────────────────────────────────────────────────
  if (verbose) console.log(`  Fetching from Discogs API...`);
  const release = await fetchDiscogsRelease(releaseId);
  if (verbose) console.log(`  Got: "${release.title}" (${release.year})`);

  if (!process.env['DISCOGS_USER_TOKEN']) {
    console.warn(`  ⚠  DISCOGS_USER_TOKEN not set — cover art will be low-res (150px) only`);
  }

  const coverArtUrl = extractCoverArtUrl(release);
  if (verbose) console.log(`  Cover art: ${coverArtUrl ?? 'none found'}`);

  // ── Call Claude ───────────────────────────────────────────────────────────
  if (verbose) console.log(`  Calling Claude API...`);
  const generated = await generateTagsWithClaude(
    release,
    coverArtUrl,
    folderName,
    structure,
    folderAsAlbum,
    parentFolderAsArtist,
    parentFolderName,
    verbose
  );

  if (coverArtUrl && !generated.coverArtUrl) {
    generated.coverArtUrl = coverArtUrl;
  }

  // ── Write back ────────────────────────────────────────────────────────────
  writeTaggingFile(albumFolder, generated);

  return generated;
}
