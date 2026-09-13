#!/usr/bin/env python3
"""Deterministic, standard-library editorial pipeline for IA Aprova."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable, Sequence


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = REPO_ROOT.parent
DEFAULT_SOURCE_ROOT = WORKSPACE_ROOT / "Provas Anteriores"
DEFAULT_INVENTORY = REPO_ROOT / "content" / "reports" / "source-inventory.json"
DEFAULT_CATALOG = REPO_ROOT / "content" / "catalog" / "exam-families.json"
DEFAULT_BLUEPRINTS = REPO_ROOT / "content" / "catalog" / "blueprints.json"
DEFAULT_RIGHTS_REGISTRY = REPO_ROOT / "content" / "rights" / "registry.json"
DEFAULT_BATCH_MANIFEST = REPO_ROOT / "content" / "eligible" / "batches.manifest.json"
DEFAULT_COVERAGE_REPORT = REPO_ROOT / "content" / "reports" / "coverage-gaps.json"
DEFAULT_EEAR_SOURCE = (
    WORKSPACE_ROOT
    / "_ENTREGAVEIS-AUDITORIA"
    / "banco-questoes"
    / "eear-oficial-554-questoes.json"
)
DEFAULT_EEAR_MANIFEST = REPO_ROOT / "content" / "quarantine" / "eear-554.manifest.json"

QUESTION_STATUSES = {
    "draft",
    "quarantine",
    "rights_cleared",
    "in_review",
    "ready_for_beta",
    "published",
    "suspended",
}
CONTENT_TYPES = {"original_authoral", "official_licensed"}
REQUIRED_REVIEW_ROLES = {
    "blind_solver",
    "subject_specialist",
    "independent_auditor",
}
ELIGIBLE_STATUSES = {"ready_for_beta", "published"}
QUESTION_SCHEMA_VERSION = "2.0.0"
FINGERPRINT_ALGORITHM = "sha256-normalized-v3"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{5,127}$")


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise ValueError(f"arquivo não encontrado: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"JSON inválido em {path}:{exc.lineno}:{exc.colno}: {exc.msg}"
        ) from exc


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    path.write_text(rendered, encoding="utf-8", newline="\n")


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def logical_relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def source_files(source_root: Path) -> list[Path]:
    allowed = {".pdf", ".docx"}
    return sorted(
        (
            path
            for path in source_root.rglob("*")
            if path.is_file() and path.suffix.casefold() in allowed
        ),
        key=lambda path: logical_relative(path, source_root).casefold(),
    )


def build_inventory(source_root: Path) -> dict[str, Any]:
    if not source_root.is_dir():
        raise ValueError(f"diretório de fontes não encontrado: {source_root}")

    records: list[dict[str, Any]] = []
    extension_counts: Counter[str] = Counter()
    family_counts: Counter[str] = Counter()
    total_bytes = 0

    for path in source_files(source_root):
        relative = logical_relative(path, source_root)
        parts = Path(relative).parts
        family = parts[0] if len(parts) > 1 else "_root"
        extension = path.suffix.casefold().lstrip(".")
        size = path.stat().st_size
        records.append(
            {
                "relativePath": relative,
                "familyFolder": family,
                "extension": extension,
                "bytes": size,
                "sha256": sha256_file(path),
                "state": "quarantine",
            }
        )
        extension_counts[extension] += 1
        family_counts[family] += 1
        total_bytes += size

    hash_counts = Counter(record["sha256"] for record in records)
    duplicate_hash_groups = sum(1 for count in hash_counts.values() if count > 1)
    inventory_fingerprint = hashlib.sha256(
        json.dumps(
            records,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    return {
        "inventoryVersion": "1.0.0",
        "inventoryFingerprint": {
            "algorithm": "sha256-canonical-json-v1",
            "value": inventory_fingerprint,
        },
        "sourceRoot": "../Provas Anteriores",
        "policy": {
            "copiesSourceFiles": False,
            "publicationState": "quarantine",
            "includedExtensions": ["docx", "pdf"],
        },
        "summary": {
            "fileCount": len(records),
            "distinctHashCount": len(hash_counts),
            "duplicateHashGroupCount": duplicate_hash_groups,
            "totalBytes": total_bytes,
            "extensionCounts": dict(sorted(extension_counts.items())),
            "familyFolderCounts": dict(sorted(family_counts.items(), key=lambda item: item[0].casefold())),
        },
        "files": records,
    }


def build_eear_manifest(source: Path) -> dict[str, Any]:
    raw = read_json(source)
    if not isinstance(raw, list):
        raise ValueError("o lote legado EEAR deve ser um array JSON")

    ids: list[str] = []
    years: Counter[str] = Counter()
    subjects: Counter[str] = Counter()
    origins: Counter[str] = Counter()
    invalid_records = 0
    for item in raw:
        if not isinstance(item, dict):
            invalid_records += 1
            continue
        item_id = item.get("id")
        year = item.get("year")
        subject = item.get("materiaId")
        origin = item.get("origem")
        if not (
            nonempty_string(item_id)
            and isinstance(year, (int, str))
            and not isinstance(year, bool)
            and nonempty_string(str(year))
            and nonempty_string(subject)
            and nonempty_string(origin)
        ):
            invalid_records += 1
            continue
        ids.append(item_id)
        years[str(year)] += 1
        subjects[subject] += 1
        origins[origin] += 1

    return {
        "manifestVersion": "1.0.0",
        "datasetId": "legacy-eear-official-554",
        "canonicalProductId": "eear",
        "legacyAliases": ["EAAR"],
        "state": "quarantine",
        "publishable": False,
        "sourceReference": "../../../_ENTREGAVEIS-AUDITORIA/banco-questoes/eear-oficial-554-questoes.json",
        "sourceSha256": sha256_file(source),
        "declaredItemCount": len(raw),
        "uniqueIdCount": len(set(ids)),
        "invalidRecordCount": invalid_records,
        "yearCounts": dict(sorted(years.items())),
        "subjectCounts": dict(sorted(subjects.items())),
        "originCounts": dict(sorted(origins.items())),
        "blockingReasons": [
            "commercial_rights_not_cleared",
            "source_pages_not_recorded",
            "topics_and_skills_missing",
            "solutions_missing",
            "distractor_rationales_missing",
            "independent_reviews_missing",
            "content_fingerprints_missing",
            "assets_and_context_not_verified",
        ],
        "requiredNextGate": "rights_clearance_and_item_level_reconstruction",
        "notes": [
            "Este manifesto referencia o lote legado por hash; não o copia nem o publica.",
            "A presença de uma prova em fonte pública não equivale a licença comercial.",
            "Os totais descrevem o arquivo referenciado e não constituem aprovação editorial.",
        ],
    }


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def question_fingerprint(question: dict[str, Any]) -> str:
    raw_products = question.get("productIds")
    if not isinstance(raw_products, list):
        raw_products = []
    raw_options = question.get("options")
    if not isinstance(raw_options, list):
        raw_options = []
    options = []
    for option in raw_options:
        if isinstance(option, dict) and isinstance(option.get("text"), str):
            options.append(
                {
                    "id": normalize_text(str(option.get("id", ""))),
                    "text": normalize_text(option["text"]),
                }
            )
    solution = question.get("solution")
    if not isinstance(solution, dict):
        solution = {}
    rationales = solution.get("distractorRationales")
    if not isinstance(rationales, dict):
        rationales = {}
    steps = solution.get("steps")
    if not isinstance(steps, list):
        steps = []
    raw_assignments = question.get("blueprintAssignments")
    if not isinstance(raw_assignments, list):
        raw_assignments = []
    assignments = []
    for assignment in raw_assignments:
        if not isinstance(assignment, dict):
            continue
        assignments.append(
            {
                key: normalize_text(str(assignment.get(key, "")))
                for key in (
                    "blueprintId",
                    "blueprintVersion",
                    "familyId",
                    "trackId",
                    "subjectId",
                    "topicId",
                    "skillId",
                )
            }
        )
    stimulus = question.get("stimulus")
    if not isinstance(stimulus, dict):
        stimulus = {}
    raw_assets = stimulus.get("assets")
    if not isinstance(raw_assets, list):
        raw_assets = []
    assets = []
    for asset in raw_assets:
        if not isinstance(asset, dict):
            continue
        assets.append(
            {
                key: normalize_text(str(asset.get(key, "")))
                for key in (
                    "id",
                    "kind",
                    "sha256",
                    "mimeType",
                    "rightsDocumentId",
                    "altText",
                    "longDescription",
                )
            }
        )
    source = question.get("source")
    if not isinstance(source, dict):
        source = {}
    source_location = source.get("location")
    if not isinstance(source_location, dict):
        source_location = {}
    rights = question.get("rights")
    if not isinstance(rights, dict):
        rights = {}
    payload = {
        "products": sorted(
            normalize_text(product)
            for product in raw_products
            if isinstance(product, str)
        ),
        "examVersion": normalize_text(str(question.get("examVersionId", ""))),
        "subject": normalize_text(str(question.get("subjectId", ""))),
        "topic": normalize_text(str(question.get("topicId", ""))),
        "skill": normalize_text(str(question.get("skillId", ""))),
        "blueprintAssignments": sorted(
            assignments,
            key=lambda assignment: tuple(assignment[key] for key in sorted(assignment)),
        ),
        "difficulty": normalize_text(str(question.get("difficulty", ""))),
        "stem": normalize_text(str(question.get("stem", ""))),
        "options": sorted(options, key=lambda option: (option["id"], option["text"])),
        "correctOptionId": normalize_text(str(question.get("correctOptionId", ""))),
        "solution": {
            "steps": [
                normalize_text(str(step))
                for step in steps
                if isinstance(step, str)
            ],
            "finalAnswer": normalize_text(str(solution.get("finalAnswer", ""))),
            "distractorRationales": {
                normalize_text(str(option_id)): normalize_text(str(rationale))
                for option_id, rationale in sorted(
                    rationales.items(), key=lambda item: str(item[0])
                )
            },
        },
        "stimulus": {
            "kind": normalize_text(str(stimulus.get("kind", ""))),
            "text": normalize_text(str(stimulus.get("text", ""))),
            "assets": sorted(
                assets,
                key=lambda asset: (asset["id"], asset["sha256"]),
            ),
        },
        "source": {
            "kind": normalize_text(str(source.get("kind", ""))),
            "transformation": normalize_text(str(source.get("transformation", ""))),
            "title": normalize_text(str(source.get("title", ""))),
            "owner": normalize_text(str(source.get("owner", ""))),
            "sourceHash": normalize_text(str(source.get("sourceHash", ""))),
            "location": {
                "file": normalize_text(str(source_location.get("file", ""))),
                "page": source_location.get("page"),
                "questionNumber": normalize_text(
                    str(source_location.get("questionNumber", ""))
                ),
            },
        },
        "rights": {
            "status": normalize_text(str(rights.get("status", ""))),
            "documentId": normalize_text(
                str(
                    rights.get("licenseId")
                    or rights.get("authoringAgreementId")
                    or ""
                )
            ),
            "territories": sorted(
                normalize_text(str(item))
                for item in rights.get("territories", [])
                if isinstance(item, str)
            ),
            "platforms": sorted(
                normalize_text(str(item))
                for item in rights.get("platforms", [])
                if isinstance(item, str)
            ),
            "validFrom": normalize_text(str(rights.get("validFrom", ""))),
            "validUntil": normalize_text(str(rights.get("validUntil", ""))),
        },
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def stem_shingles(question: dict[str, Any], width: int = 3) -> set[str]:
    words = normalize_text(str(question.get("stem", ""))).split()
    if len(words) < width:
        return {" ".join(words)} if words else set()
    return {" ".join(words[index : index + width]) for index in range(len(words) - width + 1)}


def near_duplicate_pairs(
    questions: Sequence[dict[str, Any]], threshold: float = 0.9
) -> list[tuple[int, int, float]]:
    normalized_stems = [normalize_text(str(question.get("stem", ""))) for question in questions]
    shingles = [stem_shingles(question) for question in questions]
    index: dict[str, list[int]] = defaultdict(list)
    candidates: set[tuple[int, int]] = set()
    for current, values in enumerate(
        [set(stem.split()) | shingles[index] for index, stem in enumerate(normalized_stems)]
    ):
        for value in values:
            for previous in index[value]:
                candidates.add((previous, current))
            index[value].append(current)

    result: list[tuple[int, int, float]] = []
    for left, right in sorted(candidates):
        union = shingles[left] | shingles[right]
        if not union:
            continue
        shingle_similarity = len(shingles[left] & shingles[right]) / len(union)
        character_similarity = SequenceMatcher(
            None,
            normalized_stems[left],
            normalized_stems[right],
            autojunk=False,
        ).ratio()
        token_similarity = SequenceMatcher(
            None,
            normalized_stems[left].split(),
            normalized_stems[right].split(),
            autojunk=False,
        ).ratio()
        similarity = max(shingle_similarity, character_similarity, token_similarity)
        if similarity >= threshold and question_fingerprint(questions[left]) != question_fingerprint(questions[right]):
            result.append((left, right, round(similarity, 4)))
    return result


def issue(
    code: str,
    message: str,
    *,
    question_id: str = "<unknown>",
    path: str = "$",
    severity: str = "error",
) -> dict[str, str]:
    return {
        "severity": severity,
        "code": code,
        "questionId": question_id,
        "path": path,
        "message": message,
    }


def nonempty_string(value: Any, minimum: int = 1) -> bool:
    return isinstance(value, str) and len(value.strip()) >= minimum


def valid_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def valid_iso_datetime(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def validate_question(question: Any, known_products: set[str]) -> list[dict[str, str]]:
    if not isinstance(question, dict):
        return [issue("QUESTION_NOT_OBJECT", "a questão deve ser um objeto JSON")]

    question_id = str(question.get("id", "<unknown>"))
    errors: list[dict[str, str]] = []
    expected_fingerprint = question_fingerprint(question)

    required = {
        "schemaVersion",
        "id",
        "authorId",
        "revision",
        "status",
        "contentType",
        "productIds",
        "blueprintAssignments",
        "examVersionId",
        "subjectId",
        "topicId",
        "skillId",
        "stem",
        "options",
        "correctOptionId",
        "solution",
        "stimulus",
        "difficulty",
        "source",
        "rights",
        "reviews",
        "semanticDeduplication",
        "fingerprint",
    }
    for field in sorted(question.keys() - required):
        errors.append(
            issue(
                "UNKNOWN_FIELD",
                f"campo não permitido pelo contrato: {field}",
                question_id=question_id,
                path=f"$.{field}",
            )
        )
    for field in sorted(required - question.keys()):
        errors.append(issue("REQUIRED_FIELD", f"campo obrigatório ausente: {field}", question_id=question_id, path=f"$.{field}"))

    if question.get("schemaVersion") != QUESTION_SCHEMA_VERSION:
        errors.append(issue("SCHEMA_VERSION", f"schemaVersion deve ser {QUESTION_SCHEMA_VERSION}", question_id=question_id, path="$.schemaVersion"))
    if not isinstance(question.get("id"), str) or not ID_RE.fullmatch(question["id"]):
        errors.append(issue("INVALID_ID", "id deve ser minúsculo, estável e ter 6–128 caracteres", question_id=question_id, path="$.id"))
    author_id = question.get("authorId")
    if not nonempty_string(author_id, 3):
        errors.append(issue("INVALID_AUTHOR", "authorId é obrigatório", question_id=question_id, path="$.authorId"))
    if not isinstance(question.get("revision"), int) or isinstance(question.get("revision"), bool) or question.get("revision", 0) < 1:
        errors.append(issue("INVALID_REVISION", "revision deve ser inteiro >= 1", question_id=question_id, path="$.revision"))
    if question.get("status") not in QUESTION_STATUSES:
        errors.append(issue("INVALID_STATUS", "status editorial inválido", question_id=question_id, path="$.status"))
    if question.get("contentType") not in CONTENT_TYPES:
        errors.append(issue("INVALID_CONTENT_TYPE", "contentType inválido", question_id=question_id, path="$.contentType"))

    product_ids = question.get("productIds")
    if not isinstance(product_ids, list) or not product_ids or not all(nonempty_string(item) for item in product_ids):
        errors.append(issue("INVALID_PRODUCTS", "productIds deve ser uma lista não vazia", question_id=question_id, path="$.productIds"))
    else:
        if len(set(product_ids)) != len(product_ids):
            errors.append(issue("DUPLICATE_PRODUCT", "productIds contém duplicatas", question_id=question_id, path="$.productIds"))
        for product_id in product_ids:
            if product_id not in known_products:
                errors.append(issue("UNKNOWN_PRODUCT", f"produto fora do catálogo: {product_id}", question_id=question_id, path="$.productIds"))

    assignments = question.get("blueprintAssignments")
    assignment_keys: list[tuple[str, ...]] = []
    assignment_families: list[str] = []
    if not isinstance(assignments, list) or not assignments:
        errors.append(
            issue(
                "BLUEPRINT_ASSIGNMENT_REQUIRED",
                "blueprintAssignments deve registrar ao menos uma compatibilidade editorial",
                question_id=question_id,
                path="$.blueprintAssignments",
            )
        )
        assignments = []
    assignment_fields = (
        "blueprintId",
        "blueprintVersion",
        "familyId",
        "trackId",
        "subjectId",
        "topicId",
        "skillId",
    )
    for index, assignment in enumerate(assignments):
        if not isinstance(assignment, dict):
            errors.append(
                issue(
                    "BLUEPRINT_ASSIGNMENT_NOT_OBJECT",
                    "compatibilidade de blueprint deve ser um objeto",
                    question_id=question_id,
                    path=f"$.blueprintAssignments[{index}]",
                )
            )
            continue
        unknown = set(assignment) - set(assignment_fields)
        if unknown:
            errors.append(
                issue(
                    "BLUEPRINT_ASSIGNMENT_UNKNOWN_FIELD",
                    f"campos não permitidos: {', '.join(sorted(unknown))}",
                    question_id=question_id,
                    path=f"$.blueprintAssignments[{index}]",
                )
            )
        for field in assignment_fields:
            if not nonempty_string(assignment.get(field), 2):
                errors.append(
                    issue(
                        "INVALID_BLUEPRINT_ASSIGNMENT",
                        f"{field} é obrigatório",
                        question_id=question_id,
                        path=f"$.blueprintAssignments[{index}].{field}",
                    )
                )
        family_id = assignment.get("familyId")
        if isinstance(family_id, str):
            assignment_families.append(family_id)
            if family_id not in known_products:
                errors.append(
                    issue(
                        "UNKNOWN_BLUEPRINT_FAMILY",
                        f"família fora do catálogo: {family_id}",
                        question_id=question_id,
                        path=f"$.blueprintAssignments[{index}].familyId",
                    )
                )
        assignment_keys.append(tuple(str(assignment.get(field, "")) for field in assignment_fields))
    if len(set(assignment_keys)) != len(assignment_keys):
        errors.append(
            issue(
                "DUPLICATE_BLUEPRINT_ASSIGNMENT",
                "blueprintAssignments contém compatibilidades duplicadas",
                question_id=question_id,
                path="$.blueprintAssignments",
            )
        )
    if isinstance(product_ids, list) and set(assignment_families) != set(product_ids):
        errors.append(
            issue(
                "PRODUCT_ASSIGNMENT_MISMATCH",
                "productIds deve ser exatamente o conjunto de famílias em blueprintAssignments",
                question_id=question_id,
                path="$.blueprintAssignments",
            )
        )

    for field, minimum in (("examVersionId", 3), ("subjectId", 2), ("topicId", 2), ("skillId", 2), ("stem", 20)):
        if not nonempty_string(question.get(field), minimum):
            errors.append(issue("INVALID_TEXT", f"{field} deve ter ao menos {minimum} caracteres", question_id=question_id, path=f"$.{field}"))
    if assignments and isinstance(assignments[0], dict):
        primary = assignments[0]
        for question_field, assignment_field in (
            ("examVersionId", "blueprintId"),
            ("subjectId", "subjectId"),
            ("topicId", "topicId"),
            ("skillId", "skillId"),
        ):
            if question.get(question_field) != primary.get(assignment_field):
                errors.append(
                    issue(
                        "PRIMARY_CLASSIFICATION_MISMATCH",
                        f"{question_field} deve coincidir com {assignment_field} da primeira compatibilidade",
                        question_id=question_id,
                        path=f"$.{question_field}",
                    )
                )
    if question.get("difficulty") not in {"easy", "medium", "hard"}:
        errors.append(issue("INVALID_DIFFICULTY", "difficulty deve ser easy, medium ou hard", question_id=question_id, path="$.difficulty"))

    options = question.get("options")
    option_ids: list[str] = []
    option_texts: list[str] = []
    if not isinstance(options, list) or not 2 <= len(options) <= 5:
        errors.append(issue("OPTION_COUNT", "a questão deve ter entre 2 e 5 opções", question_id=question_id, path="$.options"))
        options = []
    for index, option in enumerate(options):
        if not isinstance(option, dict):
            errors.append(issue("OPTION_NOT_OBJECT", "opção deve ser um objeto", question_id=question_id, path=f"$.options[{index}]"))
            continue
        option_id = option.get("id")
        option_text = option.get("text")
        if option_id not in {"a", "b", "c", "d", "e"}:
            errors.append(issue("INVALID_OPTION_ID", "id da opção deve estar entre a e e", question_id=question_id, path=f"$.options[{index}].id"))
        else:
            option_ids.append(option_id)
        if not nonempty_string(option_text):
            errors.append(issue("EMPTY_OPTION", "texto da opção não pode ser vazio", question_id=question_id, path=f"$.options[{index}].text"))
        else:
            option_texts.append(normalize_text(option_text))
    if len(set(option_ids)) != len(option_ids):
        errors.append(issue("DUPLICATE_OPTION_ID", "ids de opção devem ser únicos", question_id=question_id, path="$.options"))
    if len(set(option_texts)) != len(option_texts):
        errors.append(issue("DUPLICATE_OPTION_TEXT", "textos de opção devem ser únicos", question_id=question_id, path="$.options"))
    correct = question.get("correctOptionId")
    if correct not in option_ids:
        errors.append(issue("INVALID_ANSWER", "correctOptionId deve apontar para uma opção existente", question_id=question_id, path="$.correctOptionId"))

    solution = question.get("solution")
    if not isinstance(solution, dict):
        errors.append(issue("INVALID_SOLUTION", "solution deve ser um objeto", question_id=question_id, path="$.solution"))
    else:
        steps = solution.get("steps")
        if not isinstance(steps, list) or not steps or not all(nonempty_string(step, 10) for step in steps):
            errors.append(issue("INVALID_SOLUTION_STEPS", "solution.steps deve conter etapas explicativas", question_id=question_id, path="$.solution.steps"))
        if not nonempty_string(solution.get("finalAnswer"), 10):
            errors.append(issue("INVALID_FINAL_ANSWER", "solution.finalAnswer deve explicar a resposta", question_id=question_id, path="$.solution.finalAnswer"))
        rationales = solution.get("distractorRationales")
        expected_distractors = set(option_ids) - {correct}
        if not isinstance(rationales, dict):
            errors.append(issue("INVALID_RATIONALES", "distractorRationales deve ser um objeto", question_id=question_id, path="$.solution.distractorRationales"))
        else:
            if set(rationales) != expected_distractors:
                errors.append(issue("RATIONALE_COVERAGE", "deve haver uma justificativa, e apenas uma, para cada distrator", question_id=question_id, path="$.solution.distractorRationales"))
            for option_id, rationale in rationales.items():
                if not nonempty_string(rationale, 10):
                    errors.append(issue("EMPTY_RATIONALE", f"justificativa insuficiente para {option_id}", question_id=question_id, path=f"$.solution.distractorRationales.{option_id}"))

    stimulus = question.get("stimulus")
    if not isinstance(stimulus, dict):
        errors.append(
            issue(
                "INVALID_STIMULUS",
                "stimulus deve declarar explicitamente contexto e ativos, mesmo quando vazio",
                question_id=question_id,
                path="$.stimulus",
            )
        )
    else:
        allowed_stimulus_fields = {"kind", "text", "assets"}
        unknown = set(stimulus) - allowed_stimulus_fields
        if unknown:
            errors.append(
                issue(
                    "STIMULUS_UNKNOWN_FIELD",
                    f"campos não permitidos: {', '.join(sorted(unknown))}",
                    question_id=question_id,
                    path="$.stimulus",
                )
            )
        stimulus_kind = stimulus.get("kind")
        if stimulus_kind not in {"none", "text", "image", "table", "diagram", "mixed"}:
            errors.append(
                issue(
                    "INVALID_STIMULUS_KIND",
                    "stimulus.kind inválido",
                    question_id=question_id,
                    path="$.stimulus.kind",
                )
            )
        stimulus_text = stimulus.get("text")
        assets = stimulus.get("assets")
        if not isinstance(assets, list):
            errors.append(
                issue(
                    "INVALID_ASSETS",
                    "stimulus.assets deve ser uma lista",
                    question_id=question_id,
                    path="$.stimulus.assets",
                )
            )
            assets = []
        if stimulus_kind == "none":
            if (stimulus_text is not None and stimulus_text != "") or assets:
                errors.append(
                    issue(
                        "EMPTY_STIMULUS_MUST_HAVE_NO_CONTENT",
                        "stimulus none não pode carregar texto ou ativos",
                        question_id=question_id,
                        path="$.stimulus",
                    )
                )
        elif stimulus_kind in {"text", "mixed"} and not nonempty_string(stimulus_text, 10):
            errors.append(
                issue(
                    "STIMULUS_TEXT_REQUIRED",
                    "contexto textual deve ter conteúdo suficiente",
                    question_id=question_id,
                    path="$.stimulus.text",
                )
            )
        if stimulus_kind in {"image", "table", "diagram", "mixed"} and not assets:
            errors.append(
                issue(
                    "STIMULUS_ASSET_REQUIRED",
                    "contexto visual deve referenciar ao menos um ativo",
                    question_id=question_id,
                    path="$.stimulus.assets",
                )
            )
        asset_ids: list[str] = []
        for index, asset in enumerate(assets):
            if not isinstance(asset, dict):
                errors.append(
                    issue(
                        "ASSET_NOT_OBJECT",
                        "ativo deve ser um objeto",
                        question_id=question_id,
                        path=f"$.stimulus.assets[{index}]",
                    )
                )
                continue
            allowed_asset_fields = {
                "id",
                "kind",
                "sha256",
                "mimeType",
                "rightsDocumentId",
                "altText",
                "longDescription",
            }
            unknown_asset = set(asset) - allowed_asset_fields
            if unknown_asset:
                errors.append(
                    issue(
                        "ASSET_UNKNOWN_FIELD",
                        f"campos não permitidos: {', '.join(sorted(unknown_asset))}",
                        question_id=question_id,
                        path=f"$.stimulus.assets[{index}]",
                    )
                )
            asset_id = asset.get("id")
            if not nonempty_string(asset_id, 3):
                errors.append(issue("INVALID_ASSET_ID", "asset.id é obrigatório", question_id=question_id, path=f"$.stimulus.assets[{index}].id"))
            else:
                asset_ids.append(asset_id)
            if asset.get("kind") not in {"image", "table", "diagram"}:
                errors.append(issue("INVALID_ASSET_KIND", "asset.kind inválido", question_id=question_id, path=f"$.stimulus.assets[{index}].kind"))
            if not isinstance(asset.get("sha256"), str) or not SHA256_RE.fullmatch(asset["sha256"]):
                errors.append(issue("INVALID_ASSET_HASH", "asset.sha256 deve ser SHA-256 hexadecimal", question_id=question_id, path=f"$.stimulus.assets[{index}].sha256"))
            if not nonempty_string(asset.get("mimeType"), 3):
                errors.append(issue("INVALID_ASSET_MIME", "asset.mimeType é obrigatório", question_id=question_id, path=f"$.stimulus.assets[{index}].mimeType"))
            if not nonempty_string(asset.get("rightsDocumentId"), 3):
                errors.append(issue("ASSET_RIGHTS_REQUIRED", "ativo exige documento de direitos próprio", question_id=question_id, path=f"$.stimulus.assets[{index}].rightsDocumentId"))
            if not nonempty_string(asset.get("altText"), 10):
                errors.append(issue("ASSET_ALT_TEXT_REQUIRED", "ativo visual exige texto alternativo", question_id=question_id, path=f"$.stimulus.assets[{index}].altText"))
            if asset.get("kind") in {"table", "diagram"} and not nonempty_string(asset.get("longDescription"), 10):
                errors.append(issue("ASSET_LONG_DESCRIPTION_REQUIRED", "tabela ou diagrama exige descrição longa", question_id=question_id, path=f"$.stimulus.assets[{index}].longDescription"))
        if len(set(asset_ids)) != len(asset_ids):
            errors.append(issue("DUPLICATE_ASSET_ID", "ids de ativos devem ser únicos", question_id=question_id, path="$.stimulus.assets"))

    source = question.get("source")
    content_type = question.get("contentType")
    if not isinstance(source, dict):
        errors.append(issue("INVALID_SOURCE", "source deve ser um objeto", question_id=question_id, path="$.source"))
    else:
        unknown_source = set(source) - {"kind", "transformation", "title", "owner", "sourceHash", "location"}
        if unknown_source:
            errors.append(issue("SOURCE_UNKNOWN_FIELD", f"campos não permitidos: {', '.join(sorted(unknown_source))}", question_id=question_id, path="$.source"))
        expected_kind = "official_exam" if content_type == "official_licensed" else "original_authoral"
        if source.get("kind") != expected_kind:
            errors.append(issue("SOURCE_KIND_MISMATCH", f"source.kind deve ser {expected_kind}", question_id=question_id, path="$.source.kind"))
        for field in ("title", "owner"):
            if not nonempty_string(source.get(field), 2):
                errors.append(issue("INVALID_SOURCE_METADATA", f"source.{field} é obrigatório", question_id=question_id, path=f"$.source.{field}"))
        if not isinstance(source.get("sourceHash"), str) or not SHA256_RE.fullmatch(source["sourceHash"]):
            errors.append(issue("INVALID_SOURCE_HASH", "sourceHash deve ser SHA-256 hexadecimal", question_id=question_id, path="$.source.sourceHash"))
        if content_type == "official_licensed":
            location = source.get("location")
            question_number_valid = isinstance(location, dict) and (
                (isinstance(location.get("questionNumber"), int) and not isinstance(location.get("questionNumber"), bool) and location.get("questionNumber", 0) > 0)
                or nonempty_string(location.get("questionNumber"))
            )
            if not isinstance(location, dict) or not isinstance(location.get("page"), int) or isinstance(location.get("page"), bool) or location.get("page", 0) < 1 or not nonempty_string(location.get("file")) or not question_number_valid:
                errors.append(issue("OFFICIAL_LOCATION_REQUIRED", "questão oficial exige arquivo, página e número na fonte", question_id=question_id, path="$.source.location"))
            if source.get("transformation") not in {"verbatim", "adapted", "fragmented"}:
                errors.append(issue("OFFICIAL_TRANSFORMATION_REQUIRED", "questão oficial deve declarar verbatim, adapted ou fragmented", question_id=question_id, path="$.source.transformation"))

    rights = question.get("rights")
    if not isinstance(rights, dict):
        errors.append(issue("INVALID_RIGHTS", "rights deve ser um objeto", question_id=question_id, path="$.rights"))
    else:
        unknown_rights = set(rights) - {"status", "licenseId", "authoringAgreementId", "territories", "platforms", "validFrom", "validUntil"}
        if unknown_rights:
            errors.append(issue("RIGHTS_UNKNOWN_FIELD", f"campos não permitidos: {', '.join(sorted(unknown_rights))}", question_id=question_id, path="$.rights"))
        if rights.get("status") != "cleared":
            errors.append(issue("RIGHTS_NOT_CLEARED", "direitos devem estar liberados antes da entrada no lote", question_id=question_id, path="$.rights.status"))
        required_right = "licenseId" if content_type == "official_licensed" else "authoringAgreementId"
        forbidden_right = "authoringAgreementId" if content_type == "official_licensed" else "licenseId"
        if not nonempty_string(rights.get(required_right), 3):
            errors.append(issue("RIGHTS_DOCUMENT_REQUIRED", f"{required_right} é obrigatório", question_id=question_id, path=f"$.rights.{required_right}"))
        if rights.get(forbidden_right) is not None:
            errors.append(issue("RIGHTS_DOCUMENT_TYPE_MISMATCH", f"{forbidden_right} não é permitido para {content_type}", question_id=question_id, path=f"$.rights.{forbidden_right}"))
        territories = rights.get("territories")
        if not isinstance(territories, list) or not all(isinstance(item, str) for item in territories) or "BR" not in territories or len(set(territories)) != len(territories):
            errors.append(issue("RIGHTS_TERRITORY", "direitos devem incluir o território BR", question_id=question_id, path="$.rights.territories"))
        platforms = rights.get("platforms")
        if (
            not isinstance(platforms, list)
            or not all(isinstance(platform, str) for platform in platforms)
            or not {"ios", "android"}.issubset(set(platforms))
        ):
            errors.append(issue("RIGHTS_PLATFORMS", "direitos devem incluir iOS e Android", question_id=question_id, path="$.rights.platforms"))
        if not valid_iso_date(rights.get("validFrom")):
            errors.append(issue("RIGHTS_VALID_FROM", "validFrom deve ser uma data ISO", question_id=question_id, path="$.rights.validFrom"))
        if rights.get("validUntil") is not None and not valid_iso_date(rights.get("validUntil")):
            errors.append(issue("RIGHTS_VALID_UNTIL", "validUntil deve ser data ISO ou null", question_id=question_id, path="$.rights.validUntil"))
        if valid_iso_date(rights.get("validFrom")) and valid_iso_date(rights.get("validUntil")):
            if date.fromisoformat(rights["validUntil"]) < date.fromisoformat(rights["validFrom"]):
                errors.append(issue("RIGHTS_INVALID_RANGE", "validUntil não pode anteceder validFrom", question_id=question_id, path="$.rights.validUntil"))

    reviews = question.get("reviews")
    review_roles: set[str] = set()
    reviewer_ids: list[str] = []
    divergent = False
    adjudicator_approved = False
    if not isinstance(reviews, list):
        errors.append(issue("INVALID_REVIEWS", "reviews deve ser uma lista", question_id=question_id, path="$.reviews"))
        reviews = []
    for index, review in enumerate(reviews):
        if not isinstance(review, dict):
            errors.append(issue("REVIEW_NOT_OBJECT", "review deve ser um objeto", question_id=question_id, path=f"$.reviews[{index}]"))
            continue
        role = review.get("role")
        reviewer_id = review.get("reviewerId")
        if role not in REQUIRED_REVIEW_ROLES | {"adjudicator"}:
            errors.append(issue("INVALID_REVIEW_ROLE", "papel de revisão inválido", question_id=question_id, path=f"$.reviews[{index}].role"))
        else:
            review_roles.add(role)
        if not nonempty_string(reviewer_id, 3):
            errors.append(issue("INVALID_REVIEWER", "reviewerId é obrigatório", question_id=question_id, path=f"$.reviews[{index}].reviewerId"))
        else:
            reviewer_ids.append(reviewer_id)
        if review.get("decision") != "approved":
            errors.append(issue("REVIEW_NOT_APPROVED", "todos os gates do lote devem estar aprovados", question_id=question_id, path=f"$.reviews[{index}].decision"))
        if not valid_iso_datetime(review.get("reviewedAt")):
            errors.append(issue("INVALID_REVIEW_TIME", "reviewedAt deve ser RFC 3339 com fuso", question_id=question_id, path=f"$.reviews[{index}].reviewedAt"))
        if review.get("questionRevision") != question.get("revision"):
            errors.append(issue("REVIEW_REVISION_MISMATCH", "revisão editorial não está vinculada à revisão atual da questão", question_id=question_id, path=f"$.reviews[{index}].questionRevision"))
        if review.get("questionFingerprint") != expected_fingerprint:
            errors.append(issue("REVIEW_FINGERPRINT_MISMATCH", "revisão editorial não está vinculada ao conteúdo atual", question_id=question_id, path=f"$.reviews[{index}].questionFingerprint"))
        selected = review.get("selectedOptionId")
        if role == "blind_solver" and selected not in option_ids:
            errors.append(issue("BLIND_ANSWER_REQUIRED", "solucionador cego deve registrar uma opção existente", question_id=question_id, path=f"$.reviews[{index}].selectedOptionId"))
        if selected in option_ids and selected != correct:
            divergent = True
        if role == "adjudicator" and review.get("decision") == "approved":
            adjudicator_approved = True
    missing_roles = REQUIRED_REVIEW_ROLES - review_roles
    if missing_roles:
        errors.append(issue("MISSING_REVIEW_ROLES", f"revisões ausentes: {', '.join(sorted(missing_roles))}", question_id=question_id, path="$.reviews"))
    if len(set(reviewer_ids)) != len(reviewer_ids):
        errors.append(issue("REVIEWER_NOT_INDEPENDENT", "cada gate deve ter reviewerId distinto", question_id=question_id, path="$.reviews"))
    if nonempty_string(author_id, 3) and author_id in reviewer_ids:
        errors.append(issue("AUTHOR_REVIEWER_NOT_INDEPENDENT", "o autor não pode revisar a própria questão", question_id=question_id, path="$.reviews"))
    if divergent and not adjudicator_approved:
        errors.append(issue("ADJUDICATION_REQUIRED", "divergência exige adjudicador independente", question_id=question_id, path="$.reviews"))

    semantic = question.get("semanticDeduplication")
    if not isinstance(semantic, dict):
        errors.append(issue("SEMANTIC_DEDUP_REQUIRED", "checagem semântica auditável é obrigatória", question_id=question_id, path="$.semanticDeduplication"))
    else:
        allowed_semantic_fields = {
            "reviewerId",
            "decision",
            "reviewedAt",
            "questionRevision",
            "questionFingerprint",
            "corpusSnapshotHash",
            "methodVersion",
            "nearestQuestionId",
            "maxSimilarity",
        }
        unknown_semantic = set(semantic) - allowed_semantic_fields
        if unknown_semantic:
            errors.append(issue("SEMANTIC_DEDUP_UNKNOWN_FIELD", f"campos não permitidos: {', '.join(sorted(unknown_semantic))}", question_id=question_id, path="$.semanticDeduplication"))
        independent_ids = {
            review.get("reviewerId")
            for review in reviews
            if isinstance(review, dict) and review.get("role") == "independent_auditor"
        }
        if semantic.get("reviewerId") not in independent_ids:
            errors.append(issue("SEMANTIC_REVIEWER_NOT_AUDITOR", "checagem semântica deve ser assinada pelo fiscal independente", question_id=question_id, path="$.semanticDeduplication.reviewerId"))
        if semantic.get("decision") != "no_material_duplicate":
            errors.append(issue("SEMANTIC_DUPLICATE_NOT_CLEARED", "decisão semântica deve ser no_material_duplicate", question_id=question_id, path="$.semanticDeduplication.decision"))
        if not valid_iso_datetime(semantic.get("reviewedAt")):
            errors.append(issue("INVALID_SEMANTIC_REVIEW_TIME", "reviewedAt semântico deve ser RFC 3339 com fuso", question_id=question_id, path="$.semanticDeduplication.reviewedAt"))
        if semantic.get("questionRevision") != question.get("revision"):
            errors.append(issue("SEMANTIC_REVISION_MISMATCH", "checagem semântica não está vinculada à revisão atual", question_id=question_id, path="$.semanticDeduplication.questionRevision"))
        if semantic.get("questionFingerprint") != expected_fingerprint:
            errors.append(issue("SEMANTIC_FINGERPRINT_MISMATCH", "checagem semântica não está vinculada ao conteúdo atual", question_id=question_id, path="$.semanticDeduplication.questionFingerprint"))
        if not isinstance(semantic.get("corpusSnapshotHash"), str) or not SHA256_RE.fullmatch(semantic["corpusSnapshotHash"]):
            errors.append(issue("INVALID_SEMANTIC_CORPUS_HASH", "corpusSnapshotHash deve ser SHA-256", question_id=question_id, path="$.semanticDeduplication.corpusSnapshotHash"))
        if not nonempty_string(semantic.get("methodVersion"), 3):
            errors.append(issue("SEMANTIC_METHOD_REQUIRED", "methodVersion é obrigatório", question_id=question_id, path="$.semanticDeduplication.methodVersion"))
        max_similarity = semantic.get("maxSimilarity")
        if not isinstance(max_similarity, (int, float)) or isinstance(max_similarity, bool) or not 0 <= max_similarity <= 1:
            errors.append(issue("INVALID_SEMANTIC_SIMILARITY", "maxSimilarity deve estar entre 0 e 1", question_id=question_id, path="$.semanticDeduplication.maxSimilarity"))

    fingerprint = question.get("fingerprint")
    if not isinstance(fingerprint, dict):
        errors.append(issue("INVALID_FINGERPRINT", "fingerprint deve ser um objeto", question_id=question_id, path="$.fingerprint"))
    else:
        if fingerprint.get("algorithm") != FINGERPRINT_ALGORITHM:
            errors.append(issue("FINGERPRINT_ALGORITHM", f"algoritmo deve ser {FINGERPRINT_ALGORITHM}", question_id=question_id, path="$.fingerprint.algorithm"))
        if fingerprint.get("value") != expected_fingerprint:
            errors.append(issue("FINGERPRINT_MISMATCH", f"fingerprint esperado: {expected_fingerprint}", question_id=question_id, path="$.fingerprint.value"))

    return errors


def load_questions(path: Path) -> list[Any]:
    data = read_json(path)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return data["questions"]
    raise ValueError("o lote deve ser um array ou um objeto com a lista questions")


def load_known_products(catalog_path: Path) -> set[str]:
    catalog = read_json(catalog_path)
    families = catalog.get("families") if isinstance(catalog, dict) else None
    if not isinstance(families, list):
        raise ValueError("catálogo inválido: families deve ser uma lista")
    if len(families) != 19 or not all(
        isinstance(family, dict) and nonempty_string(family.get("id"))
        for family in families
    ):
        raise ValueError("catálogo canônico deve conter exatamente 19 IDs únicos")
    product_ids = {family["id"] for family in families}
    if len(product_ids) != 19:
        raise ValueError("catálogo canônico deve conter exatamente 19 IDs únicos")
    return product_ids


def load_catalog(catalog_path: Path) -> dict[str, Any]:
    catalog = read_json(catalog_path)
    known_products = load_known_products(catalog_path)
    if not isinstance(catalog, dict):
        raise ValueError("catálogo inválido")
    target = catalog.get("contentTargetPerSubject")
    if not isinstance(target, int) or isinstance(target, bool) or target < 1000:
        raise ValueError("catálogo deve exigir ao menos 1000 itens elegíveis por matéria")
    default_tracks: set[tuple[str, str]] = set()
    for family in catalog["families"]:
        track = family.get("defaultTrack")
        if not isinstance(track, dict) or not nonempty_string(track.get("id"), 2):
            raise ValueError(f"família {family.get('id')} não possui defaultTrack válido")
        key = (family["id"], track["id"])
        if key in default_tracks:
            raise ValueError(f"trilha default duplicada: {family['id']}/{track['id']}")
        default_tracks.add(key)
    if set(family["id"] for family in catalog["families"]) != known_products:
        raise ValueError("catálogo inconsistente")
    return catalog


def canonical_json_hash(value: Any) -> str:
    rendered = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def report_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.name


def coverage_blocker(code: str, scope: str, message: str) -> dict[str, str]:
    return {"code": code, "scope": scope, "message": message}


def approved_blueprints(
    registry: Any,
    catalog: dict[str, Any],
    blockers: list[dict[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    if not isinstance(registry, dict) or registry.get("schemaVersion") != "1.0.0":
        raise ValueError("registro de blueprints inválido")
    blueprints = registry.get("blueprints")
    if not isinstance(blueprints, list):
        raise ValueError("registro de blueprints deve conter a lista blueprints")
    known_products = {family["id"] for family in catalog["families"]}
    target = catalog["contentTargetPerSubject"]
    approved: dict[tuple[str, str], dict[str, Any]] = {}
    seen_versions: set[tuple[str, str]] = set()
    for index, blueprint in enumerate(blueprints):
        scope = f"blueprint[{index}]"
        if not isinstance(blueprint, dict):
            blockers.append(coverage_blocker("BLUEPRINT_INVALID", scope, "registro não é objeto"))
            continue
        blueprint_id = blueprint.get("id")
        version = blueprint.get("version")
        key_version = (str(blueprint_id), str(version))
        if key_version in seen_versions:
            blockers.append(coverage_blocker("BLUEPRINT_VERSION_DUPLICATE", scope, "id e versão duplicados"))
        seen_versions.add(key_version)
        family_id = blueprint.get("familyId")
        track_id = blueprint.get("trackId")
        if family_id not in known_products or not nonempty_string(track_id, 2):
            blockers.append(coverage_blocker("BLUEPRINT_TRACK_INVALID", scope, "família ou trilha fora do catálogo"))
            continue
        if blueprint.get("status") != "approved":
            continue
        required_text = ("id", "version", "cargo", "banca", "phase", "modality", "sourceDocumentHash")
        missing = [field for field in required_text if not nonempty_string(blueprint.get(field), 2)]
        if missing or not SHA256_RE.fullmatch(str(blueprint.get("sourceDocumentHash", ""))):
            blockers.append(coverage_blocker("BLUEPRINT_METADATA_INCOMPLETE", scope, f"metadados inválidos: {', '.join(missing) or 'sourceDocumentHash'}"))
            continue
        edital = blueprint.get("edital")
        if not isinstance(edital, dict) or not all(
            nonempty_string(edital.get(field), 2) for field in ("id", "title", "sourceUrl")
        ) or not SHA256_RE.fullmatch(str(edital.get("sourceHash", ""))):
            blockers.append(coverage_blocker("BLUEPRINT_EDITAL_INCOMPLETE", scope, "edital exige id, título, URL e hash"))
            continue
        approval = blueprint.get("approval")
        if not isinstance(approval, dict) or approval.get("decision") != "approved" or not nonempty_string(approval.get("reviewerId"), 3) or not valid_iso_datetime(approval.get("reviewedAt")):
            blockers.append(coverage_blocker("BLUEPRINT_APPROVAL_MISSING", scope, "aprovação editorial independente ausente"))
            continue
        if approval.get("reviewerId") == blueprint.get("preparedById"):
            blockers.append(coverage_blocker("BLUEPRINT_SELF_APPROVED", scope, "preparador e fiscal devem ser pessoas/agentes distintos"))
            continue
        subjects = blueprint.get("subjects")
        if not isinstance(subjects, list) or not subjects:
            blockers.append(coverage_blocker("BLUEPRINT_SUBJECTS_MISSING", scope, "blueprint aprovado não possui matérias"))
            continue
        subject_ids: set[str] = set()
        valid_subjects = True
        for subject_index, subject in enumerate(subjects):
            subject_scope = f"{scope}.subjects[{subject_index}]"
            if not isinstance(subject, dict) or not nonempty_string(subject.get("id"), 2) or not nonempty_string(subject.get("name"), 2):
                blockers.append(coverage_blocker("BLUEPRINT_SUBJECT_INVALID", subject_scope, "matéria exige id e nome"))
                valid_subjects = False
                continue
            if subject["id"] in subject_ids:
                blockers.append(coverage_blocker("BLUEPRINT_SUBJECT_DUPLICATE", subject_scope, "id de matéria duplicado"))
                valid_subjects = False
            subject_ids.add(subject["id"])
            subject_target = subject.get("targetEligibleItems")
            if not isinstance(subject_target, int) or isinstance(subject_target, bool) or subject_target < target:
                blockers.append(coverage_blocker("BLUEPRINT_TARGET_TOO_LOW", subject_scope, f"meta deve ser >= {target}"))
                valid_subjects = False
            topics = subject.get("topics")
            if not isinstance(topics, list) or not topics:
                blockers.append(coverage_blocker("BLUEPRINT_TOPICS_MISSING", subject_scope, "matéria exige tópicos e habilidades aprovados"))
                valid_subjects = False
                continue
            topic_ids: set[str] = set()
            for topic in topics:
                if not isinstance(topic, dict) or not nonempty_string(topic.get("id"), 2) or topic.get("id") in topic_ids:
                    blockers.append(coverage_blocker("BLUEPRINT_TOPIC_INVALID", subject_scope, "tópico inválido ou duplicado"))
                    valid_subjects = False
                    continue
                topic_ids.add(topic["id"])
                skills = topic.get("skills")
                if not isinstance(skills, list) or not skills or not all(nonempty_string(skill, 2) for skill in skills) or len(set(skills)) != len(skills):
                    blockers.append(coverage_blocker("BLUEPRINT_SKILLS_INVALID", subject_scope, "tópico exige habilidades únicas"))
                    valid_subjects = False
        if not valid_subjects:
            continue
        active_key = (family_id, track_id)
        if active_key in approved:
            blockers.append(coverage_blocker("MULTIPLE_ACTIVE_BLUEPRINTS", f"{family_id}/{track_id}", "mais de um blueprint aprovado está ativo"))
            continue
        approved[active_key] = blueprint
    return approved


def active_rights_documents(
    registry: Any,
    as_of: date,
    blockers: list[dict[str, str]],
) -> dict[str, dict[str, Any]]:
    if not isinstance(registry, dict) or registry.get("schemaVersion") != "1.0.0":
        raise ValueError("registro de direitos inválido")
    records = registry.get("records")
    if not isinstance(records, list):
        raise ValueError("registro de direitos deve conter a lista records")
    active: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for index, record in enumerate(records):
        scope = f"rights[{index}]"
        if not isinstance(record, dict) or not nonempty_string(record.get("id"), 3):
            blockers.append(coverage_blocker("RIGHTS_RECORD_INVALID", scope, "registro de direitos sem id"))
            continue
        record_id = record["id"]
        if record_id in seen:
            blockers.append(coverage_blocker("RIGHTS_RECORD_DUPLICATE", scope, f"id duplicado: {record_id}"))
            continue
        seen.add(record_id)
        if record.get("status") != "active":
            continue
        if record.get("type") not in {"official_license", "authoring_agreement", "asset_license"}:
            blockers.append(coverage_blocker("RIGHTS_TYPE_INVALID", scope, "tipo de documento inválido"))
            continue
        if not SHA256_RE.fullmatch(str(record.get("instrumentHash", ""))):
            blockers.append(coverage_blocker("RIGHTS_INSTRUMENT_HASH_MISSING", scope, "instrumento exige hash SHA-256"))
            continue
        if not nonempty_string(record.get("holder"), 2):
            blockers.append(coverage_blocker("RIGHTS_HOLDER_MISSING", scope, "titular/cadeia de titularidade ausente"))
            continue
        if not nonempty_string(record.get("preparedById"), 3):
            blockers.append(coverage_blocker("RIGHTS_PREPARER_MISSING", scope, "responsável pelo registro ausente"))
            continue
        territories = record.get("territories")
        platforms = record.get("platforms")
        permissions = record.get("permissions")
        required_permissions = {"commercial", "digital"}
        if record.get("type") in {"official_license", "asset_license"}:
            required_permissions.add("reproduce")
        if (
            not isinstance(territories, list)
            or not all(isinstance(item, str) for item in territories)
            or "BR" not in territories
            or not isinstance(platforms, list)
            or not all(isinstance(item, str) for item in platforms)
            or not {"ios", "android"}.issubset(set(platforms))
            or not isinstance(permissions, list)
            or not all(isinstance(item, str) for item in permissions)
            or not required_permissions.issubset(set(permissions))
        ):
            blockers.append(coverage_blocker("RIGHTS_SCOPE_INSUFFICIENT", scope, "território, plataformas ou permissões insuficientes"))
            continue
        valid_from = record.get("validFrom")
        valid_until = record.get("validUntil")
        if not valid_iso_date(valid_from) or (valid_until is not None and not valid_iso_date(valid_until)):
            blockers.append(coverage_blocker("RIGHTS_DATES_INVALID", scope, "vigência inválida"))
            continue
        if date.fromisoformat(valid_from) > as_of or (valid_until is not None and date.fromisoformat(valid_until) < as_of):
            continue
        approval = record.get("approval")
        if not isinstance(approval, dict) or approval.get("decision") != "approved" or not nonempty_string(approval.get("reviewerId"), 3) or not valid_iso_datetime(approval.get("reviewedAt")):
            blockers.append(coverage_blocker("RIGHTS_APPROVAL_MISSING", scope, "fiscalização independente do instrumento ausente"))
            continue
        if approval.get("reviewerId") == record.get("preparedById"):
            blockers.append(coverage_blocker("RIGHTS_SELF_APPROVED", scope, "preparador e fiscal de direitos devem ser distintos"))
            continue
        active[record_id] = record
    return active


def load_manifest_questions(
    manifest: Any,
    blockers: list[dict[str, str]],
) -> tuple[list[Any], list[dict[str, str]], dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "1.0.0":
        raise ValueError("manifesto de lotes elegíveis inválido")
    policy = manifest.get("semanticDeduplicationPolicy")
    if not isinstance(policy, dict):
        policy = {}
    batches = manifest.get("batches")
    if not isinstance(batches, list):
        raise ValueError("manifesto deve conter a lista batches")
    questions: list[Any] = []
    batch_inputs: list[dict[str, str]] = []
    seen_batch_ids: set[str] = set()
    base = (REPO_ROOT / "content" / "eligible" / "batches").resolve()
    for index, batch in enumerate(batches):
        scope = f"batch[{index}]"
        if not isinstance(batch, dict) or not nonempty_string(batch.get("id"), 3) or not nonempty_string(batch.get("relativePath"), 3) or not isinstance(batch.get("sha256"), str) or not SHA256_RE.fullmatch(batch["sha256"]):
            blockers.append(coverage_blocker("BATCH_MANIFEST_INVALID", scope, "id, caminho ou hash do lote inválido"))
            continue
        if batch["id"] in seen_batch_ids:
            blockers.append(coverage_blocker("BATCH_ID_DUPLICATE", scope, f"id duplicado: {batch['id']}"))
            continue
        seen_batch_ids.add(batch["id"])
        if batch.get("state") != "eligible_candidate":
            blockers.append(coverage_blocker("BATCH_STATE_NOT_ELIGIBLE", scope, "lote não está em eligible_candidate"))
            continue
        batch_path = (base / batch["relativePath"]).resolve()
        try:
            batch_path.relative_to(base)
        except ValueError:
            blockers.append(coverage_blocker("BATCH_PATH_ESCAPE", scope, "caminho sai da raiz de lotes"))
            continue
        if not batch_path.is_file():
            blockers.append(coverage_blocker("BATCH_FILE_MISSING", scope, f"arquivo ausente: {batch['relativePath']}"))
            continue
        actual_hash = sha256_file(batch_path)
        if actual_hash != batch["sha256"]:
            blockers.append(coverage_blocker("BATCH_HASH_MISMATCH", scope, f"hash divergente: {batch['relativePath']}"))
            continue
        loaded = load_questions(batch_path)
        questions.extend(loaded)
        batch_inputs.append({"id": batch["id"], "relativePath": batch["relativePath"], "sha256": actual_hash})
    return questions, sorted(batch_inputs, key=lambda item: item["id"]), policy


def validate_batch(questions: list[Any], known_products: set[str]) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    valid_objects: list[dict[str, Any]] = []
    id_positions: dict[str, int] = {}
    fingerprint_positions: dict[str, int] = {}

    for index, question in enumerate(questions):
        errors.extend(validate_question(question, known_products))
        if not isinstance(question, dict):
            continue
        valid_objects.append(question)
        question_id = str(question.get("id", "<unknown>"))
        if question_id in id_positions:
            errors.append(issue("DUPLICATE_QUESTION_ID", f"id também aparece no índice {id_positions[question_id]}", question_id=question_id, path=f"$[{index}].id"))
        else:
            id_positions[question_id] = index
        fingerprint = question_fingerprint(question)
        if fingerprint in fingerprint_positions:
            previous = fingerprint_positions[fingerprint]
            errors.append(issue("DUPLICATE_CONTENT", f"conteúdo normalizado duplica o índice {previous}", question_id=question_id, path=f"$[{index}]"))
        else:
            fingerprint_positions[fingerprint] = index

    for left, right, similarity in near_duplicate_pairs(valid_objects):
        errors.append(
            issue(
                "NEAR_DUPLICATE_CONTENT",
                f"similaridade de enunciado {similarity:.4f} com {valid_objects[left].get('id', '<unknown>')}",
                question_id=str(valid_objects[right].get("id", "<unknown>")),
                path=f"$[{right}].stem",
            )
        )

    errors.sort(key=lambda item: (item["questionId"], item["code"], item["path"], item["message"]))
    code_counts = Counter(item["code"] for item in errors)
    return {
        "validationVersion": "1.0.0",
        "valid": not errors,
        "questionCount": len(questions),
        "errorCount": len(errors),
        "errorCodeCounts": dict(sorted(code_counts.items())),
        "errors": errors,
    }


def build_coverage_report(
    *,
    catalog_path: Path,
    blueprints_path: Path,
    rights_path: Path,
    batch_manifest_path: Path,
    inventory_path: Path,
    source_root: Path,
    as_of: date,
) -> dict[str, Any]:
    catalog = load_catalog(catalog_path)
    known_products = {family["id"] for family in catalog["families"]}
    blueprint_registry = read_json(blueprints_path)
    rights_registry = read_json(rights_path)
    batch_manifest = read_json(batch_manifest_path)
    checked_inventory = read_json(inventory_path)
    actual_inventory = build_inventory(source_root)
    blockers: list[dict[str, str]] = []

    inventory_verified = checked_inventory == actual_inventory
    if not inventory_verified:
        blockers.append(coverage_blocker("SOURCE_INVENTORY_DRIFT", "inventory", "o inventário versionado diverge dos PDFs/DOCX locais"))

    approved = approved_blueprints(blueprint_registry, catalog, blockers)
    active_rights = active_rights_documents(rights_registry, as_of, blockers)
    questions, batch_inputs, semantic_policy = load_manifest_questions(batch_manifest, blockers)
    current_corpus_snapshot_hash = canonical_json_hash(
        sorted(
            question_fingerprint(question)
            for question in questions
            if isinstance(question, dict)
        )
    )
    if catalog.get("catalogStatus") != "active":
        blockers.append(coverage_blocker("CATALOG_NOT_ACTIVE", "catalog", "catálogo editorial ainda está bloqueado"))
    if not isinstance(blueprint_registry, dict) or blueprint_registry.get("status") != "active":
        blockers.append(coverage_blocker("BLUEPRINT_REGISTRY_NOT_ACTIVE", "blueprints", "registro de blueprints ainda está bloqueado"))
    if not isinstance(rights_registry, dict) or rights_registry.get("status") != "active":
        blockers.append(coverage_blocker("RIGHTS_REGISTRY_NOT_ACTIVE", "rights", "registro de direitos ainda está bloqueado"))
    if not questions:
        blockers.append(coverage_blocker("ELIGIBLE_CORPUS_EMPTY", "corpus", "nenhum lote elegível foi registrado"))
    if not active_rights:
        blockers.append(coverage_blocker("RIGHTS_REGISTRY_EMPTY", "rights", "nenhum instrumento de direitos ativo e aprovado foi registrado"))
    if batch_manifest.get("status") != "active":
        blockers.append(coverage_blocker("BATCH_MANIFEST_NOT_ACTIVE", "corpus", "manifesto de lotes não está ativo"))

    policy_approved = (
        semantic_policy.get("status") == "approved"
        and nonempty_string(semantic_policy.get("methodVersion"), 3)
        and semantic_policy.get("corpusSnapshotHash") == current_corpus_snapshot_hash
        and nonempty_string(semantic_policy.get("preparedById"), 3)
        and isinstance(semantic_policy.get("approval"), dict)
        and semantic_policy["approval"].get("decision") == "approved"
        and nonempty_string(semantic_policy["approval"].get("reviewerId"), 3)
        and semantic_policy["approval"].get("reviewerId") != semantic_policy.get("preparedById")
        and valid_iso_datetime(semantic_policy["approval"].get("reviewedAt"))
    )
    if not policy_approved:
        blockers.append(coverage_blocker("SEMANTIC_DEDUP_POLICY_NOT_APPROVED", "qa", "método, snapshot integral do corpus e fiscalização semântica ainda não foram aprovados"))

    batch_validation = validate_batch(questions, known_products)
    if not batch_validation["valid"]:
        for code, count in batch_validation["errorCodeCounts"].items():
            blockers.append(coverage_blocker("QUESTION_VALIDATION_FAILED", f"questions/{code}", f"{count} ocorrência(s)"))
    invalid_question_ids = {
        error["questionId"]
        for error in batch_validation["errors"]
    }

    inventory_by_path = {
        record["relativePath"]: record
        for record in actual_inventory.get("files", [])
        if isinstance(record, dict) and nonempty_string(record.get("relativePath"))
    }
    blueprint_by_version = {
        (blueprint["id"], blueprint["version"]): blueprint
        for blueprint in approved.values()
    }
    eligible_fingerprints: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    cross_gate_counts: Counter[str] = Counter()

    def reject(code: str) -> None:
        cross_gate_counts[code] += 1

    for question in questions:
        if not isinstance(question, dict):
            reject("QUESTION_NOT_OBJECT")
            continue
        question_id = str(question.get("id", "<unknown>"))
        if question_id in invalid_question_ids or question.get("status") not in ELIGIBLE_STATUSES:
            if question.get("status") not in ELIGIBLE_STATUSES:
                reject("QUESTION_STATUS_NOT_ELIGIBLE")
            continue
        rights_snapshot = question.get("rights")
        if not isinstance(rights_snapshot, dict):
            reject("QUESTION_RIGHTS_INVALID")
            continue
        document_id = (
            rights_snapshot.get("licenseId")
            if question.get("contentType") == "official_licensed"
            else rights_snapshot.get("authoringAgreementId")
        )
        document = active_rights.get(document_id)
        expected_type = "official_license" if question.get("contentType") == "official_licensed" else "authoring_agreement"
        if not document or document.get("type") != expected_type:
            reject("QUESTION_RIGHTS_NOT_IN_ACTIVE_REGISTRY")
            continue
        if set(rights_snapshot.get("territories", [])) - set(document.get("territories", [])) or set(rights_snapshot.get("platforms", [])) - set(document.get("platforms", [])):
            reject("QUESTION_RIGHTS_SCOPE_MISMATCH")
            continue
        if rights_snapshot.get("validFrom") != document.get("validFrom") or rights_snapshot.get("validUntil") != document.get("validUntil"):
            reject("QUESTION_RIGHTS_DATES_MISMATCH")
            continue
        if question.get("contentType") == "official_licensed":
            source = question.get("source")
            location = source.get("location") if isinstance(source, dict) else None
            source_record = inventory_by_path.get(location.get("file")) if isinstance(location, dict) else None
            if not source_record or source_record.get("sha256") != source.get("sourceHash"):
                reject("OFFICIAL_SOURCE_NOT_IN_VERIFIED_INVENTORY")
                continue
            transformation_permission = {
                "verbatim": "reproduce",
                "adapted": "adapt",
                "fragmented": "fragment",
            }.get(source.get("transformation"))
            if not transformation_permission or transformation_permission not in document.get("permissions", []):
                reject("OFFICIAL_TRANSFORMATION_NOT_LICENSED")
                continue
        stimulus = question.get("stimulus")
        assets = stimulus.get("assets", []) if isinstance(stimulus, dict) else []
        asset_rights_valid = True
        for asset in assets:
            asset_document = active_rights.get(asset.get("rightsDocumentId")) if isinstance(asset, dict) else None
            if not asset_document or asset_document.get("type") not in {"asset_license", "authoring_agreement", "official_license"}:
                asset_rights_valid = False
                break
        if not asset_rights_valid:
            reject("ASSET_RIGHTS_NOT_IN_ACTIVE_REGISTRY")
            continue
        semantic = question.get("semanticDeduplication")
        if (
            not policy_approved
            or not isinstance(semantic, dict)
            or semantic.get("methodVersion") != semantic_policy.get("methodVersion")
            or semantic.get("corpusSnapshotHash") != current_corpus_snapshot_hash
        ):
            reject("SEMANTIC_POLICY_MISMATCH")
            continue
        for assignment in question.get("blueprintAssignments", []):
            if not isinstance(assignment, dict):
                reject("BLUEPRINT_ASSIGNMENT_INVALID")
                continue
            blueprint = blueprint_by_version.get((assignment.get("blueprintId"), assignment.get("blueprintVersion")))
            if not blueprint or blueprint.get("familyId") != assignment.get("familyId") or blueprint.get("trackId") != assignment.get("trackId"):
                reject("BLUEPRINT_ASSIGNMENT_NOT_APPROVED")
                continue
            subjects = {
                subject["id"]: subject
                for subject in blueprint["subjects"]
            }
            subject = subjects.get(assignment.get("subjectId"))
            if not subject:
                reject("SUBJECT_NOT_IN_BLUEPRINT")
                continue
            topics = {
                topic["id"]: topic
                for topic in subject["topics"]
            }
            topic = topics.get(assignment.get("topicId"))
            if not topic or assignment.get("skillId") not in topic.get("skills", []):
                reject("TOPIC_OR_SKILL_NOT_IN_BLUEPRINT")
                continue
            key = (assignment["familyId"], assignment["trackId"], assignment["subjectId"])
            eligible_fingerprints[key].add(question_fingerprint(question))

    for code, count in sorted(cross_gate_counts.items()):
        blockers.append(coverage_blocker("ELIGIBILITY_GATE_FAILED", f"eligibility/{code}", f"{count} questão(ões) ou compatibilidade(s)"))

    tracks: list[dict[str, Any]] = []
    target = catalog["contentTargetPerSubject"]
    approved_default_count = 0
    subject_row_count = 0
    for family in sorted(catalog["families"], key=lambda item: item["id"]):
        family_id = family["id"]
        track_id = family["defaultTrack"]["id"]
        blueprint = approved.get((family_id, track_id))
        if not blueprint:
            track_blockers = ["approved_blueprint_missing"]
            blockers.append(coverage_blocker("DEFAULT_TRACK_BLUEPRINT_MISSING", f"{family_id}/{track_id}", "blueprint aprovado ausente"))
            subjects_report: list[dict[str, Any]] = []
            dimensions = None
            blueprint_reference = None
        else:
            approved_default_count += 1
            track_blockers = []
            blueprint_reference = {"id": blueprint["id"], "version": blueprint["version"]}
            dimensions = {
                "cargo": blueprint["cargo"],
                "banca": blueprint["banca"],
                "editalId": blueprint["edital"]["id"],
                "phase": blueprint["phase"],
                "modality": blueprint["modality"],
            }
            subjects_report = []
            for subject in sorted(blueprint["subjects"], key=lambda item: item["id"]):
                subject_row_count += 1
                subject_target = subject["targetEligibleItems"]
                eligible = len(eligible_fingerprints[(family_id, track_id, subject["id"])])
                gap = max(0, subject_target - eligible)
                if gap:
                    track_blockers.append(f"subject_gap:{subject['id']}")
                subjects_report.append(
                    {
                        "subjectId": subject["id"],
                        "subjectName": subject["name"],
                        "targetEligibleItems": subject_target,
                        "eligibleSemanticUniqueItems": eligible,
                        "gap": gap,
                        "status": "ready" if gap == 0 else "blocked",
                    }
                )
        tracks.append(
            {
                "familyId": family_id,
                "familyName": family["name"],
                "trackId": track_id,
                "trackName": family["defaultTrack"]["name"],
                "blueprint": blueprint_reference,
                "dimensions": dimensions,
                "subjects": subjects_report,
                "blockers": sorted(set(track_blockers)),
                "status": "ready" if not track_blockers else "blocked",
            }
        )

    source_folders = set(actual_inventory.get("summary", {}).get("familyFolderCounts", {}))
    alias_to_family = {
        alias: family["id"]
        for family in catalog["families"]
        for alias in family.get("sourceFolderAliases", [])
    }
    unmapped_source_folders = sorted(source_folders - set(alias_to_family), key=str.casefold)
    families_without_local_sources = sorted(
        family["id"]
        for family in catalog["families"]
        if not set(family.get("sourceFolderAliases", [])) & source_folders
    )
    if unmapped_source_folders:
        blockers.append(coverage_blocker("SOURCE_FOLDER_MAPPING_REQUIRED", "inventory", f"pastas sem família canônica: {', '.join(unmapped_source_folders)}"))

    blockers.sort(key=lambda item: (item["scope"], item["code"], item["message"]))
    release_ready = not blockers and all(track["status"] == "ready" for track in tracks)
    input_hashes = {
        "catalog": sha256_file(catalog_path),
        "blueprints": sha256_file(blueprints_path),
        "rightsRegistry": sha256_file(rights_path),
        "batchManifest": sha256_file(batch_manifest_path),
        "sourceInventory": sha256_file(inventory_path),
    }
    return {
        "coverageReportVersion": "1.0.0",
        "asOf": as_of.isoformat(),
        "releaseReady": release_ready,
        "inputFingerprint": canonical_json_hash({"asOf": as_of.isoformat(), **input_hashes}),
        "inputs": {
            "catalog": {"path": report_path(catalog_path), "sha256": input_hashes["catalog"]},
            "blueprints": {"path": report_path(blueprints_path), "sha256": input_hashes["blueprints"]},
            "rightsRegistry": {"path": report_path(rights_path), "sha256": input_hashes["rightsRegistry"]},
            "batchManifest": {"path": report_path(batch_manifest_path), "sha256": input_hashes["batchManifest"]},
            "sourceInventory": {"path": report_path(inventory_path), "sha256": input_hashes["sourceInventory"]},
            "eligibleBatches": batch_inputs,
        },
        "inventory": {
            "verifiedAgainstDisk": inventory_verified,
            "fileCount": actual_inventory["summary"]["fileCount"],
            "extensionCounts": actual_inventory["summary"]["extensionCounts"],
            "distinctHashCount": actual_inventory["summary"]["distinctHashCount"],
            "duplicateHashGroupCount": actual_inventory["summary"]["duplicateHashGroupCount"],
            "unmappedSourceFolders": unmapped_source_folders,
            "familiesWithoutLocalSources": families_without_local_sources,
            "publicationState": "quarantine",
        },
        "corpus": {
            "batchCount": len(batch_inputs),
            "questionCount": len(questions),
            "validationErrorCount": batch_validation["errorCount"],
            "validationErrorCodeCounts": batch_validation["errorCodeCounts"],
            "eligibleAssignmentCount": sum(len(values) for values in eligible_fingerprints.values()),
            "corpusSnapshotHash": current_corpus_snapshot_hash,
            "semanticDeduplicationPolicyStatus": semantic_policy.get("status", "missing"),
        },
        "summary": {
            "familyCount": len(catalog["families"]),
            "approvedDefaultTrackBlueprintCount": approved_default_count,
            "subjectCountFromApprovedBlueprints": subject_row_count,
            "readyTrackCount": sum(1 for track in tracks if track["status"] == "ready"),
            "blockedTrackCount": sum(1 for track in tracks if track["status"] == "blocked"),
            "activeRightsDocumentCount": len(active_rights),
            "blockerCount": len(blockers),
        },
        "blockers": blockers,
        "tracks": tracks,
        "decision": "pass" if release_ready else "blocked",
    }


def command_inventory(args: argparse.Namespace) -> int:
    inventory = build_inventory(args.source.resolve())
    write_json(args.output.resolve(), inventory)
    print(json.dumps(inventory["summary"], ensure_ascii=False, sort_keys=True))
    return 0


def command_quarantine_eear(args: argparse.Namespace) -> int:
    manifest = build_eear_manifest(args.source.resolve())
    write_json(args.output.resolve(), manifest)
    print(json.dumps({"datasetId": manifest["datasetId"], "declaredItemCount": manifest["declaredItemCount"], "publishable": False}, ensure_ascii=False, sort_keys=True))
    return 0


def command_validate(args: argparse.Namespace) -> int:
    questions = load_questions(args.input.resolve())
    known_products = load_known_products(args.catalog.resolve())
    report = validate_batch(questions, known_products)
    if args.report:
        write_json(args.report.resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 1


def command_fingerprint(args: argparse.Namespace) -> int:
    questions = load_questions(args.input.resolve())
    records = []
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            raise ValueError(f"questão no índice {index} não é um objeto")
        records.append({"id": question.get("id", f"index-{index}"), "fingerprint": question_fingerprint(question)})
    print(json.dumps(records, ensure_ascii=False, indent=2))
    return 0


def parse_date_argument(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use uma data ISO no formato YYYY-MM-DD") from exc


def command_coverage(args: argparse.Namespace) -> int:
    report = build_coverage_report(
        catalog_path=args.catalog.resolve(),
        blueprints_path=args.blueprints.resolve(),
        rights_path=args.rights.resolve(),
        batch_manifest_path=args.batches.resolve(),
        inventory_path=args.inventory.resolve(),
        source_root=args.source.resolve(),
        as_of=args.as_of,
    )
    if args.report:
        write_json(args.report.resolve(), report)
    print(
        json.dumps(
            {
                "decision": report["decision"],
                "releaseReady": report["releaseReady"],
                "blockerCount": report["summary"]["blockerCount"],
                "readyTrackCount": report["summary"]["readyTrackCount"],
                "blockedTrackCount": report["summary"]["blockedTrackCount"],
                "report": report_path(args.report) if args.report else None,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0 if report["releaseReady"] else 1


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Pipeline editorial determinístico do IA Aprova")
    commands = root.add_subparsers(dest="command", required=True)

    inventory = commands.add_parser("inventory", help="inventaria e hasheia PDFs/DOCX sem copiá-los")
    inventory.add_argument("--source", type=Path, default=DEFAULT_SOURCE_ROOT)
    inventory.add_argument("--output", type=Path, default=DEFAULT_INVENTORY)
    inventory.set_defaults(handler=command_inventory)

    quarantine = commands.add_parser("quarantine-eear", help="reconstrói o manifesto do lote legado EEAR")
    quarantine.add_argument("--source", type=Path, default=DEFAULT_EEAR_SOURCE)
    quarantine.add_argument("--output", type=Path, default=DEFAULT_EEAR_MANIFEST)
    quarantine.set_defaults(handler=command_quarantine_eear)

    validate = commands.add_parser("validate", help="valida um lote editorial")
    validate.add_argument("--input", type=Path, required=True)
    validate.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    validate.add_argument("--report", type=Path)
    validate.set_defaults(handler=command_validate)

    fingerprint = commands.add_parser("fingerprint", help="calcula fingerprints sem alterar o lote")
    fingerprint.add_argument("--input", type=Path, required=True)
    fingerprint.set_defaults(handler=command_fingerprint)

    coverage = commands.add_parser("coverage", help="comprova cobertura por trilha/matéria e falha se houver qualquer gate aberto")
    coverage.add_argument("--as-of", type=parse_date_argument, required=True, help="data determinística para validar vigência (YYYY-MM-DD)")
    coverage.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    coverage.add_argument("--blueprints", type=Path, default=DEFAULT_BLUEPRINTS)
    coverage.add_argument("--rights", type=Path, default=DEFAULT_RIGHTS_REGISTRY)
    coverage.add_argument("--batches", type=Path, default=DEFAULT_BATCH_MANIFEST)
    coverage.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    coverage.add_argument("--source", type=Path, default=DEFAULT_SOURCE_ROOT)
    coverage.add_argument("--report", type=Path, default=DEFAULT_COVERAGE_REPORT)
    coverage.set_defaults(handler=command_coverage)
    return root


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.handler(args))
    except (OSError, ValueError) as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
