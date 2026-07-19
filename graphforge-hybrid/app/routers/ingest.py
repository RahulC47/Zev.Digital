from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from .. import jobs
from .. import sessions as repo
from ..ingest import ingest_audio, ingest_files, ingest_text

router = APIRouter()


class TextIn(BaseModel):
    text: str
    name: str = "note"
    source_description: str = "typed input"


def _require(session_id: str):
    s = repo.get_session(session_id)
    if s is None:
        raise HTTPException(404, "session not found")
    return s


@router.post("/sessions/{session_id}/text", status_code=202)
async def add_text(session_id: str, body: TextIn, bg: BackgroundTasks):
    s = _require(session_id)
    if not body.text.strip():
        raise HTTPException(400, "text is empty")
    job_id = jobs.create_job(session_id, "text")
    bg.add_task(ingest_text, s, body.text, body.name, body.source_description, job_id)
    return {"job_id": job_id}


@router.post("/sessions/{session_id}/files", status_code=202)
async def add_files(session_id: str, bg: BackgroundTasks, files: list[UploadFile] = File(...)):
    s = _require(session_id)
    payload: list[tuple[str, bytes]] = []
    for f in files:
        payload.append((f.filename or "file", await f.read()))
    job_id = jobs.create_job(session_id, "files", total=len(payload))
    bg.add_task(ingest_files, s, payload, job_id)
    return {"job_id": job_id, "files": [name for name, _ in payload]}


@router.post("/sessions/{session_id}/audio", status_code=202)
async def add_audio(session_id: str, bg: BackgroundTasks, file: UploadFile = File(...)):
    s = _require(session_id)
    data = await file.read()
    job_id = jobs.create_job(session_id, "audio")
    bg.add_task(ingest_audio, s, data, file.filename or "audio.webm", job_id)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return job
