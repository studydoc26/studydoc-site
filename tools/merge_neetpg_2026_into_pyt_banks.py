#!/usr/bin/env python3
"""Append the 2026 200-question sets to StudyDoc's five existing PYT banks.

The merge is intentionally idempotent: previously generated records are removed
using sourceQuestionId before the same 200 source questions are appended again.
Existing records keep their original order and question numbers so saved browser
progress and report lookups remain valid.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "neetpg_advanced_2026" / "data"


@dataclass(frozen=True)
class Bank:
    slug: str
    target: str
    original_count: int
    bank_name: str
    subject_name: str
    compact_schema: bool = False


BANKS = (
    Bank("medicine", "neet_pg_medicine_pyt_bank_data.json", 260, "Medicine PYT", "Medicine"),
    Bank("surgery", "neet_pg_surgery_pyt_bank_data.json", 263, "Surgery PYT", "Surgery"),
    Bank("obgyn", "neet_pg_obgyn_pyt_bank_data.json", 237, "ObGyn PYT", "ObGyn"),
    Bank("pediatrics", "neet_pg_pediatrics_practice_bank_data.json", 142, "Pediatrics PYT", "Pediatrics", True),
    Bank("physiology", "neet_pg_physiology_practice_bank_data.json", 133, "Physiology PYT", "Physiology", True),
)


def read_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def image_record(question: dict) -> list[dict]:
    image = question.get("image")
    if not image:
        return []
    caption = (image.get("sourceTitle") or "Question image").strip()[:1000]
    # neutralCredit already includes the license label when one is available.
    credit = image.get("neutralCredit", "").strip()[:1000]
    return [{
        "src": image["src"],
        "caption": caption,
        "credit": credit,
        "source": image.get("sourcePage", "")[:1000],
        "width": image["width"],
        "height": image["height"],
    }]


def compact_record(question: dict, number: int) -> dict:
    return {
        "number": number,
        "subtopic": question["topic"],
        "topic": question["topic"],
        "question": question["question"],
        "options": question["options"],
        "answerIndex": question["answerIndex"],
        "correctAnswer": question["options"][question["answerIndex"]],
        "explanation": question["explanation"],
        "images": image_record(question),
        "references": question.get("references", []),
        "year": "2026",
        "difficulty": question["difficulty"],
        "integratedSubjects": question["integratedSubjects"],
        "sourceQuestionId": question["id"],
    }


def full_record(question: dict, number: int, visible: int, bank: Bank) -> dict:
    return {
        "number": number,
        "year": "2026",
        "bank": bank.bank_name,
        "topic": question["topic"],
        "subject": bank.subject_name,
        "subjectTags": question["integratedSubjects"],
        "question": question["question"],
        "options": question["options"],
        "answerIndex": question["answerIndex"],
        "correctAnswer": question["options"][question["answerIndex"]],
        "explanation": question["explanation"],
        "imageRecall": "",
        "images": image_record(question),
        "source": "StudyDoc 2026 PYT-theme question bank; references and image provenance are included with this item.",
        "page": None,
        "subtopic": question["topic"],
        "difficulty": question["difficulty"],
        "visible": visible,
        "references": question.get("references", []),
        "integratedSubjects": question["integratedSubjects"],
        "sourceQuestionId": question["id"],
        "originBank": "neetpg-2026-200",
    }


def merge_bank(bank: Bank) -> tuple[int, int]:
    target_path = ROOT / bank.target
    target = read_json(target_path)
    if not isinstance(target, list):
        raise SystemExit(f"{bank.target}: root must be an array")

    original = [item for item in target if not item.get("sourceQuestionId")]
    if len(original) != bank.original_count:
        raise SystemExit(
            f"{bank.target}: expected {bank.original_count} original records, found {len(original)}"
        )
    original_numbers = [item.get("number") for item in original]
    if any(not isinstance(number, int) or number < 1 for number in original_numbers):
        raise SystemExit(f"{bank.target}: invalid original question number")
    if len(set(original_numbers)) != len(original_numbers):
        raise SystemExit(f"{bank.target}: duplicate original question number")

    source = read_json(SOURCE_DIR / f"{bank.slug}.json")
    if not isinstance(source, list) or len(source) != 200:
        raise SystemExit(f"{bank.slug}: expected exactly 200 source questions")
    source_ids = [item.get("id") for item in source]
    if len(set(source_ids)) != 200:
        raise SystemExit(f"{bank.slug}: source question IDs are not unique")
    if sum(bool(item.get("imageBased")) for item in source) != 80:
        raise SystemExit(f"{bank.slug}: expected exactly 80 image-based source questions")

    start_number = max(original_numbers) + 1
    generated = []
    for offset, question in enumerate(source):
        number = start_number + offset
        visible = len(original) + offset + 1
        record = compact_record(question, number) if bank.compact_schema else full_record(question, number, visible, bank)
        generated.append(record)

    merged = original + generated
    expected_total = bank.original_count + 200
    if len(merged) != expected_total:
        raise SystemExit(f"{bank.target}: merged total mismatch")
    numbers = [item["number"] for item in merged]
    if len(set(numbers)) != len(numbers):
        raise SystemExit(f"{bank.target}: merged question numbers are not unique")
    image_total = sum(bool(item.get("images")) for item in merged)
    original_image_total = sum(bool(item.get("images")) for item in original)
    if image_total != original_image_total + 80:
        raise SystemExit(f"{bank.target}: merged image total mismatch")

    with target_path.open("w", encoding="utf-8") as handle:
        json.dump(merged, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return len(merged), image_total


def main() -> None:
    grand_total = 0
    grand_images = 0
    for bank in BANKS:
        total, images = merge_bank(bank)
        grand_total += total
        grand_images += images
        print(f"{bank.subject_name}: {total} questions, {images} image/data")
    if (grand_total, grand_images) != (2035, 875):
        raise SystemExit(f"five-bank total mismatch: {grand_total} / {grand_images}")
    print(f"Existing five PYT banks: {grand_total} questions, {grand_images} image/data")


if __name__ == "__main__":
    main()
