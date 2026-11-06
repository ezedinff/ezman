// Builds ezman-mcp and places it where Tauri expects the externalBin sidecar:
// src-tauri/binaries/ezman-mcp-<target-triple>[.exe]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const host = /host: (\S+)/.exec(execSync('rustc -vV', { encoding: 'utf8' }))[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const release = process.env.TAURI_ENV_DEBUG !== 'true';
const ext = triple.includes('windows') ? '.exe' : '';

const flags = [release ? '--release' : '', triple !== host ? `--target ${triple}` : ''].filter(Boolean).join(' ');
execSync(`cargo build -p ezman-mcp-server ${flags}`, { cwd: root, stdio: 'inherit' });

const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, 'target');
const built = path.join(targetDir, triple !== host ? triple : '', release ? 'release' : 'debug', `ezman-mcp${ext}`);
const dest = path.join(here, '../src-tauri/binaries');
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(built, path.join(dest, `ezman-mcp-${triple}${ext}`));
console.log(`sidecar ready: ezman-mcp-${triple}${ext}`);
