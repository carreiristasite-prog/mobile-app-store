#!/usr/bin/env python3
"""Fail-closed static release audit for the IA Aprova mobile product.

This audit is intentionally stricter than normal CI. It does not prove that a
binary is safe to publish; it prevents a release candidate from being called
ready while known, machine-detectable blockers are still present.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable


MINIMUM_EXPO = (57, 0, 9)
MINIMUM_REACT = (19, 2, 0)
MINIMUM_REACT_NATIVE = (0, 86, 2)
EXPECTED_APPLICATION_ID = "br.com.iaaprova.app"


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    path: str


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _semver(value: object) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def _dependency(package: dict[str, Any], name: str, catalog: dict[str, str] | None = None) -> object:
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        values = package.get(section)
        if isinstance(values, dict) and name in values:
            value = values[name]
            if value == "catalog:" and catalog:
                return catalog.get(name, value)
            return value
    return None


def _load_workspace_catalog(path: Path) -> dict[str, str]:
    """Load the flat pnpm catalog without adding a YAML runtime dependency."""
    try:
        source = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    catalog: dict[str, str] = {}
    in_catalog = False
    for line in source.splitlines():
        if line.rstrip() == "catalog:":
            in_catalog = True
            continue
        if in_catalog and line and not line.startswith("  "):
            break
        if not in_catalog or not line.startswith("  ") or line.lstrip().startswith("#"):
            continue
        match = re.match(r"\s{2}(['\"]?)([^'\"]+?)\1:\s+(['\"]?)([^'\"]+)\3\s*$", line)
        if match:
            catalog[match.group(2).strip()] = match.group(4).strip()
    return catalog


def _is_alpha_png(path: Path) -> bool:
    """Read the PNG IHDR without image libraries; color types 4 and 6 have alpha."""
    try:
        with path.open("rb") as handle:
            if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                return False
            length = struct.unpack(">I", handle.read(4))[0]
            if handle.read(4) != b"IHDR" or length != 13:
                return False
            ihdr = handle.read(13)
            return ihdr[9] in (4, 6)
    except (OSError, EOFError, struct.error):
        return False


def _relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _add_version_finding(
    findings: list[Finding],
    package_path: Path,
    package: dict[str, Any],
    dependency: str,
    minimum: tuple[int, int, int],
    code: str,
    catalog: dict[str, str] | None = None,
) -> None:
    value = _dependency(package, dependency, catalog)
    parsed = _semver(value)
    if parsed is None or parsed < minimum:
        minimum_label = ".".join(str(part) for part in minimum)
        findings.append(Finding(
            code,
            f"{dependency} must be at least {minimum_label}; found {value!r}",
            package_path.as_posix(),
        ))


def _iter_route_files(app_dir: Path) -> Iterable[Path]:
    for suffix in ("*.ts", "*.tsx", "*.js", "*.jsx"):
        yield from app_dir.rglob(suffix)


def audit_workspace(root: Path) -> list[Finding]:
    root = root.resolve()
    findings: list[Finding] = []
    mobile_dir = root / "artifacts" / "ia-aprova"
    package_path = mobile_dir / "package.json"
    app_config_path = mobile_dir / "app.json"

    try:
        package = _load_json(package_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return [Finding("MOBILE_PACKAGE_INVALID", str(error), _relative(root, package_path))]

    package_display = _relative(root, package_path)
    catalog = _load_workspace_catalog(root / "pnpm-workspace.yaml")
    _add_version_finding(findings, Path(package_display), package, "expo", MINIMUM_EXPO, "EXPO_VERSION_BLOCKED", catalog)
    _add_version_finding(findings, Path(package_display), package, "react", MINIMUM_REACT, "REACT_VERSION_BLOCKED", catalog)
    _add_version_finding(
        findings,
        Path(package_display),
        package,
        "react-native",
        MINIMUM_REACT_NATIVE,
        "REACT_NATIVE_VERSION_BLOCKED",
        catalog,
    )

    required_native_dependencies = {
        "@clerk/expo": "CLERK_NATIVE_MISSING",
        "expo-apple-authentication": "APPLE_SIGN_IN_NATIVE_MISSING",
        "expo-dev-client": "DEVELOPMENT_CLIENT_MISSING",
        "react-native-purchases": "REVENUECAT_NATIVE_MISSING",
    }
    for name, code in required_native_dependencies.items():
        if _dependency(package, name, catalog) is None:
            findings.append(Finding(code, f"required native dependency {name} is not installed", package_display))

    try:
        app_config = _load_json(app_config_path).get("expo")
        if not isinstance(app_config, dict):
            raise ValueError("app.json must contain an expo object")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        findings.append(Finding("APP_CONFIG_INVALID", str(error), _relative(root, app_config_path)))
        app_config = {}

    app_display = _relative(root, app_config_path)
    ios = app_config.get("ios") if isinstance(app_config.get("ios"), dict) else {}
    android = app_config.get("android") if isinstance(app_config.get("android"), dict) else {}
    if ios.get("bundleIdentifier") != EXPECTED_APPLICATION_ID:
        findings.append(Finding("IOS_ID_INVALID", "iOS bundleIdentifier is not the approved application ID", app_display))
    if android.get("package") != EXPECTED_APPLICATION_ID:
        findings.append(Finding("ANDROID_ID_INVALID", "Android package is not the approved application ID", app_display))
    if ios.get("usesAppleSignIn") is not True:
        findings.append(Finding("APPLE_CAPABILITY_MISSING", "usesAppleSignIn must be true", app_display))

    plugins = app_config.get("plugins") if isinstance(app_config.get("plugins"), list) else []
    plugin_names = {
        item if isinstance(item, str) else item[0]
        for item in plugins
        if isinstance(item, str) or (isinstance(item, list) and item and isinstance(item[0], str))
    }
    for plugin in ("@clerk/expo", "expo-apple-authentication"):
        if plugin not in plugin_names:
            findings.append(Finding("APP_PLUGIN_MISSING", f"required config plugin {plugin} is missing", app_display))

    adaptive = android.get("adaptiveIcon") if isinstance(android.get("adaptiveIcon"), dict) else None
    if not adaptive:
        findings.append(Finding("ADAPTIVE_ICON_MISSING", "Android adaptiveIcon is not configured", app_display))
    else:
        foreground = adaptive.get("foregroundImage")
        foreground_path = mobile_dir / str(foreground).removeprefix("./") if isinstance(foreground, str) else None
        if not foreground_path or not foreground_path.is_file():
            findings.append(Finding("ADAPTIVE_ICON_FILE_MISSING", "adaptive icon foreground file is missing", app_display))
        elif not _is_alpha_png(foreground_path):
            findings.append(Finding(
                "ADAPTIVE_ICON_NO_ALPHA",
                "adaptive icon foreground must be a PNG with an alpha channel",
                _relative(root, foreground_path),
            ))

    billing_dir = mobile_dir / "src" / "services" / "billing"
    billing_source = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in billing_dir.rglob("*.ts*")
    ) if billing_dir.is_dir() else ""
    required_billing_markers = ("react-native-purchases", "Purchases.configure", "restorePurchases")
    for marker in required_billing_markers:
        if marker not in billing_source:
            findings.append(Finding(
                "BILLING_ADAPTER_INCOMPLETE",
                f"native billing adapter does not contain {marker}",
                _relative(root, billing_dir),
            ))
    if re.search(r"nativePurchasesAvailable\s*=\s*false", billing_source):
        findings.append(Finding(
            "BILLING_DISABLED",
            "native purchases are explicitly disabled",
            _relative(root, billing_dir),
        ))

    forbidden_route_patterns = {
        "MOCK_ROUTE_IMPORT": re.compile(r"constants/mockData|\bMOCK_[A-Z0-9_]+\b"),
        "FAKE_DUEL_ROUTE": re.compile(r"\bBOT_ACCURACY\b|\bbotCorrect\b"),
        "GENERATIVE_AI_CLAIM": re.compile(r"AproBot IA|gerad[oa] por IA", re.IGNORECASE),
        "IMPLICIT_CONSENT_COPY": re.compile(r"ao continuar.{0,80}concord", re.IGNORECASE | re.DOTALL),
        "BUNDLED_CONSENT_COPY": re.compile(
            r"aceit(?:ar|o).{0,100}termos.{0,40}(?:e|&)\s+(?:a\s+)?pol[ií]tica\s+de\s+privacidade",
            re.IGNORECASE | re.DOTALL,
        ),
    }
    app_dir = mobile_dir / "app"
    if app_dir.is_dir():
        for route in sorted(_iter_route_files(app_dir)):
            source = route.read_text(encoding="utf-8", errors="replace")
            for code, pattern in forbidden_route_patterns.items():
                if pattern.search(source):
                    findings.append(Finding(
                        code,
                        "a public Expo Router module still contains prototype/mock behavior",
                        _relative(root, route),
                    ))

    blockers_path = root / "docs" / "compliance" / "release-blockers.json"
    try:
        blockers_document = _load_json(blockers_path)
        blockers = blockers_document.get("blockers")
        if not isinstance(blockers, list):
            raise ValueError("release-blockers.json must contain a blockers array")
        for blocker in blockers:
            if isinstance(blocker, dict) and str(blocker.get("status", "open")).lower() not in {"closed", "resolved"}:
                blocker_id = str(blocker.get("id", "unknown"))
                findings.append(Finding(
                    "COMPLIANCE_BLOCKER_OPEN",
                    f"compliance release blocker {blocker_id} is still open",
                    _relative(root, blockers_path),
                ))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        findings.append(Finding("COMPLIANCE_MANIFEST_INVALID", str(error), _relative(root, blockers_path)))

    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit fail-closed release prerequisites")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    findings = audit_workspace(args.root)
    if args.as_json:
        print(json.dumps({"ready": not findings, "findings": [asdict(item) for item in findings]}, ensure_ascii=False, indent=2))
    elif findings:
        print(f"RELEASE BLOCKED: {len(findings)} finding(s)")
        for finding in findings:
            print(f"- [{finding.code}] {finding.path}: {finding.message}")
    else:
        print("STATIC RELEASE GATE PASSED")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
