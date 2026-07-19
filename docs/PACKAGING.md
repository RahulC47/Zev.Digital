# Packaging & distribution (Windows · macOS · Linux)

Contxt is a [Tauri](https://tauri.app) app, so each OS gets its own native installer.
**You cannot build all three on one machine** — each OS is built on its own runner.
The included GitHub Actions workflow does this for you.

## The easy path: build all 3 in CI

1. Push this repo to GitHub.
2. Tag a release: `git tag v0.1.0 && git push origin v0.1.0`.
3. [.github/workflows/release.yml](../.github/workflows/release.yml) spins up
   Windows, macOS and Linux runners, builds each installer, and attaches them to a
   **draft GitHub Release**. Review it and hit *Publish*.

You get:

| OS | Artifacts |
|----|-----------|
| Windows | `.exe` (NSIS) and/or `.msi` |
| macOS | `.dmg` (universal — Apple Silicon + Intel) |
| Linux | `.AppImage` and `.deb` |

### Signing (do this before a public launch)
Unsigned apps trigger scary OS warnings.
- **Windows:** an Authenticode cert (or ship unsigned + document SmartScreen "More info → Run anyway").
- **macOS:** an Apple Developer ID cert + notarization (add the `APPLE_*` secrets in the workflow). Without it, users must right-click → Open.
- **Linux:** AppImage/deb don't require signing; optionally provide a checksum.

## Build one OS locally

```bash
npm install
npm run tauri build
# installers land in src-tauri/target/release/bundle/
```

## Putting the 3 downloads on your website

The 3 installers are just files. Two common setups:

1. **Link to the GitHub Release (simplest, free hosting):** on your site, add three
   buttons pointing at the release assets, e.g.
   `https://github.com/<you>/contxt/releases/latest/download/Contxt_0.1.0_x64-setup.exe`
   (the `/latest/download/<asset-name>` URL always resolves to the newest release).
2. **Host the files yourself:** upload the `.exe` / `.dmg` / `.AppImage` to your own
   storage (S3/R2/Netlify) and link them. Publish a **SHA-256 checksum** next to each
   so users can verify.

A tiny bit of JS can auto-detect the visitor's OS and highlight the right button,
but three plain links work fine.

## The sidecar question (important)

Contxt has an **optional** local Python sidecar (FastAPI + Graphiti) that powers the
knowledge graph, semantic search, and PDF/DOCX parsing. The **core app works without
it** (capture → vault → keyword-RAG chat → experts, all offline).

There are two ways to ship it — pick one:

### Option A — Bundle it inside each installer (best UX, nothing extra to download)
- Compile the sidecar to a single native binary **per OS** with PyInstaller
  (`graphforge-hybrid/` → `contxt-sidecar`). This must run on each OS (again → CI),
  because it embeds native pieces (Kuzu, spaCy, fastembed, Whisper) that are
  platform-specific.
- Add it to `src-tauri/tauri.conf.json` as an external binary so Tauri bundles it:
  ```json
  "bundle": { "externalBin": ["binaries/contxt-sidecar"] }
  ```
  with per-target names like `contxt-sidecar-x86_64-pc-windows-msvc.exe`,
  `contxt-sidecar-aarch64-apple-darwin`, etc. Tauri picks the right one at build time.
- **Cost:** each installer grows by ~150–250 MB (the ML models). The user downloads
  one file and everything just works. Nothing is fetched separately.

### Option B — Ship the core app only; sidecar is optional/separate
- The installer stays small (~15–30 MB). Graph/semantic/parse features are disabled
  until a sidecar is present; the app already falls back to SQLite keyword search.
- Offer the sidecar as a separate download, or fetch it on first use.
- **Cost:** worse UX (a second step), but tiny installers.

**Recommendation:** for a polished "download one exe and it works" experience, use
**Option A** and build the sidecar per-OS in the same CI matrix. If you want the
smallest possible installer and are OK with keyword-only RAG out of the box, ship
**Option B** and add the sidecar later. Either way, **the sidecar is 100% local** —
it listens only on `127.0.0.1` and never phones home.

> The current repo is set up for **Option A**: CI builds the PyInstaller sidecar on
> each OS, stages it under `src-tauri/binaries/`, and Tauri includes it through
> `externalBin`. Contxt starts that local process automatically at launch.
