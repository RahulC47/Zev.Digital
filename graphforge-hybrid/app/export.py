from __future__ import annotations

import json

from .graphview import get_full


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("'", "\\'")


async def export_markdown(gid: str, session_name: str) -> str:
    data = await get_full(gid)
    lines = [f"# Knowledge graph: {session_name}", ""]

    lines.append(f"## Entities ({len(data['entities'])})")
    lines.append("")
    for e in sorted(data["entities"], key=lambda x: x["label"].lower()):
        summary = e.get("summary") or ""
        lines.append(f"- **{e['label']}**" + (f" — {summary}" if summary else ""))
    lines.append("")

    lines.append(f"## Facts / Relationships ({len(data['edges'])})")
    lines.append("")
    name_by_id = {e["id"]: e["label"] for e in data["entities"]}
    for edge in data["edges"]:
        src = name_by_id.get(edge["source"], edge["source"])
        tgt = name_by_id.get(edge["target"], edge["target"])
        fact = edge.get("fact") or f"{src} {edge.get('name', '')} {tgt}"
        valid = edge.get("valid_at")
        suffix = f"  _(valid: {valid})_" if valid and valid != "None" else ""
        lines.append(f"- {fact}{suffix}")
    lines.append("")
    return "\n".join(lines)


async def export_json(gid: str) -> str:
    data = await get_full(gid)
    return json.dumps(data, indent=2, default=str)


async def export_cypher(gid: str) -> str:
    """Generate re-importable CREATE statements scoped to this group."""
    data = await get_full(gid)
    lines = ["// Graphiti session export", f"// group_id: {gid}", ""]
    for e in data["entities"]:
        lines.append(
            f"CREATE (:Entity {{uuid:'{_esc(e['id'])}', name:'{_esc(e['label'])}', "
            f"summary:'{_esc(e.get('summary',''))}', group_id:'{_esc(gid)}'}});"
        )
    lines.append("")
    for edge in data["edges"]:
        lines.append(
            f"MATCH (a:Entity {{uuid:'{_esc(edge['source'])}'}}), "
            f"(b:Entity {{uuid:'{_esc(edge['target'])}'}}) "
            f"CREATE (a)-[:RELATES_TO {{name:'{_esc(edge.get('name',''))}', "
            f"fact:'{_esc(edge.get('fact',''))}', group_id:'{_esc(gid)}'}}]->(b);"
        )
    return "\n".join(lines)
