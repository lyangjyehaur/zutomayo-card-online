#!/usr/bin/env python3
"""Extract official English card text from downloaded card images.

The script keeps the complete OCR geometry so extracted fields can be audited.
Card metadata can come from a JSON file or from a JSON blob stored in Git.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import unicodedata
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any


_ENGINE: Any = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cards-json", type=Path)
    source.add_argument("--cards-git-object")
    parser.add_argument("--ids", nargs="*", help="Only process these card IDs")
    parser.add_argument("--workers", type=int, default=4)
    return parser.parse_args()


def load_cards(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.cards_json:
        raw = args.cards_json.read_text(encoding="utf-8")
    else:
        raw = subprocess.check_output(
            ["git", "show", args.cards_git_object],
            text=True,
            encoding="utf-8",
        )
    cards = json.loads(raw)
    if not isinstance(cards, list):
        raise ValueError("Card source must contain a JSON array")
    return cards


def init_worker() -> None:
    global _ENGINE
    from rapidocr import RapidOCR

    _ENGINE = RapidOCR(
        params={
            "EngineConfig.onnxruntime.intra_op_num_threads": 1,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "Global.log_level": "error",
        }
    )


def ascii_letter_ratio(text: str) -> float:
    if not text:
        return 0.0
    return len(re.findall(r"[A-Za-z]", text)) / len(text)


def normalized_box(
    box: list[list[float]],
    width: int,
    height: int,
    offset_y: int = 0,
) -> dict[str, float]:
    xs = [point[0] for point in box]
    ys = [point[1] + offset_y for point in box]
    return {
        "left": float(min(xs) / width),
        "top": float(min(ys) / height),
        "right": float(max(xs) / width),
        "bottom": float(max(ys) / height),
    }


def is_noise(text: str) -> bool:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    compact = re.sub(r"[^A-Z0-9]", "", ascii_text.upper())
    noise_patterns = (
        r"^(THE)?WORLDISCHANGING$",
        r"^ALLALONGTHEWATCHTOWER$",
        r"^OFFMINOR$",
        r"^FANTASYISREALITY$",
        r"^ZUTOMAYO$",
        r"^ZUTT?OMAYONAKADEI+NONI$",
        r"^THEBATTLEBEGINS$",
        r"^SENDTOPOWER$",
        r"^(POWER|COST|OWER)$",
        r"^NIGH[DT]?.*DAY\d*$",
        r"^NIGH[DT]?\d+$",
        r"^DAY\d+$",
        r"^(AREA)?ENCHANT$",
        r"^CHARACTER$",
        r"^ILLUSTRATOR.*$",
        r"^ZUTOMAYO20\d\d$",
        r"^\d{3,4}104$",
        r"^[NRSU]{1,2}$",
    )
    return any(re.fullmatch(pattern, compact) for pattern in noise_patterns)


def extract_candidates(
    card_id: str,
    has_effect: bool,
    lines: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pack = card_id.split("_", 1)[0]
    name_top, name_bottom = (0.64, 0.825)
    name_candidates: list[dict[str, Any]] = []
    effect_candidates: list[dict[str, Any]] = []

    for line in lines:
        text = line["text"].strip()
        box = line["position"]
        center_y = (box["top"] + box["bottom"]) / 2
        if ascii_letter_ratio(text) < 0.25 or is_noise(text):
            continue
        if name_top <= center_y <= name_bottom:
            name_candidates.append(line)
        if (
            has_effect
            and 0.815 <= center_y <= 0.925
            and box["left"] < 0.18
            and box["right"] < 0.76
        ):
            effect_candidates.append(line)

    order = lambda line: (line["position"]["top"], line["position"]["left"])
    return sorted(name_candidates, key=order), sorted(effect_candidates, key=order)


def process_card(task: tuple[dict[str, Any], str]) -> dict[str, Any]:
    card, images_dir = task
    image_path = Path(images_dir) / f"{card['id']}.jpg"
    if not image_path.exists():
        return {"id": card["id"], "error": f"Missing image: {image_path}"}

    import cv2

    image = cv2.imread(str(image_path))
    if image is None:
        return {"id": card["id"], "error": f"Unreadable image: {image_path}"}
    height, width = image.shape[:2]
    crop_top = int(height * 0.62)
    result = _ENGINE(image[crop_top:, :], use_cls=False)
    lines = []
    boxes = result.boxes if result.boxes is not None else []
    texts = result.txts if result.txts is not None else []
    scores = result.scores if result.scores is not None else []
    for box, text, score in zip(boxes, texts, scores):
        lines.append(
            {
                "text": text,
                "score": float(score),
                "position": normalized_box(box, width, height, crop_top),
            }
        )
    name_candidates, effect_candidates = extract_candidates(
        card["id"], bool(str(card.get("effect", "")).strip()), lines
    )
    return {
        "id": card["id"],
        "image": card.get("image", ""),
        "japaneseName": card.get("name", ""),
        "japaneseEffect": card.get("effect", ""),
        "nameCandidates": name_candidates,
        "effectCandidates": effect_candidates,
        "ocrLines": lines,
        "elapsedSeconds": float(result.elapse),
    }


def main() -> None:
    args = parse_args()
    cards = load_cards(args)
    if args.ids:
        requested_ids = set(args.ids)
        cards = [card for card in cards if card["id"] in requested_ids]
        missing_ids = requested_ids - {card["id"] for card in cards}
        if missing_ids:
            raise ValueError(f"Unknown card IDs: {', '.join(sorted(missing_ids))}")
    tasks = [(card, str(args.images_dir)) for card in cards]
    records: list[dict[str, Any]] = []
    with ProcessPoolExecutor(max_workers=args.workers, initializer=init_worker) as pool:
        futures = {pool.submit(process_card, task): task[0]["id"] for task in tasks}
        for completed, future in enumerate(as_completed(futures), start=1):
            card_id = futures[future]
            try:
                records.append(future.result())
            except Exception as exc:
                records.append({"id": card_id, "error": str(exc)})
            if completed % 25 == 0 or completed == len(futures):
                print(f"OCR {completed}/{len(futures)}", flush=True)

    order = {card["id"]: index for index, card in enumerate(cards)}
    records.sort(key=lambda record: order.get(record["id"], len(order)))
    payload = {
        "schemaVersion": 1,
        "cardCount": len(cards),
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
