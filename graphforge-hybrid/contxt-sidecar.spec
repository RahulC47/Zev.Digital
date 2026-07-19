# PyInstaller specification for Zev.Digital's headless Graphiti service.
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []
for package in [
    "kuzu", "graphiti_core", "spacy", "en_core_web_sm", "fastembed", "rapidfuzz",
    "onnxruntime", "tokenizers", "tiktoken", "tiktoken_ext",
    "faster_whisper", "ctranslate2", "av", "pypdf", "docx",
]:
    try:
        package_datas, package_binaries, package_imports = collect_all(package)
        datas += package_datas
        binaries += package_binaries
        hiddenimports += package_imports
    except Exception:
        pass

hiddenimports += ["tiktoken_ext.openai_public", "openai", "anthropic", "google.genai"]
hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["sidecar.py"], pathex=[], binaries=binaries, datas=datas,
    hiddenimports=hiddenimports, hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=["tkinter"], noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [], name="contxt-sidecar",
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True,
)
