from __future__ import annotations

from datetime import datetime, timezone

from graphiti_core.nodes import EpisodeType

from . import bitemporal as bt
from . import jobs
from .graphiti_factory import configure, get_driver, get_engine, write_lock
from .parsers import chunk_text, extract_text
from .sessions import GraphSession
from .transcribe import transcribe


async def _add_episode(s: GraphSession, name: str, body: str, source_description: str) -> None:
    if s.provider == "local":
        # Bypass Graphiti's LLM-heavy add_episode — use spaCy + fastembed instead
        from .local_ingest import local_add_episode

        async with write_lock:
            await local_add_episode(
                group_id=s.id,
                name=name,
                body=body,
                source_description=source_description,
            )
        return

    engine = await get_engine()
    async with write_lock:  # Kuzu single-writer: serialize all graph ops
        configure(engine, s)
        await engine.add_episode(
            name=name,
            episode_body=body,
            source=EpisodeType.text,
            source_description=source_description,
            reference_time=datetime.now(timezone.utc),
            group_id=s.id,
        )


async def ingest_text(s: GraphSession, text: str, name: str, source_description: str, job_id: str):
    try:
        chunks = chunk_text(text)
        jobs.update_job(job_id, total=max(len(chunks), 1), status="running")
        for i, chunk in enumerate(chunks):
            await _add_episode(s, f"{name} [{i + 1}/{len(chunks)}]", chunk, source_description)
            jobs.bump_job(job_id, detail=f"chunk {i + 1}/{len(chunks)}")
        jobs.update_job(job_id, status="done", detail="complete")
        await bt.sync_group(get_driver(), s.id)
    except Exception as e:  # noqa: BLE001
        jobs.update_job(job_id, status="error", error=str(e))


async def ingest_files(s: GraphSession, files: list[tuple[str, bytes]], job_id: str):
    try:
        all_chunks: list[tuple[str, str, str]] = []  # (name, body, source_description)
        for filename, data in files:
            text = extract_text(filename, data)
            chunks = chunk_text(text)
            for i, chunk in enumerate(chunks):
                all_chunks.append((f"{filename} [{i + 1}/{len(chunks)}]", chunk, filename))
        jobs.update_job(job_id, total=max(len(all_chunks), 1), status="running")
        for name, body, src in all_chunks:
            await _add_episode(s, name, body, src)
            jobs.bump_job(job_id, detail=name)
        jobs.update_job(job_id, status="done", detail="complete")
        await bt.sync_group(get_driver(), s.id)
    except Exception as e:  # noqa: BLE001
        jobs.update_job(job_id, status="error", error=str(e))


async def ingest_audio(s: GraphSession, data: bytes, filename: str, job_id: str):
    try:
        jobs.update_job(job_id, status="running", detail="transcribing")
        text = await transcribe(data, filename)
        if not text:
            jobs.update_job(job_id, status="error", error="No speech detected")
            return
        jobs.update_job(job_id, detail=f"transcript: {text[:80]}")
        await _add_episode(s, f"voice: {text[:40]}", text, "voice input")
        jobs.update_job(job_id, status="done", processed=1, total=1, detail=text)
        await bt.sync_group(get_driver(), s.id)
    except Exception as e:  # noqa: BLE001
        jobs.update_job(job_id, status="error", error=str(e))
