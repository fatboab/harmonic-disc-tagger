import * as https from 'https';

// ─── Discogs API types ────────────────────────────────────────────────────────
// These reflect the actual shape of the Discogs v2 release response.

export interface DiscogsArtist {
  id: number;
  name: string;
  anv: string;       // Artist Name Variation — the credited name on this release
  role: string;
  join: string;
  tracks: string;    // Track positions this credit applies to, e.g. "1,2" or "" for all
  resource_url: string;
}

export interface DiscogsTrack {
  position: string;  // e.g. "A1", "1", "2-3", "1.01"
  title: string;
  duration: string;
  type_: string;     // "track" | "heading" | "index"
  extraartists?: DiscogsArtist[];
}

export interface DiscogsImage {
  type: string;      // "primary" | "secondary"
  uri: string;       // Full-res URL (requires authentication)
  uri150: string;    // 150px thumbnail
  resource_url: string;
  width: number;
  height: number;
}

export interface DiscogsLabel {
  name: string;
  catno: string;
  entity_type: string;
  id: number;
  resource_url: string;
}

export interface DicogsSeries {
  name: string;
  id: number;
  resource_url: string;
}

export interface DiscogsRelease {
  id: number;
  title: string;
  year: number;
  released: string;
  country: string;
  genres: string[];
  styles: string[];
  artists: DiscogsArtist[];
  extraartists: DiscogsArtist[];
  tracklist: DiscogsTrack[];
  labels: DiscogsLabel[];
  images: DiscogsImage[];
  series: DicogsSeries[];
  notes: string;
  uri: string;        // Discogs release URL
  resource_url: string;
  data_quality: string;
  format_quantity: number;
  formats: Array<{ name: string; qty: string; descriptions: string[] }>;
}

// ─── Fetch using disconnect ───────────────────────────────────────────────────

// disconnect is a CommonJS module with no @types package; require it
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Disconnect = require('disconnect');

/**
 * Fetches a release from the Discogs API using the disconnect client.
 * Requires DISCOGS_USER_TOKEN environment variable for authenticated access,
 * which is needed to receive full-resolution image URLs.
 *
 * Falls back to unauthenticated access if no token is set, but cover art
 * will only be available as 150px thumbnails.
 */
export async function fetchDiscogsRelease(releaseId: number): Promise<DiscogsRelease> {
  const userToken = process.env['DISCOGS_USER_TOKEN'];

  const clientOptions = userToken ? { userToken } : {};
  const dis = new Disconnect.Client('MusicTagger/3.0 +https://github.com/your-repo', clientOptions);
  const db = dis.database();

  return new Promise((resolve, reject) => {
    db.getRelease(releaseId, (err: Error | null, data: DiscogsRelease) => {
      if (err) {
        reject(new Error(`Discogs API error for release ${releaseId}: ${err.message}`));
        return;
      }
      if (!data || !data.id) {
        reject(new Error(`Discogs returned empty data for release ${releaseId}`));
        return;
      }
      resolve(data);
    });
  });
}

/**
 * Returns the best available cover art URL from a release.
 * Prefers the primary image at full resolution; falls back to thumbnail.
 */
export function extractCoverArtUrl(release: DiscogsRelease): string | null {
  if (!release.images || release.images.length === 0) return null;
  const primary = release.images.find((img) => img.type === 'primary') ?? release.images[0];
  // uri is the full-res URL (only available when authenticated)
  // uri150 is always available but only 150px
  return primary.uri || primary.uri150 || null;
}

/**
 * Downloads cover art from a Discogs image URL.
 * Discogs image URLs are signed and require no special auth headers beyond
 * a sensible User-Agent.
 */
export async function downloadCoverArt(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'MusicTagger/3.0 +https://github.com/your-repo',
      },
    };

    const request = (targetUrl: string): void => {
      https.get(targetUrl, options, (res) => {
        // Follow redirects (Discogs image URLs sometimes redirect)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Cover art download failed: HTTP ${res.statusCode ?? 'unknown'}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}
