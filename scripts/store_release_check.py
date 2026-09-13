#!/usr/bin/env python3
"""Fail-closed audit for the IA Aprova Apple/Google release package."""

from __future__ import annotations

import binascii
import hashlib
import json
import re
import struct
import sys
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "store-release"
APP_DIR = ROOT / "artifacts" / "ia-aprova"


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    path: str


def _json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _flatten_unready(value: Any, prefix: str = "") -> list[str]:
    result: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            result.extend(_flatten_unready(child, child_prefix))
    elif value is None or value is False or value == [] or value == "":
        result.append(prefix)
    return result


_PLACEHOLDER = re.compile(
    r"(?:\{\{[^}]+\}\}|\b(?:replace[_-]?me|example\.com|todo|tbd|preencher|pendente|your[_-](?:id|team|app))\b)",
    re.IGNORECASE,
)


def _walk_strings(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            result.extend(_walk_strings(child, child_prefix))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            result.extend(_walk_strings(child, f"{prefix}[{index}]"))
    elif isinstance(value, str):
        result.append((prefix, value))
    return result


def _is_rfc3339(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _evidence_shape_checks(evidence: dict[str, Any], path: str = "docs/store-release/release-evidence.json") -> list[Finding]:
    findings: list[Finding] = []
    placeholder_paths = [key for key, value in _walk_strings(evidence) if _PLACEHOLDER.search(value)]
    if placeholder_paths:
        findings.append(Finding(
            "RELEASE_EVIDENCE_PLACEHOLDER",
            f"placeholder values are not evidence: {', '.join(placeholder_paths[:8])}",
            path,
        ))

    candidate = evidence.get("candidate", {})
    formats = {
        "sourceCommit": r"(?:[0-9a-f]{40}|[0-9a-f]{64})",
        "iosIpaSha256": r"[0-9a-f]{64}",
        "androidAabSha256": r"[0-9a-f]{64}",
        "sbomSha256": r"[0-9a-f]{64}",
    }
    for key, pattern in formats.items():
        value = candidate.get(key)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(pattern, value, re.IGNORECASE)):
            findings.append(Finding("RELEASE_EVIDENCE_FORMAT", f"candidate.{key} has an invalid format", path))
    built_at = candidate.get("builtAt")
    if built_at is not None and (not isinstance(built_at, str) or not _is_rfc3339(built_at)):
        findings.append(Finding("RELEASE_EVIDENCE_FORMAT", "candidate.builtAt must be RFC 3339 with timezone", path))

    ownership = evidence.get("ownership", {})
    identity_formats = {
        "easProjectId": r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        "appleTeamId": r"[A-Z0-9]{10}",
        "appleAppStoreConnectId": r"[0-9]{8,12}",
    }
    for key, pattern in identity_formats.items():
        value = ownership.get(key)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(pattern, value, re.IGNORECASE)):
            findings.append(Finding("RELEASE_EVIDENCE_FORMAT", f"ownership.{key} has an invalid format", path))

    review = evidence.get("reviewAccess", {})
    for key in ("appleReviewerAdultEmail", "googleReviewerAdultEmail", "reviewContactEmail"):
        value = review.get(key)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)):
            findings.append(Finding("RELEASE_EVIDENCE_FORMAT", f"reviewAccess.{key} is not an email", path))
    for key in ("appleReviewerAdultPasswordSecretRef", "googleReviewerAdultPasswordSecretRef"):
        value = review.get(key)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"(?:secret|gcp-sm|vault)://[^\s]+", value)):
            findings.append(Finding("REVIEW_SECRET_REFERENCE", f"reviewAccess.{key} must be a secret reference, never a password", path))
    phone = review.get("reviewContactPhone")
    if phone is not None and (not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone)):
        findings.append(Finding("RELEASE_EVIDENCE_FORMAT", "reviewAccess.reviewContactPhone must be E.164", path))

    approvals = evidence.get("approvals", {})
    for key, value in approvals.items() if isinstance(approvals, dict) else []:
        if value is None:
            continue
        if not isinstance(value, dict):
            findings.append(Finding("APPROVAL_EVIDENCE_INVALID", f"approvals.{key} must be a structured review record", path))
            continue
        reviewer = value.get("reviewer")
        reviewed_at = value.get("reviewedAt")
        artifact_hash = value.get("artifactSha256")
        if not isinstance(reviewer, str) or len(reviewer.strip()) < 3:
            findings.append(Finding("APPROVAL_EVIDENCE_INVALID", f"approvals.{key}.reviewer is missing", path))
        if not isinstance(reviewed_at, str) or not _is_rfc3339(reviewed_at):
            findings.append(Finding("APPROVAL_EVIDENCE_INVALID", f"approvals.{key}.reviewedAt must be RFC 3339", path))
        if not isinstance(artifact_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", artifact_hash, re.IGNORECASE):
            findings.append(Finding("APPROVAL_EVIDENCE_INVALID", f"approvals.{key}.artifactSha256 is invalid", path))
    return findings


def _feature_claim_checks(metadata: str, evidence: dict[str, Any], path: str = "docs/store-release/metadata-pt-BR.md") -> list[Finding]:
    findings: list[Finding] = []
    public_listing = metadata.split("## Nota de controle de alegações", maxsplit=1)[0].lower()
    product = evidence.get("productFeatures", {})
    if product.get("socialEndToEndPassed") is not True and re.search(r"\b(?:amizades?|ranking|duelos?)\b", public_listing):
        findings.append(Finding("UNVERIFIED_SOCIAL_CLAIM", "store listing advertises social features without approved E2E evidence", path))
    if product.get("simulationRulesEndToEndPassed") is not True and re.search(r"simulad[^\n.]{0,80}(?:regras?|tempo|pontuação)[^\n.]{0,80}(?:edital|prova)", public_listing):
        findings.append(Finding("UNVERIFIED_SIMULATION_CLAIM", "store listing advertises unverified simulation rules", path))
    return findings


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def png_info(path: Path, decode: bool = False) -> dict[str, Any]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    position = 8
    idat: list[bytes] = []
    header: tuple[int, int, int, int, int, int, int] | None = None
    while position < len(data):
        if position + 12 > len(data):
            raise ValueError("truncated PNG chunk")
        length = struct.unpack(">I", data[position : position + 4])[0]
        chunk_type = data[position + 4 : position + 8]
        chunk_data = data[position + 8 : position + 8 + length]
        expected_crc = struct.unpack(">I", data[position + 8 + length : position + 12 + length])[0]
        actual_crc = binascii.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ValueError(f"CRC mismatch in {chunk_type!r}")
        position += length + 12
        if chunk_type == b"IHDR":
            header = struct.unpack(">IIBBBBB", chunk_data)
        elif chunk_type == b"IDAT":
            idat.append(chunk_data)
        elif chunk_type == b"IEND":
            break
    if header is None:
        raise ValueError("missing IHDR")
    width, height, bit_depth, color_type, compression, filtering, interlace = header
    result: dict[str, Any] = {
        "width": width,
        "height": height,
        "bitDepth": bit_depth,
        "colorType": color_type,
    }
    if not decode:
        return result
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if bit_depth != 8 or channels is None or compression != 0 or filtering != 0 or interlace != 0:
        raise ValueError("checker decodes only non-interlaced 8-bit grayscale/RGB/RGBA PNGs")
    raw = zlib.decompress(b"".join(idat))
    stride = width * channels
    if len(raw) != (stride + 1) * height:
        raise ValueError("unexpected decompressed PNG size")
    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = raw[cursor : cursor + stride]
        cursor += stride
        row = bytearray(stride)
        for index, byte in enumerate(encoded):
            left = row[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                predictor = _paeth(left, up, upper_left)
            else:
                raise ValueError(f"unsupported PNG filter {filter_type}")
            row[index] = (byte + predictor) & 0xFF
        rows.append(row)
        previous = row
    result["rows"] = rows
    result["channels"] = channels
    return result


def alpha_bbox(info: dict[str, Any], threshold: int = 8) -> tuple[int, int, int, int] | None:
    color_type = info["colorType"]
    channels = info["channels"]
    alpha_index = 3 if color_type == 6 else 1 if color_type == 4 else None
    if alpha_index is None:
        return None
    xs: list[int] = []
    ys: list[int] = []
    for y, row in enumerate(info["rows"]):
        for x in range(info["width"]):
            if row[x * channels + alpha_index] >= threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def _asset_checks(root: Path, app: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    expo = app["expo"]
    app_dir = root / "artifacts" / "ia-aprova"
    assets = [
        ("IOS_ICON", app_dir / expo["icon"], False),
        ("ANDROID_FOREGROUND", app_dir / expo["android"]["adaptiveIcon"]["foregroundImage"], True),
        ("ANDROID_MONOCHROME", app_dir / expo["android"]["adaptiveIcon"]["monochromeImage"], True),
    ]
    for code, path, needs_alpha in assets:
        if not path.is_file():
            findings.append(Finding(f"{code}_MISSING", "asset does not exist", _relative(root, path)))
            continue
        try:
            info = png_info(path, decode=needs_alpha)
        except Exception as exc:  # fail closed on malformed assets
            findings.append(Finding(f"{code}_INVALID", str(exc), _relative(root, path)))
            continue
        if info["width"] != info["height"] or info["width"] < 1024:
            findings.append(Finding(f"{code}_DIMENSIONS", "asset must be square and at least 1024px", _relative(root, path)))
        if not needs_alpha and info["colorType"] not in {0, 2}:
            findings.append(Finding(f"{code}_ALPHA", "iOS/base icon must be opaque", _relative(root, path)))
        if needs_alpha:
            bbox = alpha_bbox(info)
            if bbox is None:
                findings.append(Finding(f"{code}_ALPHA", "adaptive layer needs non-empty transparency mask", _relative(root, path)))
                continue
            safe_min_x = int(info["width"] * 0.17)
            safe_min_y = int(info["height"] * 0.17)
            safe_max_x = int(info["width"] * 0.83) + 1
            safe_max_y = int(info["height"] * 0.83) + 1
            if bbox[0] < safe_min_x or bbox[1] < safe_min_y or bbox[2] > safe_max_x or bbox[3] > safe_max_y:
                findings.append(Finding(f"{code}_SAFE_ZONE", f"alpha>=8 bbox {bbox} exceeds centered 66% safe zone", _relative(root, path)))
            if code == "ANDROID_MONOCHROME":
                channels = info["channels"]
                rgb_max = 0
                for row in info["rows"]:
                    for index in range(0, len(row), channels):
                        if row[index + 3] >= 8:
                            rgb_max = max(rgb_max, row[index], row[index + 1], row[index + 2])
                if rgb_max > 16:
                    findings.append(Finding("ANDROID_MONOCHROME_COLOR", "monochrome mask must use a single near-black color", _relative(root, path)))
    return findings


def _store_asset_checks(root: Path, evidence: dict[str, Any]) -> list[Finding]:
    """Validate objective Google Play asset evidence without granting approval."""
    findings: list[Finding] = []
    manifest_path = root / "docs" / "store-release" / "assets" / "manifest.json"
    manifest_parts = ("docs", "store-release", "assets", "manifest.json")
    if any(
        root.joinpath(*manifest_parts[:index]).is_symlink()
        for index in range(1, len(manifest_parts) + 1)
    ):
        return [Finding(
            "GOOGLE_STORE_ASSET_MANIFEST_PATH",
            "store asset manifest and its parent chain must not use symlinks",
            _relative(root, manifest_path),
        )]
    if not manifest_path.is_file():
        return [Finding("GOOGLE_STORE_ASSET_MANIFEST_MISSING", "store asset manifest is required", _relative(root, manifest_path))]
    try:
        manifest = _json(manifest_path)
    except Exception as exc:
        return [Finding("GOOGLE_STORE_ASSET_MANIFEST_INVALID", str(exc), _relative(root, manifest_path))]
    entries = manifest.get("assets")
    if not isinstance(entries, list):
        return [Finding("GOOGLE_STORE_ASSET_MANIFEST_INVALID", "assets must be an array", _relative(root, manifest_path))]
    kinds = [entry.get("kind") for entry in entries if isinstance(entry, dict)]
    duplicate_kinds = sorted({kind for kind in kinds if kind is not None and kinds.count(kind) > 1})
    if duplicate_kinds:
        findings.append(Finding(
            "GOOGLE_STORE_ASSET_MANIFEST_DUPLICATE",
            f"duplicate manifest kinds: {', '.join(str(kind) for kind in duplicate_kinds)}",
            _relative(root, manifest_path),
        ))
    by_kind = {entry.get("kind"): entry for entry in entries if isinstance(entry, dict)}
    expected = {
        "googlePlayStoreIcon": ("google_play_store_icon", 512, 512, 1_024 * 1_024, 6),
        "googleFeatureGraphic": ("google_play_feature_graphic", 1024, 500, 15 * 1_024 * 1_024, 2),
    }
    approvals = manifest.get("approvals")
    required_approval_keys = {
        "visual",
        "legal",
        "accessibility",
        "independentStoreReviewer",
    }
    if (
        not isinstance(approvals, dict)
        or set(approvals) != required_approval_keys
        or any(approvals[key] is not False for key in required_approval_keys)
    ):
        findings.append(Finding(
            "GOOGLE_STORE_ASSET_APPROVAL_INVALID",
            "candidate asset approvals must remain explicitly false until signed evidence exists",
            _relative(root, manifest_path),
        ))
    evidence_assets = evidence.get("assets", {})
    assets_root = (root / "docs" / "store-release" / "assets").resolve()
    for evidence_key, (kind, width, height, max_bytes, expected_color_type) in expected.items():
        relative = evidence_assets.get(evidence_key) if isinstance(evidence_assets, dict) else None
        if not isinstance(relative, str) or not relative.strip():
            findings.append(Finding("GOOGLE_STORE_ASSET_MISSING", f"assets.{evidence_key} is required", "docs/store-release/release-evidence.json"))
            continue
        posix_path = PurePosixPath(relative)
        if (
            "\\" in relative
            or posix_path.is_absolute()
            or ".." in posix_path.parts
            or len(posix_path.parts) != 4
            or posix_path.parts[:3] != ("docs", "store-release", "assets")
        ):
            findings.append(Finding("GOOGLE_STORE_ASSET_PATH", f"assets.{evidence_key} must be a canonical path directly under docs/store-release/assets", "docs/store-release/release-evidence.json"))
            continue
        unresolved_candidate = root.joinpath(*posix_path.parts)
        candidate = unresolved_candidate.resolve()
        path_uses_symlink = any(
            root.joinpath(*posix_path.parts[:index]).is_symlink()
            for index in range(1, len(posix_path.parts) + 1)
        )
        if candidate.parent != assets_root or path_uses_symlink:
            findings.append(Finding("GOOGLE_STORE_ASSET_PATH", f"assets.{evidence_key} must not use symlinks or leave docs/store-release/assets", "docs/store-release/release-evidence.json"))
            continue
        entry = by_kind.get(kind)
        if not isinstance(entry, dict) or entry.get("path") != relative:
            findings.append(Finding("GOOGLE_STORE_ASSET_MANIFEST_MISMATCH", f"manifest entry for {kind} is missing or points elsewhere", _relative(root, manifest_path)))
            continue
        if not candidate.is_file():
            findings.append(Finding("GOOGLE_STORE_ASSET_MISSING", "referenced store asset does not exist", _relative(root, candidate)))
            continue
        try:
            info = png_info(candidate, decode=expected_color_type == 6)
        except Exception as exc:
            findings.append(Finding("GOOGLE_STORE_ASSET_INVALID", str(exc), _relative(root, candidate)))
            continue
        size = candidate.stat().st_size
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if (info["width"], info["height"]) != (width, height):
            findings.append(Finding("GOOGLE_STORE_ASSET_DIMENSIONS", f"expected {width}x{height}", _relative(root, candidate)))
        if info["bitDepth"] != 8 or info["colorType"] != expected_color_type:
            required = "32-bit RGBA PNG" if expected_color_type == 6 else "24-bit RGB PNG without alpha"
            findings.append(Finding("GOOGLE_STORE_ASSET_FORMAT", f"asset must be {required}", _relative(root, candidate)))
        elif expected_color_type == 6:
            channels = info["channels"]
            if any(row[index + 3] != 255 for row in info["rows"] for index in range(0, len(row), channels)):
                findings.append(Finding("GOOGLE_STORE_ICON_TRANSPARENCY", "store icon background must remain full-square and opaque", _relative(root, candidate)))
        if size > max_bytes:
            findings.append(Finding("GOOGLE_STORE_ASSET_SIZE", f"asset exceeds {max_bytes} bytes", _relative(root, candidate)))
        manifest_values = (entry.get("width"), entry.get("height"), entry.get("bytes"), str(entry.get("sha256", "")).lower())
        actual_values = (info["width"], info["height"], size, digest)
        if manifest_values != actual_values:
            findings.append(Finding("GOOGLE_STORE_ASSET_HASH_MISMATCH", "manifest dimensions, size or SHA-256 differ from the file", _relative(root, manifest_path)))
    return findings


def _extract_backtick(text: str, label: str) -> str | None:
    match = re.search(rf"^- {re.escape(label)}: `([^`]+)`\s*$", text, re.MULTILINE)
    return match.group(1) if match else None


def run_checks(root: Path = ROOT) -> list[Finding]:
    findings: list[Finding] = []
    docs = root / "docs" / "store-release"
    app_dir = root / "artifacts" / "ia-aprova"
    required = [
        docs / "store-package.json",
        docs / "release-evidence.json",
        docs / "metadata-pt-BR.md",
        docs / "apple-review-package.pt-BR.md",
        docs / "google-play-package.pt-BR.md",
        docs / "privacy-disclosures.pt-BR.md",
        docs / "assets-and-screenshots.pt-BR.md",
        docs / "assets" / "manifest.json",
        docs / "official-requirements-2026-08-23.md",
        docs / "risks-and-handoff.pt-BR.md",
        docs / "independent-review-handoff.pt-BR.md",
        app_dir / "app.json",
        app_dir / "eas.json",
        app_dir / "package.json",
    ]
    for path in required:
        if not path.is_file():
            findings.append(Finding("REQUIRED_FILE_MISSING", "required store package file is absent", _relative(root, path)))
    if findings:
        return findings

    package = _json(docs / "store-package.json")
    evidence = _json(docs / "release-evidence.json")
    app = _json(app_dir / "app.json")
    eas = _json(app_dir / "eas.json")
    mobile_package = _json(app_dir / "package.json")
    expo = app.get("expo", {})
    canonical_app = package.get("app", {})
    canonical_urls = package.get("urls", {})
    subscription = package.get("subscription", {})
    age_signals = package.get("ageSignals", {})

    findings.extend(_evidence_shape_checks(evidence, _relative(root, docs / "release-evidence.json")))

    if package.get("status") != "approved" or package.get("releaseAllowed") is not True:
        findings.append(Finding("STORE_PACKAGE_BLOCKED", "store package must be approved and releaseAllowed=true", _relative(root, docs / "store-package.json")))
    if age_signals != {
        "ios": "declared_age_range",
        "android": "play_age_signals",
        "missingOrErrorBehavior": "restrict_as_minor",
        "storeSignalMayNotBeOverriddenToAdult": True,
    }:
        findings.append(Finding("AGE_SIGNAL_POLICY", "canonical store package must fail closed around Apple/Google age signals", _relative(root, docs / "store-package.json")))

    expected_pairs = [
        (expo.get("name"), canonical_app.get("name"), "APP_NAME"),
        (expo.get("version"), canonical_app.get("version"), "APP_VERSION"),
        (expo.get("ios", {}).get("bundleIdentifier"), canonical_app.get("iosBundleIdentifier"), "IOS_BUNDLE_ID"),
        (expo.get("ios", {}).get("buildNumber"), canonical_app.get("iosBuildNumber"), "IOS_BUILD_NUMBER"),
        (expo.get("android", {}).get("package"), canonical_app.get("androidPackage"), "ANDROID_PACKAGE"),
        (expo.get("android", {}).get("versionCode"), canonical_app.get("androidVersionCode"), "ANDROID_VERSION_CODE"),
    ]
    for actual, expected, code in expected_pairs:
        if actual != expected:
            findings.append(Finding(f"{code}_MISMATCH", f"app config {actual!r} != canonical {expected!r}", _relative(root, app_dir / "app.json")))
    if expo.get("platforms") != ["ios", "android"]:
        findings.append(Finding("PLATFORMS", "store build must explicitly target only ios and android", _relative(root, app_dir / "app.json")))
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+", str(expo.get("ios", {}).get("bundleIdentifier", ""))):
        findings.append(Finding("IOS_BUNDLE_ID_INVALID", "invalid reverse-DNS bundle identifier", _relative(root, app_dir / "app.json")))
    if expo.get("ios", {}).get("config", {}).get("usesNonExemptEncryption") is not False:
        findings.append(Finding("ENCRYPTION_DECLARATION", "usesNonExemptEncryption must be explicitly assessed", _relative(root, app_dir / "app.json")))
    plugins = expo.get("plugins", [])
    plugin_names = {item if isinstance(item, str) else item[0] for item in plugins if isinstance(item, (str, list)) and item}
    clerk_plugin = next((item for item in plugins if isinstance(item, list) and item and item[0] == "@clerk/expo"), None)
    secure_store_plugin = next((item for item in plugins if isinstance(item, list) and item and item[0] == "expo-secure-store"), None)
    clerk_apple_enabled = bool(clerk_plugin and len(clerk_plugin) > 1 and isinstance(clerk_plugin[1], dict) and clerk_plugin[1].get("appleSignIn") is True)
    if expo.get("ios", {}).get("usesAppleSignIn") is not True or "expo-apple-authentication" not in plugin_names or not clerk_apple_enabled:
        findings.append(Finding("APPLE_SIGN_IN_CONFIG", "native Apple Sign-In capability/plugins are incomplete", _relative(root, app_dir / "app.json")))
    secure_store_face_id_disabled = bool(
        secure_store_plugin
        and len(secure_store_plugin) > 1
        and isinstance(secure_store_plugin[1], dict)
        and secure_store_plugin[1].get("faceIDPermission") is False
    )
    if not secure_store_face_id_disabled:
        findings.append(Finding("UNUSED_FACE_ID_PERMISSION", "SecureStore must not add a Face ID usage description when biometric authentication is unused", _relative(root, app_dir / "app.json")))
    privacy_types = expo.get("ios", {}).get("privacyManifests", {}).get("NSPrivacyAccessedAPITypes", [])
    if not any(item.get("NSPrivacyAccessedAPIType") == "NSPrivacyAccessedAPICategoryUserDefaults" and "CA92.1" in item.get("NSPrivacyAccessedAPITypeReasons", []) for item in privacy_types if isinstance(item, dict)):
        findings.append(Finding("PRIVACY_MANIFEST", "UserDefaults CA92.1 declaration missing", _relative(root, app_dir / "app.json")))
    android = expo.get("android", {})
    if android.get("allowBackup") is not False:
        findings.append(Finding("ANDROID_BACKUP", "Android backup must be explicitly disabled for local account data", _relative(root, app_dir / "app.json")))
    if android.get("permissions") != []:
        findings.append(Finding("ANDROID_PERMISSIONS", "no runtime permissions are authorized for the current feature set", _relative(root, app_dir / "app.json")))
    expected_blocked = {
        "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.ACCESS_MEDIA_LOCATION",
        "android.permission.FOREGROUND_SERVICE_LOCATION", "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO", "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
    }
    if not expected_blocked.issubset(set(android.get("blockedPermissions", []))):
        findings.append(Finding("ANDROID_BLOCKED_PERMISSIONS", "unused location/camera/media permissions are not all blocked", _relative(root, app_dir / "app.json")))

    production = eas.get("build", {}).get("production", {})
    if production.get("environment") != "production" or production.get("distribution") != "store" or production.get("developmentClient") is not False:
        findings.append(Finding("EAS_PRODUCTION_PROFILE", "production profile is not an explicit store build", _relative(root, app_dir / "eas.json")))
    if production.get("node") != "22.23.1" or production.get("ios", {}).get("image") != "sdk-57" or production.get("android", {}).get("image") != "sdk-57":
        findings.append(Finding("EAS_TOOLCHAIN", "production must pin Node 22.23.1 and sdk-57 images", _relative(root, app_dir / "eas.json")))
    draft_submit = eas.get("submit", {}).get("store-draft", {}).get("android", {})
    if draft_submit.get("track") != "internal" or draft_submit.get("releaseStatus") != "draft":
        findings.append(Finding("EAS_SUBMIT_SAFETY", "only internal draft submission may be configured before approval", _relative(root, app_dir / "eas.json")))
    if not expo.get("owner") or not expo.get("extra", {}).get("eas", {}).get("projectId"):
        findings.append(Finding("EAS_IDENTITY_MISSING", "owner and extra.eas.projectId require the organization Expo project", _relative(root, app_dir / "app.json")))

    build_script = mobile_package.get("scripts", {}).get("build", "")
    if build_script == "node scripts/build.js" or "expo export" not in build_script:
        findings.append(Finding("BUILD_SCRIPT_NOT_NATIVE", "build script is a Replit/Expo Go artifact, not a mobile bundle smoke test", _relative(root, app_dir / "package.json")))
    all_dependencies = {**mobile_package.get("dependencies", {}), **mobile_package.get("devDependencies", {})}
    unused_native = sorted(name for name in ("expo-location", "expo-image-picker") if name in all_dependencies)
    if unused_native:
        findings.append(Finding("UNUSED_NATIVE_DEPENDENCIES", f"remove unused native packages and regenerate lock: {', '.join(unused_native)}", _relative(root, app_dir / "package.json")))

    links = (app_dir / "constants" / "links.ts").read_text(encoding="utf-8")
    env_example = (app_dir / ".env.example").read_text(encoding="utf-8")
    for key in ("privacy", "terms", "support", "accountDeletion"):
        url = canonical_urls[key]
        if url not in links and url not in env_example:
            findings.append(Finding("URL_CONFIG_MISMATCH", f"canonical {key} URL is not embedded in mobile config", _relative(root, app_dir / "constants" / "links.ts")))
    billing_text = "\n".join((app_dir / path).read_text(encoding="utf-8") for path in (
        "src/services/billing/BillingProvider.tsx", "src/services/billing/purchases.native.ts",
    ))
    if subscription.get("productId") not in billing_text:
        findings.append(Finding("IAP_PRODUCT_MISMATCH", "canonical product ID not found in native billing boundary", _relative(root, app_dir / "src/services/billing")))
    openapi_text = (root / "lib" / "api-spec" / "openapi.yaml").read_text(encoding="utf-8")
    if f"const: {subscription.get('entitlement')}" not in openapi_text or "react-native-purchases" not in all_dependencies:
        findings.append(Finding("IAP_ENTITLEMENT_MISMATCH", "RevenueCat SDK/server entitlement does not match the store package", _relative(root, app_dir / "src/services/billing")))
    deletion_text = (app_dir / "app" / "settings" / "index.tsx").read_text(encoding="utf-8")
    if (
        "Gerenciar assinatura" not in deletion_text
        or "https://apps.apple.com/account/subscriptions" not in deletion_text
        or "https://play.google.com/store/account/subscriptions?package=br.com.iaaprova.app" not in deletion_text
    ):
        findings.append(Finding("ACCOUNT_DELETION_SUBSCRIPTION_MANAGEMENT", "account deletion must offer store subscription management without blocking deletion", _relative(root, app_dir / "app" / "settings" / "index.tsx")))
    if evidence.get("productFeatures", {}).get("catalogRightsAndCoveragePassed") is not True and "Todos os concursos" in "\n".join((app_dir / path).read_text(encoding="utf-8") for path in ("app/pro/index.tsx", "app/settings/index.tsx")):
        findings.append(Finding("UNVERIFIED_ALL_CATALOG_CLAIM", "mobile paywall advertises all contests before rights and coverage evidence", _relative(root, app_dir / "app" / "pro" / "index.tsx")))

    findings.extend(_asset_checks(root, app))
    findings.extend(_store_asset_checks(root, evidence))

    metadata = (docs / "metadata-pt-BR.md").read_text(encoding="utf-8")
    findings.extend(_feature_claim_checks(metadata, evidence, _relative(root, docs / "metadata-pt-BR.md")))
    apple_name = _extract_backtick(metadata, "Nome")
    apple_subtitle = _extract_backtick(metadata, "Subtítulo")
    apple_promotional = _extract_backtick(metadata, "Texto promocional")
    apple_keywords = _extract_backtick(metadata, "Keywords")
    google_name = _extract_backtick(metadata, "Nome do app")
    google_short = _extract_backtick(metadata, "Descrição curta")
    for value, maximum, code in ((apple_name, 30, "APPLE_NAME"), (apple_subtitle, 30, "APPLE_SUBTITLE"), (google_name, 30, "GOOGLE_NAME"), (google_short, 80, "GOOGLE_SHORT_DESCRIPTION")):
        if value is None or len(value) > maximum:
            findings.append(Finding(f"{code}_LIMIT", f"missing or over {maximum} characters", _relative(root, docs / "metadata-pt-BR.md")))
    for value, maximum, code in ((apple_promotional, 170, "APPLE_PROMOTIONAL_TEXT"), (apple_keywords, 100, "APPLE_KEYWORDS")):
        if value is None or len(value) > maximum:
            findings.append(Finding(f"{code}_LIMIT", f"missing or over {maximum} characters", _relative(root, docs / "metadata-pt-BR.md")))
    try:
        apple_description = metadata.split("## Apple App Store", 1)[1].split("## Google Play", 1)[0].split("### Descrição", 1)[1]
        google_description = metadata.split("## Google Play", 1)[1].split("## Nota de controle de alegações", 1)[0].split("### Descrição completa", 1)[1]
    except IndexError:
        findings.append(Finding("STORE_DESCRIPTION_STRUCTURE", "Apple or Google description heading is missing", _relative(root, docs / "metadata-pt-BR.md")))
    else:
        if len(apple_description.strip()) > 4000:
            findings.append(Finding("APPLE_DESCRIPTION_LIMIT", "Apple description exceeds 4000 characters", _relative(root, docs / "metadata-pt-BR.md")))
        if len(google_description.strip()) > 4000:
            findings.append(Finding("GOOGLE_DESCRIPTION_LIMIT", "Google full description exceeds 4000 characters", _relative(root, docs / "metadata-pt-BR.md")))
    for banned in ("revisado por professores humanos", "garantia de aprovação", "somos afiliados oficialmente", "usa ia generativa para"):
        if banned in metadata.lower():
            findings.append(Finding("FORBIDDEN_STORE_CLAIM", f"forbidden claim: {banned}", _relative(root, docs / "metadata-pt-BR.md")))
    for url in canonical_urls.values():
        if url not in "\n".join(path.read_text(encoding="utf-8") for path in docs.glob("*.md")):
            findings.append(Finding("STORE_DOC_URL_MISSING", f"canonical URL absent from store docs: {url}", _relative(root, docs)))
        if not re.fullmatch(r"https://[a-z0-9.-]+(?:/[a-z0-9._~!$&'()*+,;=:@%/-]*)?", str(url)):
            findings.append(Finding("STORE_URL_INVALID", f"URL must be absolute HTTPS without query/fragment: {url}", _relative(root, docs / "store-package.json")))

    placeholder_pattern = _PLACEHOLDER
    placeholder_hits: list[str] = []
    for base in (root / "artifacts" / "legal-site",):
        if not base.is_dir():
            placeholder_hits.append(_relative(root, base))
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".html", ".txt", ".json", ".md"}:
                if placeholder_pattern.search(path.read_text(encoding="utf-8")):
                    placeholder_hits.append(_relative(root, path))
    if placeholder_hits:
        findings.append(Finding("PUBLIC_DOCUMENT_PLACEHOLDERS", f"{len(placeholder_hits)} public legal files still contain placeholders; first: {', '.join(placeholder_hits[:5])}", _relative(root, root / "artifacts" / "legal-site")))

    audit_date = date.fromisoformat(package["auditDate"])
    if date.today() > audit_date + timedelta(days=92):
        findings.append(Finding("OFFICIAL_SOURCES_STALE", "official requirement review is older than 92 days", _relative(root, docs / "official-requirements-2026-08-23.md")))

    unready = _flatten_unready(evidence)
    if unready:
        preview = ", ".join(unready[:8])
        findings.append(Finding("RELEASE_EVIDENCE_INCOMPLETE", f"{len(unready)} evidence fields remain false/empty; first: {preview}", _relative(root, docs / "release-evidence.json")))
    privacy_safety = evidence.get("privacyAndSafety", {})
    required_age_signals = {
        "appleDeclaredAgeRangeSandboxPassed",
        "googlePlayAgeSignalsPassed",
        "ageSignalFailureAndRevocationPassed",
    }
    if not required_age_signals.issubset(privacy_safety):
        findings.append(Finding("AGE_SIGNAL_EVIDENCE_MISSING", "Declared Age Range and Play Age Signals evidence fields are required", _relative(root, docs / "release-evidence.json")))
    if evidence.get("assets", {}).get("googlePlayStoreIcon") is None or evidence.get("assets", {}).get("googleFeatureGraphic") is None:
        findings.append(Finding("GOOGLE_STORE_ASSETS_MISSING", "512px icon and 1024x500 feature graphic are required", _relative(root, docs / "release-evidence.json")))
    if not evidence.get("assets", {}).get("iosScreenshots") or not evidence.get("assets", {}).get("androidPhoneScreenshots"):
        findings.append(Finding("STORE_SCREENSHOTS_MISSING", "real screenshots from the candidate build are required", _relative(root, docs / "release-evidence.json")))

    blockers_path = root / "docs" / "compliance" / "release-blockers.json"
    if blockers_path.is_file():
        blockers = _json(blockers_path).get("blockers", [])
        open_release = [item.get("id", "unknown") for item in blockers if item.get("severity") == "release" and item.get("status") != "closed"]
        if open_release:
            findings.append(Finding("COMPLIANCE_RELEASE_BLOCKERS", f"{len(open_release)} open: {', '.join(open_release)}", _relative(root, blockers_path)))
    else:
        findings.append(Finding("COMPLIANCE_FILE_MISSING", "release blocker registry is required", _relative(root, blockers_path)))
    return findings


def main() -> int:
    try:
        findings = run_checks()
    except Exception as exc:
        print(json.dumps({"releaseAllowed": False, "fatal": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    payload = {
        "releaseAllowed": not findings,
        "checkedAt": date.today().isoformat(),
        "findingCount": len(findings),
        "findings": [finding.__dict__ for finding in findings],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
