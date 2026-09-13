import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = ROOT / "lib" / "api-spec" / "openapi.yaml"
API_ROUTES_PATHS = (
    ROOT / "artifacts" / "api-server" / "src" / "routes" / "v1.ts",
    ROOT / "artifacts" / "api-server" / "src" / "routes" / "integrity.ts",
)
MOBILE_PATHS_PATH = ROOT / "artifacts" / "ia-aprova" / "src" / "services" / "api" / "paths.ts"
MOBILE_ROOT = ROOT / "artifacts" / "ia-aprova"
APP_INTEGRITY_SERVICE_PATH = ROOT / "artifacts" / "api-server" / "src" / "services" / "app-integrity.ts"


def openapi_paths(source: str) -> set[str]:
    server_match = re.search(r"^\s*- url:\s*([^\s]+)\s*$", source, flags=re.MULTILINE)
    prefix = server_match.group(1).rstrip("/") if server_match else ""
    paths: set[str] = set()
    in_paths = False
    for line in source.splitlines():
        if line == "paths:":
            in_paths = True
            continue
        if in_paths and line and not line.startswith(" "):
            break
        match = re.match(r"^  (/[^:]+):\s*$", line) if in_paths else None
        if match:
            paths.add(f"{prefix}{match.group(1)}")
    return paths


def express_paths(source: str) -> set[str]:
    paths = set()
    for route in re.findall(r'router\.(?:get|post|put|patch|delete)\(\s*["\']([^"\']+)["\']', source):
        normalized = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", route)
        paths.add(f"/api/v1{normalized}")
    return paths


def mobile_paths(source: str) -> set[str]:
    values = re.findall(r"['\"](/api/v1/[^'\"]+)['\"]", source)
    values.extend(re.findall(r"`(/api/v1/[^`]+)`", source))
    normalized: set[str] = set()
    for value in values:
        value = re.sub(r"\$\{encodeURIComponent\(([A-Za-z_][A-Za-z0-9_]*)\)\}", r"{\1}", value)
        value = value.split("?", 1)[0]
        normalized.add(value)
    return normalized


def component_block(source: str, name: str) -> str:
    match = re.search(
        rf"^    {re.escape(name)}:\s*$([\s\S]*?)(?=^    [A-Za-z0-9_.-]+:\s*$|\Z)",
        source,
        flags=re.MULTILINE,
    )
    return match.group(1) if match else ""


class ContractAlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.openapi = OPENAPI_PATH.read_text(encoding="utf-8")
        cls.routes = "\n".join(path.read_text(encoding="utf-8") for path in API_ROUTES_PATHS)
        cls.integrity_routes = API_ROUTES_PATHS[1].read_text(encoding="utf-8")
        cls.integrity_service = APP_INTEGRITY_SERVICE_PATH.read_text(encoding="utf-8")
        cls.mobile = MOBILE_PATHS_PATH.read_text(encoding="utf-8")

    def test_every_public_api_route_is_documented(self) -> None:
        missing = express_paths(self.routes) - openapi_paths(self.openapi)
        self.assertEqual(missing, set(), f"API routes absent from OpenAPI: {sorted(missing)}")

    def test_operational_probes_are_documented_at_the_real_api_base(self) -> None:
        for path, operation_id in (("/healthz", "healthCheck"), ("/readyz", "readinessCheck")):
            block = re.search(
                rf"^  {re.escape(path)}:\s*$([\s\S]*?)(?=^  /|^components:)",
                self.openapi,
                flags=re.MULTILINE,
            )
            self.assertIsNotNone(block, f"OpenAPI operation missing: {path}")
            source = block.group(1)
            self.assertIn(f"operationId: {operation_id}", source)
            self.assertIn("security: []", source)
            self.assertIn("- url: /api", source)
            self.assertIn("Cache-Control:", source)

    def test_every_mobile_v1_path_exists_in_openapi(self) -> None:
        missing = mobile_paths(self.mobile) - openapi_paths(self.openapi)
        self.assertEqual(missing, set(), f"mobile paths absent from OpenAPI: {sorted(missing)}")

    def test_public_question_never_contains_answer_material(self) -> None:
        block = component_block(self.openapi, "PublicQuestion")
        self.assertTrue(block, "OpenAPI PublicQuestion component not found")
        forbidden = re.findall(r"\b(?:isCorrect|correctOptionId|solution|rationale|optionRationales)\b", block)
        self.assertEqual(forbidden, [], "PublicQuestion leaks grading material")

    def test_active_simulation_never_contains_grading_material(self) -> None:
        for component in ("SimulationPublicQuestion", "SimulationSession", "SimulationAnswerResponse"):
            block = component_block(self.openapi, component)
            self.assertTrue(block, f"OpenAPI {component} component not found")
            forbidden = re.findall(r"\b(?:isCorrect|correctOptionId|solution|rationale|snapshotHash|resultHash|score)\b", block)
            self.assertEqual(forbidden, [], f"{component} leaks grading material")

    def test_simulation_mutations_require_idempotency(self) -> None:
        for path in ("/simulations", "/simulations/{simulationId}/answers"):
            block = re.search(
                rf"^  {re.escape(path)}:\s*$([\s\S]*?)(?=^  /|^components:)",
                self.openapi,
                flags=re.MULTILINE,
            )
            self.assertIsNotNone(block, f"OpenAPI simulation operation missing: {path}")
            self.assertIn('#/components/parameters/IdempotencyKey', block.group(1))

    def test_active_mobile_code_uses_the_central_path_registry(self) -> None:
        offenders: list[str] = []
        roots = [MOBILE_ROOT / "app", MOBILE_ROOT / "components", MOBILE_ROOT / "hooks", MOBILE_ROOT / "src"]
        for source_root in roots:
            if not source_root.is_dir():
                continue
            for path in source_root.rglob("*.ts*"):
                if path == MOBILE_PATHS_PATH or "__generated__" in path.parts or (
                    "src" in path.parts and "services" in path.parts and "api" in path.parts
                ):
                    continue
                source = path.read_text(encoding="utf-8", errors="replace")
                if re.search(r"['\"`](/api/v1/)", source):
                    offenders.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(offenders, [], f"mobile code bypasses apiPaths: {offenders}")

    def test_legal_actions_require_the_exact_displayed_policy_snapshot(self) -> None:
        for component in ("RecordLegalAcknowledgementRequest", "AcceptGuardianInvitationRequest"):
            block = component_block(self.openapi, component)
            self.assertTrue(block, f"OpenAPI {component} component not found")
            required = re.findall(r"required:\s*\[([^\]]+)\]", block)
            self.assertTrue(required, f"{component} has no required fields")
            fields = {field.strip() for declaration in required for field in declaration.split(",")}
            for version in ("policyVersion", "termsVersion", "privacyNoticeVersion"):
                self.assertIn(version, fields, f"{component} does not require {version}")

    def test_guardian_revocation_is_explicit_and_legacy_route_is_deprecated(self) -> None:
        self.assertIn("/api/v1/me/guardian-links/{linkId}", openapi_paths(self.openapi))
        self.assertIn("/api/v1/me/guardian-links/{linkId}", mobile_paths(self.mobile))
        legacy = re.search(
            r"^  /me/guardian-link:\s*$([\s\S]*?)(?=^  /|^components:)",
            self.openapi,
            flags=re.MULTILINE,
        )
        self.assertIsNotNone(legacy, "legacy guardian-link route missing")
        self.assertIn("deprecated: true", legacy.group(1))

    def test_backend_checks_policy_snapshot_inside_each_write_transaction(self) -> None:
        for start, end in (
            ('router.post("/me/legal-acknowledgements"', 'router.post("/me/optional-consents"'),
            ('router.post("/guardian-invitations/accept"', 'router.get("/me/guardian-links"'),
        ):
            block = self.routes.split(start, 1)[1].split(end, 1)[0]
            self.assertIn("db.transaction", block)
            self.assertIn("requireCurrentPolicySnapshot(input)", block)
            self.assertLess(block.index("db.transaction"), block.index("requireCurrentPolicySnapshot(input)"))

    def test_backend_authorizes_exact_guardian_link_id(self) -> None:
        block = self.routes.split('async function revokeGuardianLink(', 1)[1].split(
            'router.delete("/me/guardian-links/:linkId"', 1,
        )[0]
        self.assertIn("eq(guardianLinksTable.id, requestedLinkId)", block)
        self.assertIn("eq(guardianLinksTable.minorUserId, userId)", block)
        self.assertIn("eq(guardianLinksTable.guardianUserId, userId)", block)
        self.assertIn("activeLinks.length > 1", block)

    def test_guardian_acceptance_rechecks_revocation_and_binds_replays(self) -> None:
        block = self.routes.split('router.post("/guardian-invitations/accept"', 1)[1].split(
            'router.get("/me/guardian-links"', 1,
        )[0]
        lock = "guardian-minor:${candidateInvitation.minorUserId}"
        self.assertIn(lock, block)
        self.assertGreater(
            block.index("const [invitation]"),
            block.index(lock),
            "invitation must be re-read after the guardian-minor lock",
        )
        self.assertIn("guardianInviteReplayMatches(invitation.acceptanceRequestHash, requestHash)", block)
        self.assertIn("eq(guardianLinksTable.id, invitation.guardianLinkId)", block)
        self.assertIn("acceptanceRequestHash: requestHash", block)
        self.assertIn("guardianLinkId: link.id", block)

    def test_minor_cannot_shadow_guardian_legal_records(self) -> None:
        block = self.routes.split('router.post("/me/legal-acknowledgements"', 1)[1].split(
            'router.post("/me/optional-consents"', 1,
        )[0]
        self.assertIn('age.ageBand !== "18_plus"', block)
        self.assertIn("guardian-permission-required", block)

    def test_platform_age_signal_is_monitoring_only_and_cannot_enable_client_privilege(self) -> None:
        self.assertIn("/api/v1/me/platform-age-signal", openapi_paths(self.openapi))
        self.assertIn("/api/v1/me/platform-age-signal", mobile_paths(self.mobile))
        block = self.routes.split('router.post("/me/platform-age-signal"', 1)[1].split(
            'router.post("/me/legal-acknowledgements"', 1,
        )[0]
        self.assertIn('trustStatus: "device_reported_monitoring"', block)
        self.assertIn('const preservesServerVerified = before?.trustStatus === "server_verified"', block)
        self.assertIn('if (!preservesServerVerified)', block)
        self.assertIn("socialEnabled: false", block)
        self.assertIn("notificationsEnabled: false", block)
        self.assertNotRegex(block, r"input\.(?:trust|source|verified|assurance)")

    def test_integrity_phase_a_contract_is_authenticated_idempotent_and_sanitized(self) -> None:
        paths = openapi_paths(self.openapi)
        for path in (
            "/api/v1/integrity/device-bindings",
            "/api/v1/integrity/challenges",
            "/api/v1/me/platform-age-signal/verified",
            "/api/v1/integrity/verifications/{verificationId}",
        ):
            self.assertIn(path, paths)
        for path in ("/integrity/device-bindings", "/me/platform-age-signal/verified"):
            block = re.search(
                rf"^  {re.escape(path)}:\s*$([\s\S]*?)(?=^  /|^components:)",
                self.openapi,
                flags=re.MULTILINE,
            )
            self.assertIsNotNone(block)
            self.assertIn('#/components/parameters/IdempotencyKey', block.group(1))

        response = component_block(self.openapi, "IntegrityVerification")
        for forbidden in ("proofDigest", "requestDigest", "envelopeDigest", "counter", "receipt", "verdict", "nonce"):
            self.assertNotRegex(response, rf"^\s+{forbidden}:", forbidden)

    def test_integrity_phase_a_has_no_server_verified_write_path(self) -> None:
        source = self.integrity_routes
        self.assertIn("PHASE_A_PROVIDER_ADAPTERS", source)
        self.assertIn('status: "indeterminate"', self.integrity_service)
        self.assertNotIn('trustStatus: "server_verified"', source)
        self.assertNotIn('status: "verified"', source)
        self.assertIn("leaseGeneration", source)
        self.assertIn("eq(integrityChallengesTable.leaseGeneration, reservation.leaseGeneration)", source)


if __name__ == "__main__":
    unittest.main()
