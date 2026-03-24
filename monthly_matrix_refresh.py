#!/usr/bin/env python3
"""
Monthly provider matrix maintenance helper.

What this script does:
- Loads the provider JSON files in this repo
- Fetches each declared source page
- Stores a checksum and check timestamp in the JSON metadata

What this script does NOT do yet:
- It does not auto-rebuild the brand/model arrays from HTML

This still gives a reliable monthly signal in git history and helps detect
source-page changes that should trigger a manual refresh of extracted data.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
JSON_FILES = [
    "parkplace-supported-products.json",
    "evernex-supported-products.json",
    "itris-supported-products.json",
    "dis-supported-products.json",
    "nordic-supported-products.json",
]


def utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch_source(url: str) -> Tuple[bool, str]:
    req = Request(
        url,
        headers={
            "User-Agent": "hw24-provider-matrix-refresh/1.0 (+github-actions)",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urlopen(req, timeout=45) as response:
            raw = response.read()
        return True, raw.decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError):
        return False, ""


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def update_one(path: Path, today: str) -> Tuple[bool, str]:
    data = read_json(path)
    source_url = str(data.get("source", "")).strip()
    if not source_url:
        return False, f"{path.name}: skipped (missing source URL)"

    old = json.dumps(data, sort_keys=True, ensure_ascii=False)

    ok, html = fetch_source(source_url)
    data["last_checked_at"] = today
    data["source_reachable"] = ok

    if ok:
        new_hash = sha256_text(html)
        old_hash = data.get("source_hash", "")
        data["source_hash"] = new_hash
        if old_hash and old_hash != new_hash:
            data["source_changed_at"] = today
            data["refresh_note"] = "Source content changed; please review and refresh extracted brand/model lists."
        elif not old_hash:
            data["source_changed_at"] = today
            data["refresh_note"] = "Initial source checksum recorded."
    else:
        data["refresh_note"] = "Source could not be reached in monthly check."

    new = json.dumps(data, sort_keys=True, ensure_ascii=False)
    changed = old != new
    if changed:
        write_json(path, data)

    state = "updated" if changed else "unchanged"
    reach = "reachable" if ok else "unreachable"
    return changed, f"{path.name}: {state} ({reach})"


def main() -> int:
    today = utc_date()
    changed_any = False
    lines: List[str] = []

    for rel in JSON_FILES:
        path = ROOT / rel
        if not path.exists():
            lines.append(f"{rel}: missing")
            continue
        changed, msg = update_one(path, today)
        changed_any = changed_any or changed
        lines.append(msg)

    print("\n".join(lines))

    # Exit 0 either way; PR action handles no-change gracefully.
    return 0


if __name__ == "__main__":
    sys.exit(main())
