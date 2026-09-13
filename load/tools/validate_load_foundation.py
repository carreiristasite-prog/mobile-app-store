#!/usr/bin/env python3
"""Offline, fail-closed validation for the IA Aprova k6 foundation."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


EXPECTED_PROFILES = {
    "rps_300_1h": {
        "executor": "constant-arrival-rate",
        "rate": 300,
        "timeUnit": "1s",
        "duration": "1h",
        "preAllocatedVUs": 600,
        "maxVUs": 2400,
    },
    "rps_600_15m": {
        "executor": "constant-arrival-rate",
        "rate": 600,
        "timeUnit": "1s",
        "duration": "15m",
        "preAllocatedVUs": 1200,
        "maxVUs": 4800,
    },
    "rps_1000_60s": {
        "executor": "constant-arrival-rate",
        "rate": 1000,
        "timeUnit": "1s",
        "duration": "60s",
        "preAllocatedVUs": 2000,
        "maxVUs": 8000,
    },
    "sessions_5000": {
        "executor": "per-vu-iterations",
        "vus": 5000,
        "iterations": 1,
        "maxDuration": "30m",
    },
}

REQUIRED_FILES = (
    "README.md",
    "RULES_OF_ENGAGEMENT.md",
    "profiles.json",
    "dataset.example.json",
    "authorization.example.json",
    "k6/main.js",
    "k6/lib/guardrails.js",
    "k6/lib/observability.js",
    "results/.gitignore",
)

SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("OpenAI-style secret", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("JWT-like token", re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
)


def load_text(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        errors.append(f"cannot read {path.name}: {exc}")
        return ""


def require_markers(text: str, filename: str, markers: tuple[str, ...], errors: list[str]) -> None:
    for marker in markers:
        if marker not in text:
            errors.append(f"{filename} is missing required marker: {marker}")


def without_js_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"(^|\s)//.*$", r"\1", text, flags=re.MULTILINE)


def validate_workflow(path: Path, errors: list[str]) -> None:
    if not path.is_file():
        errors.append("missing static-only workflow: .github/workflows/load-static-validation.yml")
        return
    workflow = load_text(path, errors)
    if ("pull_request_target:" in workflow or "runs-on: self-hosted" in workflow or
            re.search(r"\b(?:secrets|environment|env|shell|container|services)\s*:", workflow)):
        errors.append("load static workflow may not use privileged triggers, environments, custom shells, containers, self-hosted runners or secrets")
    if not re.search(r"(?m)^permissions:\s*\n\s+contents:\s*read\s*$", workflow):
        errors.append("load static workflow must retain contents-read-only permissions")
    uses = re.findall(r"^\s*-\s*uses:\s*(\S+)\s*$", workflow, flags=re.MULTILINE)
    if uses != ["actions/checkout@v4", "actions/setup-python@v5"]:
        errors.append("load static workflow may only use pinned checkout and setup-python actions")
    runs = re.findall(r"^\s*run:\s*(.+?)\s*$", workflow, flags=re.MULTILINE)
    expected_runs = [
        "python load/tools/validate_load_foundation.py --json",
        'python -m unittest discover -s load/tests -p "test_*.py" -v',
    ]
    if runs != expected_runs:
        errors.append("load static workflow run steps drifted or could execute traffic")
    if re.search(r"\b(?:k6|curl|wget|Invoke-WebRequest|Invoke-RestMethod|nc|ncat|telnet)\b", workflow, re.IGNORECASE):
        errors.append("load static workflow contains a traffic-capable command")


def validate(root: Path, workflow_path: Path | None = None) -> list[str]:
    errors: list[str] = []
    for relative in REQUIRED_FILES:
        if not (root / relative).is_file():
            errors.append(f"missing required file: {relative}")
    if errors:
        return errors

    try:
        profiles = json.loads((root / "profiles.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"profiles.json is invalid: {exc}")
        profiles = None
    if profiles != EXPECTED_PROFILES:
        errors.append("profiles.json drifted from the four approved exact profiles")

    try:
        sample = json.loads((root / "dataset.example.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"dataset.example.json is invalid: {exc}")
        sample = {}
    if sample.get("synthetic") is not True or sample.get("environment") != "staging":
        errors.append("dataset example must be explicitly synthetic and staging-only")
    users = sample.get("users")
    if not isinstance(users, list) or len(users) != 1:
        errors.append("dataset example must contain exactly one non-runnable sample user")
    else:
        token = users[0].get("accessToken", "") if isinstance(users[0], dict) else ""
        if "INJECT" not in token or len(token) > 80:
            errors.append("dataset example must contain only the explicit runtime injection placeholder")
        if not isinstance(users[0], dict) or set(users[0]) != {"alias", "accessToken", "tokenExpiresAt", "productId", "examVersionId", "mode"}:
            errors.append("dataset example user must use the closed synthetic schema")

    try:
        approval = json.loads((root / "authorization.example.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"authorization.example.json is invalid: {exc}")
        approval = {}
    if approval.get("environment") != "staging" or not str(approval.get("expiresAt", "")).startswith("2000-"):
        errors.append("authorization example must be staging-only and deliberately expired")

    main = load_text(root / "k6/main.js", errors)
    guardrails = load_text(root / "k6/lib/guardrails.js", errors)
    observability = load_text(root / "k6/lib/observability.js", errors)
    readme = load_text(root / "README.md", errors)
    roe = load_text(root / "RULES_OF_ENGAGEMENT.md", errors)
    main_code = without_js_comments(main)
    guardrails_code = without_js_comments(guardrails)
    observability_code = without_js_comments(observability)

    require_markers(
        main_code,
        "k6/main.js",
        (
            'http_req_duration: ["p(95)<=300", "p(99)<=800"]',
            'http_req_failed: ["rate<0.005"]',
            'functional_errors: ["rate<0.005"]',
            'dropped_iterations: ["count==0"]',
            'systemTags: ["status", "method", "name", "scenario", "expected_response"]',
            '"/api/healthz"',
            '"/api/v1/catalog/active"',
            '"/api/v1/learning/sessions/:sessionId/attempts"',
            '"Idempotency-Key": idempotencyKey',
            'JSON.stringify(replayBody) === JSON.stringify(firstBody)',
            "safeSummary(data, runtime)",
            "SUMMARY_PATH must be a JSON file directly inside load/results",
        ),
        errors,
    )
    require_markers(
        guardrails_code,
        "k6/lib/guardrails.js",
        (
            'RUN_AUTHORIZED',
            'ALLOW_MUTATIONS',
            'MUTATION_SCOPE',
            'seeded-learning-idempotency',
            'SYNTHETIC_DATASET_SHA256',
            'crypto.sha256',
            'STAGING_HOST_ALLOWLIST',
            'parsed.protocol !== "https:"',
            'parsed.port !== "443"',
            '.replace(/\\.+$/, "")',
            '/(^|[.-])(prod|production)([.-]|$)/',
            'iaaprova.com.br',
            'production hostname is permanently blocked',
            'AUTHORIZATION_MANIFEST_SHA256',
            'authorization scope does not match this run',
            'profiles.json does not match the approved exact profiles',
            'dataset.users.length !== 5000',
            'synthetic access tokens must be unique',
            'a synthetic token outlives the approved authorization window',
        ),
        errors,
    )
    require_markers(
        observability_code,
        "k6/lib/observability.js",
        ("testRunId", "thresholdsPassed", "completionPassed", "requiredMetricsPresent", "evidencePassed",
         "iterationCount === runtime.expectedIterations", "httpRequests === runtime.expectedHttpRequests",
         "evidencePassed = thresholdsPassed && completionPassed && requiredMetricsPresent",
         "expectedIterations", "expectedHttpRequests", "durationP95Ms", "durationP99Ms", "functionalErrorRate"),
        errors,
    )
    require_markers(
        readme + "\n" + roe,
        "documentation",
        (
            "NO-GO",
            "10.000 WebSockets",
            "não executar carga em pull request",
            "RUN_AUTHORIZED=true",
            "SYNTHETIC_DATASET_SHA256",
            "AUTHORIZATION_MANIFEST_SHA256",
            "R$",
        ),
        errors,
    )

    methods = re.findall(r"\bhttp\.(\w+)\s*\(", main_code)
    if sorted(methods) != ["get", "get", "get", "post", "post", "post"]:
        errors.append("k6 HTTP call set drifted from three approved GETs and three approved POSTs")
    if len(re.findall(r"\bhttp\b", main_code)) != 8 or "http[" in main_code:
        errors.append("k6/main.js may not alias or dynamically access the HTTP client")
    import_sources = re.findall(r'^import\s+.*?\s+from\s+["\']([^"\']+)["\'];?$', main_code, flags=re.MULTILINE)
    if import_sources != ["k6/http", "k6", "k6/execution", "./lib/guardrails.js", "./lib/observability.js"]:
        errors.append("k6/main.js imports drifted from the offline-reviewed allowlist")
    if re.findall(r'^import\s+.*?\s+from\s+["\']([^"\']+)["\'];?$', guardrails_code, flags=re.MULTILINE) != ["k6/crypto"]:
        errors.append("guardrails imports drifted from the offline-reviewed allowlist")
    if re.findall(r'^import\s+.*?\s+from\s+["\']([^"\']+)["\'];?$', observability_code, flags=re.MULTILINE) != ["k6/metrics"]:
        errors.append("observability imports drifted from the offline-reviewed allowlist")
    if re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket)\b", main_code):
        errors.append("an unapproved network API exists in k6/main.js")

    combined_js = main_code + "\n" + guardrails_code + "\n" + observability_code
    if re.search(r"\bws\s*\.\s*connect\s*\(", combined_js):
        errors.append("WebSocket execution code is forbidden while realtime has no real endpoint")
    if re.search(r"https?://(?:www\.)?iaaprova\.com\.br", combined_js, flags=re.IGNORECASE):
        errors.append("a production IA Aprova URL is embedded in executable load code")
    if "console.log" in combined_js or "console.info" in combined_js:
        errors.append("executable load code must not log runtime values")

    for path in root.rglob("*"):
        if (
            not path.is_file()
            or "__pycache__" in path.parts
            or path.suffix in {".pyc", ".pyo"}
            or path.parts[-2:] == ("results", ".gitignore")
        ):
            continue
        text = load_text(path, errors)
        for label, pattern in SECRET_PATTERNS:
            if pattern.search(text):
                errors.append(f"possible {label} found in {path.relative_to(root).as_posix()}")

    validate_workflow((workflow_path or (root.parent / ".github" / "workflows" / "load-static-validation.yml")).resolve(), errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workflow", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    errors = validate(args.root.resolve(), args.workflow.resolve() if args.workflow else None)
    report = {"ok": not errors, "networkExecuted": False, "errors": errors}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif errors:
        print("Load foundation validation: FAIL")
        for error in errors:
            print(f"- {error}")
    else:
        print("Load foundation validation: PASS (static only; no network executed)")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
