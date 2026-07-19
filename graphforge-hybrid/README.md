# GraphForge Desktop (standalone, no Docker)

A single Windows app that builds temporal **knowledge graphs** from text, files, or
voice — one isolated graph per **session** — and exports them as context for other AI
apps. Same features as the Docker edition, but **fully self-contained**:

- **Embedded [Kuzu](https://kuzudb.com) graph DB** — a file on disk, no database server.
- **FastAPI backend + built React UI** served from one in-process server.
- **Native window** via pywebview (Windows' built-in WebView2) — real app, no browser tab.
- **Voice** transcribed locally with faster-whisper.
- Packaged into a `GraphForge.exe` by PyInstaller, installed by an Inno Setup installer.

All data lives in `%LOCALAPPDATA%\GraphForge\` (`graph.kuzu`, `graphforge.db`).

## Run from source (dev)

```powershell
# one-time: create the venv + install deps (Python 3.12 via uv)
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -e ".[build]"

# build the frontend into app\web
cd frontend; npm install; npm run build; cd ..

# launch the native app
.venv\Scripts\python.exe desktop.py
```

For frontend hot-reload during dev, run the backend and Vite separately:
```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8009
cd frontend; $env:VITE_API_BASE="http://localhost:8009/api"; npm run dev
```

## Build the .exe

```powershell
cd frontend; npm run build; cd ..        # ensure app\web is current
.venv\Scripts\pyinstaller graphforge.spec --noconfirm
# → dist\GraphForge\GraphForge.exe  (double-click to run)
```

## Build the installer

Install [Inno Setup](https://jrsoftware.org/isinfo.php), then:
```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
# → installer\GraphForge-Setup.exe
```
The installer is **per-user** (no admin), adds Start-menu + optional desktop shortcuts,
and registers an uninstaller.

## First run

1. Launch GraphForge. The graph DB initializes on first start.
2. Click ⚙ and paste an OpenAI / Anthropic / Gemini key (or pick `ollama` per session for offline).
3. Create a session, add text/files/voice, watch the graph build, then export.

## Notes & caveats

- **WebView2 runtime** ships with Windows 11; on older Windows the installer/app may prompt to install it.
- **Microphone:** WebView2 may ask for mic permission the first time you record.
- **Whisper models** download on first voice use (cached under `%LOCALAPPDATA%`).
- **Ollama** (offline) still requires installing Ollama separately and pulling a model.
- This shares the same `app/` backend code as the Docker edition, with the DB layer
  swapped from Neo4j to embedded Kuzu via Graphiti's database-agnostic model APIs.
