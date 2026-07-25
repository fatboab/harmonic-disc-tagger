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

// ─── Fetch (direct HTTPS, not the disconnect npm client) ─────────────────────

const DISCOGS_API_HOST = 'api.discogs.com';
const USER_AGENT = 'HarmonicDiscTagger/2.13 +https://github.com/fatboab/harmonic-disc-tagger';
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Fetches a release from the Discogs API.
 * Requires DISCOGS_USER_TOKEN environment variable for authenticated access,
 * which is needed to receive full-resolution image URLs.
 *
 * Falls back to unauthenticated access if no token is set, but cover art
 * will only be available as 150px thumbnails.
 *
 * This deliberately makes the HTTPS request directly rather than using the
 * `disconnect` npm client. That library has a real bug: on a non-2xx
 * response with a non-JSON body (e.g. a plain-text "Internal Server Error"
 * from a transient Discogs 500), it still unconditionally attempts
 * JSON.parse() on the raw response body inside its own internal handler —
 * and that parse failure throws SYNCHRONOUSLY inside a Node.js stream
 * 'end' event callback, several stack frames away from any of our own
 * code. A JavaScript try/catch (or a Promise's reject path) can only catch
 * exceptions that occur within the code path it's actually watching — it
 * cannot intercept an exception thrown inside an unrelated async callback
 * deep inside a dependency's internals. The result was an uncaught
 * exception that crashed the entire Node.js process — and with it, the
 * whole batch run — rather than failing just the one album that hit the
 * transient error.
 *
 * Making the request directly means status codes and JSON parsing are
 * both fully under our control, so any failure — transient or otherwise —
 * becomes a normal rejected Promise that bubbles up through generate.ts
 * and is caught by the per-album try/catch in index.ts, exactly like
 * every other per-album failure this tool already handles gracefully.
 * Retries with backoff are applied for the specific failure modes that are
 * genuinely transient (5xx, 429 rate limiting).
 */
export async function fetchDiscogsRelease(releaseId: number): Promise<DiscogsRelease> {
  const userToken = process.env['DISCOGS_USER_TOKEN'];

  let lastError: Error = new Error(`Discogs API request failed for release ${releaseId}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchReleaseOnce(releaseId, userToken);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isRetryableError(lastError) || attempt === MAX_RETRIES) {
        throw lastError;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(
        `  ⚠  Discogs request failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message}`
      );
      console.warn(`     Retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// Node.js system error codes that represent transient network conditions
// worth retrying — DNS hiccups, dropped/reset connections, timeouts. These
// occur before any HTTP request is even sent (or mid-request), so they
// never carry an HTTP status code — they need to be recognised separately
// from the 5xx/429 HTTP-level checks below.
const RETRYABLE_ERROR_CODES = new Set([
  'EAI_AGAIN', // DNS lookup temporarily failed
  'ENOTFOUND', // DNS lookup failed (occasionally transient, not always permanent)
  'ECONNRESET', // Connection reset by peer
  'ECONNREFUSED', // Connection refused (can be a brief router/firewall hiccup)
  'ETIMEDOUT', // Connection timed out
  'ENETUNREACH', // Network unreachable
  'EHOSTUNREACH', // Host unreachable
  'EPIPE', // Broken pipe
]);

function isRetryableError(err: Error): boolean {
  // Node system errors (DNS failures, connection resets, etc.) carry a
  // `.code` property — check that first since it's the most reliable
  // signal. Our request/response error handlers pass these through
  // unwrapped via reject(err), so .code survives all the way here.
  const code = (err as NodeJS.ErrnoException).code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;

  // Fallback: Node's default error message format includes the code as a
  // literal substring (e.g. "getaddrinfo EAI_AGAIN api.discogs.com"), so
  // this catches the same cases even if .code were ever missing.
  for (const knownCode of RETRYABLE_ERROR_CODES) {
    if (err.message.includes(knownCode)) return true;
  }

  // 5xx and 429 (rate limit) are transient server-side conditions worth
  // retrying. A JSON parse failure is included too, since it's often the
  // symptom of exactly this kind of transient error returning a
  // non-standard (non-JSON) body rather than a genuine data problem.
  return /HTTP (5\d\d|429)\b/.test(err.message) || /invalid JSON/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchReleaseOnce(
  releaseId: number,
  userToken: string | undefined
): Promise<DiscogsRelease> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.discogs.v2.discogs+json,application/octet-stream',
    };
    if (userToken) {
      headers['Authorization'] = `Discogs token=${userToken}`;
    }

    const options: https.RequestOptions = {
      host: DISCOGS_API_HOST,
      path: `/releases/${releaseId}`,
      method: 'GET',
      headers,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const status = res.statusCode ?? 0;

        if (status < 200 || status >= 300) {
          // Try to pull a message out of a JSON error body, but never
          // assume the body IS JSON — a 500 can just as easily return
          // plain text, which is exactly what caused the original bug.
          let message = body.slice(0, 200).trim() || `(empty body)`;
          try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed.message === 'string') message = parsed.message;
          } catch {
            // Not JSON — the raw text snippet above is used as-is.
          }
          reject(
            new Error(`Discogs API returned HTTP ${status} for release ${releaseId}: ${message}`)
          );
          return;
        }

        try {
          const data = JSON.parse(body) as DiscogsRelease;
          if (!data || !data.id) {
            reject(new Error(`Discogs returned empty/invalid data for release ${releaseId}`));
            return;
          }
          resolve(data);
        } catch (parseErr) {
          reject(
            new Error(
              `Discogs returned invalid JSON for release ${releaseId} (HTTP ${status}): ` +
                `${String(parseErr)}. Response started with: "${body.slice(0, 200)}"`
            )
          );
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
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
 * Strips a Discogs release down to only the fields the tagging prompt
 * actually uses, before it gets sent to Claude.
 *
 * This matters more than it might look: `db.getRelease()` returns the full
 * raw Discogs API response at runtime — our DiscogsRelease TypeScript
 * interface only *names* a subset of fields, it doesn't strip anything.
 * The actual object in memory still carries community stats, video links,
 * every image variant, resource_url on every single artist credit
 * (repeated per track for large tracklists), master_url, data_quality,
 * and more — none of which the system prompt needs to generate tags.
 * JSON.stringify()-ing the raw object sends all of that on every single
 * album, every single run, for no benefit.
 *
 * Unlike the system prompt (which is identical across every call and
 * therefore benefits from prompt caching), this release data is different
 * for every album and can never be cached — so trimming it here is the
 * more impactful lever for reducing the token cost that's actually billed
 * fresh on every request.
 */
export function pruneReleaseForPrompt(release: DiscogsRelease): Record<string, unknown> {
  const pruneArtist = (a: DiscogsArtist) => ({
    name: a.name,
    anv: a.anv || undefined,
    role: a.role,
    join: a.join || undefined,
    tracks: a.tracks || undefined,
  });

  return {
    id: release.id,
    title: release.title,
    year: release.year || undefined,
    genres: release.genres,
    styles: release.styles,
    labels: (release.labels ?? []).map((l) => ({ name: l.name, catno: l.catno })),
    formats: (release.formats ?? []).map((f) => ({
      name: f.name,
      qty: f.qty,
      descriptions: f.descriptions,
    })),
    series: (release.series ?? []).map((s) => ({ name: s.name })),
    artists: (release.artists ?? []).map(pruneArtist),
    extraartists: (release.extraartists ?? []).map(pruneArtist),
    tracklist: (release.tracklist ?? []).map((t) => ({
      position: t.position,
      title: t.title,
      duration: t.duration || undefined,
      type_: t.type_ !== 'track' ? t.type_ : undefined, // omit the common case
      extraartists: t.extraartists?.map(pruneArtist),
    })),
  };
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
