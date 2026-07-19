# PyInstaller spec for GraphForge desktop (no Docker).
# Build:  .venv\Scripts\pyinstaller graphforge.spec --noconfirm
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Native / data-heavy packages that PyInstaller can't fully trace on its own.
for pkg in [
    "kuzu",
    "faster_whisper",
    "ctranslate2",
    "onnxruntime",
    "av",
    "tokenizers",
    "tiktoken",
    "tiktoken_ext",
    "graphiti_core",
    "webview",
    "clr_loader",
    "pythonnet",
    # Local NLP (hybrid mode)
    "spacy",
    "en_core_web_sm",
    "fastembed",
    "rapidfuzz",
]:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# Plugin/entry modules imported lazily.
hiddenimports += [
    "tiktoken_ext.openai_public",
    "clr",
    "openai",
    "anthropic",
]
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("google.genai")

# The built frontend, served by the backend at runtime.
datas += [("app/web", "app/web")]


a = Analysis(
    ["desktop.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GraphForge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed app
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="GraphForge",
)
