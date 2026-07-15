#!/usr/bin/env python3
"""Download card images from card metadata without committing the image assets."""

from __future__ import annotations

import argparse
import json
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cards-json", type=Path)
    source.add_argument("--cards-git-object")
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args()


def load_cards(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.cards_json:
        raw = args.cards_json.read_text(encoding="utf-8")
    else:
        raw = subprocess.check_output(
            ["git", "show", args.cards_git_object], text=True, encoding="utf-8"
        )
    cards = json.loads(raw)
    if not isinstance(cards, list):
        raise ValueError("Card source must contain a JSON array")
    return cards


def download(task: tuple[dict[str, Any], Path]) -> tuple[str, str | None]:
    card, output_dir = task
    card_id = card["id"]
    destination = output_dir / f"{card_id}.jpg"
    if destination.exists() and destination.stat().st_size > 10_000:
        return card_id, None
    try:
        request = urllib.request.Request(
            card["image"], headers={"User-Agent": "zutomayo-card-online-ocr/1.0"}
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            content = response.read()
        if len(content) <= 10_000:
            raise ValueError(f"Downloaded file is unexpectedly small ({len(content)} bytes)")
        destination.write_bytes(content)
        return card_id, None
    except Exception as exc:
        return card_id, str(exc)


def main() -> None:
    args = parse_args()
    cards = load_cards(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(download, (card, args.output_dir)): card["id"] for card in cards
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            card_id, error = future.result()
            if error:
                failures.append({"id": card_id, "error": error})
            if completed % 25 == 0 or completed == len(futures):
                print(f"Downloaded {completed}/{len(futures)}", flush=True)
    if failures:
        raise RuntimeError(json.dumps(failures, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
