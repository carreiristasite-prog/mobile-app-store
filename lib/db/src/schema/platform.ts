import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// Identity and privacy
export const authIdentitiesTable = pgTable("auth_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_auth_identity_provider_subject").on(table.provider, table.subject),
  index("idx_auth_identity_user").on(table.userId),
]);

export const ageProfilesTable = pgTable("age_profiles", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  ageBand: text("age_band").notNull(),
  socialEnabled: boolean("social_enabled").notNull().default(false),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("ck_age_profile_band", sql`${table.ageBand} in ('under_13','13_15','16_17','18_plus')`),
]);

/**
 * Operational installation binding. It is neither a device fingerprint nor
 * proof of integrity; only an authenticated owner can use its opaque UUID.
 */
export const integrityDeviceBindingsTable = pgTable("integrity_device_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  installationDigest: text("installation_digest").notNull(),
  platform: text("platform").notNull(),
  environment: text("environment").notNull(),
  status: text("status").notNull().default("active"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_integrity_device_owner_installation").on(
    table.userId,
    table.installationDigest,
    table.platform,
    table.environment,
  ),
  uniqueIndex("uq_integrity_device_scope").on(
    table.id,
    table.userId,
    table.platform,
    table.environment,
  ),
  uniqueIndex("uq_integrity_device_owner_environment").on(table.id, table.userId, table.environment),
  index("idx_integrity_device_owner_status").on(table.userId, table.status, table.lastSeenAt.desc()),
  check("ck_integrity_device_installation_digest", sql`${table.installationDigest} ~ '^[a-f0-9]{64}$'`),
  check("ck_integrity_device_platform", sql`${table.platform} in ('ios','android')`),
  check("ck_integrity_device_environment", sql`${table.environment} in ('development','production')`),
  check("ck_integrity_device_status", sql`${table.status} in ('active','revoked')`),
  check("ck_integrity_device_revocation", sql`(${table.status} = 'active' and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null)`),
]);

/** Apple App Attest key material. Phase A only creates the fail-closed shape. */
export const appIntegrityKeysTable = pgTable("app_integrity_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  deviceBindingId: uuid("device_binding_id").notNull().references(() => integrityDeviceBindingsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("ios"),
  environment: text("environment").notNull(),
  keyId: text("key_id").notNull(),
  keyIdHash: text("key_id_hash").notNull(),
  publicKeySpki: bytea("public_key_spki"),
  formatPolicy: text("format_policy"),
  receiptCiphertext: bytea("receipt_ciphertext"),
  receiptKeyVersion: text("receipt_key_version"),
  appIdPrefix: text("app_id_prefix"),
  bundleId: text("bundle_id"),
  bundleVersion: text("bundle_version"),
  aaguidEnvironment: text("aaguid_environment"),
  validationCategory: integer("validation_category"),
  lastAssertionCounter: bigint("last_assertion_counter", { mode: "bigint" }).notNull().default(0n),
  status: text("status").notNull().default("pending"),
  attestedAt: timestamp("attested_at", { withTimezone: true }),
  lastAssertedAt: timestamp("last_asserted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_app_integrity_key_environment_hash").on(table.environment, table.keyIdHash),
  uniqueIndex("uq_app_integrity_key_owner_device").on(table.userId, table.deviceBindingId, table.keyIdHash),
  index("idx_app_integrity_key_owner_status").on(table.userId, table.status, table.updatedAt.desc()),
  check("ck_app_integrity_key_platform", sql`${table.platform} = 'ios'`),
  check("ck_app_integrity_key_environment", sql`${table.environment} in ('development','production')`),
  check("ck_app_integrity_key_id", sql`${table.keyId} ~ '^[A-Za-z0-9_-]{43}$'`),
  check("ck_app_integrity_key_id_hash", sql`${table.keyIdHash} ~ '^[a-f0-9]{64}$'`),
  check("ck_app_integrity_key_format", sql`${table.formatPolicy} is null or ${table.formatPolicy} in ('apple_appattest_legacy_v1','apple_appattest_extensions_v2')`),
  check("ck_app_integrity_key_counter", sql`${table.lastAssertionCounter} >= 0`),
  check("ck_app_integrity_key_status", sql`${table.status} in ('pending','active','revoked','lost','compromised')`),
  check("ck_app_integrity_key_receipt_pair", sql`(${table.receiptCiphertext} is null) = (${table.receiptKeyVersion} is null)`),
  check("ck_app_integrity_key_active_shape", sql`${table.status} <> 'active' or (
    ${table.publicKeySpki} is not null and ${table.formatPolicy} is not null
    and ${table.receiptCiphertext} is not null and ${table.receiptKeyVersion} is not null
    and ${table.appIdPrefix} is not null and ${table.bundleId} is not null
    and ${table.bundleVersion} is not null and ${table.aaguidEnvironment} is not null
    and ${table.attestedAt} is not null
  )`),
  check("ck_app_integrity_key_revocation", sql`${table.status} not in ('revoked','lost','compromised') or ${table.revokedAt} is not null`),
  foreignKey({
    name: "app_integrity_keys_owner_device_fkey",
    columns: [table.deviceBindingId, table.userId, table.platform, table.environment],
    foreignColumns: [
      integrityDeviceBindingsTable.id,
      integrityDeviceBindingsTable.userId,
      integrityDeviceBindingsTable.platform,
      integrityDeviceBindingsTable.environment,
    ],
  }).onDelete("cascade"),
]);

export const integrityChallengesTable = pgTable("integrity_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  deviceBindingId: uuid("device_binding_id").notNull().references(() => integrityDeviceBindingsTable.id, { onDelete: "cascade" }),
  authSessionHash: text("auth_session_hash").notNull(),
  purpose: text("purpose").notNull(),
  platform: text("platform").notNull(),
  environment: text("environment").notNull(),
  appleKeyIdHash: text("apple_key_id_hash"),
  nonceHash: text("nonce_hash").notNull(),
  principalBindingHash: text("principal_binding_hash").notNull(),
  principalBindingKeyVersion: text("principal_binding_key_version").notNull(),
  canonicalizationVersion: text("canonicalization_version").notNull(),
  status: text("status").notNull().default("issued"),
  proofDigest: text("proof_digest"),
  requestDigest: text("request_digest"),
  idempotencyKey: text("idempotency_key"),
  // Declared without an inline reference to avoid a circular TypeScript
  // initializer. Migration 0014 installs the deferred FK after both tables
  // exist, while integrity_verifications.challenge_id owns the forward edge.
  verificationAttemptId: uuid("verification_attempt_id"),
  leaseGeneration: integer("lease_generation").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  proofCiphertext: bytea("proof_ciphertext"),
  proofKeyVersion: text("proof_key_version"),
  proofDeleteAt: timestamp("proof_delete_at", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  attemptCount: integer("attempt_count").notNull().default(0),
}, (table) => [
  index("idx_integrity_challenge_owner_status").on(table.userId, table.status, table.expiresAt),
  index("idx_integrity_challenge_device_status").on(table.deviceBindingId, table.status, table.expiresAt),
  uniqueIndex("uq_integrity_challenge_owner_idempotency").on(table.userId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  uniqueIndex("uq_integrity_challenge_proof_digest").on(table.proofDigest)
    .where(sql`${table.proofDigest} is not null`),
  uniqueIndex("uq_integrity_challenge_scope").on(
    table.id,
    table.userId,
    table.deviceBindingId,
    table.platform,
    table.environment,
  ),
  foreignKey({
    name: "integrity_challenges_owner_device_fkey",
    columns: [table.deviceBindingId, table.userId, table.platform, table.environment],
    foreignColumns: [
      integrityDeviceBindingsTable.id,
      integrityDeviceBindingsTable.userId,
      integrityDeviceBindingsTable.platform,
      integrityDeviceBindingsTable.environment,
    ],
  }).onDelete("cascade"),
  check("ck_integrity_challenge_digest", sql`${table.authSessionHash} ~ '^[a-f0-9]{64}$'
    and ${table.nonceHash} ~ '^[a-f0-9]{64}$' and ${table.principalBindingHash} ~ '^[a-f0-9]{64}$'
    and (${table.appleKeyIdHash} is null or ${table.appleKeyIdHash} ~ '^[a-f0-9]{64}$')
    and (${table.proofDigest} is null or ${table.proofDigest} ~ '^[a-f0-9]{64}$')
    and (${table.requestDigest} is null or ${table.requestDigest} ~ '^[A-Za-z0-9_-]{43}$')`),
  check("ck_integrity_challenge_binding_key_version", sql`length(${table.principalBindingKeyVersion}) between 1 and 64 and ${table.principalBindingKeyVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'`),
  check("ck_integrity_challenge_canonicalization", sql`${table.canonicalizationVersion} = 'age-integrity-v1'`),
  check("ck_integrity_challenge_purpose", sql`${table.purpose} in ('platform_age_signal','apple_key_attestation')`),
  check("ck_integrity_challenge_purpose_platform", sql`${table.purpose} = 'platform_age_signal' or (${table.purpose} = 'apple_key_attestation' and ${table.platform} = 'ios')`),
  check("ck_integrity_challenge_platform", sql`${table.platform} in ('ios','android')`),
  check("ck_integrity_challenge_environment", sql`${table.environment} in ('development','production')`),
  check("ck_integrity_challenge_apple_key", sql`(${table.platform} = 'ios' and ${table.appleKeyIdHash} is not null) or (${table.platform} = 'android' and ${table.appleKeyIdHash} is null)`),
  check("ck_integrity_challenge_status", sql`${table.status} in ('issued','verifying','consumed','rejected','expired','indeterminate')`),
  check("ck_integrity_challenge_expiry", sql`${table.expiresAt} > ${table.issuedAt}`),
  check("ck_integrity_challenge_attempts", sql`${table.attemptCount} >= 0 and ${table.leaseGeneration} >= 0`),
  check("ck_integrity_challenge_proof_ciphertext", sql`(
    ${table.proofCiphertext} is null and ${table.proofKeyVersion} is null and ${table.proofDeleteAt} is null
  ) or (
    ${table.platform} = 'android' and ${table.reservedAt} is not null and ${table.proofCiphertext} is not null
    and ${table.proofKeyVersion} is not null and ${table.proofDeleteAt} is not null
    and ${table.proofDeleteAt} <= ${table.reservedAt} + interval '5 minutes'
  )`),
  check("ck_integrity_challenge_state_shape", sql`(
    ${table.status} = 'issued' and ${table.proofDigest} is null and ${table.requestDigest} is null
      and ${table.idempotencyKey} is null and ${table.verificationAttemptId} is null
      and ${table.reservedAt} is null and ${table.terminalAt} is null
  ) or (
    ${table.status} = 'verifying' and ${table.proofDigest} is not null and ${table.requestDigest} is not null
      and ${table.idempotencyKey} is not null and ${table.verificationAttemptId} is not null
      and ${table.reservedAt} is not null and ${table.terminalAt} is null and ${table.leaseGeneration} >= 1
  ) or (
    ${table.status} = 'consumed' and ${table.proofDigest} is not null and ${table.requestDigest} is not null
      and ${table.idempotencyKey} is not null and ${table.verificationAttemptId} is not null
      and ${table.reservedAt} is not null and ${table.consumedAt} is not null and ${table.terminalAt} is not null
  ) or (
    ${table.status} in ('rejected','indeterminate') and ${table.proofDigest} is not null
      and ${table.requestDigest} is not null and ${table.idempotencyKey} is not null
      and ${table.verificationAttemptId} is not null and ${table.reservedAt} is not null
      and ${table.terminalAt} is not null and ${table.failureCode} is not null
  ) or (
    ${table.status} = 'expired' and ${table.terminalAt} is not null and ${table.failureCode} is not null
  )`),
]);

export const integrityVerificationsTable = pgTable("integrity_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  deviceBindingId: uuid("device_binding_id").notNull().references(() => integrityDeviceBindingsTable.id, { onDelete: "cascade" }),
  challengeId: uuid("challenge_id").notNull().references(() => integrityChallengesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  purpose: text("purpose").notNull(),
  platform: text("platform").notNull(),
  environment: text("environment").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  envelopeDigest: text("envelope_digest").notNull(),
  requestDigest: text("request_digest").notNull(),
  proofDigest: text("proof_digest").notNull(),
  outcomeCode: text("outcome_code"),
  appBuildDecision: text("app_build_decision").notNull().default("not_evaluated"),
  deviceDecision: text("device_decision").notNull().default("not_evaluated"),
  testingResponse: boolean("testing_response"),
  policyVersion: text("policy_version").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_integrity_verification_challenge").on(table.challengeId),
  uniqueIndex("uq_integrity_verification_owner_idempotency").on(table.userId, table.idempotencyKey),
  index("idx_integrity_verification_owner_created").on(table.userId, table.createdAt.desc()),
  check("ck_integrity_verification_provider", sql`${table.provider} in ('apple_app_attest','google_play_integrity_standard')`),
  check("ck_integrity_verification_provider_platform", sql`(${table.provider} = 'apple_app_attest' and ${table.platform} = 'ios') or (${table.provider} = 'google_play_integrity_standard' and ${table.platform} = 'android')`),
  check("ck_integrity_verification_purpose", sql`${table.purpose} = 'platform_age_signal'`),
  check("ck_integrity_verification_environment", sql`${table.environment} in ('development','production')`),
  check("ck_integrity_verification_status", sql`${table.status} in ('verifying','verified','rejected','expired','indeterminate')`),
  check("ck_integrity_verification_idempotency", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("ck_integrity_verification_digests", sql`${table.envelopeDigest} ~ '^[a-f0-9]{64}$'
    and ${table.requestDigest} ~ '^[A-Za-z0-9_-]{43}$' and ${table.proofDigest} ~ '^[a-f0-9]{64}$'`),
  check("ck_integrity_verification_policy", sql`length(${table.policyVersion}) between 1 and 80 and ${table.policyVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'`),
  check("ck_integrity_verification_state_shape", sql`(
    ${table.status} = 'verifying' and ${table.terminalAt} is null and ${table.verifiedAt} is null
  ) or (
    ${table.status} = 'verified' and ${table.terminalAt} is not null and ${table.verifiedAt} is not null
      and ${table.outcomeCode} = 'verified'
  ) or (
    ${table.status} in ('rejected','expired','indeterminate') and ${table.terminalAt} is not null
      and ${table.verifiedAt} is null and ${table.outcomeCode} is not null
  )`),
  foreignKey({
    name: "integrity_verifications_owner_challenge_fkey",
    columns: [table.challengeId, table.userId, table.deviceBindingId, table.platform, table.environment],
    foreignColumns: [
      integrityChallengesTable.id,
      integrityChallengesTable.userId,
      integrityChallengesTable.deviceBindingId,
      integrityChallengesTable.platform,
      integrityChallengesTable.environment,
    ],
  }).onDelete("cascade"),
]);

/**
 * Current store-provided age signal per platform. The mobile bridge does not
 * expose a server-verifiable proof, so public clients can only write the
 * restrictive `device_reported_monitoring` trust state. Exact birth dates,
 * Play install IDs and parental-control details are deliberately excluded.
 */
export const platformAgeSignalsTable = pgTable("platform_age_signals", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  source: text("source").notNull(),
  sharingStatus: text("sharing_status").notNull(),
  ageBand: text("age_band"),
  trustStatus: text("trust_status").notNull().default("device_reported_monitoring"),
  verificationId: uuid("verification_id").references(() => integrityVerificationsTable.id, { onDelete: "set null" }),
  assuranceKind: text("assurance_kind"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  verifiedBuild: text("verified_build"),
  verificationPolicyVersion: text("verification_policy_version"),
  pendingConflict: jsonb("pending_conflict").$type<{
    status: "shared" | "not_shared" | "verification_required" | "not_required" | "unsupported" | "error";
    ageBand: "under_13" | "13_15" | "16_17" | "18_plus" | null;
    observedAt: string;
  }>(),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.platform] }),
  index("idx_platform_age_signal_user_observed").on(table.userId, table.lastObservedAt.desc()),
  check("ck_platform_age_signal_platform", sql`${table.platform} in ('ios','android')`),
  check("ck_platform_age_signal_source", sql`${table.source} in ('apple_declared_age_range','google_play_age_signals')`),
  check("ck_platform_age_signal_platform_source", sql`(${table.platform} = 'ios' and ${table.source} = 'apple_declared_age_range') or (${table.platform} = 'android' and ${table.source} = 'google_play_age_signals')`),
  check("ck_platform_age_signal_status", sql`${table.sharingStatus} in ('shared','not_shared','verification_required','not_required','unsupported','error')`),
  check("ck_platform_age_signal_band", sql`${table.ageBand} is null or ${table.ageBand} in ('under_13','13_15','16_17','18_plus')`),
  check("ck_platform_age_signal_shape", sql`(${table.sharingStatus} = 'shared' and ${table.ageBand} is not null) or (${table.sharingStatus} <> 'shared' and ${table.ageBand} is null)`),
  check("ck_platform_age_signal_trust", sql`${table.trustStatus} in ('device_reported_monitoring','server_verified')`),
  check("ck_platform_age_signal_assurance", sql`${table.assuranceKind} is null or ${table.assuranceKind} = 'integrity_bound_report'`),
  check("ck_platform_age_signal_verified_shape", sql`(
    ${table.trustStatus} = 'device_reported_monitoring' and ${table.verificationId} is null
      and ${table.assuranceKind} is null and ${table.verifiedAt} is null and ${table.expiresAt} is null
      and ${table.verifiedBuild} is null and ${table.verificationPolicyVersion} is null
  ) or (
    ${table.trustStatus} = 'server_verified' and ${table.verificationId} is not null
      and ${table.assuranceKind} = 'integrity_bound_report' and ${table.verifiedAt} is not null
      and ${table.expiresAt} > ${table.verifiedAt} and ${table.verifiedBuild} is not null
      and ${table.verificationPolicyVersion} is not null
  )`),
  check("ck_platform_age_signal_pending_conflict", sql`${table.pendingConflict} is null or (
    jsonb_typeof(${table.pendingConflict}) = 'object'
    and ${table.pendingConflict} ?& array['status','ageBand','observedAt']
    and (${table.pendingConflict} - 'status' - 'ageBand' - 'observedAt') = '{}'::jsonb
    and ${table.pendingConflict}->>'status' in ('shared','not_shared','verification_required','not_required','unsupported','error')
    and (
      (${table.pendingConflict}->>'status' = 'shared' and ${table.pendingConflict}->>'ageBand' in ('under_13','13_15','16_17','18_plus'))
      or (${table.pendingConflict}->>'status' <> 'shared' and ${table.pendingConflict}->'ageBand' = 'null'::jsonb)
    )
  )`),
  check("ck_platform_age_signal_observed_order", sql`${table.lastObservedAt} >= ${table.firstObservedAt}`),
]);

export const guardianLinksTable = pgTable("guardian_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  minorUserId: uuid("minor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  guardianUserId: uuid("guardian_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Legado: o novo fluxo não coleta e-mail do responsável. A coluna continua
  // apenas para leitura expand/contract de registros anteriores.
  guardianEmailHash: text("guardian_email_hash"),
  status: text("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  index("idx_guardian_minor").on(table.minorUserId),
  check("ck_guardian_link_status", sql`${table.status} in ('pending','verified','revoked')`),
  check("ck_guardian_not_minor", sql`${table.guardianUserId} is null or ${table.guardianUserId} <> ${table.minorUserId}`),
]);

export const guardianInvitationsTable = pgTable("guardian_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  minorUserId: uuid("minor_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenDigest: text("token_digest").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  acceptedByUserId: uuid("accepted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  guardianLinkId: uuid("guardian_link_id").references(() => guardianLinksTable.id, { onDelete: "set null" }),
  // Binds a consumed invite to the exact authenticated acceptance payload.
  // This prevents a new Idempotency-Key from turning a replay into a change of
  // legal versions or optional permissions.
  acceptanceRequestHash: text("acceptance_request_hash"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_guardian_invitation_digest").on(table.tokenDigest),
  index("idx_guardian_invitation_minor_created").on(table.minorUserId, table.createdAt.desc()),
  check("ck_guardian_invitation_digest", sql`${table.tokenDigest} ~ '^[a-f0-9]{64}$'`),
  check("ck_guardian_invitation_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    "ck_guardian_invitation_use_actor",
    sql`${table.acceptedByUserId} is null or ${table.usedAt} is not null`,
  ),
  check(
    "ck_guardian_invitation_acceptance_binding",
    sql`(${table.guardianLinkId} is null and ${table.acceptanceRequestHash} is null)
      or (${table.usedAt} is not null and ${table.acceptanceRequestHash} ~ '^[a-f0-9]{64}$')`,
  ),
]);

export const consentsTable = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  documentVersion: text("document_version").notNull(),
  granted: boolean("granted").notNull(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorRole: text("actor_role").notNull().default("self"),
  policyVersion: text("policy_version").notNull().default("legacy"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
}, (table) => [
  index("idx_consents_user_kind").on(table.userId, table.kind),
  index("idx_consents_user_kind_recorded").on(
    table.userId,
    table.kind,
    table.recordedAt.desc(),
    table.id.desc(),
  ),
  check("ck_consent_actor_role", sql`${table.actorRole} in ('self','guardian','system')`),
]);

export const identityOperationsTable = pgTable("identity_operations", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  resourceId: text("resource_id"),
  response: jsonb("response").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.idempotencyKey] }),
  check("ck_identity_operation_idempotency_key", sql`length(${table.idempotencyKey}) between 8 and 128`),
  check("ck_identity_operation_request_hash", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
]);

export const devicesTable = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  installationId: text("installation_id").notNull(),
  platform: text("platform").notNull(),
  integrityState: text("integrity_state").notNull().default("unknown"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [uniqueIndex("uq_device_installation").on(table.installationId)]);

export const dataRequestsTable = pgTable("data_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  subjectHash: text("subject_hash").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  phase: text("phase").notNull().default("requested"),
  stateVersion: integer("state_version").notNull().default(1),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  errorCode: text("error_code"),
  exportChecksumSha256: text("export_checksum_sha256"),
  exportSizeBytes: bigint("export_size_bytes", { mode: "number" }),
  exportObjectKey: text("export_object_key"),
  exportObjectGeneration: text("export_object_generation"),
  exportExpiresAt: timestamp("export_expires_at", { withTimezone: true }),
  exportRevokedAt: timestamp("export_revoked_at", { withTimezone: true }),
  exportRevocationRequired: boolean("export_revocation_required").notNull().default(true),
  retentionPolicyId: text("retention_policy_id"),
  retentionPolicySha256: text("retention_policy_sha256"),
  evidence: jsonb("evidence").notNull().default({}).$type<Record<string, unknown>>(),
}, (table) => [
  index("idx_data_requests_user_status").on(table.userId, table.status),
  index("idx_data_requests_subject_hash").on(table.subjectHash, table.requestedAt),
  uniqueIndex("uq_data_requests_active_user").on(table.userId)
    .where(sql`${table.userId} is not null and ${table.status} in ('pending','processing')`),
  check("ck_data_request_kind", sql`${table.kind} in ('export','deletion')`),
  check("ck_data_request_status", sql`${table.status} in ('pending','processing','completed','failed')`),
  check("ck_data_request_phase", sql`${table.phase} in ('requested','export_snapshot','export_stored','access_revoked','external_accounts_erased','internal_data_erased','completed')`),
  check("ck_data_request_state_version", sql`${table.stateVersion} > 0`),
  check("ck_data_request_subject_hash", sql`${table.subjectHash} ~ '^[a-f0-9]{64}$'`),
  check("ck_data_request_export_checksum", sql`${table.exportChecksumSha256} is null or ${table.exportChecksumSha256} ~ '^[a-f0-9]{64}$'`),
  check("ck_data_request_retention_checksum", sql`${table.retentionPolicySha256} is null or ${table.retentionPolicySha256} ~ '^[a-f0-9]{64}$'`),
  check("ck_data_request_export_size", sql`${table.exportSizeBytes} is null or ${table.exportSizeBytes} >= 0`),
  check("ck_data_request_export_generation", sql`${table.exportObjectGeneration} is null or ${table.exportObjectGeneration} ~ '^[0-9]+$'`),
  check("ck_data_request_export_revocation", sql`${table.exportRevokedAt} is null or (${table.kind} = 'export' and ${table.exportObjectKey} is not null)`),
  check("ck_data_request_completed_shape", sql`${table.status} <> 'completed' or (${table.phase} = 'completed' and ${table.completedAt} is not null and ${table.errorCode} is null)`),
]);

export const dataRequestEvidenceTable = pgTable("data_request_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => dataRequestsTable.id, { onDelete: "restrict" }),
  step: text("step").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  evidence: jsonb("evidence").notNull().default({}).$type<Record<string, unknown>>(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_data_request_evidence_step").on(table.requestId, table.step),
  uniqueIndex("uq_data_request_evidence_idempotency").on(table.requestId, table.idempotencyKey),
  index("idx_data_request_evidence_request_time").on(table.requestId, table.recordedAt),
  check("ck_data_request_evidence_step", sql`${table.step} in ('requested','processing_started','export_snapshot','export_stored','export_objects_revoked','access_revoked','external_accounts_erased','internal_data_erased','completed')`),
  check("ck_data_request_evidence_idempotency_key", sql`length(${table.idempotencyKey}) between 8 and 160`),
]);

export const dataRequestExportAccessEventsTable = pgTable("data_request_export_access_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => dataRequestsTable.id, { onDelete: "restrict" }),
  subjectHash: text("subject_hash").notNull(),
  eventType: text("event_type").notNull(),
  objectGeneration: text("object_generation").notNull(),
  byteStart: bigint("byte_start", { mode: "number" }),
  byteEnd: bigint("byte_end", { mode: "number" }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  requestCorrelationId: text("request_correlation_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_data_request_export_access_request_time").on(table.requestId, table.recordedAt, table.id),
  uniqueIndex("uq_data_request_export_terminal_event").on(table.requestId, table.eventType)
    .where(sql`${table.eventType} in ('revoked','expired_denied')`),
  check("ck_data_request_export_access_subject", sql`${table.subjectHash} ~ '^[a-f0-9]{64}$'`),
  check("ck_data_request_export_access_type", sql`${table.eventType} in ('accessed','revoked','expired_denied')`),
  check("ck_data_request_export_access_generation", sql`${table.objectGeneration} ~ '^[0-9]+$'`),
  check("ck_data_request_export_access_request_id", sql`length(${table.requestCorrelationId}) between 8 and 128`),
  check("ck_data_request_export_access_shape", sql`(
    (${table.eventType} = 'accessed' and ${table.byteStart} is not null and ${table.byteEnd} is not null
      and ${table.sizeBytes} is not null and ${table.byteStart} >= 0 and ${table.byteEnd} >= ${table.byteStart}
      and ${table.sizeBytes} = ${table.byteEnd} - ${table.byteStart} + 1)
    or (${table.eventType} in ('revoked','expired_denied') and ${table.byteStart} is null
      and ${table.byteEnd} is null and ${table.sizeBytes} is null)
  )`),
]);

// Versioned catalog and editorial workflow
export const productsTable = pgTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  institution: text("institution"),
  category: text("category").notNull(),
  defaultTrack: text("default_track"),
  status: text("status").notNull().default("draft"),
  ...auditColumns,
});

export const userProductSelectionsTable = pgTable("user_product_selections", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => productsTable.id),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const examVersionsTable = pgTable("exam_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: text("product_id").notNull().references(() => productsTable.id),
  code: text("code").notNull(),
  board: text("board"),
  role: text("role"),
  phase: text("phase"),
  modality: text("modality"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  status: text("status").notNull().default("draft"),
  ...auditColumns,
}, (table) => [uniqueIndex("uq_exam_version_product_code").on(table.productId, table.code)]);

export const subjectsTable = pgTable("subjects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...auditColumns,
});

export const topicsTable = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: text("subject_id").notNull().references(() => subjectsTable.id),
  parentId: uuid("parent_id"),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_topic_subject_slug").on(table.subjectId, table.slug),
  foreignKey({ columns: [table.parentId], foreignColumns: [table.id], name: "topics_parent_id_fkey" }),
]);

export const blueprintVersionsTable = pgTable("blueprint_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  examVersionId: uuid("exam_version_id").notNull().references(() => examVersionsTable.id),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  rules: jsonb("rules").notNull().$type<Record<string, unknown>>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_blueprint_exam_version").on(table.examVersionId, table.version),
  check("ck_blueprint_version_positive", sql`${table.version} > 0`),
]);

export const blueprintSubjectsTable = pgTable("blueprint_subjects", {
  blueprintVersionId: uuid("blueprint_version_id").notNull().references(() => blueprintVersionsTable.id, { onDelete: "cascade" }),
  subjectId: text("subject_id").notNull().references(() => subjectsTable.id),
  questionCount: integer("question_count").notNull(),
  weight: doublePrecision("weight").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.blueprintVersionId, table.subjectId] }),
  check("ck_blueprint_subject_question_count", sql`${table.questionCount} > 0`),
  check("ck_blueprint_subject_weight", sql`${table.weight} > 0`),
]);

export const sourcesTable = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  owner: text("owner"),
  uri: text("uri"),
  contentHash: text("content_hash").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ...auditColumns,
}, (table) => [uniqueIndex("uq_source_hash").on(table.contentHash)]);

export const licensesTable = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").notNull().references(() => sourcesTable.id),
  status: text("status").notNull().default("pending"),
  licenseType: text("license_type").notNull(),
  territory: text("territory"),
  platforms: jsonb("platforms").$type<string[]>(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  evidenceHash: text("evidence_hash"),
  approvedBy: text("approved_by"),
  permissions: jsonb("permissions").notNull().default([]).$type<string[]>(),
  ...auditColumns,
}, (table) => [
  check("ck_license_permissions", sql`jsonb_typeof(${table.permissions}) = 'array' and ${table.permissions} <@ '["commercial","digital","reproduce","adapt","fragment"]'::jsonb`),
]);

export const questionItemsTable = pgTable("question_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalHash: text("canonical_hash").notNull().unique(),
  origin: text("origin").notNull(),
  sourceId: uuid("source_id").references(() => sourcesTable.id),
  licenseId: uuid("license_id").references(() => licensesTable.id),
  authorId: text("author_id"),
  sourceTransformation: text("source_transformation"),
  ...auditColumns,
}, (table) => [
  check("ck_question_item_origin", sql`${table.origin} in ('original_authoral','official_licensed')`),
  check("ck_question_item_official_license", sql`${table.origin} <> 'official_licensed' or ${table.licenseId} is not null`),
  check("ck_question_item_source_transformation", sql`${table.sourceTransformation} is null or (${table.origin} = 'original_authoral' and ${table.sourceTransformation} = 'original') or (${table.origin} = 'official_licensed' and ${table.sourceTransformation} in ('verbatim','adapted','fragmented'))`),
]);

export const questionVersionsTable = pgTable("question_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionItemId: uuid("question_item_id").notNull().references(() => questionItemsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  examVersionId: uuid("exam_version_id").notNull().references(() => examVersionsTable.id),
  subjectId: text("subject_id").notNull().references(() => subjectsTable.id),
  topicId: uuid("topic_id").notNull().references(() => topicsTable.id),
  statement: text("statement").notNull(),
  solution: text("solution").notNull(),
  difficulty: text("difficulty").notNull(),
  skill: text("skill").notNull(),
  status: text("status").notNull().default("quarantine"),
  contentHash: text("content_hash").notNull(),
  sourcePage: text("source_page"),
  presentationKind: text("presentation_kind").notNull().default("blocked_unclassified"),
  supersedesId: uuid("supersedes_id"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_question_item_version").on(table.questionItemId, table.version),
  index("idx_question_version_catalog").on(table.examVersionId, table.subjectId, table.topicId, table.status),
  foreignKey({ columns: [table.supersedesId], foreignColumns: [table.id], name: "question_versions_supersedes_id_fkey" }),
  check("ck_question_version_positive", sql`${table.version} > 0`),
  check("ck_question_version_difficulty", sql`${table.difficulty} in ('easy','medium','hard')`),
  check("ck_question_version_presentation_kind", sql`${table.presentationKind} in ('blocked_unclassified','text_only','external_assets')`),
]);

export const questionVersionFreezesTable = pgTable("question_version_freezes", {
  questionVersionId: uuid("question_version_id")
    .primaryKey()
    .references(() => questionVersionsTable.id),
  firstReferencedAt: timestamp("first_referenced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reason: text("reason").notNull().default("publication_or_exposure"),
});

export const questionOptionsTable = pgTable("question_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  body: text("body").notNull(),
  isCorrect: boolean("is_correct").notNull().default(false),
  rationale: text("rationale").notNull(),
  orderIndex: integer("order_index").notNull(),
}, (table) => [
  uniqueIndex("uq_question_option_key").on(table.questionVersionId, table.key),
  uniqueIndex("uq_question_one_correct_option").on(table.questionVersionId).where(sql`${table.isCorrect}`),
  check("ck_question_option_order", sql`${table.orderIndex} >= 0`),
]);

export const reviewDecisionsTable = pgTable("review_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  decision: text("decision").notNull(),
  findings: jsonb("findings").$type<Record<string, unknown>>(),
  contentHash: text("content_hash").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_review_question_stage").on(table.questionVersionId, table.stage)]);

export const publicationsTable = pgTable("publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id),
  blueprintVersionId: uuid("blueprint_version_id").references(() => blueprintVersionsTable.id),
  status: text("status").notNull().default("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  reason: text("reason"),
}, (table) => [
  uniqueIndex("uq_publication_question_blueprint").on(
    table.questionVersionId,
    sql`coalesce(${table.blueprintVersionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
  ),
]);

// Learning
export const learningSessionsTable = pgTable("learning_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => productsTable.id),
  examVersionId: uuid("exam_version_id").notNull().references(() => examVersionsTable.id),
  blueprintVersionId: uuid("blueprint_version_id").references(() => blueprintVersionsTable.id),
  mode: text("mode").notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  status: text("status").notNull().default("active"),
  seed: text("seed").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("idx_learning_session_user_status").on(table.userId, table.status),
  index("idx_learning_session_user_mode_started").on(table.userId, table.mode, table.startedAt),
]);

/**
 * Server-authoritative simulations are intentionally separate from adaptive
 * learning sessions. Their JSON snapshots are revalidated by the versioned
 * scoring engine on every mutation; the relational rows add ownership,
 * ordering and idempotency constraints that JSON alone cannot provide.
 */
export const simulationSessionsTable = pgTable("simulation_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => productsTable.id),
  examVersionId: uuid("exam_version_id").notNull().references(() => examVersionsTable.id),
  blueprintVersionId: uuid("blueprint_version_id").notNull().references(() => blueprintVersionsTable.id),
  createIdempotencyKey: text("create_idempotency_key").notNull(),
  status: text("status").notNull().default("active"),
  rules: jsonb("rules").notNull().$type<Record<string, unknown>>(),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
  snapshotHash: text("snapshot_hash").notNull(),
  state: jsonb("state").notNull().$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  resultHash: text("result_hash"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finishReason: text("finish_reason"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_simulation_create_idempotency").on(table.userId, table.createIdempotencyKey),
  uniqueIndex("uq_simulation_one_active_user").on(table.userId).where(sql`${table.status} = 'active'`),
  index("idx_simulation_user_status_started").on(table.userId, table.status, table.startedAt.desc()),
  index("idx_simulation_deadline_status").on(table.status, table.deadlineAt),
  check("ck_simulation_snapshot_hash", sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`),
  check("ck_simulation_result_hash", sql`${table.resultHash} is null or ${table.resultHash} ~ '^[a-f0-9]{64}$'`),
  check("ck_simulation_deadline", sql`${table.deadlineAt} > ${table.startedAt}`),
  check("ck_simulation_status", sql`${table.status} in ('active','finalized')`),
  check("ck_simulation_finish_reason", sql`${table.finishReason} is null or ${table.finishReason} in ('question-count','deadline')`),
  check("ck_simulation_state_shape", sql`(
    ${table.status} = 'active' and ${table.finalizedAt} is null and ${table.finishReason} is null
      and ${table.result} is null and ${table.resultHash} is null
    ) or (
    ${table.status} = 'finalized' and ${table.finalizedAt} is not null and ${table.finishReason} is not null
      and ${table.result} is not null and ${table.resultHash} is not null
  )`),
]);

export const simulationQuestionsTable = pgTable("simulation_questions", {
  simulationId: uuid("simulation_id").notNull().references(() => simulationSessionsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id),
  subjectId: text("subject_id").notNull().references(() => subjectsTable.id),
  optionIds: uuid("option_ids").array().notNull(),
  correctOptionId: uuid("correct_option_id").notNull().references(() => questionOptionsTable.id),
}, (table) => [
  primaryKey({ columns: [table.simulationId, table.questionVersionId] }),
  uniqueIndex("uq_simulation_question_position").on(table.simulationId, table.position),
  check("ck_simulation_question_position", sql`${table.position} >= 0`),
  check("ck_simulation_question_options", sql`cardinality(${table.optionIds}) between 2 and 100`),
  check("ck_simulation_question_correct_in_options", sql`${table.correctOptionId} = any(${table.optionIds})`),
]);

export const simulationAnswersTable = pgTable("simulation_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  simulationId: uuid("simulation_id").notNull().references(() => simulationSessionsTable.id, { onDelete: "cascade" }),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id),
  selectedOptionId: uuid("selected_option_id").notNull().references(() => questionOptionsTable.id),
  idempotencyKey: text("idempotency_key").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_simulation_first_answer").on(table.simulationId, table.questionVersionId),
  uniqueIndex("uq_simulation_answer_idempotency").on(table.simulationId, table.idempotencyKey),
  foreignKey({
    columns: [table.simulationId, table.questionVersionId],
    foreignColumns: [simulationQuestionsTable.simulationId, simulationQuestionsTable.questionVersionId],
    name: "simulation_answers_question_fkey",
  }),
]);

export const itemExposuresTable = pgTable("item_exposures", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => learningSessionsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id),
  sequence: integer("sequence").notNull(),
  selectionBucket: text("selection_bucket").notNull(),
  exposedAt: timestamp("exposed_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("uq_exposure_session_sequence").on(table.sessionId, table.sequence),
  index("idx_exposure_user_question").on(table.userId, table.questionVersionId),
  index("idx_exposure_user_exposed_at").on(table.userId, table.exposedAt),
]);

export const attemptsTable = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => learningSessionsTable.id, { onDelete: "cascade" }),
  exposureId: uuid("exposure_id").notNull().references(() => itemExposuresTable.id),
  questionVersionId: uuid("question_version_id").notNull().references(() => questionVersionsTable.id),
  selectedOptionId: uuid("selected_option_id").notNull().references(() => questionOptionsTable.id),
  isCorrect: boolean("is_correct").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  validForCalibration: boolean("valid_for_calibration").notNull(),
  masteryProbability: doublePrecision("mastery_probability").notNull(),
  masteryObservations: integer("mastery_observations").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_attempt_user_idempotency").on(table.userId, table.idempotencyKey),
  uniqueIndex("uq_attempt_first_exposure").on(table.exposureId),
  index("idx_attempt_user_answered").on(table.userId, table.answeredAt),
  check("ck_attempt_elapsed", sql`${table.elapsedMs} >= 0`),
  check("ck_attempt_mastery_probability", sql`${table.masteryProbability} between 0 and 1`),
  check("ck_attempt_mastery_observations", sql`${table.masteryObservations} >= 0`),
]);

export const topicMasteryTable = pgTable("topic_mastery", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topicsTable.id),
  probability: doublePrecision("probability").notNull().default(0.35),
  observations: integer("observations").notNull().default(0),
  algorithmVersion: text("algorithm_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.topicId] }),
  check("ck_topic_mastery_probability", sql`${table.probability} between 0 and 1`),
  check("ck_topic_mastery_observations", sql`${table.observations} >= 0`),
]);

export const reviewSchedulesTable = pgTable("review_schedules", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topicsTable.id),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  intervalDays: integer("interval_days").notNull().default(1),
  easeFactor: doublePrecision("ease_factor").notNull().default(2.5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.topicId] })]);

// Billing
export const billingCustomersTable = pgTable("billing_customers", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  appUserId: uuid("app_user_id").notNull().defaultRandom().unique(),
  status: text("status").notNull().default("active"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  check("ck_billing_customer_status", sql`${table.status} in ('active','revoked')`),
  check("ck_billing_customer_revocation", sql`(
    (${table.status} = 'active' and ${table.revokedAt} is null)
    or (${table.status} = 'revoked' and ${table.revokedAt} is not null)
  )`),
]);

export const billingCustomerAliasesTable = pgTable("billing_customer_aliases", {
  alias: text("alias").primaryKey(),
  userId: uuid("user_id").notNull().references(() => billingCustomersTable.userId, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_billing_alias_user").on(table.userId),
  check("ck_billing_alias_length", sql`length(${table.alias}) between 1 and 100`),
  check("ck_billing_alias_kind", sql`${table.kind} in ('canonical','legacy_internal','legacy_clerk','revenuecat_alias')`),
]);

export const entitlementsTable = pgTable("entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  status: text("status").notNull(),
  productSku: text("product_sku").notNull(),
  store: text("store").notNull(),
  originalTransactionId: text("original_transaction_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  sourceEventId: text("source_event_id").notNull(),
  sourceOccurredAt: timestamp("source_occurred_at", { withTimezone: true }).notNull(),
  provider: text("provider").notNull().default("revenuecat"),
  environment: text("environment").notNull().default("production"),
  lifecycleVersion: integer("lifecycle_version").notNull().default(1),
  gracePeriodExpiresAt: timestamp("grace_period_expires_at", { withTimezone: true }),
  autoResumeAt: timestamp("auto_resume_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_entitlement_user_key").on(table.userId, table.key),
  index("idx_entitlement_status_expiry").on(table.status, table.expiresAt),
  check("ck_entitlement_key", sql`${table.key} = 'pro'`),
  check("ck_entitlement_status", sql`${table.status} in ('active','grace_period','paused','expired','revoked','inactive')`),
  check("ck_entitlement_product", sql`${table.productSku} in ('iaaprova.pro.monthly','iaaprova.pro.monthly:monthly-auto-renewing')`),
  check("ck_entitlement_store", sql`${table.store} in ('APP_STORE','PLAY_STORE','REVENUECAT')`),
  check("ck_entitlement_provider", sql`${table.provider} = 'revenuecat'`),
  check("ck_entitlement_environment", sql`${table.environment} in ('production','sandbox')`),
  check("ck_entitlement_lifecycle", sql`${table.lifecycleVersion} = 1
    and (${table.status} <> 'grace_period' or ${table.gracePeriodExpiresAt} is not null)
    and (${table.status} <> 'paused' or ${table.autoResumeAt} is not null)
    and (${table.status} <> 'active' or ${table.expiresAt} is not null)
    and (${table.status} = 'grace_period' or ${table.gracePeriodExpiresAt} is null)
    and (${table.status} = 'paused' or ${table.autoResumeAt} is null)
    and (${table.store} <> 'APP_STORE' or ${table.productSku} = 'iaaprova.pro.monthly')
    and (${table.store} <> 'PLAY_STORE' or ${table.productSku} = 'iaaprova.pro.monthly:monthly-auto-renewing')`),
  check("ck_entitlement_text_bounds", sql`length(${table.sourceEventId}) between 1 and 255
    and (${table.originalTransactionId} is null or length(${table.originalTransactionId}) between 1 and 255)`),
]);

export const subscriptionEventsTable = pgTable("subscription_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  providerEventId: text("provider_event_id").notNull().unique(),
  type: text("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  schemaVersion: integer("schema_version").notNull().default(1),
  environment: text("environment").notNull().default("production"),
  store: text("store"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("ck_subscription_event_schema", sql`${table.schemaVersion} = 1`),
  check("ck_subscription_event_environment", sql`${table.environment} in ('production','sandbox')`),
  check("ck_subscription_event_store", sql`${table.store} is null or ${table.store} in ('APP_STORE','PLAY_STORE')`),
  check("ck_subscription_event_type", sql`${table.type} in (
    'INITIAL_PURCHASE','RENEWAL','CANCELLATION','UNCANCELLATION','NON_RENEWING_PURCHASE',
    'SUBSCRIPTION_PAUSED','EXPIRATION','BILLING_ISSUE','PRODUCT_CHANGE',
    'SUBSCRIPTION_EXTENDED','REFUND','REFUND_REVERSED','TRANSFER','TEMPORARY_ENTITLEMENT_GRANT'
  )`),
  check("ck_subscription_event_payload", sql`length(${table.providerEventId}) between 1 and 255
    and jsonb_typeof(${table.payload}) = 'object'`),
]);

export const webhookInboxTable = pgTable("webhook_inbox", {
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
}, (table) => [
  primaryKey({ columns: [table.provider, table.eventId] }),
  check("ck_webhook_provider", sql`${table.provider} = 'revenuecat'`),
  check("ck_webhook_status", sql`${table.status} in ('received','processing','processed','stale','ignored','rejected','error')`),
  check("ck_webhook_payload", sql`length(${table.eventId}) between 1 and 255
    and jsonb_typeof(${table.payload}) = 'object'
    and (${table.error} is null or length(${table.error}) between 1 and 255)`),
]);

export const reconciliationRunsTable = pgTable("reconciliation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  checkedCount: integer("checked_count").notNull().default(0),
  mismatchCount: integer("mismatch_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  expectedCount: integer("expected_count").notNull().default(0),
  runDate: date("run_date").notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  cursorCreatedAt: timestamp("cursor_created_at", { withTimezone: true }),
  cursorUserId: uuid("cursor_user_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_reconciliation_provider_day").on(table.provider, table.runDate),
  check("ck_reconciliation_provider", sql`${table.provider} = 'revenuecat'`),
  check("ck_reconciliation_status", sql`${table.status} in ('scheduling','draining','completed','failed')`),
  check("ck_reconciliation_counts", sql`${table.checkedCount} >= 0 and ${table.mismatchCount} >= 0
    and ${table.failedCount} >= 0 and ${table.expectedCount} >= 0
    and ${table.checkedCount} <= ${table.expectedCount}
    and ${table.mismatchCount} <= ${table.checkedCount}
    and ${table.failedCount} <= ${table.checkedCount}`),
]);

export const billingReconciliationItemsTable = pgTable("billing_reconciliation_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => reconciliationRunsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => billingCustomersTable.userId, { onDelete: "cascade" }),
  appUserId: uuid("app_user_id").notNull(),
  outboxEventId: uuid("outbox_event_id").notNull().unique(),
  status: text("status").notNull().default("pending"),
  mismatch: boolean("mismatch").notNull().default(false),
  errorCode: text("error_code"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("uq_billing_reconciliation_run_user").on(table.runId, table.userId),
  index("idx_billing_reconciliation_pending").on(table.runId, table.status, table.createdAt),
  check("ck_billing_reconciliation_status", sql`${table.status} in ('pending','completed','failed')`),
  check("ck_billing_reconciliation_terminal", sql`(
    (${table.status} = 'pending' and ${table.completedAt} is null and ${table.errorCode} is null)
    or (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.errorCode} is null)
    or (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.errorCode} is not null)
  )`),
  check("ck_billing_reconciliation_error", sql`${table.errorCode} is null or length(${table.errorCode}) between 1 and 120`),
]);

// Social, trust and platform
export const socialProfilesTable = pgTable("social_profiles", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  pseudonym: text("pseudonym").notNull().unique(),
  avatarKey: text("avatar_key").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  discoverable: boolean("discoverable").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const friendshipsTable = pgTable("friendships", {
  requesterId: uuid("requester_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  addresseeId: uuid("addressee_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.requesterId, table.addresseeId] }),
  check("ck_friendship_distinct_users", sql`${table.requesterId} <> ${table.addresseeId}`),
]);

export const userBlocksTable = pgTable("user_blocks", {
  blockerId: uuid("blocker_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.blockerId, table.blockedId] }),
  check("ck_user_block_distinct_users", sql`${table.blockerId} <> ${table.blockedId}`),
]);

export const duelMatchesTable = pgTable("duel_matches_v1", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: text("product_id").notNull().references(() => productsTable.id),
  playerOneId: uuid("player_one_id").notNull().references(() => usersTable.id),
  playerTwoId: uuid("player_two_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("matched"),
  seed: text("seed").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  check("ck_duel_distinct_players", sql`${table.playerOneId} <> ${table.playerTwoId}`),
]);

export const rankingSeasonsTable = pgTable("ranking_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: text("product_id").notNull().references(() => productsTable.id),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),
}, (table) => [
  check("ck_ranking_season_dates", sql`${table.endsAt} > ${table.startsAt}`),
]);

export const riskEventsTable = pgTable("risk_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  score: doublePrecision("score").notNull(),
  evidence: jsonb("evidence").notNull().$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reportsTable = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterUserId: uuid("reporter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("idx_reports_target_status").on(table.targetType, table.targetId, table.status),
  index("idx_reports_reporter_target_status").on(table.reporterUserId, table.targetType, table.targetId, table.status),
]);

export const outboxEventsTable = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
}, (table) => [index("idx_outbox_pending").on(table.processedAt, table.availableAt)]);

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  requestId: text("request_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_audit_resource").on(table.resourceType, table.resourceId, table.createdAt)]);

export const featureFlagsTable = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  rules: jsonb("rules").notNull().$type<Record<string, unknown>>(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
