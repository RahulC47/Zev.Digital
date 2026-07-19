"""Headless sidecar entry point for Zev.Digital.

Launches GraphForge's FastAPI server without pywebview, using Zev.Digital's data
directory for storage.  Tauri starts this process and watches stdout for
the ``SIDECAR_READY`` sentinel.

Usage (dev):
    python sidecar.py --port 8766 --data-dir "C:/Users/.../vault/graphiti"

In production, the PyInstaller exe is launched by Tauri as a sidecar binary.
"""
from __future__ import annotations

import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Graphiti sidecar for Zev.Digital")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--data-dir", required=True, help="Directory for Kuzu + SQLite files")
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    os.makedirs(data_dir, exist_ok=True)

    # Override storage paths BEFORE importing the app (pydantic-settings reads env).
    os.environ["SQLITE_PATH"] = os.path.join(data_dir, "graphiti.db")
    os.environ["KUZU_PATH"] = os.path.join(data_dir, "graph.kuzu")

    # Import after env vars are set so config.settings picks them up.
    import uvicorn

    from app.main import app  # noqa: E402 — intentionally late import

    class _ReadyServer(uvicorn.Server):
        """Print SIDECAR_READY once the server is listening."""

        def startup(self, sockets=None):
            result = super().startup(sockets)
            print("SIDECAR_READY", flush=True)
            return result

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
    )
    server = _ReadyServer(config)
    server.run()


if __name__ == "__main__":
    main()
