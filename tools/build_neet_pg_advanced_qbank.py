#!/usr/bin/env python3
"""Build the browser-ready StudyDoc NEET-PG Advanced 2026 question bank.

The source banks and image manifest remain untouched. The generated web bundle
contains compact subject JSON, public-safe image provenance, and one immutable
JPEG display asset per approved source-image hash.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - local build dependency guard
    raise SystemExit("Pillow is required to validate the rendered JPEG assets.") from exc


SCHEMA_VERSION = "1.0"
RELEASE_YEAR = "2026"
REPO_ROOT = Path(__file__).resolve().parents[1]
RENDERING_NOTE = (
    "Web display JPEG made from the approved white-background render used in "
    "the final StudyDoc PDF; diagnostic annotations were not added."
)


@dataclass(frozen=True)
class SubjectSpec:
    name: str
    slug: str
    code: str
    bank_path: str
    source_key: str


SUBJECTS = (
    SubjectSpec("Anatomy", "anatomy", "ANAT", "preclinical/anatomy.json", "ANATOMY"),
    SubjectSpec("Physiology", "physiology", "PHYS", "preclinical/physiology.json", "PHYSIOLOGY"),
    SubjectSpec("Biochemistry", "biochemistry", "BIOC", "preclinical/biochemistry.json", "BIOCHEMISTRY"),
    SubjectSpec("Pathology", "pathology", "PATH", "paraclinical/pathology.json", "PATHOLOGY"),
    SubjectSpec("Pharmacology", "pharmacology", "PHARM", "preclinical/pharmacology.json", "PHARMACOLOGY"),
    SubjectSpec("Microbiology", "microbiology", "MICR", "preclinical/microbiology.json", "MICROBIOLOGY"),
    SubjectSpec(
        "Forensic Medicine",
        "forensic-medicine",
        "FMT",
        "paraclinical/forensic_medicine.json",
        "FORENSIC MEDICINE",
    ),
    SubjectSpec(
        "Community Medicine (PSM)",
        "community-medicine-psm",
        "PSM",
        "paraclinical/community_medicine_psm.json",
        "COMMUNITY MEDICINE (PSM)",
    ),
    SubjectSpec("Medicine", "medicine", "MED", "medicine_para/medicine.json", "MEDICINE"),
    SubjectSpec("Pediatrics", "pediatrics", "PED", "medicine_para/pediatrics.json", "PEDIATRICS"),
    SubjectSpec("Dermatology", "dermatology", "DERM", "medicine_para/dermatology.json", "DERMATOLOGY"),
    SubjectSpec("Psychiatry", "psychiatry", "PSY", "medicine_para/psychiatry.json", "PSYCHIATRY"),
    SubjectSpec("Surgery", "surgery", "SUR", "surgical_allied/surgery.json", "SURGERY"),
    SubjectSpec("Orthopedics", "orthopedics", "ORTHO", "surgical_allied/orthopedics.json", "ORTHOPEDICS"),
    SubjectSpec(
        "Radiodiagnosis",
        "radiodiagnosis",
        "RAD",
        "surgical_allied/radiodiagnosis.json",
        "RADIODIAGNOSIS",
    ),
    SubjectSpec(
        "Anaesthesiology",
        "anaesthesiology",
        "ANES",
        "surgical_allied/anaesthesiology.json",
        "ANAESTHESIOLOGY",
    ),
    SubjectSpec(
        "Ophthalmology",
        "ophthalmology",
        "OPH",
        "surgical_allied/ophthalmology.json",
        "OPHTHALMOLOGY",
    ),
    SubjectSpec("ENT", "ent", "ENT", "surgical_allied/ent.json", "OTORHINOLARYNGOLOGY (ENT)"),
    SubjectSpec(
        "Obstetrics and Gynaecology",
        "obgyn",
        "OBG",
        "medicine_para/obgyn.json",
        "OBSTETRICS AND GYNAECOLOGY",
    ),
)


INTEGRATED_ALIASES = {
    "anesthesiology": "Anaesthesiology",
    "anaesthesiology": "Anaesthesiology",
    "community medicine": "Community Medicine (PSM)",
    "community medicine (psm)": "Community Medicine (PSM)",
    "genetic and molecular medicine": "Genetics",
    "geriatric medicine": "Geriatrics",
    "infectious disease": "Infectious Diseases",
    "infectious diseases": "Infectious Diseases",
    "obstetrics": "Obstetrics and Gynaecology",
    "obstetrics and gynaecology": "Obstetrics and Gynaecology",
    "orthopaedics": "Orthopedics",
    "orthopedics": "Orthopedics",
    "otolaryngology": "ENT",
    "otorhinolaryngology (ent)": "ENT",
    "physical medicine and rehabilitation": "Rehabilitation Medicine",
    "rehabilitation": "Rehabilitation Medicine",
    "rehabilitation medicine": "Rehabilitation Medicine",
    "radiotherapy": "Radiation Oncology",
    "radiation oncology": "Radiation Oncology",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--banks",
        type=Path,
        default=REPO_ROOT / "work/neetpg_3800/banks",
        help="Directory containing the final 19 subject bank JSON files.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=REPO_ROOT / "work/neetpg_3800/final_image_manifest.json",
        help="Final 1,520-row approved image manifest.",
    )
    parser.add_argument(
        "--topic-map",
        type=Path,
        default=REPO_ROOT / "work/neetpg_3800/source_topic_map.json",
        help="Ranked subject/topic source map.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "assets/neetpg_advanced_2026",
        help="Generated browser bundle directory.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_compact_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(encoded, encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00a0", " ").split())


def normalize_license(value: Any) -> str:
    text = clean_text(value)
    lowered = text.casefold()
    if lowered == "public domain":
        return "Public domain"
    if lowered == "cc0":
        return "CC0"
    if lowered in {"by-sa", "by-sa 2.0"}:
        return "CC BY-SA" if lowered == "by-sa" else "CC BY-SA 2.0"
    return text


def normalize_difficulty(value: Any) -> str:
    difficulty = clean_text(value).casefold()
    if difficulty == "medium":
        difficulty = "moderate"
    if difficulty not in {"easy", "moderate", "hard"}:
        fail(f"Unsupported question difficulty: {value!r}")
    return difficulty


def is_https_url(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def normalize_integrated_subjects(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        text = unicodedata.normalize("NFKC", clean_text(raw))
        if not text:
            continue
        text = INTEGRATED_ALIASES.get(text.casefold(), text)
        key = text.casefold()
        if key not in seen:
            seen.add(key)
            result.append(text)
    return result


def reference_title(url: str) -> str:
    hostname = (urlparse(url).hostname or "Source").casefold()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    return hostname


def extract_references(question: dict[str, Any]) -> list[dict[str, str]]:
    """Return sourceGuideline first, followed by sourceHints, without duplicates."""
    candidates: list[str] = []
    guideline = question.get("sourceGuideline")
    if isinstance(guideline, str) and clean_text(guideline):
        candidates.append(guideline)

    hints = question.get("sourceHints", [])
    if isinstance(hints, list):
        candidates.extend(item for item in hints if isinstance(item, str) and clean_text(item))

    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for candidate in candidates:
        url = clean_text(candidate)
        if is_https_url(url) and url not in seen:
            seen.add(url)
            result.append({"title": reference_title(url), "url": url})
        if len(result) == 3:
            break
    return result


def markdown_escape(value: Any) -> str:
    return clean_text(value).replace("\\", "\\\\").replace("|", "\\|").replace("[", "\\[").replace("]", "\\]")


def make_image_public_metadata(entry: dict[str, Any], web_sha: str, width: int, height: int) -> dict[str, Any]:
    original_sha = entry["sha256"]
    license_name = normalize_license(entry.get("license_short") or entry.get("usage_terms"))
    license_url = clean_text(entry.get("license_url"))
    if license_url and not is_https_url(license_url):
        license_url = ""

    source_page = clean_text(entry.get("commons_page_url") or entry.get("original_url"))
    if not is_https_url(source_page):
        fail(f"Image {original_sha} has no valid HTTPS source page")

    source_title = clean_text(entry.get("commons_title") or entry.get("description") or "Source image")
    artist = clean_text(entry.get("artist"))
    provider = clean_text(entry.get("provider") or entry.get("source_repository") or "Source provider")
    attribution_party = artist or provider
    neutral_credit = f"Image credit: {attribution_party} · {license_name}"

    return {
        "src": f"assets/neetpg_advanced_2026/images/{original_sha}.jpg",
        "width": width,
        "height": height,
        "neutralCredit": neutral_credit,
        "license": license_name,
        "licenseUrl": license_url,
        "sourcePage": source_page,
        "sourceTitle": source_title,
        "originalSha256": original_sha,
        "webAssetSha256": web_sha,
        "renderingNote": RENDERING_NOTE,
    }


def validate_source_inputs(
    banks_dir: Path,
    manifest_rows: list[dict[str, Any]],
    topic_source: dict[str, list[dict[str, Any]]],
) -> tuple[
    dict[str, list[dict[str, Any]]],
    dict[str, dict[str, Any]],
    dict[str, list[dict[str, Any]]],
]:
    if len(SUBJECTS) != 19:
        fail(f"Expected 19 subject specifications, found {len(SUBJECTS)}")
    if len(manifest_rows) != 1520:
        fail(f"Expected 1,520 manifest rows, found {len(manifest_rows)}")

    banks: dict[str, list[dict[str, Any]]] = {}
    questions_by_id: dict[str, dict[str, Any]] = {}
    for spec in SUBJECTS:
        path = banks_dir / spec.bank_path
        questions = load_json(path)
        if not isinstance(questions, list) or len(questions) != 200:
            fail(f"{spec.name}: expected 200 questions in {path}")

        image_count = 0
        answer_positions: Counter[int] = Counter()
        numbers: set[int] = set()
        topic_names: set[str] = set()
        for question in questions:
            question_id = question.get("id")
            match = re.fullmatch(rf"{re.escape(spec.code)}-(\d{{3}})", str(question_id))
            if not match:
                fail(f"{spec.name}: malformed question ID {question_id!r}")
            number = int(match.group(1))
            numbers.add(number)
            if question_id in questions_by_id:
                fail(f"Duplicate question ID: {question_id}")
            if question.get("subject") != spec.name:
                fail(f"{question_id}: subject mismatch")
            options = question.get("options")
            if not isinstance(options, list) or len(options) != 4 or not all(isinstance(item, str) for item in options):
                fail(f"{question_id}: expected exactly four text options")
            answer_index = question.get("answerIndex")
            if answer_index not in (0, 1, 2, 3):
                fail(f"{question_id}: invalid answerIndex {answer_index!r}")
            if question.get("correctAnswer") != options[answer_index]:
                fail(f"{question_id}: correctAnswer does not match indexed option")
            normalize_difficulty(question.get("difficulty"))
            if not clean_text(question.get("question")) or not clean_text(question.get("explanation")):
                fail(f"{question_id}: missing question text or explanation")
            image_count += bool(question.get("imageBased"))
            answer_positions[answer_index] += 1
            topic_names.add(question.get("topic"))
            questions_by_id[question_id] = question

        if numbers != set(range(1, 201)):
            fail(f"{spec.name}: question numbers are not exactly 1-200")
        if image_count != 80:
            fail(f"{spec.name}: expected 80 image questions, found {image_count}")
        if answer_positions != Counter({0: 50, 1: 50, 2: 50, 3: 50}):
            fail(f"{spec.name}: answer-position balance is {dict(answer_positions)}")

        source_topics = topic_source.get(spec.source_key)
        if not isinstance(source_topics, list) or not source_topics:
            fail(f"{spec.name}: topic source key {spec.source_key!r} is missing")
        source_topic_names = {item.get("topic") for item in source_topics}
        if topic_names != source_topic_names:
            missing = sorted(source_topic_names - topic_names)
            extra = sorted(topic_names - source_topic_names)
            fail(f"{spec.name}: topic mismatch; missing={missing}, extra={extra}")
        ranks = [item.get("rank") for item in source_topics]
        if ranks != list(range(1, len(source_topics) + 1)):
            fail(f"{spec.name}: topic ranks are not contiguous from 1")

        banks[spec.slug] = sorted(questions, key=lambda item: int(item["id"].rsplit("-", 1)[1]))

    if len(questions_by_id) != 3800:
        fail(f"Expected 3,800 unique questions, found {len(questions_by_id)}")

    manifest_by_question: dict[str, dict[str, Any]] = {}
    manifest_by_sha: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in manifest_rows:
        question_id = row.get("question_id")
        sha = row.get("sha256")
        if question_id in manifest_by_question:
            fail(f"Manifest has duplicate row for {question_id}")
        if question_id not in questions_by_id:
            fail(f"Manifest references unknown question {question_id}")
        if not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
            fail(f"{question_id}: malformed original SHA-256")
        question = questions_by_id[question_id]
        if not question.get("imageBased"):
            fail(f"Manifest references non-image question {question_id}")
        if row.get("subject") != question.get("subject") or row.get("topic") != question.get("topic"):
            fail(f"{question_id}: manifest subject/topic mismatch")
        manifest_by_question[question_id] = row
        manifest_by_sha[sha].append(row)

    expected_image_ids = {qid for qid, question in questions_by_id.items() if question.get("imageBased")}
    if set(manifest_by_question) != expected_image_ids:
        fail("Manifest question IDs do not exactly match the 1,520 image questions")
    if len(manifest_by_sha) != 760:
        fail(f"Expected 760 unique image hashes, found {len(manifest_by_sha)}")
    if any(len(rows) != 2 for rows in manifest_by_sha.values()):
        fail("Every unique image must be used by exactly two questions")

    unique_images_per_subject: Counter[str] = Counter()
    for sha, rows in manifest_by_sha.items():
        subjects = {row["subject"] for row in rows}
        local_paths = {row["local_path"] for row in rows}
        if len(subjects) != 1 or len(local_paths) != 1:
            fail(f"Image {sha} crosses subjects or points to multiple local files")
        unique_images_per_subject[next(iter(subjects))] += 1
    for spec in SUBJECTS:
        if unique_images_per_subject[spec.name] != 40:
            fail(f"{spec.name}: expected 40 unique images")

    return banks, manifest_by_question, dict(manifest_by_sha)


def build(args: argparse.Namespace) -> dict[str, Any]:
    manifest_rows = load_json(args.manifest)
    topic_source = load_json(args.topic_map)
    if not isinstance(manifest_rows, list) or not isinstance(topic_source, dict):
        fail("Manifest must be an array and topic map must be an object")

    banks, manifest_by_question, manifest_by_sha = validate_source_inputs(
        args.banks, manifest_rows, topic_source
    )

    output_dir = args.output.resolve()
    data_dir = output_dir / "data"
    images_dir = output_dir / "images"
    data_dir.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    # Generate only the files owned by this build. Unknown neighboring files
    # are intentionally left untouched so a rebuild cannot remove user data.
    expected_data_names = {f"{spec.slug}.json" for spec in SUBJECTS}
    expected_image_names = {f"{sha}.jpg" for sha in manifest_by_sha}

    image_metadata_by_sha: dict[str, dict[str, Any]] = {}
    original_bytes = 0
    web_bytes = 0
    web_hashes: set[str] = set()
    for original_sha, rows in sorted(manifest_by_sha.items()):
        entry = rows[0]
        original_path = Path(entry["local_path"])
        if not original_path.is_absolute():
            original_path = (REPO_ROOT / original_path).resolve()
        if not original_path.is_file():
            fail(f"Missing approved source image: {original_path}")
        if sha256_file(original_path) != original_sha:
            fail(f"Original image hash mismatch: {original_path}")
        if original_path.stat().st_size != entry.get("bytes"):
            fail(f"Original image byte-count mismatch: {original_path}")

        render_path = original_path.with_name(f"{original_path.stem}_render_v2.jpg")
        if not render_path.is_file():
            fail(f"Missing approved display JPEG sibling: {render_path}")
        with Image.open(render_path) as image:
            image.load()
            if image.format != "JPEG":
                fail(f"Display asset is not a JPEG: {render_path}")
            width, height = image.size
        if width <= 0 or height <= 0:
            fail(f"Display asset has invalid dimensions: {render_path}")

        web_sha = sha256_file(render_path)
        if web_sha in web_hashes:
            fail(f"Duplicate rendered web asset detected: {render_path}")
        web_hashes.add(web_sha)
        destination = images_dir / f"{original_sha}.jpg"
        shutil.copyfile(render_path, destination)
        if sha256_file(destination) != web_sha:
            fail(f"Copied web asset hash mismatch: {destination}")

        original_bytes += original_path.stat().st_size
        web_bytes += destination.stat().st_size
        image_metadata_by_sha[original_sha] = make_image_public_metadata(
            entry, web_sha, width, height
        )

    catalog_subjects: list[dict[str, Any]] = []
    public_questions_by_slug: dict[str, list[dict[str, Any]]] = {}
    subject_reports: list[dict[str, Any]] = []
    total_topics = 0
    for spec in SUBJECTS:
        source_topics = topic_source[spec.source_key]
        topic_ids = {
            item["topic"]: f"{spec.slug}-t{int(item['rank']):02d}" for item in source_topics
        }
        catalog_topics = [
            {
                "id": topic_ids[item["topic"]],
                "name": item["topic"],
                "rank": int(item["rank"]),
                "frequency": item["frequency"],
                "sourceQuestionCount": int(item["question_count_in_source_corpus"]),
            }
            for item in source_topics
        ]
        total_topics += len(catalog_topics)

        public_questions: list[dict[str, Any]] = []
        for source_question in banks[spec.slug]:
            question_id = source_question["id"]
            number = int(question_id.rsplit("-", 1)[1])
            image_based = bool(source_question["imageBased"])
            image_payload: dict[str, Any] | None = None
            if image_based:
                original_sha = manifest_by_question[question_id]["sha256"]
                image_payload = dict(image_metadata_by_sha[original_sha])

            references = extract_references(source_question)
            if len(references) > 3 or any(
                set(reference) != {"title", "url"}
                or not clean_text(reference["title"])
                or not is_https_url(reference["url"])
                for reference in references
            ):
                fail(f"{question_id}: invalid public references")

            public_questions.append(
                {
                    "id": question_id,
                    "number": number,
                    "year": RELEASE_YEAR,
                    "subject": spec.name,
                    "subjectSlug": spec.slug,
                    "topic": source_question["topic"],
                    "topicId": topic_ids[source_question["topic"]],
                    "difficulty": normalize_difficulty(source_question["difficulty"]),
                    "question": source_question["question"],
                    "options": source_question["options"],
                    "answerIndex": source_question["answerIndex"],
                    "explanation": source_question["explanation"],
                    "integratedSubjects": normalize_integrated_subjects(
                        source_question.get("integratedSubjects", [])
                    ),
                    "imageBased": image_based,
                    "image": image_payload,
                    "references": references,
                }
            )

        public_questions_by_slug[spec.slug] = public_questions
        write_compact_json(data_dir / f"{spec.slug}.json", public_questions)
        catalog_subjects.append(
            {
                "id": spec.slug,
                "slug": spec.slug,
                "name": spec.name,
                "code": spec.code,
                "questionCount": len(public_questions),
                "imageQuestionCount": sum(item["imageBased"] for item in public_questions),
                "topicCount": len(catalog_topics),
                "dataPath": f"assets/neetpg_advanced_2026/data/{spec.slug}.json",
                "topics": catalog_topics,
            }
        )
        subject_reports.append(
            {
                "subject": spec.name,
                "slug": spec.slug,
                "questions": len(public_questions),
                "imageQuestions": sum(item["imageBased"] for item in public_questions),
                "uniqueImages": len(
                    {
                        item["image"]["originalSha256"]
                        for item in public_questions
                        if item["imageBased"]
                    }
                ),
                "topics": len(catalog_topics),
                "answerPositions": dict(
                    sorted(Counter(item["answerIndex"] for item in public_questions).items())
                ),
            }
        )

    if total_topics != 381:
        fail(f"Expected 381 catalog topics, found {total_topics}")

    catalog = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseYear": RELEASE_YEAR,
        "title": "StudyDoc NEET-PG Advanced Question Bank 2026",
        "subjectCount": len(SUBJECTS),
        "questionCount": sum(len(items) for items in public_questions_by_slug.values()),
        "imageQuestionCount": sum(
            item["imageBased"]
            for items in public_questions_by_slug.values()
            for item in items
        ),
        "uniqueImageCount": len(image_metadata_by_sha),
        "topicCount": total_topics,
        "subjects": catalog_subjects,
    }
    write_compact_json(output_dir / "catalog.json", catalog)

    image_source_records: list[dict[str, Any]] = []
    for original_sha, rows in sorted(manifest_by_sha.items()):
        source = rows[0]
        safe = image_metadata_by_sha[original_sha]
        artist = clean_text(source.get("artist"))
        provider = clean_text(source.get("provider") or source.get("source_repository"))
        full_credit = clean_text(source.get("credit"))
        if not full_credit:
            full_credit = f"{safe['sourceTitle']} · {artist or provider} · {safe['license']}"
        image_source_records.append(
            {
                **safe,
                "questionIds": sorted(row["question_id"] for row in rows),
                "subjects": sorted({row["subject"] for row in rows}),
                "topics": sorted({row["topic"] for row in rows}),
                "artist": artist,
                "provider": provider,
                "fullCredit": full_credit,
            }
        )
    image_sources_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "imageCount": len(image_source_records),
        "renderingNote": RENDERING_NOTE,
        "images": image_source_records,
    }
    write_compact_json(output_dir / "image_sources.json", image_sources_payload)

    attribution_csv = output_dir / "image_attribution.csv"
    with attribution_csv.open("w", encoding="utf-8", newline="") as handle:
        fieldnames = [
            "original_sha256",
            "web_asset_sha256",
            "file",
            "width",
            "height",
            "question_ids",
            "subjects",
            "topics",
            "artist",
            "provider",
            "full_credit",
            "license",
            "license_url",
            "source_page",
            "source_title",
            "rendering_note",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in image_source_records:
            writer.writerow(
                {
                    "original_sha256": record["originalSha256"],
                    "web_asset_sha256": record["webAssetSha256"],
                    "file": record["src"],
                    "width": record["width"],
                    "height": record["height"],
                    "question_ids": " | ".join(record["questionIds"]),
                    "subjects": " | ".join(record["subjects"]),
                    "topics": " | ".join(record["topics"]),
                    "artist": record["artist"],
                    "provider": record["provider"],
                    "full_credit": record["fullCredit"],
                    "license": record["license"],
                    "license_url": record["licenseUrl"],
                    "source_page": record["sourcePage"],
                    "source_title": record["sourceTitle"],
                    "rendering_note": record["renderingNote"],
                }
            )

    attribution_md = output_dir / "image_attribution.md"
    markdown_lines = [
        "# StudyDoc NEET-PG Advanced 2026 image attribution",
        "",
        f"This ledger covers {len(image_source_records)} unique display images used by 1,520 image questions.",
        "",
        RENDERING_NOTE,
        "",
        "| # | Question IDs | Source | Creator/provider | License |",
        "|---:|---|---|---|---|",
    ]
    for index, record in enumerate(image_source_records, start=1):
        title = markdown_escape(record["sourceTitle"])
        source_link = f"[{title}](<{record['sourcePage']}>)"
        creator = markdown_escape(record["artist"] or record["provider"] or "Not stated")
        license_text = markdown_escape(record["license"])
        if record["licenseUrl"]:
            license_text = f"[{license_text}](<{record['licenseUrl']}>)"
        markdown_lines.append(
            f"| {index} | {markdown_escape(', '.join(record['questionIds']))} | "
            f"{source_link} | {creator} | {license_text} |"
        )
    attribution_md.write_text("\n".join(markdown_lines) + "\n", encoding="utf-8")

    data_files = sorted(data_dir / name for name in expected_data_names)
    image_files = sorted(images_dir / name for name in expected_image_names)
    if len(data_files) != 19:
        fail(f"Generated data file count is {len(data_files)}, expected 19")
    if len(image_files) != 760:
        fail(f"Generated image file count is {len(image_files)}, expected 760")
    if any(path.stem not in manifest_by_sha for path in image_files):
        fail("Generated images include an unexpected original SHA filename")

    copied_hashes_verified = 0
    for path in image_files:
        expected_web_sha = image_metadata_by_sha[path.stem]["webAssetSha256"]
        if sha256_file(path) != expected_web_sha:
            fail(f"Final web image hash mismatch: {path}")
        copied_hashes_verified += 1

    public_question_count = 0
    public_image_count = 0
    public_reference_question_count = 0
    public_reference_url_count = 0
    for spec in SUBJECTS:
        payload = load_json(data_dir / f"{spec.slug}.json")
        if not isinstance(payload, list) or len(payload) != 200:
            fail(f"Generated {spec.slug}.json failed the 200-question readback")
        if sum(bool(item.get("imageBased")) for item in payload) != 80:
            fail(f"Generated {spec.slug}.json failed the 80-image readback")
        if any(len(item.get("options", [])) != 4 for item in payload):
            fail(f"Generated {spec.slug}.json has a non-four-option item")
        for item in payload:
            references = item.get("references", [])
            if len(references) > 3 or any(
                not isinstance(reference, dict)
                or set(reference) != {"title", "url"}
                or not clean_text(reference["title"])
                or not is_https_url(reference["url"])
                for reference in references
            ):
                fail(f"Generated {item['id']} has invalid references")
            if len({reference["url"] for reference in references}) != len(references):
                fail(f"Generated {item['id']} has duplicate references")
        public_question_count += len(payload)
        public_image_count += sum(bool(item["imageBased"]) for item in payload)
        public_reference_question_count += sum(bool(item["references"]) for item in payload)
        public_reference_url_count += sum(len(item["references"]) for item in payload)

    core_output_paths = [
        output_dir / "catalog.json",
        output_dir / "image_sources.json",
        attribution_md,
        attribution_csv,
        *data_files,
    ]
    output_file_hashes = [
        {
            "path": path.relative_to(output_dir).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in core_output_paths
    ]

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseYear": RELEASE_YEAR,
        "generatedAtUtc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "status": "passed",
        "validation": {
            "subjectCount": len(SUBJECTS),
            "questionCount": public_question_count,
            "questionsPerSubject": 200,
            "imageQuestionCount": public_image_count,
            "imageQuestionsPerSubject": 80,
            "uniqueImageCount": len(image_files),
            "usesPerUniqueImage": 2,
            "topicCount": total_topics,
            "optionsPerQuestion": 4,
            "answerPositionsPerSubject": {"A": 50, "B": 50, "C": 50, "D": 50},
            "correctAnswerConsistency": "3800/3800",
            "originalHashesVerified": len(manifest_by_sha),
            "renderedJpegHashesUnique": len(web_hashes),
            "copiedWebAssetHashesVerified": copied_hashes_verified,
            "validHttpsReferencesOnly": True,
            "maxReferencesPerQuestion": 3,
            "questionsWithReferences": public_reference_question_count,
            "referenceUrlCount": public_reference_url_count,
        },
        "bytes": {
            "approvedOriginalImages": original_bytes,
            "webDisplayJpegs": web_bytes,
            "webDisplaySavings": original_bytes - web_bytes,
        },
        "subjects": subject_reports,
        "outputFiles": output_file_hashes,
        "notes": [
            "Question references are ordered from sourceGuideline then sourceHints, deduplicated, filtered to valid HTTPS URLs, and capped at three.",
            "Non-URL textbook source hints are intentionally excluded from the public link list.",
            "Image source and license links remain available separately in each image object and the attribution ledgers.",
            "build_report.json excludes its own checksum by design.",
        ],
    }
    write_compact_json(output_dir / "build_report.json", report)
    return report


def main() -> int:
    args = parse_args()
    try:
        report = build(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        return 1
    validation = report["validation"]
    print(
        "BUILD PASSED: "
        f"{validation['subjectCount']} subjects, "
        f"{validation['questionCount']} questions, "
        f"{validation['imageQuestionCount']} image questions, "
        f"{validation['uniqueImageCount']} unique web JPEGs, "
        f"{validation['topicCount']} topics"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
