from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


LOAD_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = LOAD_ROOT / "tools" / "validate_load_foundation.py"


class LoadFoundationValidatorTests(unittest.TestCase):
    def run_validator(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR), "--root", str(root), "--json"],
            check=False,
            capture_output=True,
            text=True,
        )

    def copy_fixture(self, destination: Path) -> Path:
        fixture = destination / "load"
        shutil.copytree(LOAD_ROOT, fixture, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        workflow_source = LOAD_ROOT.parent / ".github" / "workflows" / "load-static-validation.yml"
        workflow_destination = destination / ".github" / "workflows" / "load-static-validation.yml"
        workflow_destination.parent.mkdir(parents=True)
        shutil.copy2(workflow_source, workflow_destination)
        return fixture

    def test_current_foundation_passes_without_network(self) -> None:
        result = self.run_validator(LOAD_ROOT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertFalse(report["networkExecuted"])

    def test_profile_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            profiles_path = fixture / "profiles.json"
            profiles = json.loads(profiles_path.read_text(encoding="utf-8"))
            profiles["rps_1000_60s"]["rate"] = 999
            profiles_path.write_text(json.dumps(profiles), encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("exact profiles", result.stdout)

    def test_websocket_execution_code_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            main_path = fixture / "k6" / "main.js"
            main_path.write_text(main_path.read_text(encoding="utf-8") + "\nws.connect('wss://staging.invalid');\n", encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("WebSocket execution code is forbidden", result.stdout)

    def test_embedded_jwt_like_secret_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            readme_path = fixture / "README.md"
            fake = "eyJ" + "A" * 24 + "." + "B" * 12 + "." + "C" * 12
            readme_path.write_text(readme_path.read_text(encoding="utf-8") + fake, encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("JWT-like token", result.stdout)

    def test_extra_http_call_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            main_path = fixture / "k6" / "main.js"
            main_path.write_text(main_path.read_text(encoding="utf-8") + "\nhttp.get(runtime.baseUrl + '/api/v1/admin');\n", encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("HTTP call set drifted", result.stdout)

    def test_workflow_traffic_command_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            workflow = Path(temporary) / ".github" / "workflows" / "load-static-validation.yml"
            workflow.write_text(workflow.read_text(encoding="utf-8") + "\n      - run: k6 run load/k6/main.js\n", encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("traffic-capable command", result.stdout)

    def test_threshold_decoy_in_comment_does_not_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            main_path = fixture / "k6" / "main.js"
            text = main_path.read_text(encoding="utf-8").replace(
                'http_req_failed: ["rate<0.005"]',
                'http_req_failed: ["rate<0.05"], // http_req_failed: ["rate<0.005"]',
            )
            main_path.write_text(text, encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing required marker", result.stdout)

    def test_incomplete_run_summary_cannot_be_relaxed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            summary_path = fixture / "k6" / "lib" / "observability.js"
            text = summary_path.read_text(encoding="utf-8").replace(
                "iterationCount === runtime.expectedIterations",
                "iterationCount <= runtime.expectedIterations // iterationCount === runtime.expectedIterations",
            )
            summary_path.write_text(text, encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing required marker", result.stdout)

    def test_custom_workflow_shell_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = self.copy_fixture(Path(temporary))
            workflow = Path(temporary) / ".github" / "workflows" / "load-static-validation.yml"
            workflow.write_text(workflow.read_text(encoding="utf-8") + "\n      shell: custom {0}\n", encoding="utf-8")
            result = self.run_validator(fixture)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("custom shells", result.stdout)


if __name__ == "__main__":
    unittest.main()
