from __future__ import annotations

import asyncio
import tempfile

from .config import settings

_model = None

_HALLUCINATION_PATTERNS = {
    "thank you", "thanks for watching", "subscribe", "like and subscribe",
    "you", "bye", "goodbye", "see you", "the end",
}


def _looks_hallucinated(text: str) -> bool:
    """Detect common Whisper hallucinations on near-silent audio."""
    lower = text.lower().strip(" .")
    if lower in _HALLUCINATION_PATTERNS:
        return True
    words = lower.split()
    if len(words) >= 3 and len(set(words)) == 1:
        return True
    return False


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        # CPU + int8 keeps it light and dependency-free of CUDA on Windows/Docker.
        _model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
    return _model


def _transcribe_sync(data: bytes, suffix: str) -> str:
    model = _get_model()
    # delete=False so faster-whisper can open the file by path on Windows
    # (NamedTemporaryFile with delete=True holds a lock that blocks reads).
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.close()
        # First try without VAD — short user-initiated clips don't benefit
        # from Silero VAD and it aggressively discards quiet/short speech.
        segments, _info = model.transcribe(tmp.name, vad_filter=False)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        # Whisper sometimes hallucinates on silence (repeated filler words).
        # If the result looks like pure hallucination, retry with VAD as filter.
        if text and _looks_hallucinated(text):
            segments, _info = model.transcribe(tmp.name, vad_filter=True)
            text = " ".join(seg.text.strip() for seg in segments).strip()
        return text
    finally:
        import os
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


async def transcribe(data: bytes, filename: str = "audio.webm") -> str:
    suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
    # faster-whisper is blocking/CPU-bound -> run off the event loop.
    return await asyncio.to_thread(_transcribe_sync, data, suffix)
