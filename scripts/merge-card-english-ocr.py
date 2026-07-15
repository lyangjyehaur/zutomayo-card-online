#!/usr/bin/env python3
"""Merge geometry-aware OCR with prior Vision OCR into auditable card fields."""

from __future__ import annotations

import argparse
import itertools
import json
import re
import subprocess
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    prior = parser.add_mutually_exclusive_group(required=True)
    prior.add_argument("--prior-json", type=Path)
    prior.add_argument("--prior-git-object")
    parser.add_argument("--overrides", type=Path)
    parser.add_argument("--second-pass", type=Path)
    return parser.parse_args()


def load_json(path: Path | None, git_object: str | None = None) -> Any:
    if path is not None:
        raw = path.read_text(encoding="utf-8")
    elif git_object:
        raw = subprocess.check_output(
            ["git", "show", git_object], text=True, encoding="utf-8"
        )
    else:
        raise ValueError("A JSON path or Git object is required")
    return json.loads(raw)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def letter_ratio(text: str) -> float:
    return len(re.findall(r"[A-Za-z]", text)) / max(len(text), 1)


def is_noise(text: str) -> bool:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    compact = re.sub(r"[^A-Z0-9]", "", ascii_text.upper())
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


def center_y(line: dict[str, Any]) -> float:
    position = line["position"]
    return (position["top"] + position["bottom"]) / 2


def name_lines(record: dict[str, Any]) -> list[dict[str, Any]]:
    lines = []
    for line in record.get("ocrLines", []):
        text = line["text"].strip()
        y = center_y(line)
        if 0.64 <= y <= 0.825 and letter_ratio(text) >= 0.25 and not is_noise(text):
            lines.append(line)
    return sorted(lines, key=lambda line: (center_y(line), line["position"]["left"]))


def reading_order_text(lines: list[dict[str, Any]]) -> str:
    if not lines:
        return ""
    rows: list[list[dict[str, Any]]] = []
    for line in lines:
        row_center = sum(map(center_y, rows[-1])) / len(rows[-1]) if rows else 0
        if not rows or abs(center_y(line) - row_center) > 0.012:
            rows.append([line])
        else:
            rows[-1].append(line)
    parts = []
    for row in rows:
        row.sort(key=lambda line: line["position"]["left"])
        right_side = [line for line in row if line["position"]["left"] >= 0.52]
        chosen = right_side if right_side else row
        parts.append(" ".join(line["text"].strip() for line in chosen))
    return " ".join(parts).strip()


def best_similarity(reference: str, lines: list[dict[str, Any]]) -> float:
    texts = [line["text"].strip() for line in lines]
    if not reference or not texts:
        return 0.0
    candidates = [reading_order_text(lines), *texts]
    if len(texts) <= 5:
        candidates.extend(" ".join(order) for order in itertools.permutations(texts))
    reference = normalize(reference)
    return max(
        SequenceMatcher(None, reference, normalize(candidate)).ratio()
        for candidate in candidates
        if normalize(candidate)
    )


def clean_effect_text(text: str) -> str:
    text = re.sub(
        r"^NIGH[DT]?\s*\S+(?:\s*[|1]?\s*DAY\s*\S+)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", text).strip()


def join_effect(record: dict[str, Any]) -> str:
    return clean_effect_text(
        " ".join(
            line["text"].strip() for line in record.get("effectCandidates", [])
        )
    )


def usable_prior(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    return "" if value.lower() == "vision_unavailable" else value


def merge_field(
    prior: str, candidate: str, similarity: float, override: str
) -> tuple[str, str, str]:
    if override:
        return override, "verified", "manual-image-review"
    if prior and candidate and similarity >= 0.86:
        return prior, "verified", "prior-and-new-ocr-agree"
    if candidate:
        return candidate, "needs_review", "new-ocr-candidate"
    if prior:
        return prior, "needs_review", "prior-ocr-only"
    return "", "missing", "not-detected"


def second_pass_evidence(
    records: dict[str, dict[str, Any]], card_id: str, field: str
) -> dict[str, Any] | None:
    evidence = records.get(card_id, {}).get(field)
    if not evidence:
        return None
    return {
        variant: {
            "text": details["best"]["text"],
            "ratio": details["best"]["ratio"],
        }
        for variant, details in evidence.items()
    }


def second_pass_verified(evidence: dict[str, Any] | None) -> bool:
    return bool(
        evidence
        and evidence.get("color", {}).get("ratio", 0) >= 0.9
        and evidence.get("enhanced", {}).get("ratio", 0) >= 0.9
    )


def main() -> None:
    args = parse_args()
    raw = load_json(args.raw)
    prior_records = load_json(args.prior_json, args.prior_git_object)
    prior_by_id = {record["id"]: record for record in prior_records}
    overrides = load_json(args.overrides) if args.overrides else {}
    second_pass_records = (
        {
            record["id"]: record
            for record in load_json(args.second_pass).get("records", [])
        }
        if args.second_pass
        else {}
    )

    cards = []
    for record in raw["records"]:
        card_id = record["id"]
        prior = prior_by_id.get(card_id, {})
        override = overrides.get(card_id, {})
        lines = name_lines(record)
        name_candidate = reading_order_text(lines)
        prior_name = usable_prior(prior.get("en_name"))
        name, name_status, name_source = merge_field(
            prior_name,
            name_candidate,
            best_similarity(prior_name, lines),
            override.get("enNameOfficial", ""),
        )
        name_second_pass = second_pass_evidence(second_pass_records, card_id, "name")
        if name_status != "verified" and second_pass_verified(name_second_pass):
            name_status = "verified"
            name_source = "targeted-color-and-enhanced-ocr-agree"

        has_effect = bool(str(record.get("japaneseEffect", "")).strip())
        effect_candidate = join_effect(record)
        prior_effect = clean_effect_text(usable_prior(prior.get("en_effect")))
        if has_effect:
            effect_similarity = (
                SequenceMatcher(
                    None, normalize(prior_effect), normalize(effect_candidate)
                ).ratio()
                if prior_effect and effect_candidate
                else 0.0
            )
            effect, effect_status, effect_source = merge_field(
                prior_effect,
                effect_candidate,
                effect_similarity,
                override.get("enEffectOfficial", ""),
            )
        else:
            effect, effect_status, effect_source = "", "verified", "card-has-no-effect"
        effect_second_pass = second_pass_evidence(
            second_pass_records, card_id, "effect"
        )
        if effect_status != "verified" and second_pass_verified(effect_second_pass):
            effect_status = "verified"
            effect_source = "targeted-color-and-enhanced-ocr-agree"

        review_reasons = []
        if name_status != "verified":
            review_reasons.append(f"name: {name_source}")
        if effect_status != "verified":
            review_reasons.append(f"effect: {effect_source}")
        if override.get("note"):
            review_reasons.append(override["note"])
        cards.append(
            {
                "id": card_id,
                "japaneseName": record.get("japaneseName", ""),
                "enNameOfficial": name,
                "nameStatus": name_status,
                "nameVerificationSource": name_source,
                "japaneseEffect": record.get("japaneseEffect", ""),
                "enEffectOfficial": effect,
                "effectStatus": effect_status,
                "effectVerificationSource": effect_source,
                "reviewReasons": review_reasons,
                "evidence": {
                    "nameCandidate": name_candidate,
                    "effectCandidate": effect_candidate,
                    "priorName": prior_name,
                    "priorEffect": prior_effect,
                    "secondPassName": name_second_pass,
                    "secondPassEffect": effect_second_pass,
                },
            }
        )

    effect_cards = [card for card in cards if card["japaneseEffect"].strip()]
    summary = {
        "cardCount": len(cards),
        "verifiedNames": sum(card["nameStatus"] == "verified" for card in cards),
        "reviewNames": sum(card["nameStatus"] == "needs_review" for card in cards),
        "missingNames": sum(card["nameStatus"] == "missing" for card in cards),
        "effectCardCount": len(effect_cards),
        "noEffectCardCount": len(cards) - len(effect_cards),
        "verifiedEffectCards": sum(
            card["effectStatus"] == "verified" for card in effect_cards
        ),
        "reviewEffectCards": sum(
            card["effectStatus"] == "needs_review" for card in effect_cards
        ),
        "missingEffectCards": sum(
            card["effectStatus"] == "missing" for card in effect_cards
        ),
    }
    payload = {"schemaVersion": 1, "summary": summary, "cards": cards}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
