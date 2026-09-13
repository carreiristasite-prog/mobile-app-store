"""Fail-closed, read-only checks for the IA Aprova security package."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_DOCS = {
    "README.md", "threat-model.pt-BR.md", "risk-register.pt-BR.md",
    "security-test-plan.pt-BR.md", "pentest-fraud-scope.pt-BR.md",
    "pre-release-checklist.pt-BR.md", "incident-response-handoff.pt-BR.md",
    "release-security-gates.json",
}
EXPECTED_BLOCKERS = {
    "LEGAL-001", "LEGAL-002", "LEGAL-003", "PRIV-001", "PRIV-002",
    "VEND-001", "MINOR-001", "DSR-001", "BILL-001", "STORE-001",
    "STORE-002", "SEC-001", "INC-001", "RIGHTS-001", "CONTENT-001",
    "CONSENT-001", "SITE-001", "SITE-002", "VEND-002",
}
EXPECTED_FLOWS = {f"F{number:02d}" for number in range(1, 15)}
STRIDE_TERMS = {
    "Spoofing", "Tampering", "Repudiation", "Information Disclosure",
    "Denial of Service", "Elevation of Privilege",
}
REQUIRED_SURFACES = {
    "mobile", "clerk", "api", "worker", "postgresql", "redis",
    "revenuecat", "social", "realtime", "admin", "cloud storage",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON {path}: {exc}") from exc


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc


def table_ids(text: str, pattern: str) -> list[str]:
    return re.findall(rf"^\|\s*({pattern})\s*\|", text, flags=re.MULTILINE)


def index_records(records: object, label: str, errors: list[str]) -> tuple[dict[str, dict[str, Any]], int]:
    if not isinstance(records, list):
        errors.append(f"{label} must be a JSON array")
        return {}, 0
    indexed: dict[str, dict[str, Any]] = {}
    duplicates: set[str] = set()
    for position, item in enumerate(records):
        if not isinstance(item, dict):
            errors.append(f"{label}[{position}] must be an object")
            continue
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            errors.append(f"{label}[{position}] has no valid id")
            continue
        if item_id in indexed:
            duplicates.add(item_id)
        indexed[item_id] = item
    if duplicates:
        errors.append(f"duplicate IDs in {label}: {sorted(duplicates)}")
    return indexed, len(records)


def validate_risks(text: str, errors: list[str]) -> set[str]:
    risk_ids = table_ids(text, r"R-\d{3}")
    registered = set(risk_ids)
    if not registered:
        errors.append("risk register has no structured risk rows")
    if len(registered) != len(risk_ids):
        errors.append("duplicate risk rows in risk register")
    thresholds = ((20, "crítico"), (12, "alto"), (6, "médio"), (1, "baixo"))
    for line in text.splitlines():
        if not re.match(r"^\|\s*R-\d{3}\s*\|", line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        risk_id = cells[0] if cells else "unknown"
        if len(cells) < 9:
            errors.append(f"{risk_id}: malformed risk row")
            continue
        stride = {code.strip() for code in cells[2].split("/") if code.strip()}
        if not stride or not stride <= set("STRIDE"):
            errors.append(f"{risk_id}: invalid STRIDE code set")
        try:
            impact, probability = int(cells[3]), int(cells[4])
        except ValueError:
            errors.append(f"{risk_id}: impact/probability must be integers")
            continue
        score_match = re.fullmatch(r"(\d+)\s+(crítico|alto|médio|baixo)", cells[5], re.I)
        if impact not in range(1, 6) or probability not in range(1, 6):
            errors.append(f"{risk_id}: impact/probability must be between 1 and 5")
        if not score_match:
            errors.append(f"{risk_id}: invalid score/severity cell")
            continue
        calculated = impact * probability
        expected_label = next(label for minimum, label in thresholds if calculated >= minimum)
        if int(score_match.group(1)) != calculated or score_match.group(2).lower() != expected_label:
            errors.append(f"{risk_id}: score/severity must be {calculated} {expected_label}")
    return registered


def validate_package(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    root = root.resolve()
    security_dir = root / "docs" / "security"
    try:
        present = {path.name for path in security_dir.iterdir() if path.is_file()}
    except OSError as exc:
        return [f"cannot inspect security directory: {exc}"]
    errors.extend(
        f"missing required security artifact: docs/security/{name}"
        for name in sorted(REQUIRED_DOCS - present)
    )
    if errors:
        return errors

    try:
        blocker_document = load_json(root / "docs" / "compliance" / "release-blockers.json")
        gate_document = load_json(security_dir / "release-security-gates.json")
    except ValueError as exc:
        return [str(exc)]
    if not isinstance(blocker_document, dict):
        errors.append("canonical blocker document must be a JSON object")
        blocker_document = {}
    if not isinstance(gate_document, dict):
        errors.append("security gate map must be a JSON object")
        gate_document = {}
    canonical, canonical_count = index_records(blocker_document.get("blockers"), "canonical blockers", errors)
    mapped, mapping_count = index_records(gate_document.get("blockerMappings"), "security blocker mappings", errors)
    if canonical_count != 19 or set(canonical) != EXPECTED_BLOCKERS:
        errors.append("canonical blocker inventory must contain the 19 expected IDs exactly")
    if mapping_count != 19 or set(mapped) != EXPECTED_BLOCKERS:
        errors.append("security gate map must contain the 19 expected IDs exactly")
    if set(mapped) != set(canonical):
        errors.append("security gate map must match canonical blocker IDs exactly")
    if gate_document.get("releaseDecision") != "blocked":
        errors.append("security package releaseDecision must remain 'blocked'")
    if "does not close" not in str(gate_document.get("disclaimer", "")).lower():
        errors.append("security gate map must explicitly disclaim closing blockers")

    try:
        risk_text = read_text(security_dir / "risk-register.pt-BR.md")
    except ValueError as exc:
        errors.append(str(exc))
        risk_text = ""
    registered_risks = validate_risks(risk_text, errors)
    for blocker_id, mapping in mapped.items():
        if mapping.get("closesBlocker") is not False:
            errors.append(f"{blocker_id}: security package must not close blockers")
        canonical_owner = canonical.get(blocker_id, {}).get("owner")
        if not isinstance(canonical_owner, str) or not canonical_owner:
            errors.append(f"{blocker_id}: canonical blocker has no valid owner")
        elif mapping.get("owner") != canonical_owner:
            errors.append(f"{blocker_id}: owner differs from canonical release blocker")
        if not str(mapping.get("securityContribution", "")).strip():
            errors.append(f"{blocker_id}: missing security contribution")
        risk_ids = mapping.get("riskIds")
        if not isinstance(risk_ids, list) or not risk_ids:
            errors.append(f"{blocker_id}: missing risk mapping")
        elif any(not isinstance(risk_id, str) for risk_id in risk_ids):
            errors.append(f"{blocker_id}: risk mapping contains a non-string ID")
        else:
            if len(risk_ids) != len(set(risk_ids)):
                errors.append(f"{blocker_id}: duplicate risk IDs in mapping")
            unknown = sorted(set(risk_ids) - registered_risks)
            if unknown:
                errors.append(f"{blocker_id}: unknown risks {unknown}")

    for markdown in security_dir.glob("*.md"):
        try:
            text = read_text(markdown)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        for raw in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
            target_text = raw.strip().split("#", 1)[0]
            if not target_text or re.match(r"^[a-z][a-z0-9+.-]*:", target_text, re.I):
                continue
            target = (markdown.parent / target_text).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                errors.append(f"internal link escapes repository in {markdown.relative_to(root)}")
                continue
            if not target.exists():
                errors.append(f"broken internal link in {markdown.relative_to(root)}: {target}")

    try:
        threat_text = read_text(security_dir / "threat-model.pt-BR.md")
        test_plan = read_text(security_dir / "security-test-plan.pt-BR.md")
        roe = read_text(security_dir / "pentest-fraud-scope.pt-BR.md")
        incident = read_text(security_dir / "incident-response-handoff.pt-BR.md")
    except ValueError as exc:
        errors.append(str(exc))
        threat_text = test_plan = roe = incident = ""
    flows = table_ids(threat_text, r"F\d{2}")
    if len(flows) != len(set(flows)):
        errors.append("duplicate data-flow rows in threat model")
    if set(flows) != EXPECTED_FLOWS:
        errors.append("threat model must contain structured rows F01-F14 exactly")
    normalized_threat = " ".join(threat_text.split())
    missing_stride = sorted(term for term in STRIDE_TERMS if term not in normalized_threat)
    if missing_stride:
        errors.append(f"threat model missing expanded STRIDE terms: {missing_stride}")
    if "trust boundaries" not in threat_text.lower():
        errors.append("threat model missing trust-boundary declaration")
    for boundary in ("TB-1", "TB-2", "TB-3", "TB-4", "TB-5"):
        if boundary not in threat_text:
            errors.append(f"threat model missing trust boundary {boundary}")
    missing_surfaces = sorted(surface for surface in REQUIRED_SURFACES if surface not in threat_text.lower())
    if missing_surfaces:
        errors.append(f"threat model missing required surfaces: {missing_surfaces}")
    normalized_plan = " ".join(test_plan.split()).lower()
    normalized_roe = " ".join(roe.split()).lower()
    normalized_incident = " ".join(incident.split()).lower()
    for marker in ("MASVS", "ASVS", "somente staging isolado", "Nenhum comando deste documento autoriza teste"):
        if marker.lower() not in normalized_plan:
            errors.append(f"security test plan missing safety/framework marker: {marker}")
    for marker in ("modelo, não autorização", "todo teste dinâmico está proibido", "produção", "sintétic", "ordem assinada"):
        if marker.lower() not in normalized_roe:
            errors.append(f"pentest/fraud ROE missing fail-safe marker: {marker}")
    if "../compliance/incident-response-anpd.pt-BR.md" not in incident:
        errors.append("incident handoff must link to the canonical ANPD runbook")
    if "não altera o prazo" not in normalized_incident:
        errors.append("incident handoff must not redefine the regulatory deadline")
    return errors


def main() -> int:
    errors = validate_package()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"Security documentation check failed with {len(errors)} finding(s).")
        return 1
    risk_text = read_text(ROOT / "docs" / "security" / "risk-register.pt-BR.md")
    gates = load_json(ROOT / "docs" / "security" / "release-security-gates.json")
    print(
        f"Security documentation structure valid: {len(REQUIRED_DOCS)} artifacts, "
        f"{len(set(table_ids(risk_text, r'R-\d{3}')))} structured risks, "
        f"{len(gates['blockerMappings'])} canonical blocker mappings; "
        "security package remains blocked and closes none."
    )
    print("No network request, pentest, fraud attempt or release approval was performed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
