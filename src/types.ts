// ─── Track-level tags ─────────────────────────────────────────────────────────

export interface TrackTags {
  TITLE: string;
  TRACKNUMBER: string;
  ARTIST?: string;        // Per-track artist for compilations

  COMPOSER?: string | string[];
  COMPOSERSORT?: string | string[];
  LYRICIST?: string | string[];
  LYRICISTSORT?: string | string[];
  ARRANGER?: string;
  REMIXER?: string | string[];

  CONDUCTOR?: string;
  CONDUCTORSORT?: string;
  ORCHESTRA?: string;
  ORCHESTRASORT?: string;
  ENSEMBLE?: string;
  ENSEMBLESORT?: string;
  PERFORMER?: string | string[];
  PERFORMERSORT?: string | string[];

  GROUP?: string;

  [key: string]: string | string[] | undefined;
}

// ─── Album-level tags ─────────────────────────────────────────────────────────

export interface AlbumTags {
  ALBUM: string;
  ALBUMARTIST: string;
  ARTIST: string;
  DATE: string;
  GENRE: string;
  STYLE?: string | string[];
  DISCTOTAL?: string;
  TRACKTOTAL?: string;
  CATALOGNUMBER?: string;
  SERIES?: string;
  SERIESNUMBER?: string;
  DISCOGSURL: string;
}

// ─── Per-disc structure ───────────────────────────────────────────────────────

export interface DiscData {
  discNumber: number;
  discSubtitle?: string;
  folder: string;
  tracks: TrackTags[];
}

// ─── The tagging file ─────────────────────────────────────────────────────────
//
// Stub created by user: just _discogsReleaseId
// After generate: everything filled in

export interface TaggingFile {
  // The Discogs release ID — only required field in stub
  _discogsReleaseId: number;

  // Set by generate
  _generated?: string;
  _albumFolder?: string;

  album?: AlbumTags;
  discs?: DiscData[];
  coverArtUrl?: string;
}

// ─── Internal scanning types ──────────────────────────────────────────────────

export interface AudioFile {
  filename: string;
  trackNumber: number | null;
}

export interface DiscFolder {
  folderName: string;
  relativePath: string;
  files: AudioFile[];
}

export interface FolderStructure {
  albumFolderName: string;
  discFolders: DiscFolder[];
  isMultiDisc: boolean;
}

export type AlbumResult =
  | { status: 'tagged'; albumFolder: string }
  | { status: 'skipped'; albumFolder: string; reason: string }
  | { status: 'error'; albumFolder: string; error: string };
