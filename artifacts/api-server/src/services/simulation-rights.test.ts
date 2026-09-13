import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEligibleSimulationQuestionRights,
  type SimulationQuestionRightsCandidate,
} from "./simulation-rights.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const DEADLINE = new Date("2026-08-23T13:00:00.000Z");
const HASH = "a".repeat(64);
const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const LICENSE_ID = "10000000-0000-4000-8000-000000000002";

function candidate(overrides: Partial<SimulationQuestionRightsCandidate> = {}): SimulationQuestionRightsCandidate {
  return {
    origin: "original_authoral",
    authorId: "author-1",
    sourceTransformation: "original",
    presentationKind: "text_only",
    sourceId: SOURCE_ID,
    sourceOwner: "IA Aprova Conteúdo",
    sourceContentHash: HASH,
    licenseId: LICENSE_ID,
    licenseSourceId: SOURCE_ID,
    licenseType: "authoring_agreement",
    licensePermissions: ["commercial", "digital", "reproduce"],
    licenseStatus: "active",
    licenseTerritory: "BR",
    licensePlatforms: ["ios", "android"],
    licenseStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    licenseExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    licenseEvidenceHash: HASH,
    licenseApprovedBy: "rights-reviewer-independent",
    ...overrides,
  };
}

test("authorial content requires an active authoring agreement", () => {
  assert.equal(hasEligibleSimulationQuestionRights(candidate(), NOW, DEADLINE), true);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseId: null }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseType: "official_license" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseStatus: "approved" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ authorId: null }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ presentationKind: "external_assets" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licensePermissions: ["digital", "reproduce"] }), NOW, DEADLINE), false);
});

test("official content requires an official licence", () => {
  assert.equal(hasEligibleSimulationQuestionRights(candidate({
    origin: "official_licensed",
    licenseType: "official_license",
    sourceTransformation: "verbatim",
  }), NOW, DEADLINE), true);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({
    origin: "official_licensed",
    licenseType: "authoring_agreement",
    sourceTransformation: "verbatim",
  }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ origin: "public_exam" }), NOW, DEADLINE), false);
});

test("official transformations require their explicit permission", () => {
  assert.equal(hasEligibleSimulationQuestionRights(candidate({
    origin: "official_licensed",
    licenseType: "official_license",
    sourceTransformation: "adapted",
  }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({
    origin: "official_licensed",
    licenseType: "official_license",
    sourceTransformation: "adapted",
    licensePermissions: ["commercial", "digital", "reproduce", "adapt"],
  }), NOW, DEADLINE), true);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({
    origin: "official_licensed",
    licenseType: "official_license",
    sourceTransformation: "fragmented",
    licensePermissions: ["commercial", "digital", "reproduce", "fragment"],
  }), NOW, DEADLINE), true);
});

test("source provenance and independent evidence are mandatory", () => {
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ sourceId: null }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseSourceId: "20000000-0000-4000-8000-000000000001" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ sourceOwner: "" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ sourceContentHash: "not-a-hash" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseEvidenceHash: "not-a-hash" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseApprovedBy: "" }), NOW, DEADLINE), false);
});

test("scope must cover Brazil and both stores for the whole simulation", () => {
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseTerritory: "US" }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licensePlatforms: ["mobile"] }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licensePlatforms: ["ios"] }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseStartsAt: null }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseStartsAt: new Date("2026-08-24T00:00:00.000Z") }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseExpiresAt: DEADLINE }), NOW, DEADLINE), false);
  assert.equal(hasEligibleSimulationQuestionRights(candidate({ licenseExpiresAt: new Date(DEADLINE.getTime() + 1) }), NOW, DEADLINE), true);
});
