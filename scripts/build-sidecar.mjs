import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const sidecarDir = join(root, 'graphforge-hybrid');
const target = process.env.TAURI_ENV_TARGET_TRIPLE
  || execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const extension = platform() === 'win32' ? '.exe' : '';
const produced = join(sidecarDir, 'dist', `contxt-sidecar${extension}`);
const destinationDir = join(root, 'src-tauri', 'binaries');
const destination = join(destinationDir, `contxt-sidecar-${target}${extension}`);

execFileSync('uv', ['run', '--extra', 'build', 'pyinstaller', 'contxt-sidecar.spec', '--noconfirm', '--clean'], {
  cwd: sidecarDir,
  stdio: 'inherit',
});
if (!existsSync(produced)) throw new Error(`Sidecar build did not produce ${produced}`);
mkdirSync(destinationDir, { recursive: true });
if (existsSync(destination)) rmSync(destination);
cpSync(produced, destination);
console.log(`Bundled sidecar staged at ${destination}`);
