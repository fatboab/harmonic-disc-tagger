import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { TaggingFile, FolderStructure, DiscFolder, AudioFile } from './types';

export const TAGGING_FILENAME = '.music-tags.yaml';

const AUDIO_EXTENSIONS = new Set(['.flac', '.mp3', '.ogg', '.m4a', '.aac', '.wav', '.aiff']);
const DISC_FOLDER_PATTERN = /^(.+?)\s*\(dis[ck]\s*(\d+)\)$/i;

// ─── Tree walking ─────────────────────────────────────────────────────────────

/**
 * Walks a directory tree and returns the absolute paths of every folder
 * that contains a .music-tags.yaml file, sorted depth-first (shallowest first).
 *
 * Crucially: once a folder containing .music-tags.yaml is found, its
 * subtree is NOT descended into — the album folder is a leaf node for
 * our purposes.
 */
export function findAlbumFolders(rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check if this folder contains the tagging file
    const hasTagFile = entries.some(
      (e) => e.isFile() && e.name === TAGGING_FILENAME
    );

    if (hasTagFile) {
      results.push(dir);
      return; // Do not descend further into an album folder
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(path.join(dir, entry.name));
      }
    }
  }

  walk(rootDir);
  return results;
}

// ─── Tagging file I/O ─────────────────────────────────────────────────────────

export function readTaggingFile(albumFolder: string): TaggingFile {
  const filePath = path.join(albumFolder, TAGGING_FILENAME);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No ${TAGGING_FILENAME} found in ${albumFolder}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.parse(content) as TaggingFile;
  if (!parsed._discogsReleaseId) {
    throw new Error(
      `${TAGGING_FILENAME} in ${albumFolder} is missing required field: _discogsReleaseId`
    );
  }
  return parsed;
}

export function writeTaggingFile(albumFolder: string, data: TaggingFile): void {
  const filePath = path.join(albumFolder, TAGGING_FILENAME);
  const content = yaml.stringify(data, { lineWidth: 0 });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function taggingFilePath(albumFolder: string): string {
  return path.join(albumFolder, TAGGING_FILENAME);
}

/**
 * Returns true if the tagging file exists and has already been fully
 * generated (i.e. has an `album` section populated by a previous generate run).
 */
export function isTaggingFileComplete(albumFolder: string): boolean {
  try {
    const data = readTaggingFile(albumFolder);
    return !!data.album && !!data.discs;
  } catch {
    return false;
  }
}

// ─── Folder structure scanning ────────────────────────────────────────────────

/**
 * Scans an album folder and returns the disc/file structure.
 * Handles two layouts:
 *   1. Audio files directly in the album folder (single disc)
 *   2. Audio files in named subfolders (single or multi disc)
 */
export function scanFolderStructure(albumFolder: string): FolderStructure {
  if (!fs.existsSync(albumFolder)) {
    throw new Error(`Album folder not found: ${albumFolder}`);
  }

  const albumFolderName = path.basename(albumFolder);
  const entries = fs
    .readdirSync(albumFolder, { withFileTypes: true })
    .filter((e) => e.name !== TAGGING_FILENAME && !e.name.startsWith('.'));

  const subDirs = entries.filter((e) => e.isDirectory());
  const rootAudioFiles = entries.filter(
    (e) => e.isFile() && isAudioFile(e.name)
  );

  // Case 1: Audio files sit directly in the album folder
  if (rootAudioFiles.length > 0) {
    return {
      albumFolderName,
      isMultiDisc: false,
      discFolders: [
        {
          folderName: albumFolderName,
          relativePath: '.',
          files: rootAudioFiles.map((e) => parseAudioFile(e.name)).sort(byTrackNumber),
        },
      ],
    };
  }

  // Case 2: Audio files are inside subfolders
  const discFolders: DiscFolder[] = [];

  for (const dir of subDirs) {
    const dirPath = path.join(albumFolder, dir.name);
    const audioFiles = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isFile() && isAudioFile(e.name))
      .map((e) => parseAudioFile(e.name))
      .sort(byTrackNumber);

    if (audioFiles.length > 0) {
      discFolders.push({
        folderName: dir.name,
        relativePath: dir.name,
        files: audioFiles,
      });
    }
  }

  // Sort disc folders: numbered disc folders by disc number, others alphabetically
  discFolders.sort((a, b) => {
    const am = DISC_FOLDER_PATTERN.exec(a.folderName);
    const bm = DISC_FOLDER_PATTERN.exec(b.folderName);
    if (am && bm) return parseInt(am[2], 10) - parseInt(bm[2], 10);
    return a.folderName.localeCompare(b.folderName);
  });

  if (discFolders.length === 0) {
    throw new Error(
      `No audio files found in ${albumFolder} or its immediate subfolders`
    );
  }

  const isMultiDisc =
    discFolders.length > 1 ||
    (discFolders.length === 1 && DISC_FOLDER_PATTERN.test(discFolders[0].folderName));

  return { albumFolderName, isMultiDisc, discFolders };
}

// ─── Audio file utilities ─────────────────────────────────────────────────────

export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function isFlacFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.flac';
}

function parseAudioFile(filename: string): AudioFile {
  const match = filename.match(/^(\d{1,3})[\s\-_.]/);
  return {
    filename,
    trackNumber: match ? parseInt(match[1], 10) : null,
  };
}

function byTrackNumber(a: AudioFile, b: AudioFile): number {
  if (a.trackNumber !== null && b.trackNumber !== null) {
    return a.trackNumber - b.trackNumber;
  }
  return a.filename.localeCompare(b.filename);
}

/**
 * Returns sorted audio files from a given directory.
 */
export function getAudioFilesInDir(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => isAudioFile(f))
    .sort();
}

// ─── Cover art ────────────────────────────────────────────────────────────────

const COVER_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

/**
 * Looks for a local cover image file named "cover.xxx" in the given folder.
 * Checks common image extensions in order of preference (JPEG first).
 * Returns the full path if found, or null.
 */
export function findLocalCoverArt(folder: string): string | null {
  for (const ext of COVER_IMAGE_EXTENSIONS) {
    const candidate = path.join(folder, `cover${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
