from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import content_pipeline as pipeline  # noqa: E402


KNOWN_PRODUCTS = {"eear"}


def valid_question(question_id: str = "eear.math.000001") -> dict:
    question = {
        "schemaVersion": "2.0.0",
        "id": question_id,
        "authorId": "author-math-01",
        "revision": 1,
        "status": "ready_for_beta",
        "contentType": "original_authoral",
        "productIds": ["eear"],
        "blueprintAssignments": [
            {
                "blueprintId": "eear-cfs-2026-v1",
                "blueprintVersion": "1.0.0",
                "familyId": "eear",
                "trackId": "cfs",
                "subjectId": "matematica",
                "topicId": "geometria-plana",
                "skillId": "resolver-semelhanca-triangulos",
            }
        ],
        "examVersionId": "eear-cfs-2026-v1",
        "subjectId": "matematica",
        "topicId": "geometria-plana",
        "skillId": "resolver-semelhanca-triangulos",
        "stem": "Em dois triângulos semelhantes, qual relação permite calcular o lado desconhecido?",
        "options": [
            {"id": "a", "text": "A proporcionalidade entre os lados correspondentes."},
            {"id": "b", "text": "A soma de todos os ângulos externos."},
            {"id": "c", "text": "O produto entre perímetro e área."},
            {"id": "d", "text": "A diferença entre os lados homólogos."},
        ],
        "correctOptionId": "a",
        "solution": {
            "steps": ["Identifique os lados que ocupam posições correspondentes nos dois triângulos."],
            "finalAnswer": "Triângulos semelhantes têm lados correspondentes proporcionais.",
            "distractorRationales": {
                "b": "Ângulos externos não determinam diretamente o lado solicitado.",
                "c": "Esse produto não é uma propriedade de semelhança de triângulos.",
                "d": "A diferença entre lados homólogos não permanece constante.",
            },
        },
        "stimulus": {"kind": "none", "text": None, "assets": []},
        "difficulty": "medium",
        "source": {
            "kind": "original_authoral",
            "title": "Banco autoral EEAR 2026",
            "owner": "IA Aprova",
            "sourceHash": "1" * 64,
        },
        "rights": {
            "status": "cleared",
            "authoringAgreementId": "agreement-2026-001",
            "territories": ["BR"],
            "platforms": ["ios", "android"],
            "validFrom": "2026-08-21",
            "validUntil": None,
        },
        "reviews": [
            {
                "role": "blind_solver",
                "reviewerId": "reviewer-blind-01",
                "decision": "approved",
                "reviewedAt": "2026-08-21T12:00:00-03:00",
                "selectedOptionId": "a",
            },
            {
                "role": "subject_specialist",
                "reviewerId": "reviewer-subject-01",
                "decision": "approved",
                "reviewedAt": "2026-08-21T13:00:00-03:00",
            },
            {
                "role": "independent_auditor",
                "reviewerId": "reviewer-audit-01",
                "decision": "approved",
                "reviewedAt": "2026-08-21T14:00:00-03:00",
            },
        ],
        "semanticDeduplication": {},
        "fingerprint": {"algorithm": "sha256-normalized-v3", "value": ""},
    }
    fingerprint = pipeline.question_fingerprint(question)
    question["fingerprint"]["value"] = fingerprint
    for review in question["reviews"]:
        review["questionRevision"] = question["revision"]
        review["questionFingerprint"] = fingerprint
    question["semanticDeduplication"] = {
        "reviewerId": "reviewer-audit-01",
        "decision": "no_material_duplicate",
        "reviewedAt": "2026-08-21T14:05:00-03:00",
        "questionRevision": question["revision"],
        "questionFingerprint": fingerprint,
        "corpusSnapshotHash": "2" * 64,
        "methodVersion": "semantic-audit-v1",
        "nearestQuestionId": None,
        "maxSimilarity": 0.12,
    }
    return question


class CatalogAndSchemaTests(unittest.TestCase):
    def test_catalog_has_exactly_nineteen_unique_families(self) -> None:
        catalog = json.loads((REPO_ROOT / "content/catalog/exam-families.json").read_text(encoding="utf-8"))
        ids = [family["id"] for family in catalog["families"]]
        self.assertEqual(19, len(ids))
        self.assertEqual(19, len(set(ids)))
        self.assertIn("eear", ids)
        self.assertNotIn("eaar", ids)
        self.assertTrue(all(family["defaultTrack"]["id"] for family in catalog["families"]))
        self.assertEqual("blocked_missing_approved_blueprints", catalog["catalogStatus"])
        blueprints = json.loads((REPO_ROOT / "content/catalog/blueprints.json").read_text(encoding="utf-8"))
        self.assertEqual([], blueprints["blueprints"])

    def test_question_schema_is_valid_json_and_declares_core_fields(self) -> None:
        schema = json.loads((REPO_ROOT / "content/schemas/question.schema.json").read_text(encoding="utf-8"))
        self.assertEqual("https://json-schema.org/draft/2020-12/schema", schema["$schema"])
        self.assertTrue({"authorId", "rights", "reviews", "fingerprint", "solution"}.issubset(schema["required"]))
        self.assertEqual("sha256-normalized-v3", schema["properties"]["fingerprint"]["properties"]["algorithm"]["const"])
        self.assertTrue({"blueprintAssignments", "stimulus", "semanticDeduplication"}.issubset(schema["required"]))

    def test_all_editorial_registry_schemas_are_checked_in_json(self) -> None:
        for name in (
            "blueprints.schema.json",
            "eligible-batches.schema.json",
            "question.schema.json",
            "rights-registry.schema.json",
        ):
            schema = json.loads((REPO_ROOT / "content/schemas" / name).read_text(encoding="utf-8"))
            self.assertEqual("https://json-schema.org/draft/2020-12/schema", schema["$schema"])
            self.assertFalse(schema.get("additionalProperties", True))


class InventoryTests(unittest.TestCase):
    def test_inventory_is_deterministic_and_ignores_other_extensions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            family = root / "EEAR"
            family.mkdir()
            pdf = family / "Prova B.pdf"
            docx = family / "Prova A.docx"
            ignored = family / "notas.txt"
            pdf.write_bytes(b"pdf-content")
            docx.write_bytes(b"docx-content")
            ignored.write_bytes(b"ignored")

            first = pipeline.build_inventory(root)
            second = pipeline.build_inventory(root)

            self.assertEqual(first, second)
            self.assertEqual(2, first["summary"]["fileCount"])
            self.assertEqual(["EEAR/Prova A.docx", "EEAR/Prova B.pdf"], [item["relativePath"] for item in first["files"]])
            self.assertEqual(hashlib.sha256(b"docx-content").hexdigest(), first["files"][0]["sha256"])
            self.assertTrue(all(item["state"] == "quarantine" for item in first["files"]))
            self.assertEqual(2, first["summary"]["distinctHashCount"])
            self.assertEqual(0, first["summary"]["duplicateHashGroupCount"])
            self.assertRegex(first["inventoryFingerprint"]["value"], r"^[a-f0-9]{64}$")

    def test_inventory_missing_directory_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            missing = Path(temp) / "missing"
            with self.assertRaisesRegex(ValueError, "não encontrado"):
                pipeline.build_inventory(missing)


class QuarantineTests(unittest.TestCase):
    def test_eear_manifest_recomputes_counts_and_never_publishes(self) -> None:
        records = [
            {"id": "eear-1", "year": 2024, "materiaId": "fisica", "origem": "prova_oficial_pdf"},
            {"id": "eear-2", "year": 2024, "materiaId": "fisica", "origem": "prova_oficial_pdf"},
        ]
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "legacy.json"
            source.write_text(json.dumps(records), encoding="utf-8")
            manifest = pipeline.build_eear_manifest(source)

        self.assertEqual(2, manifest["declaredItemCount"])
        self.assertEqual(2, manifest["uniqueIdCount"])
        self.assertEqual({"fisica": 2}, manifest["subjectCounts"])
        self.assertFalse(manifest["publishable"])
        self.assertEqual("quarantine", manifest["state"])
        self.assertIn("commercial_rights_not_cleared", manifest["blockingReasons"])

    def test_checked_in_manifest_matches_legacy_source_hash_and_count(self) -> None:
        source = pipeline.DEFAULT_EEAR_SOURCE
        manifest = json.loads(pipeline.DEFAULT_EEAR_MANIFEST.read_text(encoding="utf-8"))
        self.assertTrue(source.is_file())
        self.assertEqual(pipeline.sha256_file(source), manifest["sourceSha256"])
        self.assertEqual(554, manifest["declaredItemCount"])
        self.assertFalse(manifest["publishable"])

    def test_eear_manifest_counts_malformed_records_without_crashing(self) -> None:
        records = [
            {"id": "eear-1", "year": 2024, "materiaId": "fisica", "origem": "prova_oficial_pdf"},
            {"year": 2024, "materiaId": None, "origem": "prova_oficial_pdf"},
            "registro-invalido",
        ]
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "legacy.json"
            source.write_text(json.dumps(records), encoding="utf-8")
            manifest = pipeline.build_eear_manifest(source)

        self.assertEqual(3, manifest["declaredItemCount"])
        self.assertEqual(1, manifest["uniqueIdCount"])
        self.assertEqual(2, manifest["invalidRecordCount"])
        self.assertEqual({"fisica": 1}, manifest["subjectCounts"])


class FingerprintTests(unittest.TestCase):
    def test_fingerprint_normalizes_case_spacing_and_option_order(self) -> None:
        question = valid_question()
        changed = copy.deepcopy(question)
        changed["stem"] = "  EM DOIS TRIÂNGULOS   SEMELHANTES, qual relação permite calcular o lado desconhecido?  "
        changed["options"].reverse()
        self.assertEqual(pipeline.question_fingerprint(question), pipeline.question_fingerprint(changed))

    def test_near_duplicate_detection(self) -> None:
        first = valid_question("eear.math.000001")
        second = valid_question("eear.math.000002")
        second["stem"] = first["stem"] + " Agora."
        second["fingerprint"]["value"] = pipeline.question_fingerprint(second)
        matches = pipeline.near_duplicate_pairs([first, second], threshold=0.7)
        self.assertEqual(1, len(matches))

    def test_near_duplicate_with_one_word_substitution_is_detected(self) -> None:
        first = valid_question("eear.math.000001")
        second = valid_question("eear.math.000002")
        second["stem"] = first["stem"].replace("calcular", "determinar")
        second["fingerprint"]["value"] = pipeline.question_fingerprint(second)
        report = pipeline.validate_batch([first, second], KNOWN_PRODUCTS)
        self.assertIn("NEAR_DUPLICATE_CONTENT", report["errorCodeCounts"])


class ValidationTests(unittest.TestCase):
    def error_codes(self, question: dict) -> set[str]:
        return {item["code"] for item in pipeline.validate_question(question, KNOWN_PRODUCTS)}

    def test_complete_authoral_question_passes(self) -> None:
        self.assertEqual([], pipeline.validate_question(valid_question(), KNOWN_PRODUCTS))
        report = pipeline.validate_batch([valid_question()], KNOWN_PRODUCTS)
        self.assertTrue(report["valid"])
        self.assertEqual(0, report["errorCount"])

    def test_answer_must_reference_existing_unique_option(self) -> None:
        question = valid_question()
        question["correctOptionId"] = "e"
        question["options"][1]["text"] = question["options"][0]["text"].upper()
        question["fingerprint"]["value"] = pipeline.question_fingerprint(question)
        codes = self.error_codes(question)
        self.assertIn("INVALID_ANSWER", codes)
        self.assertIn("DUPLICATE_OPTION_TEXT", codes)

    def test_every_distractor_requires_one_explanation(self) -> None:
        question = valid_question()
        del question["solution"]["distractorRationales"]["d"]
        self.assertIn("RATIONALE_COVERAGE", self.error_codes(question))

    def test_official_question_requires_license_and_source_page(self) -> None:
        question = valid_question()
        question["contentType"] = "official_licensed"
        question["source"]["kind"] = "official_exam"
        del question["rights"]["authoringAgreementId"]
        question["fingerprint"]["value"] = pipeline.question_fingerprint(question)
        codes = self.error_codes(question)
        self.assertIn("RIGHTS_DOCUMENT_REQUIRED", codes)
        self.assertIn("OFFICIAL_LOCATION_REQUIRED", codes)

    def test_reviews_must_be_independent_and_complete(self) -> None:
        question = valid_question()
        question["reviews"][2]["reviewerId"] = question["reviews"][1]["reviewerId"]
        question["reviews"] = [review for review in question["reviews"] if review["role"] != "blind_solver"]
        codes = self.error_codes(question)
        self.assertIn("MISSING_REVIEW_ROLES", codes)
        self.assertIn("REVIEWER_NOT_INDEPENDENT", codes)

    def test_author_cannot_review_their_own_question(self) -> None:
        question = valid_question()
        question["authorId"] = question["reviews"][0]["reviewerId"]
        self.assertIn("AUTHOR_REVIEWER_NOT_INDEPENDENT", self.error_codes(question))

    def test_divergence_requires_adjudication(self) -> None:
        question = valid_question()
        question["reviews"][0]["selectedOptionId"] = "b"
        self.assertIn("ADJUDICATION_REQUIRED", self.error_codes(question))

        question["reviews"].append(
            {
                "role": "adjudicator",
                "reviewerId": "reviewer-adjudicator-01",
                "decision": "approved",
                "reviewedAt": "2026-08-21T15:00:00-03:00",
            }
        )
        self.assertNotIn("ADJUDICATION_REQUIRED", self.error_codes(question))

    def test_fingerprint_mismatch_is_rejected(self) -> None:
        question = valid_question()
        question["stem"] += " Texto alterado depois da revisão."
        self.assertIn("FINGERPRINT_MISMATCH", self.error_codes(question))

    def test_fingerprint_covers_answer_solution_and_classification(self) -> None:
        for mutate in (
            lambda question: question.update(correctOptionId="b"),
            lambda question: question["solution"].update(finalAnswer="Uma conclusão materialmente diferente da original."),
            lambda question: question.update(topicId="razoes-e-proporcoes"),
        ):
            question = valid_question()
            original = question["fingerprint"]["value"]
            mutate(question)
            self.assertNotEqual(original, pipeline.question_fingerprint(question))
            self.assertIn("FINGERPRINT_MISMATCH", self.error_codes(question))

    def test_reviews_and_semantic_audit_are_bound_to_current_revision_and_fingerprint(self) -> None:
        question = valid_question()
        question["reviews"][0]["questionRevision"] = 999
        question["semanticDeduplication"]["questionFingerprint"] = "0" * 64
        codes = self.error_codes(question)
        self.assertIn("REVIEW_REVISION_MISMATCH", codes)
        self.assertIn("SEMANTIC_FINGERPRINT_MISMATCH", codes)

    def test_semantic_deduplication_cannot_be_omitted_or_self_declared_by_author(self) -> None:
        question = valid_question()
        question["semanticDeduplication"] = None
        self.assertIn("SEMANTIC_DEDUP_REQUIRED", self.error_codes(question))

        question = valid_question()
        question["semanticDeduplication"]["reviewerId"] = question["authorId"]
        self.assertIn("SEMANTIC_REVIEWER_NOT_AUDITOR", self.error_codes(question))

    def test_visual_stimulus_requires_hash_rights_and_accessibility(self) -> None:
        question = valid_question()
        question["stimulus"] = {
            "kind": "table",
            "text": None,
            "assets": [
                {
                    "id": "asset-table-01",
                    "kind": "table",
                    "sha256": "3" * 64,
                    "mimeType": "image/png",
                    "rightsDocumentId": "asset-license-01",
                    "altText": "curto",
                    "longDescription": None,
                }
            ],
        }
        question["fingerprint"]["value"] = pipeline.question_fingerprint(question)
        codes = self.error_codes(question)
        self.assertIn("ASSET_ALT_TEXT_REQUIRED", codes)
        self.assertIn("ASSET_LONG_DESCRIPTION_REQUIRED", codes)

    def test_rights_validity_range_cannot_be_reversed(self) -> None:
        question = valid_question()
        question["rights"]["validUntil"] = "2026-01-01"
        question["fingerprint"]["value"] = pipeline.question_fingerprint(question)
        self.assertIn("RIGHTS_INVALID_RANGE", self.error_codes(question))

    def test_batch_rejects_duplicate_id_and_content(self) -> None:
        first = valid_question()
        second = copy.deepcopy(first)
        report = pipeline.validate_batch([first, second], KNOWN_PRODUCTS)
        codes = {item["code"] for item in report["errors"]}
        self.assertFalse(report["valid"])
        self.assertIn("DUPLICATE_QUESTION_ID", codes)
        self.assertIn("DUPLICATE_CONTENT", codes)

    def test_unknown_product_is_rejected(self) -> None:
        question = valid_question()
        question["productIds"] = ["produto-inexistente"]
        question["fingerprint"]["value"] = pipeline.question_fingerprint(question)
        self.assertIn("UNKNOWN_PRODUCT", self.error_codes(question))

    def test_catalog_loader_rejects_more_than_nineteen_entries_with_duplicate_id(self) -> None:
        catalog = json.loads((REPO_ROOT / "content/catalog/exam-families.json").read_text(encoding="utf-8"))
        catalog["families"].append(copy.deepcopy(catalog["families"][0]))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "catalog.json"
            path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exatamente 19"):
                pipeline.load_known_products(path)

    def test_malformed_container_types_fail_closed_without_crashing(self) -> None:
        mutations = (
            lambda question: question.update(productIds=None),
            lambda question: question.update(options=None),
            lambda question: question["rights"].update(platforms=[["ios"], "android"]),
        )
        for mutate in mutations:
            question = valid_question()
            mutate(question)
            errors = pipeline.validate_question(question, KNOWN_PRODUCTS)
            self.assertTrue(errors)


class CoverageGateTests(unittest.TestCase):
    def test_checked_in_coverage_report_is_deterministic_and_blocked(self) -> None:
        generated = pipeline.build_coverage_report(
            catalog_path=pipeline.DEFAULT_CATALOG,
            blueprints_path=pipeline.DEFAULT_BLUEPRINTS,
            rights_path=pipeline.DEFAULT_RIGHTS_REGISTRY,
            batch_manifest_path=pipeline.DEFAULT_BATCH_MANIFEST,
            inventory_path=pipeline.DEFAULT_INVENTORY,
            source_root=pipeline.DEFAULT_SOURCE_ROOT,
            as_of=pipeline.date.fromisoformat("2026-08-23"),
        )
        checked_in = json.loads((REPO_ROOT / "content/reports/coverage-gaps.json").read_text(encoding="utf-8"))
        self.assertEqual(checked_in, generated)
        self.assertFalse(generated["releaseReady"])
        self.assertEqual("blocked", generated["decision"])
        self.assertEqual(19, generated["summary"]["blockedTrackCount"])
        self.assertEqual(0, generated["summary"]["subjectCountFromApprovedBlueprints"])
        self.assertEqual(0, generated["corpus"]["questionCount"])
        self.assertTrue(generated["inventory"]["verifiedAgainstDisk"])
        self.assertEqual(156, generated["inventory"]["fileCount"])

    def test_quarantine_and_legacy_sources_are_never_auto_discovered_as_eligible(self) -> None:
        manifest = json.loads(pipeline.DEFAULT_BATCH_MANIFEST.read_text(encoding="utf-8"))
        blockers: list[dict[str, str]] = []
        questions, batches, _policy = pipeline.load_manifest_questions(manifest, blockers)
        self.assertEqual([], blockers)
        self.assertEqual([], questions)
        self.assertEqual([], batches)
        self.assertTrue(pipeline.DEFAULT_EEAR_SOURCE.is_file())
        self.assertEqual(554, json.loads(pipeline.DEFAULT_EEAR_MANIFEST.read_text(encoding="utf-8"))["declaredItemCount"])

    def test_batch_manifest_rejects_path_escape(self) -> None:
        manifest = {
            "schemaVersion": "1.0.0",
            "status": "active",
            "semanticDeduplicationPolicy": {},
            "batches": [
                {
                    "id": "escape-batch",
                    "relativePath": "../../quarantine/eear-554.manifest.json",
                    "sha256": "1" * 64,
                    "state": "eligible_candidate",
                }
            ],
        }
        blockers: list[dict[str, str]] = []
        questions, batches, _policy = pipeline.load_manifest_questions(manifest, blockers)
        self.assertEqual([], questions)
        self.assertEqual([], batches)
        self.assertIn("BATCH_PATH_ESCAPE", {item["code"] for item in blockers})

    def test_blueprint_cannot_pass_without_dimensions_taxonomy_target_and_independent_review(self) -> None:
        catalog = pipeline.load_catalog(pipeline.DEFAULT_CATALOG)
        blueprint = {
            "id": "eear-cfs-2026-v1",
            "version": "1.0.0",
            "status": "approved",
            "familyId": "eear",
            "trackId": "cfs",
            "cargo": "CFS",
            "banca": "órgão responsável",
            "edital": {"id": "edital-2026", "title": "Edital", "sourceUrl": "https://example.invalid/edital", "sourceHash": "4" * 64},
            "phase": "prova-escrita",
            "modality": "geral",
            "preparedById": "blueprint-author-01",
            "sourceDocumentHash": "5" * 64,
            "subjects": [{"id": "matematica", "name": "Matemática", "targetEligibleItems": 999, "topics": []}],
            "approval": {"reviewerId": "blueprint-author-01", "decision": "approved", "reviewedAt": "2026-08-23T12:00:00-03:00"},
        }
        blockers: list[dict[str, str]] = []
        approved = pipeline.approved_blueprints({"schemaVersion": "1.0.0", "blueprints": [blueprint]}, catalog, blockers)
        self.assertEqual({}, approved)
        codes = {item["code"] for item in blockers}
        self.assertIn("BLUEPRINT_SELF_APPROVED", codes)

    def test_rights_registry_requires_scope_hash_vigency_and_independent_approval(self) -> None:
        registry = {
            "schemaVersion": "1.0.0",
            "records": [
                {
                    "id": "license-01",
                    "type": "official_license",
                    "status": "active",
                    "instrumentHash": "6" * 64,
                    "holder": "Titular",
                    "preparedById": "rights-analyst-01",
                    "territories": ["BR"],
                    "platforms": ["ios", "android"],
                    "permissions": ["commercial", "digital", "reproduce"],
                    "validFrom": "2026-01-01",
                    "validUntil": "2026-12-31",
                    "approval": {"reviewerId": "rights-auditor-01", "decision": "approved", "reviewedAt": "2026-01-01T12:00:00-03:00"},
                }
            ],
        }
        blockers: list[dict[str, str]] = []
        active = pipeline.active_rights_documents(registry, pipeline.date.fromisoformat("2026-08-23"), blockers)
        self.assertEqual([], blockers)
        self.assertIn("license-01", active)
        expired = pipeline.active_rights_documents(registry, pipeline.date.fromisoformat("2027-01-01"), [])
        self.assertNotIn("license-01", expired)

    def test_malformed_rights_scope_fails_closed_without_type_error(self) -> None:
        registry = {
            "schemaVersion": "1.0.0",
            "records": [
                {
                    "id": "license-bad",
                    "type": "official_license",
                    "status": "active",
                    "instrumentHash": "7" * 64,
                    "holder": "Titular",
                    "preparedById": "rights-analyst-01",
                    "territories": ["BR", ["invalid"]],
                    "platforms": ["ios", "android"],
                    "permissions": ["commercial", "digital", "reproduce"],
                    "validFrom": "2026-01-01",
                    "validUntil": None,
                    "approval": {"reviewerId": "rights-auditor-01", "decision": "approved", "reviewedAt": "2026-01-01T12:00:00-03:00"},
                }
            ],
        }
        blockers: list[dict[str, str]] = []
        active = pipeline.active_rights_documents(registry, pipeline.date.fromisoformat("2026-08-23"), blockers)
        self.assertEqual({}, active)
        self.assertIn("RIGHTS_SCOPE_INSUFFICIENT", {item["code"] for item in blockers})


if __name__ == "__main__":
    unittest.main()
