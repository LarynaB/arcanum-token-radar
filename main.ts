// Token Launch Radar entrypoint (Node 22, standard library only, deterministic).
// Reads /input/snapshot.json (or --input), computes empirical peer-multiple valuations & farm plans,
// writes /output/board.json, /output/data.js, copies dashboard/ and screenshots/, and writes /output/dossier.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEq === undefined ? fallback : withEq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token-radar: missing snapshot at ${inputFile}\n`);
  process.exit(2);
}

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: gate validation failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyDirFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyDirFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shotFiles = copyDirFiles(join(here, 'screenshots'), join(out, 'screenshots'));

if (shotFiles.length >= 3) {
  for (const name of shotFiles) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token-radar: invalid screenshot name ${name}\n`);
      process.exit(1);
    }
  }
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
} else {
  process.stderr.write(`token-radar: screenshots/ has ${shotFiles.length} images (need 3+ before dossier.json)\n`);
  process.exit(1);
}

process.stdout.write(
  `token-radar: scored ${board.length} pre-token protocols (${radar.watchlist_count} watchlist, ${board.length - radar.watchlist_count} early radar; ${radar.live_token_count} live peers)\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shotFiles.length} images), dossier.json\n`,
);
