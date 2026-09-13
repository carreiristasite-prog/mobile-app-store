import importlib.util
import json
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "release_gate.py"
SPEC = importlib.util.spec_from_file_location("release_gate", MODULE_PATH)
assert SPEC and SPEC.loader
release_gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release_gate
SPEC.loader.exec_module(release_gate)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def write_alpha_png(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)

    def chunk(name: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)

    path.write_bytes(signature + chunk(b"IHDR", ihdr_data) + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + chunk(b"IEND", b""))


class ReleaseGateTests(unittest.TestCase):
    def make_ready_tree(self, root: Path) -> None:
        mobile = root / "artifacts" / "ia-aprova"
        write_json(mobile / "package.json", {
            "dependencies": {
                "@clerk/expo": "^3.4.2",
                "expo": "^57.0.9",
                "expo-apple-authentication": "^57.0.0",
                "expo-dev-client": "^57.0.0",
                "react": "19.2.0",
                "react-native": "0.86.2",
                "react-native-purchases": "^10.2.0",
            },
        })
        write_json(mobile / "app.json", {"expo": {
            "ios": {"bundleIdentifier": "br.com.iaaprova.app", "usesAppleSignIn": True},
            "android": {
                "package": "br.com.iaaprova.app",
                "adaptiveIcon": {"foregroundImage": "./assets/adaptive.png", "backgroundColor": "#FFFFFF"},
            },
            "plugins": ["@clerk/expo", "expo-apple-authentication"],
        }})
        write_alpha_png(mobile / "assets" / "adaptive.png")
        billing = mobile / "src" / "services" / "billing" / "native.ts"
        billing.parent.mkdir(parents=True, exist_ok=True)
        billing.write_text(
            "import Purchases from 'react-native-purchases';\n"
            "Purchases.configure({apiKey: 'public'});\n"
            "export const restore = () => Purchases.restorePurchases();\n",
            encoding="utf-8",
        )
        route = mobile / "app" / "index.tsx"
        route.parent.mkdir(parents=True, exist_ok=True)
        route.write_text("export default function Screen(){ return null }", encoding="utf-8")
        write_json(root / "docs" / "compliance" / "release-blockers.json", {"blockers": []})

    def test_ready_minimal_tree_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_tree(root)
            self.assertEqual(release_gate.audit_workspace(root), [])

    def test_detects_old_sdk_mock_route_disabled_billing_and_open_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_tree(root)
            package_path = root / "artifacts" / "ia-aprova" / "package.json"
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["dependencies"]["expo"] = "~54.0.0"
            write_json(package_path, package)
            (root / "artifacts" / "ia-aprova" / "app" / "legacy.tsx").write_text(
                "import { MOCK_PROFILE } from '../constants/mockData';\n"
                "const copy = 'Ao continuar você concorda com os Termos';",
                encoding="utf-8",
            )
            billing_path = root / "artifacts" / "ia-aprova" / "src" / "services" / "billing" / "native.ts"
            billing_path.write_text(billing_path.read_text(encoding="utf-8") + "\nconst nativePurchasesAvailable = false;", encoding="utf-8")
            write_json(root / "docs" / "compliance" / "release-blockers.json", {"blockers": [{"id": "LEGAL-1", "status": "open"}]})

            codes = {finding.code for finding in release_gate.audit_workspace(root)}
            self.assertTrue({
                "EXPO_VERSION_BLOCKED",
                "MOCK_ROUTE_IMPORT",
                "BILLING_DISABLED",
                "COMPLIANCE_BLOCKER_OPEN",
                "IMPLICIT_CONSENT_COPY",
            }.issubset(codes))


if __name__ == "__main__":
    unittest.main()
