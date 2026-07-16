#!/usr/bin/env node
import * as path from 'path';
import * as process from 'process';
import { findAlbumFolders, isTaggingFileComplete, readTaggingFile } from './filesystem';
import { runGenerate } from './commands/generate';
import { runApply, ApplyResult } from './commands/apply';

// ─── Usage ────────────────────────────────────────────────────────────────────

const USAGE = `
🎵  harmonic-disc-tagger  —  Automated FLAC tagging via Discogs + Claude AI

USAGE
  tagger <command> <root-folder> [options]

COMMANDS
  generate  Walk <root-folder> looking for .music-tags.yaml stub files.
            For each one found, fetch the release from the Discogs API and
            call Claude to generate a complete set of tags. The stub is
            replaced with a fully-populated .music-tags.yaml.

  apply     Walk <root-folder> looking for complete .music-tags.yaml files.
            Apply the tags in each file to the FLAC files alongside it,
            and embed cover art (local cover.jpg takes priority over the
            Discogs image if both are available).

  tag       Run generate then apply in a single pass. The .music-tags.yaml
            is kept on disk after completion so you can review or re-apply.

OPTIONS
  --force           (generate, tag) Re-generate tags even if already done.
  --dry-run         (apply, tag)    Show what would be tagged; don't modify files.
  --folder-as-album (generate, tag) Use the album folder name as the ALBUM tag
                    value instead of the Discogs release title. Useful when the
                    folder name already reflects how you want the album to appear
                    in your library (e.g. a compilation you've named yourself).
  --verbose         Print detailed per-track progress and tag values.
  --help            Show this help.

WORKFLOW
  1. Rip a CD with abcde into a folder under <root-folder>.
  2. Find the release on discogs.com and note its release ID — the number
     in the URL, e.g. discogs.com/release/6670784-... → 6670784
  3. Create a .music-tags.yaml stub in the ripped folder containing:

       _discogsReleaseId: 6670784

  4. Run:  tagger tag <root-folder>

     The tool walks the tree, finds your stub, fetches the release from the
     Discogs API, generates tags with Claude, applies them with metaflac,
     and embeds cover art. The completed .music-tags.yaml is kept for
     review or future re-apply.

FOLDER STRUCTURE
  The tool expects one of these layouts inside each album folder:

  Single disc — audio files directly in the album folder:
    My Album/
      .music-tags.yaml
      01 - Track One.flac
      02 - Track Two.flac

  Single disc — audio files in one subfolder:
    My Album/
      .music-tags.yaml
      My Album/
        01 - Track One.flac

  Multi-disc — one subfolder per disc:
    My Album/
      .music-tags.yaml
      My Album (Disc 1)/
        01 - Track One.flac
      My Album (Disc 2)/
        01 - Track One.flac

  An optional cover.jpg (or .jpeg/.png/.gif/.bmp/.webp) in the album folder,
  or in an individual disc folder, is used in preference to Discogs cover art.

ENVIRONMENT
  ANTHROPIC_API_KEY    Required for the generate and tag commands.
  DISCOGS_USER_TOKEN   Recommended for the generate and tag commands — without
                       it, cover art from Discogs is limited to 150px thumbnails.
`;

// ─── Arg parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  command: string | null;
  rootFolder: string | null;
  force: boolean;
  dryRun: boolean;
  folderAsAlbum: boolean;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = {
    command: null,
    rootFolder: null,
    force: false,
    dryRun: false,
    folderAsAlbum: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'generate' || a === 'apply' || a === 'tag') result.command = a;
    else if (a === '--force') result.force = true;
    else if (a === '--dry-run') result.dryRun = true;
    else if (a === '--folder-as-album') result.folderAsAlbum = true;
    else if (a === '--verbose' || a === '-v') result.verbose = true;
    else if (a === '--help' || a === '-h') result.help = true;
    else if (!a.startsWith('-') && result.command && !result.rootFolder)
      result.rootFolder = a;
    else if (!a.startsWith('-') && !result.command) result.command = a;
    else if (!a.startsWith('-') && result.command && !result.rootFolder)
      result.rootFolder = a;
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help || !args.command) {
    console.log(USAGE);
    process.exit(0);
  }

  if (!args.rootFolder) {
    console.error('❌  <root-folder> argument is required');
    process.exit(1);
  }

  if ((args.command === 'generate' || args.command === 'tag') && !process.env['ANTHROPIC_API_KEY']) {
    console.error('❌  ANTHROPIC_API_KEY environment variable is not set');
    process.exit(1);
  }

  const rootFolder = path.resolve(args.rootFolder);

  console.log(`\n🎵  music-tagger — ${args.command}`);
  console.log(`    Root: ${rootFolder}\n`);

  // ── Find all album folders ────────────────────────────────────────────────
  console.log('→ Scanning for album folders...');
  const albumFolders = findAlbumFolders(rootFolder);

  if (albumFolders.length === 0) {
    console.log('  No .music-tags.yaml files found — nothing to do.');
    console.log('  Create a stub with:  echo "_discogsReleaseId: <id>" > <album-folder>/.music-tags.yaml');
    process.exit(0);
  }

  console.log(`  Found ${albumFolders.length} album folder(s)\n`);

  // ── Process each album ────────────────────────────────────────────────────
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (let i = 0; i < albumFolders.length; i++) {
    const albumFolder = albumFolders[i];
    const relPath = path.relative(rootFolder, albumFolder);
    const prefix = `[${i + 1}/${albumFolders.length}]`;

    console.log(`${prefix} ${relPath}`);

    try {
      const warnings = await processAlbum(albumFolder, args, relPath);
      warningCount += warnings;
      successCount++;
    } catch (err) {
      console.error(`       ❌  ${String(err)}`);
      if (args.verbose && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      errorCount++;
    }

    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`✅  Done: ${successCount} succeeded, ${skipCount} skipped, ${errorCount} failed`);
  if (warningCount > 0) {
    console.log(`⚠️   ${warningCount} warning(s) flagged — check the messages above and the .music-tags.yaml files`);
  }
  if (errorCount > 0) process.exit(1);
}

// ─── Per-album processing ─────────────────────────────────────────────────────

async function processAlbum(
  albumFolder: string,
  args: CliArgs,
  relPath: string
): Promise<number> {
  const { command, force, dryRun, verbose } = args;

  // ── generate ──────────────────────────────────────────────────────────────
  if (command === 'generate' || command === 'tag') {
    const alreadyDone = isTaggingFileComplete(albumFolder);

    if (alreadyDone && !force) {
      console.log(`       ↩  Tags already generated — skipping (--force to redo)`);
      return 0;
    }

    process.stdout.write(`       generate: fetching Discogs + calling Claude...`);
    const taggingFile = await runGenerate({ albumFolder, verbose, force, folderAsAlbum: args.folderAsAlbum });
    console.log(
      ` ✓\n` +
        `              Album:  ${taggingFile.album?.ALBUM ?? '?'}\n` +
        `              Artist: ${taggingFile.album?.ALBUMARTIST ?? '?'}`
    );
    const warningCount = printWarnings(taggingFile._warnings);

    // For 'tag' command, continue straight to apply
    if (command === 'tag') {
      console.log(`       apply:${dryRun ? ' [DRY RUN]' : ''}`);
      const result = await runApply({
        albumFolder,
        verbose,
        dryRun,
        preloaded: taggingFile,
      });
      reportApplyResult(result, albumFolder, dryRun);
    }

    return warningCount;
  }

  // ── apply only ────────────────────────────────────────────────────────────
  if (command === 'apply') {
    if (!isTaggingFileComplete(albumFolder)) {
      console.log(`       ⚠  Tags not yet generated — run 'generate' first`);
      return 0;
    }

    const existing = readTaggingFile(albumFolder);
    const warningCount = printWarnings(existing._warnings);

    console.log(`       apply:${dryRun ? ' [DRY RUN]' : ''}`);
    const result = await runApply({ albumFolder, verbose, dryRun });
    reportApplyResult(result, albumFolder, dryRun);
    return warningCount;
  }

  return 0;
}

/**
 * Prints any data-quality warnings flagged by Claude during tag generation.
 * Returns the number of warnings printed, for tallying in the run summary.
 */
function printWarnings(warnings: string[] | undefined): number {
  if (!warnings || warnings.length === 0) return 0;

  console.log(`       ⚠  ${warnings.length} warning(s) flagged for this album:`);
  for (const warning of warnings) {
    console.log(`          - ${warning}`);
  }

  return warnings.length;
}

function reportApplyResult(
  result: ApplyResult,
  albumFolder: string,
  dryRun: boolean
): void {
  const verb = dryRun ? 'Would tag' : 'Tagged';
  console.log(`              ${verb}: ${result.tagged} track(s)`);
  if (result.errors > 0) {
    console.log(`              Errors: ${result.errors} — check warnings above`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('\n❌  Unexpected error:', err);
  process.exit(1);
});
