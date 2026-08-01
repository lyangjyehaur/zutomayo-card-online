#!/usr/bin/env python3
"""Build the reviewed-card intake manifest from the two public discovery pages.

The generated manifest and downloaded images are maintenance inputs only. They
stay under ignored data paths and are never a browser or game-server fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


LIMITED_CARDS_URL = "https://uribimog.com/zutomayo-limited-cards/"
FOURTH_SET_URL = "https://uribimog.com/zutomayo-card4-fantasy-is-reality/"

LIMITED_SECTIONS = {
    "特典カード": "bonus",
    "コラボカード/非売品": "collaboration",
    "来場者カード": "live",
    "ご当地カード": "regional",
}

FOURTH_SET_IDS = {
    "ちりとり男だ": "4th_105",
    "大丈夫君と私だけ（無罪）": "4th_106",
    "海馬まで灰だらけ": "4th_107",
}


def normalized_text(parts: Iterable[str]) -> str:
    return re.sub(r"\s+", " ", html.unescape("".join(parts))).strip()


@dataclass(frozen=True)
class TableRecord:
    section: str
    subsection: str
    names: tuple[str, ...]
    images: tuple[str, ...]


class CardTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_h3 = ""
        self.current_h4 = ""
        self.heading_tag = ""
        self.heading_parts: list[str] = []
        self.in_table = False
        self.in_th = False
        self.th_parts: list[str] = []
        self.table_names: list[str] = []
        self.table_images: list[str] = []
        self.tables: list[TableRecord] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag in {"h3", "h4"}:
            self.heading_tag = tag
            self.heading_parts = []
        elif tag == "table":
            self.in_table = True
            self.table_names = []
            self.table_images = []
        elif tag == "th" and self.in_table:
            self.in_th = True
            self.th_parts = []
        elif tag == "img" and self.in_table:
            source = attributes.get("data-src") or attributes.get("src") or ""
            if source.startswith("http") and source not in self.table_images:
                self.table_images.append(source)

    def handle_endtag(self, tag: str) -> None:
        if tag == self.heading_tag:
            heading = normalized_text(self.heading_parts)
            if tag == "h3":
                self.current_h3 = heading
                self.current_h4 = ""
            elif tag == "h4":
                self.current_h4 = heading
            self.heading_tag = ""
            self.heading_parts = []
        elif tag == "th" and self.in_th:
            name = normalized_text(self.th_parts)
            if name:
                self.table_names.append(name)
            self.in_th = False
            self.th_parts = []
        elif tag == "table" and self.in_table:
            if self.table_names and self.table_images:
                self.tables.append(
                    TableRecord(
                        section=self.current_h3,
                        subsection=self.current_h4,
                        names=tuple(self.table_names),
                        images=tuple(self.table_images),
                    )
                )
            self.in_table = False

    def handle_data(self, data: str) -> None:
        if self.heading_tag:
            self.heading_parts.append(data)
        if self.in_th:
            self.th_parts.append(data)


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "zutomayo-card-online-maintainer/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def parse_tables(source: bytes) -> list[TableRecord]:
    parser = CardTableParser()
    parser.feed(source.decode("utf-8"))
    return parser.tables


def pair_table(table: TableRecord) -> list[tuple[str, str]]:
    if len(table.names) != len(table.images):
        raise ValueError(
            f"{table.section}/{table.subsection}: {len(table.names)} names but {len(table.images)} images"
        )
    return list(zip(table.names, table.images))


def build_limited_candidates(tables: list[TableRecord]) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for table in tables:
        distribution = LIMITED_SECTIONS.get(table.section)
        if not distribution:
            continue
        for name, image_url in pair_table(table):
            candidates.append(
                {
                    "candidateId": f"limited_{len(candidates) + 1:03d}",
                    "expectedCardId": "",
                    "name": name,
                    "pack": table.subsection or table.section,
                    "catalogStatus": "unlisted",
                    "distributionType": distribution,
                    "sourcePageUrl": LIMITED_CARDS_URL,
                    "sourceImageUrl": image_url,
                }
            )
    if len(candidates) != 61:
        raise ValueError(f"limited-card discovery page must contain 61 cards, found {len(candidates)}")
    duplicate_names = sorted(
        name for name in {candidate["name"] for candidate in candidates}
        if sum(candidate["name"] == name for candidate in candidates) > 1
    )
    if duplicate_names != ["叢雲の剣うにぐり"]:
        raise ValueError(f"unexpected duplicate limited-card names: {duplicate_names}")
    return candidates


def build_fourth_set_candidates(tables: list[TableRecord]) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for table in tables:
        if table.section != "SE（全3種）":
            continue
        for name, image_url in pair_table(table):
            card_id = FOURTH_SET_IDS.get(name)
            if not card_id:
                raise ValueError(f"unexpected fourth-set SE card: {name}")
            candidates.append(
                {
                    "candidateId": card_id,
                    "expectedCardId": card_id,
                    "name": name,
                    "pack": "Fantasy Is Reality",
                    "catalogStatus": "pending_listing",
                    "distributionType": "standard",
                    "sourcePageUrl": FOURTH_SET_URL,
                    "sourceImageUrl": image_url,
                }
            )
    candidates.sort(key=lambda candidate: candidate["expectedCardId"])
    if {candidate["expectedCardId"] for candidate in candidates} != set(FOURTH_SET_IDS.values()):
        raise ValueError(f"fourth-set discovery page must contain {sorted(FOURTH_SET_IDS.values())}")
    return candidates


def download_candidate_image(candidate: dict[str, str], output_dir: Path) -> dict[str, str]:
    suffix = Path(urllib.parse.urlparse(candidate["sourceImageUrl"]).path).suffix.lower() or ".jpg"
    destination = output_dir / f"{candidate['candidateId']}{suffix}"
    if destination.exists() and destination.stat().st_size >= 10_000:
        content = destination.read_bytes()
    else:
        content = fetch_bytes(candidate["sourceImageUrl"])
        if len(content) < 10_000:
            raise ValueError(f"{candidate['candidateId']}: downloaded image is unexpectedly small")
        suffix = Path(urllib.parse.urlparse(candidate["sourceImageUrl"]).path).suffix.lower() or ".jpg"
        destination = output_dir / f"{candidate['candidateId']}{suffix}"
        destination.write_bytes(content)
    return {
        "localImagePath": destination.as_posix(),
        "sourceSha256": hashlib.sha256(content).hexdigest(),
    }


def download_candidate_images(candidates: list[dict[str, str]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            pool.submit(download_candidate_image, candidate, output_dir): candidate
            for candidate in candidates
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            candidate = futures[future]
            try:
                candidate.update(future.result())
            except Exception as exc:
                failures.append(f"{candidate['candidateId']}: {exc}")
            if completed % 10 == 0 or completed == len(candidates):
                print(f"Downloaded {completed}/{len(candidates)} card sources", flush=True)
    if failures:
        raise RuntimeError("card source downloads failed:\n" + "\n".join(sorted(failures)))


def run_self_test() -> None:
    fixture = """
      <h3>特典カード</h3><table><th>A</th><th>B</th><td><img data-src="https://x/a.jpg"></td><td><img src="https://x/b.jpg"></td></table>
      <h3>SE（全3種）</h3><table><th>ちりとり男だ</th><td><img src="https://x/c.jpg"></td></table>
    """
    tables = parse_tables(fixture.encode())
    assert tables[0].section == "特典カード"
    assert pair_table(tables[0]) == [("A", "https://x/a.jpg"), ("B", "https://x/b.jpg")]
    assert tables[1].names == ("ちりとり男だ",)
    print("unlisted card source parser self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/card-unlisted-sources.json"))
    parser.add_argument("--images-dir", type=Path, default=Path("data/vision-ocr/unlisted-cards"))
    parser.add_argument("--skip-images", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return

    limited_source = fetch_bytes(LIMITED_CARDS_URL)
    fourth_source = fetch_bytes(FOURTH_SET_URL)
    candidates = build_fourth_set_candidates(parse_tables(fourth_source)) + build_limited_candidates(
        parse_tables(limited_source)
    )
    if len(candidates) != 64:
        raise ValueError(f"expected 64 new card candidates, found {len(candidates)}")
    if not args.skip_images:
        download_candidate_images(candidates, args.images_dir)
    payload = {
        "schemaVersion": 1,
        "sources": [
            {"url": FOURTH_SET_URL, "sha256": hashlib.sha256(fourth_source).hexdigest()},
            {"url": LIMITED_CARDS_URL, "sha256": hashlib.sha256(limited_source).hexdigest()},
        ],
        "cardCount": len(candidates),
        "cards": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(candidates)} card candidates to {args.output}")


if __name__ == "__main__":
    main()
