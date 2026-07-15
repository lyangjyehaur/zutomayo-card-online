#!/usr/bin/env python3
"""Run an independent, tightly cropped OCR pass for fields needing review."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from concurrent.futures import ProcessPoolExecutor, as_completed
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


_ENGINE: Any = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extraction", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    return parser.parse_args()


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


def normalize(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", ascii_text.lower())


def letter_ratio(text: str) -> float:
    return len(re.findall(r"[A-Za-z]", text)) / max(len(text), 1)


def is_noise(text: str) -> bool:
    compact = normalize(text).upper()
    patterns = (
        r"^(COST|POWER|OWER)$",
        r"^NIGH[DT]?.*DAY\d*$",
        r"^NIGH[DT]?\d+$",
        r"^DAY\d+$",
        r"^(AREA)?ENCHANT$",
        r"^CHARACTE?R?$",
        r"^THEBATTLEBEGINS$",
        r"^SENDTOPOWER$",
        r"^ZUTT?OMAYONAKADEI+NONI$",
        r"^\d{3,}104$",
        r"^[NRSUW]{1,2}$",
    )
    return any(re.fullmatch(pattern, compact) for pattern in patterns)


def ocr_lines(image: Any) -> list[dict[str, Any]]:
    result = _ENGINE(image, use_cls=False)
    boxes = result.boxes if result.boxes is not None else []
    texts = result.txts if result.txts is not None else []
    scores = result.scores if result.scores is not None else []
    lines = []
    for box, text, score in zip(boxes, texts, scores):
        if letter_ratio(text) < 0.25 or is_noise(text):
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        lines.append(
            {
                "text": text.strip(),
                "score": float(score),
                "left": min(xs),
                "top": min(ys),
            }
        )
    return sorted(lines, key=lambda line: (line["top"], line["left"]))


def best_match(expected: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    texts = [line["text"] for line in lines]
    candidates = list(texts)
    for start in range(len(texts)):
        for end in range(start + 2, min(len(texts), start + 5) + 1):
            candidates.append(" ".join(texts[start:end]))
    expected_normalized = normalize(expected)
    if not expected_normalized or not candidates:
        return {"text": "", "ratio": 0.0}
    best = max(
        candidates,
        key=lambda candidate: SequenceMatcher(
            None, expected_normalized, normalize(candidate)
        ).ratio(),
    )
    return {
        "text": best,
        "ratio": SequenceMatcher(None, expected_normalized, normalize(best)).ratio(),
    }


def variants(crop: Any) -> dict[str, Any]:
    import cv2

    enlarged = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    enhanced = cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR)
    return {"color": enlarged, "enhanced": enhanced}


def review_field(expected: str, crop: Any) -> dict[str, Any]:
    results = {}
    for variant_name, variant in variants(crop).items():
        lines = ocr_lines(variant)
        results[variant_name] = {"lines": lines, "best": best_match(expected, lines)}
    return results


def process_card(task: tuple[dict[str, Any], str]) -> dict[str, Any]:
    card, images_dir = task
    import cv2

    image_path = Path(images_dir) / f"{card['id']}.jpg"
    image = cv2.imread(str(image_path))
    if image is None:
        return {"id": card["id"], "error": f"Unreadable image: {image_path}"}
    height = image.shape[0]
    output: dict[str, Any] = {"id": card["id"]}
    if card["nameStatus"] == "needs_review":
        output["name"] = review_field(
            card["enNameOfficial"], image[int(height * 0.63) : int(height * 0.83), :]
        )
    if card["effectStatus"] == "needs_review":
        output["effect"] = review_field(
            card["enEffectOfficial"], image[int(height * 0.80) : int(height * 0.94), :]
        )
    return output


def main() -> None:
    args = parse_args()
    extraction = json.loads(args.extraction.read_text(encoding="utf-8"))
    cards = [
        card
        for card in extraction["cards"]
        if card["nameStatus"] == "needs_review"
        or card["effectStatus"] == "needs_review"
    ]
    tasks = [(card, str(args.images_dir)) for card in cards]
    results = []
    with ProcessPoolExecutor(max_workers=args.workers, initializer=init_worker) as pool:
        futures = {pool.submit(process_card, task): task[0]["id"] for task in tasks}
        for completed, future in enumerate(as_completed(futures), start=1):
            card_id = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:
                results.append({"id": card_id, "error": str(exc)})
            if completed % 20 == 0 or completed == len(futures):
                print(f"Reviewed {completed}/{len(futures)}", flush=True)
    order = {card["id"]: index for index, card in enumerate(cards)}
    results.sort(key=lambda result: order[result["id"]])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"cardCount": len(cards), "records": results}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
