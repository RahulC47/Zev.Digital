"""Composio toolset wrapper for Zev's assistant integrations.

The user brings their own Composio API key (stored in the OS keyring on the Rust
side and pushed here at runtime). All connected apps live under a single fixed
entity so the Rust side never deals with Composio's multi-entity model.

Action/app names are passed as **strings** rather than the `Action`/`App` enums
so the integration survives minor Composio SDK version drift (enum members come
and go between releases). Read actions are listed per app below; write actions
are passed straight through from the UI (which gates them behind an explicit
user confirm — the agent never sends on its own).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Single user → single Composio entity.
ENTITY_ID = "zev-user"

# App keys used by the Zev UI (Composio's canonical app slugs, lowercased).
SUPPORTED_APPS = ["gmail", "googlecalendar", "slack", "notion"]

# Per-app READ action + default params. Confirm names against the installed
# composio version if a fetch returns empty — these are the stable slugs as of
# composio-core 0.5/0.6.
_FETCH: dict[str, tuple[str, dict[str, Any]]] = {
    "gmail": ("GMAIL_FETCH_EMAILS", {"max_results": 10}),
    "googlecalendar": ("GOOGLECALENDAR_FIND_EVENT", {"max_results": 10}),
    "slack": ("SLACK_FETCH_CONVERSATION_HISTORY", {"limit": 20}),
    "notion": ("NOTION_SEARCH_NOTION_PAGE", {"query": ""}),
}

_toolset = None  # type: ignore[var-annotated]


def configure(api_key: str) -> None:
    """(Re)build the toolset from the user's Composio API key."""
    global _toolset
    from composio import ComposioToolSet  # imported lazily so the dep is optional

    _toolset = ComposioToolSet(api_key=api_key, entity_id=ENTITY_ID)


def is_configured() -> bool:
    return _toolset is not None


def _ts():
    if _toolset is None:
        raise RuntimeError("Composio is not configured — set your API key first.")
    return _toolset


# ── connections ─────────────────────────────────────────────────────────────

def connected_apps() -> list[dict]:
    """Status of each supported app for the Zev entity."""
    ts = _ts()
    entity = ts.get_entity(id=ENTITY_ID)
    try:
        conns = entity.get_connections()
    except Exception as e:  # noqa: BLE001
        logger.warning("get_connections failed: %s", e)
        conns = []

    by_app: dict[str, dict] = {}
    for c in conns:
        name = (
            getattr(c, "appName", None)
            or getattr(c, "appUniqueId", None)
            or ""
        ).lower()
        if name:
            by_app[name] = {
                "status": str(getattr(c, "status", "")).lower(),
                "id": getattr(c, "id", None),
            }

    out = []
    for key in SUPPORTED_APPS:
        info = by_app.get(key)
        out.append({
            "app": key,
            "connected": bool(info and info.get("status") == "active"),
            "account_id": (info or {}).get("id"),
        })
    return out


def initiate(app: str) -> dict:
    """Start an OAuth connection; returns Composio's hosted redirect URL."""
    ts = _ts()
    entity = ts.get_entity(id=ENTITY_ID)
    req = entity.initiate_connection(app_name=app)
    return {
        "redirect_url": getattr(req, "redirectUrl", None) or getattr(req, "redirect_url", None),
        "connection_id": getattr(req, "connectedAccountId", None)
        or getattr(req, "connected_account_id", None),
    }


def connection_status(connection_id: str) -> str:
    ts = _ts()
    try:
        acc = ts.get_connected_account(connection_id)
        return str(getattr(acc, "status", "unknown")).lower()
    except Exception as e:  # noqa: BLE001
        logger.warning("connection_status failed: %s", e)
        return "unknown"


def disconnect(app: str) -> bool:
    ts = _ts()
    entity = ts.get_entity(id=ENTITY_ID)
    removed = False
    try:
        for c in entity.get_connections():
            if (getattr(c, "appName", None) or "").lower() == app:
                ts.client.connected_accounts.delete(getattr(c, "id"))
                removed = True
    except Exception as e:  # noqa: BLE001
        logger.warning("disconnect failed: %s", e)
    return removed


# ── actions ───────────────────────────────────────────────────────────────────

def fetch(app: str, limit: int = 10) -> list[dict]:
    """Run the app's READ action and normalize the result to brain-ingestable rows."""
    ts = _ts()
    spec = _FETCH.get(app)
    if not spec:
        raise RuntimeError(f"unsupported app: {app}")
    action, base_params = spec
    params = dict(base_params)
    for k in ("max_results", "limit"):
        if k in params:
            params[k] = limit
    resp = ts.execute_action(action=action, params=params, entity_id=ENTITY_ID)
    data = resp.get("data") if isinstance(resp, dict) else resp
    return _normalize(app, data)


def upcoming() -> list[dict]:
    """Next calendar events (used for reminders)."""
    return fetch("googlecalendar", 10)


def execute(action: str, params: Optional[dict]) -> dict:
    """Run an arbitrary (write) action. Only reached after the UI's explicit
    confirm — this is the single side-effectful entry point."""
    ts = _ts()
    resp = ts.execute_action(action=action, params=params or {}, entity_id=ENTITY_ID)
    return resp if isinstance(resp, dict) else {"data": resp}


# ── normalization (defensive — provider payloads vary by version) ──────────────

def _as_list(data: Any) -> list:
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("messages", "items", "events", "results", "emails", "data"):
            v = data.get(k)
            if isinstance(v, list):
                return v
        return [data]
    return [data]


def _g(d: dict, *keys: str, default: str = "") -> str:
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return str(d.get(k))
    return default


def _normalize(app: str, data: Any) -> list[dict]:
    rows = _as_list(data)
    out: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            out.append({"title": "", "body": str(r), "ts": "", "url": "", "meta": {}})
            continue
        if app == "gmail":
            sender = _g(r, "sender", "from", "From")
            body = _g(r, "messageText", "preview", "snippet", "body", "messageBody")
            out.append({
                "title": _g(r, "subject", "Subject", default="(no subject)"),
                "body": (f"From: {sender}\n{body}".strip() if sender else body),
                "ts": _g(r, "messageTimestamp", "internalDate", "date"),
                "url": "",
                "meta": {"sender": sender, "threadId": _g(r, "threadId")},
            })
        elif app == "googlecalendar":
            start_raw = r.get("start")
            start = start_raw if isinstance(start_raw, str) else _g(start_raw or {}, "dateTime", "date")
            out.append({
                "title": _g(r, "summary", "title", default="(busy)"),
                "body": _g(r, "description"),
                "ts": start,
                "url": _g(r, "htmlLink"),
                "meta": {"location": _g(r, "location")},
            })
        elif app == "slack":
            out.append({
                "title": "Slack message",
                "body": _g(r, "text"),
                "ts": _g(r, "ts", "timestamp"),
                "url": "",
                "meta": {"user": _g(r, "user")},
            })
        elif app == "notion":
            out.append({
                "title": _g(r, "title", "name", default="Notion page"),
                "body": _g(r, "content", "text", "preview"),
                "ts": _g(r, "last_edited_time"),
                "url": _g(r, "url"),
                "meta": {},
            })
        else:
            out.append({
                "title": _g(r, "title", "name", "subject"),
                "body": str(r),
                "ts": "",
                "url": _g(r, "url"),
                "meta": {},
            })
    return out
