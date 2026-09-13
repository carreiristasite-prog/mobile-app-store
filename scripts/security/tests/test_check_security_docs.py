from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CHECKER_PATH = REPOSITORY_ROOT / "scripts" / "security" / "check_security_docs.py"
SPEC = importlib.util.spec_from_file_location("check_security_docs", CHECKER_PATH)
assert SPEC and SPEC.loader
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class SecurityDocumentationCheckerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(REPOSITORY_ROOT / "docs" / "security", self.root / "docs" / "security")
        shutil.copytree(REPOSITORY_ROOT / "docs" / "compliance", self.root / "docs" / "compliance")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def read_json(self, relative: str) -> dict:
        return json.loads((self.root / relative).read_text(encoding="utf-8"))

    def write_json(self, relative: str, value: object) -> None:
        (self.root / relative).write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def assert_has_error(self, fragment: str) -> None:
        errors = CHECKER.validate_package(self.root)
        self.assertTrue(any(fragment in error for error in errors), errors)

    def test_current_package_is_structurally_valid_but_not_release_approved(self) -> None:
        self.assertEqual(CHECKER.validate_package(self.root), [])

    def test_gate_map_cannot_claim_to_close_a_blocker(self) -> None:
        path = "docs/security/release-security-gates.json"
        document = self.read_json(path)
        document["blockerMappings"][0]["closesBlocker"] = True
        self.write_json(path, document)
        self.assert_has_error("must not close blockers")

    def test_duplicate_canonical_id_fails_with_nineteen_records(self) -> None:
        path = "docs/compliance/release-blockers.json"
        document = self.read_json(path)
        document["blockers"][-1]["id"] = document["blockers"][0]["id"]
        self.write_json(path, document)
        self.assert_has_error("duplicate IDs in canonical blockers")

    def test_risk_id_in_prose_does_not_count_as_registered(self) -> None:
        path = self.root / "docs" / "security" / "risk-register.pt-BR.md"
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace("| R-025 |", "| X-025 |") + "\nR-025 em prosa.\n", encoding="utf-8")
        self.assert_has_error("unknown risks ['R-025']")

    def test_flow_id_in_prose_does_not_count_as_structured(self) -> None:
        path = self.root / "docs" / "security" / "threat-model.pt-BR.md"
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace("| F14 |", "| X14 |") + "\nF14 em prosa.\n", encoding="utf-8")
        self.assert_has_error("structured rows F01-F14 exactly")

    def test_all_six_stride_categories_must_be_expanded(self) -> None:
        path = self.root / "docs" / "security" / "threat-model.pt-BR.md"
        text = path.read_text(encoding="utf-8").replace("Elevation of Privilege", "elevacao")
        path.write_text(text, encoding="utf-8")
        self.assert_has_error("missing expanded STRIDE terms")

    def test_malformed_mapping_shape_fails_without_false_pass(self) -> None:
        path = "docs/security/release-security-gates.json"
        document = self.read_json(path)
        document["blockerMappings"] = {}
        self.write_json(path, document)
        self.assert_has_error("security blocker mappings must be a JSON array")


if __name__ == "__main__":
    unittest.main()
