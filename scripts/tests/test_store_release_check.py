import json
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.store_release_check import (
    ROOT,
    _evidence_shape_checks,
    _feature_claim_checks,
    _flatten_unready,
    _store_asset_checks,
    alpha_bbox,
    png_info,
    run_checks,
)


class StoreReleaseCheckTests(unittest.TestCase):
    def test_current_package_fails_closed_for_known_external_gates(self) -> None:
        findings = run_checks(ROOT)
        codes = {finding.code for finding in findings}
        self.assertIn("STORE_PACKAGE_BLOCKED", codes)
        self.assertIn("EAS_IDENTITY_MISSING", codes)
        self.assertIn("RELEASE_EVIDENCE_INCOMPLETE", codes)
        self.assertIn("COMPLIANCE_RELEASE_BLOCKERS", codes)

    def test_native_icon_assets_are_structurally_valid_and_safe(self) -> None:
        app = json.loads((ROOT / "artifacts/ia-aprova/app.json").read_text(encoding="utf-8"))["expo"]
        base = ROOT / "artifacts/ia-aprova"
        icon = png_info(base / app["icon"])
        self.assertEqual(icon["width"], icon["height"])
        self.assertGreaterEqual(icon["width"], 1024)
        self.assertIn(icon["colorType"], {0, 2})
        for key in ("foregroundImage", "monochromeImage"):
            info = png_info(base / app["android"]["adaptiveIcon"][key], decode=True)
            bbox = alpha_bbox(info)
            self.assertIsNotNone(bbox)
            assert bbox is not None
            self.assertGreaterEqual(bbox[0], int(info["width"] * 0.17))
            self.assertGreaterEqual(bbox[1], int(info["height"] * 0.17))
            self.assertLessEqual(bbox[2], int(info["width"] * 0.83) + 1)
            self.assertLessEqual(bbox[3], int(info["height"] * 0.83) + 1)

    def test_google_store_assets_match_their_fail_closed_manifest(self) -> None:
        evidence = json.loads((ROOT / "docs/store-release/release-evidence.json").read_text(encoding="utf-8"))
        self.assertEqual(_store_asset_checks(ROOT, evidence), [])

        tampered = json.loads(json.dumps(evidence))
        tampered["assets"]["googleFeatureGraphic"] = "../outside.png"
        codes = {finding.code for finding in _store_asset_checks(ROOT, tampered)}
        self.assertIn("GOOGLE_STORE_ASSET_PATH", codes)

        tampered = json.loads(json.dumps(evidence))
        tampered["assets"]["googleFeatureGraphic"] = "docs/store-release/assets/../assets/google-play-feature-graphic-v3.png"
        codes = {finding.code for finding in _store_asset_checks(ROOT, tampered)}
        self.assertIn("GOOGLE_STORE_ASSET_PATH", codes)

        manifest_path = ROOT / "docs/store-release/assets/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        duplicate = json.loads(json.dumps(manifest))
        duplicate["assets"].append(json.loads(json.dumps(duplicate["assets"][0])))
        with patch("scripts.store_release_check._json", return_value=duplicate):
            codes = {finding.code for finding in _store_asset_checks(ROOT, evidence)}
            self.assertIn("GOOGLE_STORE_ASSET_MANIFEST_DUPLICATE", codes)

        approvals_missing = json.loads(json.dumps(manifest))
        approvals_missing["approvals"] = {}
        with patch("scripts.store_release_check._json", return_value=approvals_missing):
            codes = {finding.code for finding in _store_asset_checks(ROOT, evidence)}
            self.assertIn("GOOGLE_STORE_ASSET_APPROVAL_INVALID", codes)

        approvals_promoted = json.loads(json.dumps(manifest))
        approvals_promoted["approvals"]["visual"] = True
        with patch("scripts.store_release_check._json", return_value=approvals_promoted):
            codes = {finding.code for finding in _store_asset_checks(ROOT, evidence)}
            self.assertIn("GOOGLE_STORE_ASSET_APPROVAL_INVALID", codes)

        manifest_path = (ROOT / "docs/store-release/assets/manifest.json").resolve()
        original_is_symlink = Path.is_symlink
        with patch.object(
            Path,
            "is_symlink",
            autospec=True,
            side_effect=lambda candidate: candidate.resolve() == manifest_path
            or original_is_symlink(candidate),
        ):
            codes = {finding.code for finding in _store_asset_checks(ROOT, evidence)}
            self.assertIn("GOOGLE_STORE_ASSET_MANIFEST_PATH", codes)

    def test_release_evidence_starts_incomplete(self) -> None:
        evidence = json.loads((ROOT / "docs/store-release/release-evidence.json").read_text(encoding="utf-8"))
        missing = _flatten_unready(evidence)
        self.assertGreater(len(missing), 20)
        self.assertIn("candidate.iosIpaSha256", missing)
        self.assertIn("billing.appleSandboxPassed", missing)
        self.assertIn("approvals.independentStoreReviewer", missing)

    def test_metadata_character_limits(self) -> None:
        text = (ROOT / "docs/store-release/metadata-pt-BR.md").read_text(encoding="utf-8")
        expected = {
            "Nome": 30,
            "Subtítulo": 30,
            "Nome do app": 30,
            "Descrição curta": 80,
        }
        for label, limit in expected.items():
            marker = f"- {label}: `"
            line = next(item for item in text.splitlines() if item.startswith(marker))
            value = line[len(marker) : -1]
            self.assertLessEqual(len(value), limit, f"{label}: {len(value)}")

    def test_placeholder_and_malformed_evidence_are_rejected(self) -> None:
        evidence = {
            "candidate": {
                "sourceCommit": "replace_me",
                "builtAt": "2026-08-23",
                "iosIpaSha256": "not-a-hash",
            },
            "ownership": {"easProjectId": "your-id", "appleTeamId": "SHORT"},
            "reviewAccess": {
                "appleReviewerAdultEmail": "invalid",
                "appleReviewerAdultPasswordSecretRef": "plaintext-password",
                "reviewContactPhone": "11999999999",
            },
            "approvals": {"product": "approved"},
        }
        codes = {finding.code for finding in _evidence_shape_checks(evidence)}
        self.assertIn("RELEASE_EVIDENCE_PLACEHOLDER", codes)
        self.assertIn("RELEASE_EVIDENCE_FORMAT", codes)
        self.assertIn("REVIEW_SECRET_REFERENCE", codes)
        self.assertIn("APPROVAL_EVIDENCE_INVALID", codes)

    def test_unverified_social_and_simulation_claims_are_rejected(self) -> None:
        evidence = {"productFeatures": {"socialEndToEndPassed": False, "simulationRulesEndToEndPassed": False}}
        metadata = """# Listagem\nAmizades, ranking e duelos.\nSimulados com tempo e pontuação conforme o edital.\n## Nota de controle de alegações\n"""
        codes = {finding.code for finding in _feature_claim_checks(metadata, evidence)}
        self.assertIn("UNVERIFIED_SOCIAL_CLAIM", codes)
        self.assertIn("UNVERIFIED_SIMULATION_CLAIM", codes)


if __name__ == "__main__":
    unittest.main()
