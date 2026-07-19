from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

JobStatus = Literal["queued", "running", "done", "error"]

# Simple in-memory job registry for async ingestion progress.
_jobs: dict[str, dict] = {}


def create_job(session_id: str, kind: str, total: int = 1) -> str:
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {
        "id": job_id,
        "session_id": session_id,
        "kind": kind,
        "status": "queued",
        "processed": 0,
        "total": total,
        "detail": "",
        "error": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return job_id


def update_job(job_id: str, **fields) -> None:
    job = _jobs.get(job_id)
    if job:
        job.update(fields)


def bump_job(job_id: str, detail: str = "") -> None:
    job = _jobs.get(job_id)
    if job:
        job["processed"] += 1
        job["status"] = "running"
        if detail:
            job["detail"] = detail


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)
