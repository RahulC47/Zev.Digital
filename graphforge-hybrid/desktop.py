"""GraphForge desktop launcher: runs the FastAPI backend in-process and shows it
in a native window (Edge WebView2 via pywebview). No Docker, no browser tab."""

from __future__ import annotations

import os
import socket
import threading
import time

import uvicorn
import webview

from app.main import app

HOST = "127.0.0.1"
PORT = 8765



class JsApi:
    """Python functions exposed to the frontend as window.pywebview.api.*"""

    def save_file(self, filename: str, content: str) -> dict:
        """Show a native Windows Save dialog and write the file.

        Called from JS via: await window.pywebview.api.save_file(filename, content)
        Returns {ok: true, path: "..."} or {ok: false, reason: "..."}
        """
        try:
            window = webview.windows[0]
            # Suggest the user's Downloads folder as the default directory
            downloads = os.path.join(os.path.expanduser("~"), "Downloads")
            result = window.create_file_dialog(
                webview.SAVE_DIALOG,
                directory=downloads if os.path.isdir(downloads) else "",
                save_filename=filename,
            )
            if not result:
                return {"ok": False, "reason": "cancelled"}
            path = result[0] if isinstance(result, (list, tuple)) else result
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(content)
            return {"ok": True, "path": path}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "reason": str(exc)}


def _serve() -> None:
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    # Signal handlers can only be installed on the main thread; we run off-thread.
    server.install_signal_handlers = lambda: None
    server.run()


def _wait_ready(timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((HOST, PORT), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def main() -> None:
    threading.Thread(target=_serve, daemon=True).start()
    if not _wait_ready():
        raise RuntimeError("Backend failed to start")
    webview.create_window(
        "GraphForge",
        f"http://{HOST}:{PORT}/",
        js_api=JsApi(),
        width=1320,
        height=860,
        min_size=(900, 600),
    )
    webview.start()  # blocks until the window is closed


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # A windowed (no-console) build fails silently; leave a breadcrumb.
        import traceback

        from app.config import APP_DATA_DIR

        with open(f"{APP_DATA_DIR}\\launch_error.log", "w", encoding="utf-8") as fh:
            fh.write(traceback.format_exc())
        raise
