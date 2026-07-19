# Zev.Digital

**Chat with your own context — 100% local, offline, and open source.**

Zev.Digital is a desktop "company brain": it reads the text you're working with straight
from the OS accessibility tree (no screenshots, no cloud), stores it in a local
**SQLite + Markdown vault**, and lets you **chat over your own work** with cited
answers — using a local LLM (Ollama) or your own API key (BYOK).

- 🔒 **Private by design** — nothing leaves your device. No account, no sign-up, no telemetry.
- 🧠 **Ask your work** — RAG chat with citations (app, window, time), plus a knowledge graph.
- 🎭 **Experts & Council** — custom personas (like local GPTs) and multi-expert answers.
- 📎 **Capture + upload** — passive window capture, drag-and-drop PDFs/DOCX/text.
- 🗝️ **BYOK** — local Ollama by default, or point it at any OpenAI-compatible endpoint / OpenRouter.
- 💸 **Free & MIT-licensed** — no trial, no paywall, no subscription.

> This is the free/offline edition. The engine is [Tauri](https://tauri.app) (Rust)
> + React, with an optional local Python sidecar for the knowledge graph and file
> parsing. **Everything works offline** once you have a model.

## Download

Grab the installer for your OS from the [Releases page](../../releases):

| OS | File |
|----|------|
| Windows | `Zev.Digital_x.y.z_x64-setup.exe` (or `.msi`) |
| macOS | `Zev.Digital_x.y.z_universal.dmg` |
| Linux | `Zev.Digital_x.y.z_amd64.AppImage` (or `.deb`) |

## Bring your own model

- **Local (recommended):** install [Ollama](https://ollama.com) and pull a model:
  `ollama pull llama3.1:8b`. Zev.Digital talks to it at `http://localhost:11434`.
- **Cloud key (BYOK):** in Settings, choose OpenRouter or a custom OpenAI-compatible
  base URL and paste your key. Your key stays in local settings; only your chosen
  provider is contacted.

## Bundled graph engine

The core app (capture → vault → keyword-RAG chat → experts) works with **no extra
downloads**. A small local Python sidecar adds the **knowledge graph**, semantic
search, and **PDF/DOCX parsing**. See [docs/PACKAGING.md](docs/PACKAGING.md) for how
it's bundled/run — it never phones home either.

## Build from source

```bash
# prerequisites: Node 20+, Rust (stable), and the Tauri OS deps (see tauri.app)
npm install
npm run build:sidecar # package the bundled graph service (requires uv/Python)
npm run tauri dev      # run in dev
npm run tauri build    # produce an installer for your current OS
```

Cross-platform installers are built in CI — see
[.github/workflows/release.yml](.github/workflows/release.yml) and
[docs/PACKAGING.md](docs/PACKAGING.md).

## License

[MIT](LICENSE). Contributions welcome.
