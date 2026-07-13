import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrackTags, AlbumTags } from './types';

// ─── Prerequisite check ───────────────────────────────────────────────────────

export function checkMetaflac(): void {
  try {
    execSync('metaflac --version', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'metaflac is not installed or not on PATH.\n' +
        'Install with: sudo apt install flac'
    );
  }
}

// ─── Tag application ──────────────────────────────────────────────────────────

/**
 * Applies all tags to a single FLAC file.
 * Clears all existing Vorbis comments first so the result is deterministic.
 */
export function applyTagsToFlac(
  filePath: string,
  albumTags: AlbumTags,
  discTags: { DISCNUMBER?: string; DISCTOTAL?: string; DISCSUBTITLE?: string },
  trackTags: TrackTags,
  verbose: boolean
): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Merge: album → disc → track (later entries override earlier for same key)
  const merged: Record<string, string | string[]> = {};
  for (const obj of [albumTags, discTags, trackTags]) {
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        merged[k] = v as string | string[];
      }
    }
  }

  const args: string[] = ['--remove-all-tags'];

  for (const [key, value] of Object.entries(merged)) {
    const tag = key.toUpperCase();
    if (Array.isArray(value)) {
      for (const v of value) {
        const s = String(v).trim();
        if (s) args.push(`--set-tag=${tag}=${s}`);
      }
    } else {
      const s = String(value).trim();
      if (s) args.push(`--set-tag=${tag}=${s}`);
    }
  }

  args.push(filePath);

  if (verbose) {
    console.log(`      metaflac [${args.length - 2} tags] "${path.basename(filePath)}"`);
  }

  const result = spawnSync('metaflac', args, { encoding: 'utf-8' });
  if (result.error) throw new Error(`metaflac not found: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`metaflac failed on ${path.basename(filePath)}:\n${result.stderr}`);
  }
}

// ─── Cover art ────────────────────────────────────────────────────────────────

/**
 * Embeds cover art into a FLAC file.
 * Removes any existing PICTURE block first to avoid duplicates.
 */
export function applyCoverArt(filePath: string, imageBuffer: Buffer): void {
  const tmpFile = path.join(os.tmpdir(), `tagger-cover-${process.pid}-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(tmpFile, imageBuffer);

    // Remove existing picture blocks first
    spawnSync('metaflac', ['--remove', '--block-type=PICTURE', filePath], {
      encoding: 'utf-8',
    });

    // Import new cover (type 3 = Front Cover)
    const result = spawnSync(
      'metaflac',
      [`--import-picture-from=3|image/jpeg|Front Cover||${tmpFile}`, filePath],
      { encoding: 'utf-8' }
    );
    if (result.error) throw new Error(`metaflac not found: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`Cover art import failed:\n${result.stderr}`);
    }
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

// ─── Track matching ───────────────────────────────────────────────────────────

/**
 * Finds the audio filename in a directory that matches a given track number.
 * Tries numeric prefix matching first, then falls back to positional.
 */
export function findAudioFileForTrack(
  audioFiles: string[],
  trackNumber: number
): string | null {
  const padded = String(trackNumber).padStart(2, '0');
  const unpadded = String(trackNumber);

  for (const file of audioFiles) {
    for (const prefix of [padded, unpadded]) {
      if (
        file.startsWith(`${prefix} `) ||
        file.startsWith(`${prefix}-`) ||
        file.startsWith(`${prefix}.`) ||
        file.startsWith(`${prefix}_`)
      ) {
        return file;
      }
    }
  }

  // Positional fallback: track 1 = first file, etc.
  if (trackNumber >= 1 && trackNumber <= audioFiles.length) {
    return audioFiles[trackNumber - 1];
  }

  return null;
}
