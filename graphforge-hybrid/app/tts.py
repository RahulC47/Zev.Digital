"""Local neural TTS via Piper — fully on-device speech synthesis.

Mirrors transcribe.py's lazy-load pattern: the voice model is loaded on first
use (and auto-downloaded once, ~60 MB from HuggingFace — the only network
access, same as the Whisper model download). Synthesis itself never leaves
the machine.

Requires `pip install piper-tts`. If it isn't installed, synthesize() raises
RuntimeError with install instructions; the desktop app falls back to the OS
speechSynthesis voices.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import wave

from .config import APP_DATA_DIR

logger = logging.getLogger(__name__)

# A clear, natural en-US voice with a good quality/size tradeoff (~60 MB).
DEFAULT_VOICE = "en_US-lessac-medium"
VOICE_DIR = os.path.join(APP_DATA_DIR, "piper-voices")

_voice = None
# Sticky failure message so we don't retry a hopeless setup on every request.
_voice_failed: str | None = None


def _download_voice(model_path: str) -> None:
    """One-time voice download into VOICE_DIR via piper's own downloader."""
    import subprocess
    import sys

    logger.info("Downloading Piper voice %s (one-time, ~60 MB)…", DEFAULT_VOICE)
    # The downloader writes into the current directory.
    subprocess.run(
        [sys.executable, "-m", "piper.download_voices", DEFAULT_VOICE],
        cwd=VOICE_DIR,
        check=True,
        timeout=600,
    )
    if not os.path.exists(model_path):
        raise RuntimeError("download finished but the voice file is missing")


def _get_voice():
    global _voice, _voice_failed
    if _voice is not None:
        return _voice
    if _voice_failed:
        raise RuntimeError(_voice_failed)

    try:
        from piper import PiperVoice
    except ImportError:
        _voice_failed = (
            "Neural TTS needs the piper-tts package. "
            "Run: pip install piper-tts  (then restart the sidecar)"
        )
        raise RuntimeError(_voice_failed)

    os.makedirs(VOICE_DIR, exist_ok=True)
    model_path = os.path.join(VOICE_DIR, f"{DEFAULT_VOICE}.onnx")
    if not os.path.exists(model_path):
        try:
            _download_voice(model_path)
        except Exception as e:  # noqa: BLE001
            # NOT sticky: a download can fail because the user is offline
            # right now and succeed later.
            raise RuntimeError(
                f"Couldn't download the Piper voice ({e}). "
                "Check your connection and try again."
            ) from e

    _voice = PiperVoice.load(model_path)
    logger.info("Piper voice %s loaded", DEFAULT_VOICE)
    return _voice


def _synthesize_sync(text: str) -> bytes:
    voice = _get_voice()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    return buf.getvalue()


async def synthesize(text: str) -> bytes:
    """Render `text` to WAV bytes. Blocking/CPU-bound → off the event loop."""
    return await asyncio.to_thread(_synthesize_sync, text)
