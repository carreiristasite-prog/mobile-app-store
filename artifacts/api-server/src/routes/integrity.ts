import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import {
  CreateIntegrityChallengeRequestSchema,
  IntegrityChallengeResponseSchema,
  IntegrityDeviceBindingResponseSchema,
  IntegrityVerificationResponseSchema,
  RegisterIntegrityDeviceBindingRequestSchema,
  VerifiedPlatformAgeSignalEnvelopeSchema,
} from "@workspace/api-zod";
import {
  ageProfilesTable,
  auditLogsTable,
  db,
  identityOperationsTable,
  integrityChallengesTable,
  integrityDeviceBindingsTable,
  integrityVerificationsTable,
} from "@workspace/db";
import { and, count, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, parse, requireIdempotencyKey } from "../lib/http";
import {
  PHASE_A_PROVIDER_ADAPTERS,
  canonicalEnvelope,
  constantTimeTextEqual,
  deriveAuthSessionHash,
  derivePrincipalBinding,
  deviceBindingRequestDigest,
  integrityEnvelopeDigest,
  loadAppIntegrityConfig,
  sha256Hex,
  type AppIntegrityConfig,
} from "../services/app-integrity";

const router = Router();

const asyncRoute = (handler: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

function appIntegrityConfig(): AppIntegrityConfig {
  try {
    return loadAppIntegrityConfig();
  } catch {
    throw new HttpError(
      503,
      "Verificação de integridade indisponível",
      "A verificação ainda não está configurada neste ambiente.",
      "https://api.iaaprova.com.br/problems/integrity-configuration-unavailable",
    );
  }
}

function requireBoundSession(providerSessionId: string | null): string {
  if (!providerSessionId) {
    throw new HttpError(
      401,
      "Sessão não vinculável",
      "Entre novamente para solicitar uma prova de integridade vinculada à sessão.",
      "https://api.iaaprova.com.br/problems/integrity-session-required",
    );
  }
  return providerSessionId;
}

function enforceParsedBodyLimit(req: Request, maximumBytes: number): void {
  // The application-wide parser has its own hard ceiling. This narrower check
  // enforces the endpoint contract after parsing without retaining raw bodies.
  const bytes = Buffer.byteLength(JSON.stringify(req.body ?? null), "utf8");
  if (bytes > maximumBytes) {
    throw new HttpError(413, "Corpo muito grande", "O payload excede o limite desta operação.");
  }
}

type VerificationRow = {
  id: string;
  status: string;
  outcomeCode: string | null;
};

export function sanitizedVerificationResponse(row: VerificationRow) {
  const status = row.status === "verifying"
    || row.status === "verified"
    || row.status === "rejected"
    || row.status === "expired"
    || row.status === "indeterminate"
    ? row.status
    : "indeterminate";
  const decision = status === "verified"
    ? "verified"
    : status === "rejected"
      ? "proof_rejected"
      : status === "expired"
        ? "challenge_expired"
        : status === "indeterminate"
          ? "verification_unavailable"
          : null;
  return IntegrityVerificationResponseSchema.parse({
    verificationId: row.id,
    status,
    statusUrl: `/api/v1/integrity/verifications/${row.id}`,
    retryAfterSeconds: status === "verifying" ? 2 : null,
    decision,
  });
}

router.post("/integrity/device-bindings", asyncRoute(async (req, res) => {
  enforceParsedBodyLimit(req, 4_096);
  const input = parse(RegisterIntegrityDeviceBindingRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const config = appIntegrityConfig();
  const principal = res.locals.principal;
  const requestDigest = deviceBindingRequestDigest(input);
  const operation = "integrity.device_binding.register.v1";

  const record = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${principal.userId}:${idempotencyKey}`}, 0))`);
    const [existingOperation] = await tx.select().from(identityOperationsTable).where(and(
      eq(identityOperationsTable.userId, principal.userId),
      eq(identityOperationsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingOperation) {
      if (existingOperation.operation !== operation || existingOperation.requestHash !== requestDigest
          || !existingOperation.resourceId) {
        throw new HttpError(409, "Conflito de idempotência", "A chave já foi usada com outro payload.");
      }
      const [replayed] = await tx.select().from(integrityDeviceBindingsTable).where(and(
        eq(integrityDeviceBindingsTable.id, existingOperation.resourceId),
        eq(integrityDeviceBindingsTable.userId, principal.userId),
      )).limit(1);
      if (!replayed) throw new HttpError(409, "Vínculo indisponível", "O resultado anterior não está mais ativo.");
      return replayed;
    }

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`integrity-device:${principal.userId}:${requestDigest}`}, 0))`);
    const [existing] = await tx.select().from(integrityDeviceBindingsTable).where(and(
      eq(integrityDeviceBindingsTable.userId, principal.userId),
      eq(integrityDeviceBindingsTable.installationDigest, requestDigest),
      eq(integrityDeviceBindingsTable.platform, input.platform),
      eq(integrityDeviceBindingsTable.environment, config.environment),
    )).limit(1);
    if (existing?.status === "revoked") {
      throw new HttpError(409, "Instalação revogada", "Registre uma nova instalação após entrar novamente.");
    }
    const now = new Date();
    const binding = existing
      ? (await tx.update(integrityDeviceBindingsTable).set({ lastSeenAt: now, updatedAt: now }).where(and(
        eq(integrityDeviceBindingsTable.id, existing.id),
        eq(integrityDeviceBindingsTable.userId, principal.userId),
        eq(integrityDeviceBindingsTable.status, "active"),
      )).returning())[0]
      : (await tx.insert(integrityDeviceBindingsTable).values({
        userId: principal.userId,
        installationDigest: requestDigest,
        platform: input.platform,
        environment: config.environment,
        firstSeenAt: now,
        lastSeenAt: now,
      }).returning())[0];
    if (!binding) throw new HttpError(409, "Instalação indisponível", "O vínculo foi revogado durante a operação.");
    await tx.insert(identityOperationsTable).values({
      userId: principal.userId,
      idempotencyKey,
      operation,
      requestHash: requestDigest,
      resourceId: binding.id,
      response: { deviceBindingId: binding.id, platform: input.platform, environment: config.environment },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: principal.userId,
      action: "integrity.device_binding_registered",
      resourceType: "integrity_device_binding",
      resourceId: binding.id,
      requestId: res.locals.requestId,
      after: { platform: input.platform, environment: config.environment, status: "active" },
    });
    return binding;
  });

  res.status(201).json(IntegrityDeviceBindingResponseSchema.parse({
    deviceBindingId: record.id,
    platform: record.platform,
    environment: record.environment,
    status: record.status,
    registeredAt: record.firstSeenAt.toISOString(),
  }));
}));

router.post("/integrity/challenges", asyncRoute(async (req, res) => {
  enforceParsedBodyLimit(req, 4_096);
  const input = parse(CreateIntegrityChallengeRequestSchema, req.body);
  const config = appIntegrityConfig();
  const principal = res.locals.principal;
  const providerSessionId = requireBoundSession(principal.providerSessionId);
  const bindingVersion = config.principalBindingCurrentVersion;
  const principalBinding = derivePrincipalBinding({
    config,
    version: bindingVersion,
    userId: principal.userId,
    providerSubject: principal.providerSubject,
  });
  const authSessionHash = deriveAuthSessionHash({ config, version: bindingVersion, providerSessionId });
  const nonce = randomBytes(32).toString("base64url");
  const challengeId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.challengeTtlSeconds * 1_000);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`integrity-challenges:${principal.userId}:${input.deviceBindingId}:platform_age_signal`}, 0))`);
    const [binding] = await tx.select().from(integrityDeviceBindingsTable).where(and(
      eq(integrityDeviceBindingsTable.id, input.deviceBindingId),
      eq(integrityDeviceBindingsTable.userId, principal.userId),
      eq(integrityDeviceBindingsTable.platform, input.platform),
      eq(integrityDeviceBindingsTable.environment, config.environment),
      eq(integrityDeviceBindingsTable.status, "active"),
    )).limit(1);
    if (!binding) throw new HttpError(404, "Instalação não encontrada", "O vínculo não existe para esta conta e ambiente.");

    await tx.update(integrityChallengesTable).set({
      status: "expired",
      terminalAt: now,
      failureCode: "challenge_expired",
    }).where(and(
      eq(integrityChallengesTable.userId, principal.userId),
      eq(integrityChallengesTable.deviceBindingId, binding.id),
      eq(integrityChallengesTable.purpose, "platform_age_signal"),
      eq(integrityChallengesTable.status, "issued"),
      lte(integrityChallengesTable.expiresAt, now),
    ));
    const [outstanding] = await tx.select({ value: count() }).from(integrityChallengesTable).where(and(
      eq(integrityChallengesTable.userId, principal.userId),
      eq(integrityChallengesTable.deviceBindingId, binding.id),
      eq(integrityChallengesTable.purpose, "platform_age_signal"),
      eq(integrityChallengesTable.status, "issued"),
    ));
    if (Number(outstanding?.value ?? 0) >= config.maxOutstandingChallenges) {
      throw new HttpError(429, "Muitos desafios ativos", "Aguarde os desafios atuais expirarem antes de solicitar outro.");
    }
    await tx.insert(integrityChallengesTable).values({
      id: challengeId,
      userId: principal.userId,
      deviceBindingId: binding.id,
      authSessionHash,
      purpose: "platform_age_signal",
      platform: input.platform,
      environment: config.environment,
      appleKeyIdHash: input.appleKeyId ? sha256Hex(input.appleKeyId) : null,
      nonceHash: sha256Hex(nonce),
      principalBindingHash: sha256Hex(principalBinding),
      principalBindingKeyVersion: bindingVersion,
      canonicalizationVersion: "age-integrity-v1",
      issuedAt: now,
      expiresAt,
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: principal.userId,
      action: "integrity.challenge_issued",
      resourceType: "integrity_challenge",
      resourceId: challengeId,
      requestId: res.locals.requestId,
      after: { purpose: "platform_age_signal", platform: input.platform, environment: config.environment },
    });
  });

  res.status(201).json(IntegrityChallengeResponseSchema.parse({
    challengeId,
    nonce,
    principalBinding,
    principalBindingKeyVersion: bindingVersion,
    canonicalizationVersion: "age-integrity-v1",
    expiresAt: expiresAt.toISOString(),
  }));
}));

router.post("/me/platform-age-signal/verified", asyncRoute(async (req, res) => {
  const preliminaryProvider = req.body?.proof?.provider;
  enforceParsedBodyLimit(req, preliminaryProvider === "google_play_integrity_standard" ? 65_536 : 32_768);
  const input = parse(VerifiedPlatformAgeSignalEnvelopeSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const config = appIntegrityConfig();
  const principal = res.locals.principal;
  const providerSessionId = requireBoundSession(principal.providerSessionId);
  const provider = input.proof.provider;
  const proofMaterial = provider === "apple_app_attest" ? input.proof.assertion : input.proof.integrityToken;
  const proofKeyId = provider === "apple_app_attest" ? input.proof.keyId : null;
  const proofDigest = sha256Hex(proofMaterial);
  const now = new Date();

  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`integrity-verify:${principal.userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select id from integrity_challenges where id = ${input.challengeId} and user_id = ${principal.userId} for update`);
    const [challenge] = await tx.select().from(integrityChallengesTable).where(and(
      eq(integrityChallengesTable.id, input.challengeId),
      eq(integrityChallengesTable.userId, principal.userId),
    )).limit(1);
    if (!challenge) throw new HttpError(404, "Desafio não encontrado", "O desafio não existe para esta conta.");
    const [binding] = await tx.select().from(integrityDeviceBindingsTable).where(and(
      eq(integrityDeviceBindingsTable.id, input.deviceBindingId),
      eq(integrityDeviceBindingsTable.userId, principal.userId),
      eq(integrityDeviceBindingsTable.status, "active"),
    )).limit(1);
    if (!binding || challenge.deviceBindingId !== binding.id
        || binding.platform !== input.signal.platform || challenge.platform !== input.signal.platform
        || binding.environment !== config.environment || challenge.environment !== config.environment
        || challenge.purpose !== "platform_age_signal") {
      throw new HttpError(403, "Prova não autorizada", "A prova não corresponde à conta, instalação ou ambiente.");
    }

    let principalBinding: string;
    let currentSessionHash: string;
    try {
      principalBinding = derivePrincipalBinding({
        config,
        version: challenge.principalBindingKeyVersion,
        userId: principal.userId,
        providerSubject: principal.providerSubject,
      });
      currentSessionHash = deriveAuthSessionHash({
        config,
        version: challenge.principalBindingKeyVersion,
        providerSessionId,
      });
    } catch {
      throw new HttpError(503, "Chave de vínculo indisponível", "Solicite um novo desafio com a configuração atual.");
    }
    const appleKeyMatches = provider === "apple_app_attest"
      ? challenge.appleKeyIdHash !== null && constantTimeTextEqual(challenge.appleKeyIdHash, sha256Hex(input.proof.keyId))
      : challenge.appleKeyIdHash === null;
    if (!constantTimeTextEqual(challenge.nonceHash, sha256Hex(input.challengeNonce))
        || !constantTimeTextEqual(challenge.principalBindingHash, sha256Hex(principalBinding))
        || !constantTimeTextEqual(challenge.authSessionHash, currentSessionHash)
        || !appleKeyMatches) {
      throw new HttpError(403, "Prova não autorizada", "O desafio não corresponde ao envelope autenticado.");
    }

    const { canonical, requestDigest } = canonicalEnvelope({
      challengeId: input.challengeId,
      challengeNonce: input.challengeNonce,
      principalBinding,
      principalBindingKeyVersion: challenge.principalBindingKeyVersion,
      deviceBindingId: input.deviceBindingId,
      platform: input.signal.platform,
      clientContext: input.clientContext,
      signal: input.signal,
      proofKeyId,
    });
    const envelopeDigest = integrityEnvelopeDigest({ canonical, provider, proofDigest });
    const [existing] = await tx.select().from(integrityVerificationsTable).where(and(
      eq(integrityVerificationsTable.userId, principal.userId),
      eq(integrityVerificationsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (!constantTimeTextEqual(existing.envelopeDigest, envelopeDigest)) {
        throw new HttpError(409, "Conflito de idempotência", "A chave já foi usada com outro envelope.");
      }
      return { kind: "existing" as const, verification: existing };
    }
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      if (challenge.status === "issued") {
        await tx.update(integrityChallengesTable).set({
          status: "expired",
          terminalAt: now,
          failureCode: "challenge_expired",
        }).where(and(eq(integrityChallengesTable.id, challenge.id), eq(integrityChallengesTable.status, "issued")));
      }
      return { kind: "expired" as const };
    }
    if (challenge.status !== "issued") {
      throw new HttpError(409, "Desafio já utilizado", "Solicite um novo desafio para enviar outra prova.");
    }

    const verificationId = randomUUID();
    const leaseGeneration = 1;
    await tx.insert(integrityVerificationsTable).values({
      id: verificationId,
      userId: principal.userId,
      deviceBindingId: binding.id,
      challengeId: challenge.id,
      provider,
      purpose: "platform_age_signal",
      platform: input.signal.platform,
      environment: config.environment,
      status: "verifying",
      idempotencyKey,
      envelopeDigest,
      requestDigest,
      proofDigest,
      policyVersion: config.policyVersion,
      issuedAt: challenge.issuedAt,
    });
    await tx.update(integrityChallengesTable).set({
      status: "verifying",
      proofDigest,
      requestDigest,
      idempotencyKey,
      verificationAttemptId: verificationId,
      leaseGeneration,
      leaseOwner: "api-phase-a",
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      reservedAt: now,
      attemptCount: 1,
    }).where(and(
      eq(integrityChallengesTable.id, challenge.id),
      eq(integrityChallengesTable.userId, principal.userId),
      eq(integrityChallengesTable.status, "issued"),
    ));
    await tx.update(ageProfilesTable).set({
      socialEnabled: false,
      notificationsEnabled: false,
      updatedAt: now,
    }).where(eq(ageProfilesTable.userId, principal.userId));
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: principal.userId,
      action: "integrity.verification_reserved",
      resourceType: "integrity_verification",
      resourceId: verificationId,
      requestId: res.locals.requestId,
      after: { provider, platform: input.signal.platform, status: "verifying", policyVersion: config.policyVersion },
    });
    return {
      kind: "reserved" as const,
      verificationId,
      challengeId: challenge.id,
      leaseGeneration,
    };
  });

  if (reservation.kind === "expired") {
    throw new HttpError(410, "Desafio expirado", "Solicite um novo desafio e uma nova prova.");
  }
  if (reservation.kind === "existing") {
    const body = sanitizedVerificationResponse(reservation.verification);
    res.status(body.status === "verifying" ? 202 : 200).json(body);
    return;
  }

  // Phase A deliberately has no Apple/Google cryptographic verifier. The
  // adapter's type permits only indeterminate and the terminal transaction is
  // fenced; no code in this route can write server_verified.
  const outcome = await PHASE_A_PROVIDER_ADAPTERS[provider].evaluate();
  const terminal = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from integrity_challenges where id = ${reservation.challengeId} for update`);
    const [closed] = await tx.update(integrityVerificationsTable).set({
      status: outcome.status,
      outcomeCode: outcome.outcomeCode,
      appBuildDecision: outcome.appBuildDecision,
      deviceDecision: outcome.deviceDecision,
      terminalAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(integrityVerificationsTable.id, reservation.verificationId),
      eq(integrityVerificationsTable.userId, principal.userId),
      eq(integrityVerificationsTable.status, "verifying"),
    )).returning();
    if (!closed) {
      const [current] = await tx.select().from(integrityVerificationsTable).where(and(
        eq(integrityVerificationsTable.id, reservation.verificationId),
        eq(integrityVerificationsTable.userId, principal.userId),
      )).limit(1);
      if (!current) throw new HttpError(409, "Verificação indisponível", "O lease não pode mais finalizar este resultado.");
      return current;
    }
    const [fenced] = await tx.update(integrityChallengesTable).set({
      status: "indeterminate",
      failureCode: outcome.outcomeCode,
      terminalAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      proofCiphertext: null,
      proofKeyVersion: null,
      proofDeleteAt: null,
    }).where(and(
      eq(integrityChallengesTable.id, reservation.challengeId),
      eq(integrityChallengesTable.userId, principal.userId),
      eq(integrityChallengesTable.status, "verifying"),
      eq(integrityChallengesTable.leaseGeneration, reservation.leaseGeneration),
      eq(integrityChallengesTable.verificationAttemptId, reservation.verificationId),
    )).returning({ id: integrityChallengesTable.id });
    if (!fenced) throw new HttpError(409, "Lease substituído", "Um executor antigo não pode finalizar esta verificação.");
    return closed;
  });
  res.json(sanitizedVerificationResponse(terminal));
}));

router.get("/integrity/verifications/:verificationId", asyncRoute(async (req, res) => {
  const verificationId = parse(z.string().uuid(), req.params.verificationId);
  const [verification] = await db.select().from(integrityVerificationsTable).where(and(
    eq(integrityVerificationsTable.id, verificationId),
    eq(integrityVerificationsTable.userId, res.locals.principal.userId),
  )).limit(1);
  if (!verification) throw new HttpError(404, "Verificação não encontrada", "A verificação não existe para esta conta.");
  const body = sanitizedVerificationResponse(verification);
  res.status(body.status === "verifying" ? 202 : 200).json(body);
}));

export default router;
