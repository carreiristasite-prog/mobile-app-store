import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import {
  AsyncRequestResponseSchema,
  AcceptGuardianInvitationRequestSchema,
  ActiveSimulationResponseSchema,
  AttemptResponseSchema,
  BillingIdentityResponseSchema,
  CatalogActiveResponseSchema,
  CreateLearningSessionRequestSchema,
  CreateSimulationRequestSchema,
  DataRequestStatusResponseSchema,
  EntitlementResponseSchema,
  GuardianInvitationResponseSchema,
  GuardianLinkResponseSchema,
  GuardianLinksResponseSchema,
  GuardianRevocationResponseSchema,
  HomeResponseSchema,
  LearningSessionResponseSchema,
  OnboardingStateResponseSchema,
  PlatformAgeSignalReportRequestSchema,
  ProgressResponseSchema,
  RecordLegalAcknowledgementRequestSchema,
  RecordOptionalConsentRequestSchema,
  ReportRequestSchema,
  ReportResponseSchema,
  RestoreBillingRequestSchema,
  SimulationBlueprintsResponseSchema,
  SimulationAnswerResponseSchema,
  SimulationResultResponseSchema,
  SimulationSessionResponseSchema,
  SetAgeProfileRequestSchema,
  SocialSummaryResponseSchema,
  SubmitAttemptRequestSchema,
  SubmitSimulationAnswerRequestSchema,
  type PublicQuestion,
} from "@workspace/api-zod";
import {
  ageProfilesTable,
  authIdentitiesTable,
  attemptsTable,
  auditLogsTable,
  blueprintSubjectsTable,
  blueprintVersionsTable,
  billingCustomerAliasesTable,
  billingCustomersTable,
  consentsTable,
  dataRequestEvidenceTable,
  dataRequestExportAccessEventsTable,
  dataRequestsTable,
  db,
  entitlementsTable,
  examVersionsTable,
  friendshipsTable,
  guardianInvitationsTable,
  guardianLinksTable,
  identityOperationsTable,
  itemExposuresTable,
  learningSessionsTable,
  outboxEventsTable,
  platformAgeSignalsTable,
  productsTable,
  publicationsTable,
  questionOptionsTable,
  questionVersionsTable,
  reportsTable,
  reviewSchedulesTable,
  socialProfilesTable,
  subjectsTable,
  topicMasteryTable,
  topicsTable,
  usersTable,
  duelMatchesTable,
  subscriptionEventsTable,
  webhookInboxTable,
  userProductSelectionsTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, parse, requireIdempotencyKey } from "../lib/http";
import { requirePrincipal } from "../middlewares/principal";
import {
  ADAPTIVE_ALGORITHM_VERSION,
  isValidForCalibration,
  selectCandidate,
  updateMastery,
  type SelectionMode,
} from "../services/adaptive";
import { gradeQuestion, GradingInvariantError, isSameAttemptRequest } from "../services/grading";
import { deterministicRequestUuid } from "../services/idempotency";
import {
  decideGuardianInviteAcceptance,
  deriveGuardianInviteToken,
  digestGuardianInviteToken,
  guardianInviteReplayMatches,
  guardianInviteTokenMatches,
  requireGuardianInviteSecret,
} from "../services/guardian-invite";
import {
  evaluateOnboarding,
  evaluatePlatformAgeSignal,
  identityPolicySnapshotMatches,
  loadIdentityPolicy,
  tryLoadIdentityPolicy,
  type AgeBand,
  type AgreementKind,
  type AgreementRecord,
  type IdentityPolicy,
  type IdentityPolicySnapshot,
  type PlatformAgeSignalEvidence,
} from "../services/identity-policy";
import {
  authenticateRevenueCatWebhook,
  isRevenueCatEventContextAllowed,
  isRevenueCatProSubscriptionEvent,
  parseRevenueCatEvent,
  RevenueCatWebhookError,
  shouldApplyRevenueCatEvent,
  type RevenueCatEnvironment,
  type RevenueCatStore,
} from "../services/revenuecat";
import {
  GcsPrivacyExportReader,
  loadPrivacyExportDeliveryConfig,
  PrivacyExportDeliveryError,
  validatePrivacyExportDescriptor,
  type PrivacyExportDeliveryConfig,
  type PrivacyExportDescriptor,
  type PrivacyExportDownload,
} from "../services/privacy-export-delivery";
import {
  answerProductSimulation,
  createProductSimulation,
  getActiveProductSimulation,
  getProductSimulation,
  getProductSimulationResult,
  listPublishedSimulationBlueprints,
} from "../services/simulation-product";
import integrityRouter from "./integrity";

const router = Router();
const PLATFORM_AGE_SIGNAL_REQUIRED = true;

const asyncRoute = (handler: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizedDifficulty(value: string): "easy" | "medium" | "hard" {
  if (value === "easy" || value === "facil") return "easy";
  if (value === "hard" || value === "dificil") return "hard";
  return "medium";
}

function requireIdentityPolicy(): IdentityPolicy {
  try {
    return loadIdentityPolicy();
  } catch {
    throw new HttpError(
      503,
      "Política de identidade indisponível",
      "As versões obrigatórias dos documentos ainda não foram configuradas no servidor.",
      "https://api.iaaprova.com.br/problems/identity-policy-unavailable",
    );
  }
}

function identityRequestHash(operation: string, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({ operation, payload })).digest("hex");
}

function requireCurrentPolicySnapshot(snapshot: IdentityPolicySnapshot): IdentityPolicy {
  const current = requireIdentityPolicy();
  if (!identityPolicySnapshotMatches(snapshot, current)) {
    throw new HttpError(
      412,
      "Versões jurídicas atualizadas",
      "Os documentos exibidos foram atualizados. Consulte o estado atual, revise as novas versões e confirme novamente.",
      "https://api.iaaprova.com.br/problems/policy-version-stale",
    );
  }
  return current;
}

function guardianCounterpartPseudonym(role: "student" | "guardian", linkId: string): string {
  const suffix = linkId.replaceAll("-", "").slice(0, 6).toUpperCase();
  return `${role === "guardian" ? "Estudante" : "Responsável"} ${suffix}`;
}

type StoredPlatformAgeSignal = {
  platform: "ios" | "android";
  source: "apple_declared_age_range" | "google_play_age_signals";
  status: PlatformAgeSignalEvidence["status"];
  ageBand: AgeBand | null;
  trust: PlatformAgeSignalEvidence["trust"];
  pendingConflict: boolean;
  observedAt: Date;
};

function summarizePlatformAgeSignals(
  selfDeclaredAgeBand: AgeBand | null,
  rows: readonly StoredPlatformAgeSignal[],
) {
  const newest = [...rows].sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
  const ranked = [
    newest.find((row) => row.pendingConflict),
    newest.find((row) => row.status === "shared" && row.ageBand !== "18_plus"),
    newest.find((row) => row.status === "shared" && selfDeclaredAgeBand !== null && row.ageBand !== selfDeclaredAgeBand),
    newest.find((row) => row.status === "verification_required" || row.status === "not_shared"),
    newest.find((row) => row.trust === "server_verified" && row.status === "shared"),
    newest.find((row) => row.status === "shared"),
    newest.find((row) => row.status === "unsupported" || row.status === "error"),
    newest[0],
  ];
  const selected = ranked.find((row) => row !== undefined) ?? null;
  const evidence: PlatformAgeSignalEvidence | null = selected
    ? {
      status: selected.status,
      ageBand: selected.ageBand,
      trust: selected.trust,
      pendingConflict: selected.pendingConflict,
    }
    : null;
  return {
    evidence,
    response: {
      required: true as const,
      platform: selected?.platform ?? null,
      source: selected?.source ?? null,
      status: selected?.status ?? "missing" as const,
      ageBand: selected?.ageBand ?? null,
      trust: selected?.trust ?? "none" as const,
      pendingConflict: selected?.pendingConflict ?? false,
      observedAt: selected ? selected.observedAt.toISOString() : null,
    },
  };
}

async function onboardingFor(userId: string, policy: IdentityPolicy | null = tryLoadIdentityPolicy()) {
  const [[age], [latestLink], agreementRows, platformSignalRows] = await Promise.all([
    db.select({
      ageBand: ageProfilesTable.ageBand,
      socialEnabled: ageProfilesTable.socialEnabled,
      notificationsEnabled: ageProfilesTable.notificationsEnabled,
    }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, userId)).limit(1),
    db.select({
      status: guardianLinksTable.status,
      guardianUserId: guardianLinksTable.guardianUserId,
    }).from(guardianLinksTable)
      .where(eq(guardianLinksTable.minorUserId, userId))
      .orderBy(desc(guardianLinksTable.updatedAt), desc(guardianLinksTable.createdAt)).limit(1),
    db.select({
      id: consentsTable.id,
      kind: consentsTable.kind,
      documentVersion: consentsTable.documentVersion,
      granted: consentsTable.granted,
      actorRole: consentsTable.actorRole,
      recordedAt: consentsTable.recordedAt,
    }).from(consentsTable).where(eq(consentsTable.userId, userId)),
    db.select({
      platform: platformAgeSignalsTable.platform,
      source: platformAgeSignalsTable.source,
      status: platformAgeSignalsTable.sharingStatus,
      ageBand: platformAgeSignalsTable.ageBand,
      trust: platformAgeSignalsTable.trustStatus,
      pendingConflict: sql<boolean>`${platformAgeSignalsTable.pendingConflict} is not null`,
      observedAt: platformAgeSignalsTable.lastObservedAt,
    }).from(platformAgeSignalsTable).where(eq(platformAgeSignalsTable.userId, userId)),
  ]);
  const [guardianAge] = latestLink?.status === "verified" && latestLink.guardianUserId
    ? await db.select({ ageBand: ageProfilesTable.ageBand }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, latestLink.guardianUserId)).limit(1)
    : [];
  const agreements = agreementRows.filter((record): record is AgreementRecord =>
    [
      "terms_acceptance",
      "privacy_notice_acknowledgement",
      "guardian_responsibility_acknowledgement",
      "social",
      "notifications",
      "marketing",
    ].includes(record.kind)
      && ["self", "guardian", "system"].includes(record.actorRole),
  );
  const ageBand = (age?.ageBand ?? null) as AgeBand | null;
  const platformSignals = summarizePlatformAgeSignals(
    ageBand,
    platformSignalRows as StoredPlatformAgeSignal[],
  );
  // A faixa do responsável pode ser corrigida depois do aceite. O vínculo só
  // continua autorizando o menor enquanto a conta autenticada permanece 18+.
  const guardianVerified = latestLink?.status === "verified" && guardianAge?.ageBand === "18_plus";
  const evaluated = evaluateOnboarding({
    policy,
    ageBand,
    guardianVerified,
    socialEnabled: age?.socialEnabled ?? false,
    notificationsEnabled: age?.notificationsEnabled ?? false,
    agreements,
    platformAgeSignal: platformSignals.evidence,
    platformAgeSignalRequired: PLATFORM_AGE_SIGNAL_REQUIRED,
  });
  const guardianRequired = ageBand === "13_15" || ageBand === "16_17";
  return OnboardingStateResponseSchema.parse({
    configurationReady: Boolean(policy),
    policyVersion: policy?.policyVersion ?? null,
    ageBand,
    requiredDocuments: {
      termsVersion: policy?.termsVersion ?? null,
      privacyNoticeVersion: policy?.privacyNoticeVersion ?? null,
    },
    termsAccepted: evaluated.termsAccepted,
    privacyNoticeAcknowledged: evaluated.privacyNoticeAcknowledged,
    guardian: {
      required: guardianRequired,
      verified: guardianVerified,
      status: !guardianRequired
        ? "not_required"
        : guardianVerified
          ? "verified"
          : latestLink?.status === "revoked"
            ? "revoked"
            : "missing",
    },
    platformAgeSignal: platformSignals.response,
    learning: evaluated.learning,
    social: evaluated.social,
    notifications: evaluated.notifications,
    onboardingComplete: evaluated.onboardingComplete,
  });
}

async function requireCapability(userId: string, capability: "learning" | "social" | "notifications") {
  const state = await onboardingFor(userId, requireIdentityPolicy());
  const decision = state[capability];
  if (!decision.eligible) {
    throw new HttpError(
      403,
      "Onboarding incompleto",
      `Este recurso está bloqueado: ${decision.reason}.`,
      `https://api.iaaprova.com.br/problems/${decision.reason.replaceAll("_", "-")}`,
    );
  }
  return state;
}

async function publicQuestion(exposureId: string): Promise<PublicQuestion> {
  const [row] = await db
    .select({
      exposureId: itemExposuresTable.id,
      questionVersionId: questionVersionsTable.id,
      sequence: itemExposuresTable.sequence,
      subjectId: subjectsTable.id,
      subjectName: subjectsTable.name,
      topicId: topicsTable.id,
      topicName: topicsTable.name,
      statement: questionVersionsTable.statement,
      difficulty: questionVersionsTable.difficulty,
    })
    .from(itemExposuresTable)
    .innerJoin(questionVersionsTable, eq(itemExposuresTable.questionVersionId, questionVersionsTable.id))
    .innerJoin(subjectsTable, eq(questionVersionsTable.subjectId, subjectsTable.id))
    .innerJoin(topicsTable, eq(questionVersionsTable.topicId, topicsTable.id))
    .where(eq(itemExposuresTable.id, exposureId))
    .limit(1);
  if (!row) throw new HttpError(404, "Questão não encontrada", "A exposição solicitada não existe.");

  const storedOptions = await db
    .select({
      id: questionOptionsTable.id,
      key: questionOptionsTable.key,
      body: questionOptionsTable.body,
      isCorrect: questionOptionsTable.isCorrect,
    })
    .from(questionOptionsTable)
    .where(eq(questionOptionsTable.questionVersionId, row.questionVersionId))
    .orderBy(questionOptionsTable.orderIndex);

  if (storedOptions.length < 2 || storedOptions.filter((option) => option.isCorrect).length !== 1) {
    throw new HttpError(409, "Conteúdo indisponível", "A questão publicada não possui alternativas e gabarito válidos.");
  }
  const options = storedOptions.map(({ id, key, body }) => ({ id, key, body }));
  return {
    exposureId: row.exposureId,
    questionVersionId: row.questionVersionId,
    sequence: row.sequence,
    subject: { id: row.subjectId, name: row.subjectName },
    topic: { id: row.topicId, name: row.topicName },
    statement: row.statement,
    difficulty: normalizedDifficulty(row.difficulty),
    options,
  };
}

async function nextQuestion(
  userId: string,
  sessionId: string,
  quotaBehavior: "error" | "stop" = "error",
): Promise<PublicQuestion | null> {
  const exposureId = await db.transaction(async (tx) => {
    // Serializa apenas o fluxo de aprendizagem deste usuário. Isso torna a
    // quota diária e a sequência da sessão atômicas sem bloquear outros alunos.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`learning:${userId}`}, 0))`);
    const [session] = await tx
      .select()
      .from(learningSessionsTable)
      .where(and(
        eq(learningSessionsTable.id, sessionId),
        eq(learningSessionsTable.userId, userId),
        eq(learningSessionsTable.status, "active"),
      ))
      .limit(1);
    if (!session) throw new HttpError(404, "Sessão não encontrada", "A sessão não existe ou já terminou.");

    const [pending] = await tx
      .select({ id: itemExposuresTable.id })
      .from(itemExposuresTable)
      .where(and(eq(itemExposuresTable.sessionId, sessionId), isNull(itemExposuresTable.answeredAt)))
      .orderBy(itemExposuresTable.sequence)
      .limit(1);
    if (pending) return pending.id;

    const [entitlement] = await tx.select({ status: entitlementsTable.status, expiresAt: entitlementsTable.expiresAt })
      .from(entitlementsTable)
      .where(and(eq(entitlementsTable.userId, userId), eq(entitlementsTable.key, "pro")))
      .limit(1);
    const proActive = Boolean(entitlement
      && ["active", "grace_period"].includes(entitlement.status)
      && (!entitlement.expiresAt || entitlement.expiresAt > new Date()));
    if (!proActive) {
      const [daily] = await tx.select({ total: count() }).from(itemExposuresTable).where(and(
        eq(itemExposuresTable.userId, userId),
        sql`${itemExposuresTable.exposedAt} >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`,
      ));
      if (Number(daily?.total ?? 0) >= 20) {
        if (quotaBehavior === "stop") return null;
        throw new HttpError(403, "Limite diário atingido", "O plano Free permite 20 novas questões por dia.", "https://api.iaaprova.com.br/problems/free-daily-limit");
      }
    }

    let candidateRows = await tx
      .selectDistinct({
        questionVersionId: questionVersionsTable.id,
        subjectId: questionVersionsTable.subjectId,
        topicId: questionVersionsTable.topicId,
        mastery: topicMasteryTable.probability,
        dueAt: reviewSchedulesTable.dueAt,
      })
      .from(questionVersionsTable)
      .innerJoin(publicationsTable, and(
        eq(publicationsTable.questionVersionId, questionVersionsTable.id),
        eq(publicationsTable.status, "published"),
      ))
      .leftJoin(topicMasteryTable, and(
        eq(topicMasteryTable.topicId, questionVersionsTable.topicId),
        eq(topicMasteryTable.userId, userId),
      ))
      .leftJoin(reviewSchedulesTable, and(
        eq(reviewSchedulesTable.topicId, questionVersionsTable.topicId),
        eq(reviewSchedulesTable.userId, userId),
      ))
      .where(and(
        eq(questionVersionsTable.examVersionId, session.examVersionId),
        eq(questionVersionsTable.status, "published"),
        session.mode === "simulation" && session.blueprintVersionId
          ? eq(publicationsTable.blueprintVersionId, session.blueprintVersionId)
          : undefined,
      ));

    const sessionExposureRows = await tx.select({
      questionVersionId: itemExposuresTable.questionVersionId,
      subjectId: questionVersionsTable.subjectId,
      topicId: questionVersionsTable.topicId,
    }).from(itemExposuresTable)
      .innerJoin(questionVersionsTable, eq(itemExposuresTable.questionVersionId, questionVersionsTable.id))
      .where(eq(itemExposuresTable.sessionId, sessionId));
    const alreadyInSession = new Set(sessionExposureRows.map((row) => row.questionVersionId));
    const sessionTopicCounts = new Map<string, number>();
    for (const exposure of sessionExposureRows) {
      sessionTopicCounts.set(exposure.topicId, (sessionTopicCounts.get(exposure.topicId) ?? 0) + 1);
    }
    const sequence = sessionExposureRows.length + 1;

    if (session.mode === "diagnostic" && sequence > 20) {
      await tx.update(learningSessionsTable).set({ status: "completed", completedAt: new Date() })
        .where(eq(learningSessionsTable.id, sessionId));
      return null;
    }

    if (session.mode === "simulation") {
      if (!session.blueprintVersionId) throw new HttpError(409, "Simulado inválido", "A sessão não possui snapshot de blueprint.");
      const requirements = await tx.select().from(blueprintSubjectsTable)
        .where(eq(blueprintSubjectsTable.blueprintVersionId, session.blueprintVersionId));
      if (requirements.length === 0) throw new HttpError(409, "Simulado indisponível", "O blueprint não possui distribuição de matérias.");
      const usedBySubject = new Map<string, number>();
      for (const exposure of sessionExposureRows) {
        usedBySubject.set(exposure.subjectId, (usedBySubject.get(exposure.subjectId) ?? 0) + 1);
      }
      const remainingSubjects = new Set(requirements
        .filter((requirement) => (usedBySubject.get(requirement.subjectId) ?? 0) < requirement.questionCount)
        .map((requirement) => requirement.subjectId));
      if (remainingSubjects.size === 0) {
        await tx.update(learningSessionsTable).set({ status: "completed", completedAt: new Date() })
          .where(eq(learningSessionsTable.id, sessionId));
        return null;
      }
      candidateRows = candidateRows.filter((row) => remainingSubjects.has(row.subjectId));
    }
    candidateRows = candidateRows.filter((row) => !alreadyInSession.has(row.questionVersionId));

    const exposureRows = await tx
      .select({ questionVersionId: itemExposuresTable.questionVersionId, total: count() })
      .from(itemExposuresTable)
      .where(eq(itemExposuresTable.userId, userId))
      .groupBy(itemExposuresTable.questionVersionId);
    const exposureCounts = new Map(exposureRows.map((row) => [row.questionVersionId, Number(row.total)]));
    const now = Date.now();
    const selected = selectCandidate(candidateRows.map((row) => ({
      questionVersionId: row.questionVersionId,
      topicId: row.topicId,
      mastery: row.mastery,
      dueForReview: row.dueAt ? row.dueAt.getTime() <= now : false,
      exposureCount: exposureCounts.get(row.questionVersionId) ?? 0,
      sessionTopicCount: sessionTopicCounts.get(row.topicId) ?? 0,
    })), session.mode as SelectionMode, session.seed, sequence);

    if (!selected) {
      await tx.update(learningSessionsTable).set({ status: "completed", completedAt: new Date() })
        .where(eq(learningSessionsTable.id, sessionId));
      return null;
    }

    const [exposure] = await tx.insert(itemExposuresTable).values({
      sessionId,
      userId,
      questionVersionId: selected.candidate.questionVersionId,
      sequence,
      selectionBucket: selected.bucket,
    }).returning({ id: itemExposuresTable.id });
    return exposure.id;
  });
  return exposureId ? publicQuestion(exposureId) : null;
}

async function createSession(
  userId: string,
  input: { productId: string; examVersionId?: string; mode: SelectionMode; blueprintVersionId?: string },
) {
  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`session-create:${userId}`}, 0))`);
    const conditions = [eq(examVersionsTable.productId, input.productId), eq(examVersionsTable.status, "active")];
    if (input.examVersionId) conditions.push(eq(examVersionsTable.id, input.examVersionId));
    const [exam] = await tx.select().from(examVersionsTable).where(and(...conditions)).orderBy(desc(examVersionsTable.createdAt)).limit(1);
    if (!exam) throw new HttpError(404, "Concurso indisponível", "Não existe uma versão ativa para o concurso escolhido.");

    const [existingSession] = await tx.select({ id: learningSessionsTable.id, status: learningSessionsTable.status })
      .from(learningSessionsTable)
      .where(and(
        eq(learningSessionsTable.userId, userId),
        eq(learningSessionsTable.productId, input.productId),
        eq(learningSessionsTable.examVersionId, exam.id),
        eq(learningSessionsTable.mode, input.mode),
        eq(learningSessionsTable.status, "active"),
        input.blueprintVersionId
          ? eq(learningSessionsTable.blueprintVersionId, input.blueprintVersionId)
          : isNull(learningSessionsTable.blueprintVersionId),
      ))
      .orderBy(desc(learningSessionsTable.startedAt))
      .limit(1);
    if (existingSession) return existingSession;

    const [entitlement] = await tx.select({ status: entitlementsTable.status, expiresAt: entitlementsTable.expiresAt })
      .from(entitlementsTable).where(and(eq(entitlementsTable.userId, userId), eq(entitlementsTable.key, "pro"))).limit(1);
    const proActive = Boolean(entitlement
      && ["active", "grace_period"].includes(entitlement.status)
      && (!entitlement.expiresAt || entitlement.expiresAt > new Date()));
    if (!proActive) {
      const [selection] = await tx.select().from(userProductSelectionsTable)
        .where(eq(userProductSelectionsTable.userId, userId)).limit(1);
      if (selection && selection.productId !== input.productId) {
        throw new HttpError(403, "Concurso bloqueado", "O plano Free permite somente um concurso ativo.", "https://api.iaaprova.com.br/problems/free-product-limit");
      }
      if (!selection) await tx.insert(userProductSelectionsTable).values({ userId, productId: input.productId });
      if (input.mode === "simulation") {
        const [monthly] = await tx.select({ total: count() }).from(learningSessionsTable).where(and(
          eq(learningSessionsTable.userId, userId),
          eq(learningSessionsTable.mode, "simulation"),
          sql`${learningSessionsTable.startedAt} >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`,
        ));
        if (Number(monthly?.total ?? 0) >= 1) {
          throw new HttpError(403, "Limite mensal atingido", "O plano Free permite um simulado por mês.", "https://api.iaaprova.com.br/problems/free-simulation-limit");
        }
      }
    }
    const [created] = await tx.insert(learningSessionsTable).values({
      userId,
      productId: input.productId,
      examVersionId: exam.id,
      blueprintVersionId: input.blueprintVersionId,
      mode: input.mode,
      algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
      seed: randomUUID(),
    }).returning({ id: learningSessionsTable.id, status: learningSessionsTable.status });
    return created;
  });
  const question = await nextQuestion(userId, session.id);
  return LearningSessionResponseSchema.parse({
    sessionId: session.id,
    status: question ? "active" : "completed",
    algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
    nextQuestion: question,
  });
}

async function entitlementFor(userId: string) {
  const [row] = await db.select().from(entitlementsTable)
    .where(and(eq(entitlementsTable.userId, userId), eq(entitlementsTable.key, "pro")))
    .limit(1);
  const now = new Date();
  const active = Boolean(row && (
    (row.status === "active" && row.expiresAt !== null && row.expiresAt > now)
    || (row.status === "grace_period" && row.gracePeriodExpiresAt !== null && row.gracePeriodExpiresAt > now)
  ));
  return EntitlementResponseSchema.parse({
    entitlement: "pro",
    active,
    status: active ? row!.status : row?.status === "revoked" ? "revoked" : row ? "expired" : "free",
    productSku: row?.productSku ?? null,
    store: row?.store ?? null,
    expiresAt: row?.expiresAt ? iso(row.expiresAt) : null,
  });
}

async function canonicalBillingIdentity(userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.insert(billingCustomersTable).values({ userId }).onConflictDoNothing();
    const [customer] = await tx.select({ appUserId: billingCustomersTable.appUserId })
      .from(billingCustomersTable)
      .where(and(eq(billingCustomersTable.userId, userId), eq(billingCustomersTable.status, "active")))
      .limit(1);
    if (!customer) throw new HttpError(409, "Cobrança indisponível", "A identidade de cobrança desta conta está revogada.");

    const identities = await tx.select({ subject: authIdentitiesTable.subject })
      .from(authIdentitiesTable)
      .where(and(eq(authIdentitiesTable.userId, userId), eq(authIdentitiesTable.provider, "clerk")));
    await tx.insert(billingCustomerAliasesTable).values([
      { alias: customer.appUserId, userId, kind: "canonical" },
      { alias: userId, userId, kind: "legacy_internal" },
      ...identities.map(({ subject }) => ({ alias: subject, userId, kind: "legacy_clerk" })),
    ]).onConflictDoNothing();
    const [canonical] = await tx.select({ userId: billingCustomerAliasesTable.userId })
      .from(billingCustomerAliasesTable)
      .where(eq(billingCustomerAliasesTable.alias, customer.appUserId))
      .limit(1);
    if (canonical?.userId !== userId) {
      throw new HttpError(409, "Cobrança indisponível", "A identidade canônica de cobrança não é unívoca.");
    }
    return customer.appUserId;
  });
}

function revenueCatWebhookEnvironment(): RevenueCatEnvironment {
  const configured = process.env.REVENUECAT_WEBHOOK_ENVIRONMENT?.trim().toLowerCase();
  const expected = configured || (process.env.NODE_ENV === "production" ? "production" : "sandbox");
  if (expected !== "production" && expected !== "sandbox") {
    throw new HttpError(503, "Webhook não configurado", "O ambiente do webhook RevenueCat é inválido.");
  }
  if (process.env.NODE_ENV === "production" && expected !== "production") {
    throw new HttpError(503, "Webhook não configurado", "Eventos sandbox não podem autorizar o ambiente de produção.");
  }
  return expected;
}

const REVENUECAT_PRODUCTION_STORES: ReadonlySet<RevenueCatStore> = new Set(["APP_STORE", "PLAY_STORE"]);

async function progressFor(userId: string) {
  const [totals] = await db.select({
    total: count(),
    correct: sql<number>`count(*) filter (where ${attemptsTable.isCorrect} = true)`,
  }).from(attemptsTable).where(eq(attemptsTable.userId, userId));
  const total = Number(totals?.total ?? 0);
  const correct = Number(totals?.correct ?? 0);
  const topics = await db.select({
    topicId: topicMasteryTable.topicId,
    topicName: topicsTable.name,
    subjectId: topicsTable.subjectId,
    probability: topicMasteryTable.probability,
    observations: topicMasteryTable.observations,
    updatedAt: topicMasteryTable.updatedAt,
  }).from(topicMasteryTable)
    .innerJoin(topicsTable, eq(topicMasteryTable.topicId, topicsTable.id))
    .where(eq(topicMasteryTable.userId, userId));
  return ProgressResponseSchema.parse({
    totalAnswered: total,
    totalCorrect: correct,
    accuracy: total === 0 ? 0 : correct / total,
    topics: topics.map((topic) => ({ ...topic, updatedAt: iso(topic.updatedAt) })),
  });
}

router.get("/catalog/active", asyncRoute(async (_req, res) => {
  const rows = await db.select({ product: productsTable, exam: examVersionsTable })
    .from(productsTable)
    .innerJoin(examVersionsTable, and(
      eq(examVersionsTable.productId, productsTable.id),
      eq(examVersionsTable.status, "active"),
    ))
    .where(eq(productsTable.status, "active"))
    .orderBy(productsTable.name, examVersionsTable.code);
  const grouped = new Map<string, (typeof rows)[number]["product"] & { examVersions: Array<(typeof rows)[number]["exam"]> }>();
  for (const row of rows) {
    const product = grouped.get(row.product.id) ?? { ...row.product, examVersions: [] };
    product.examVersions.push(row.exam);
    grouped.set(row.product.id, product);
  }
  res.json(CatalogActiveResponseSchema.parse({ products: [...grouped.values()] }));
}));

router.post("/billing/webhooks/revenuecat", asyncRoute(async (req, res) => {
  const signingSecret = process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
  const configuredAuthorization = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION;
  try {
    authenticateRevenueCatWebhook({
      rawBody: req.rawBody,
      signatureHeader: req.header("x-revenuecat-webhook-signature") ?? undefined,
      authorizationHeader: req.header("authorization") ?? undefined,
      signingSecret,
      expectedAuthorization: configuredAuthorization,
    });
  } catch (error) {
    if (error instanceof RevenueCatWebhookError && error.reason === "not_configured") {
      throw new HttpError(503, "Webhook não configurado", "As credenciais do webhook RevenueCat não estão configuradas.");
    }
    throw new HttpError(401, "Webhook não autenticado", "A autenticação do webhook está ausente, expirada ou inválida.");
  }

  let event: ReturnType<typeof parseRevenueCatEvent>;
  try {
    event = parseRevenueCatEvent(req.body);
  } catch {
    throw new HttpError(400, "Evento inválido", "O envelope RevenueCat não contém os campos obrigatórios.");
  }

  const outcome = await db.transaction(async (tx) => {
    await tx.insert(webhookInboxTable).values({
      provider: "revenuecat",
      eventId: event.id,
      payload: req.body as Record<string, unknown>,
    }).onConflictDoNothing();
    const [claimed] = await tx.update(webhookInboxTable)
      .set({ status: "processing", error: null })
      .where(and(
        eq(webhookInboxTable.provider, "revenuecat"),
        eq(webhookInboxTable.eventId, event.id),
        eq(webhookInboxTable.status, "received"),
      ))
      .returning({ eventId: webhookInboxTable.eventId });
    if (!claimed) return "duplicate" as const;

    const finishInbox = async (status: "processed" | "stale" | "ignored" | "rejected") => {
      await tx.update(webhookInboxTable).set({ status, processedAt: new Date() })
        .where(and(eq(webhookInboxTable.provider, "revenuecat"), eq(webhookInboxTable.eventId, event.id)));
      return status;
    };
    if (!isRevenueCatEventContextAllowed(
      event,
      revenueCatWebhookEnvironment(),
      REVENUECAT_PRODUCTION_STORES,
    )) return finishInbox("rejected");

    const knownAliases = await tx.select({
      alias: billingCustomerAliasesTable.alias,
      userId: billingCustomerAliasesTable.userId,
    }).from(billingCustomerAliasesTable)
      .where(inArray(billingCustomerAliasesTable.alias, event.identityCandidates));
    const resolvedUsers = [...new Set(knownAliases.map(({ userId }) => userId))];
    if (resolvedUsers.length !== 1) return finishInbox("rejected");
    const userId = resolvedUsers[0];

    await tx.insert(billingCustomerAliasesTable).values(
      event.identityCandidates.map((alias) => ({ alias, userId, kind: "revenuecat_alias" })),
    ).onConflictDoNothing();
    const verifiedAliases = await tx.select({ userId: billingCustomerAliasesTable.userId })
      .from(billingCustomerAliasesTable)
      .where(inArray(billingCustomerAliasesTable.alias, event.identityCandidates));
    if (verifiedAliases.length !== event.identityCandidates.length
      || new Set(verifiedAliases.map(({ userId: owner }) => owner)).size !== 1
      || verifiedAliases[0]?.userId !== userId) return finishInbox("rejected");

    if (!isRevenueCatProSubscriptionEvent(event)) {
      if (event.type === "TRANSFER" || event.type === "TEMPORARY_ENTITLEMENT_GRANT") {
        const appUserId = await tx.select({ appUserId: billingCustomersTable.appUserId })
          .from(billingCustomersTable).where(eq(billingCustomersTable.userId, userId)).limit(1);
        if (appUserId[0]) {
          await tx.insert(outboxEventsTable).values({
            aggregateType: "billing_restore",
            aggregateId: userId,
            eventType: "billing.restore_requested.v1",
            payload: { userId, appUserId: appUserId[0].appUserId, provider: "revenuecat" },
          });
        }
      }
      return finishInbox("ignored");
    }

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${userId}:pro`}, 0))`);
    const [current] = await tx.select({
      sourceEventId: entitlementsTable.sourceEventId,
      sourceOccurredAt: entitlementsTable.sourceOccurredAt,
    }).from(entitlementsTable).where(and(
      eq(entitlementsTable.userId, userId),
      eq(entitlementsTable.key, "pro"),
    )).limit(1);

    await tx.insert(subscriptionEventsTable).values({
      userId,
      providerEventId: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      payload: event.payload,
      environment: event.environment!,
      store: event.store!,
    }).onConflictDoNothing();

    const apply = shouldApplyRevenueCatEvent(
      current ? { occurredAt: current.sourceOccurredAt, eventId: current.sourceEventId } : null,
      { occurredAt: event.occurredAt, eventId: event.id },
    );
    if (apply) {
      await tx.insert(entitlementsTable).values({
        userId,
        key: "pro",
        status: event.status!,
        productSku: event.productId,
        store: event.store!,
        originalTransactionId: event.originalTransactionId,
        startsAt: event.startsAt,
        expiresAt: event.expiresAt,
        sourceEventId: event.id,
        sourceOccurredAt: event.occurredAt,
        provider: "revenuecat",
        environment: event.environment!,
        gracePeriodExpiresAt: event.gracePeriodExpiresAt,
        autoResumeAt: event.autoResumeAt,
      }).onConflictDoUpdate({
        target: [entitlementsTable.userId, entitlementsTable.key],
        set: {
          status: event.status!,
          productSku: event.productId,
          store: event.store!,
          originalTransactionId: event.originalTransactionId,
          startsAt: event.startsAt,
          expiresAt: event.expiresAt,
          sourceEventId: event.id,
          sourceOccurredAt: event.occurredAt,
          provider: "revenuecat",
          environment: event.environment!,
          gracePeriodExpiresAt: event.gracePeriodExpiresAt,
          autoResumeAt: event.autoResumeAt,
          updatedAt: new Date(),
        },
      });
      await tx.insert(outboxEventsTable).values({
        aggregateType: "entitlement",
        aggregateId: `${userId}:pro`,
        eventType: "billing.entitlement_changed.v1",
        payload: { userId, entitlement: "pro", status: event.status!, sourceEventId: event.id },
      });
    }
    return finishInbox(apply ? "processed" : "stale");
  });
  res.status(200).json({ received: true, [outcome]: true });
}));

router.use(requirePrincipal);
router.use(integrityRouter);

router.get("/me/onboarding-state", asyncRoute(async (_req, res) => {
  res.json(await onboardingFor(res.locals.principal.userId));
}));

router.put("/me/age-profile", asyncRoute(async (req, res) => {
  const input = parse(SetAgeProfileRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const userId = res.locals.principal.userId;
  const operation = "identity.age_profile.set.v1";
  const requestHash = identityRequestHash(operation, input);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    const [existing] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return;
    }
    const [before] = await tx.select({
      ageBand: ageProfilesTable.ageBand,
      socialEnabled: ageProfilesTable.socialEnabled,
      notificationsEnabled: ageProfilesTable.notificationsEnabled,
    }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, userId)).limit(1);
    const linksToInvalidate = input.ageBand === "18_plus"
      ? []
      : await tx.select({ id: guardianLinksTable.id, minorUserId: guardianLinksTable.minorUserId })
        .from(guardianLinksTable)
        .where(and(
          eq(guardianLinksTable.guardianUserId, userId),
          eq(guardianLinksTable.status, "verified"),
        ));
    for (const minorUserId of [...new Set(linksToInvalidate.map((link) => link.minorUserId))].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guardian-minor:${minorUserId}`}, 0))`);
    }
    const now = new Date();
    await tx.insert(ageProfilesTable).values({
      userId,
      ageBand: input.ageBand,
      // Faixa autodeclarada não é verificação forte de identidade/idade.
      verifiedAt: null,
      socialEnabled: false,
      notificationsEnabled: false,
    }).onConflictDoUpdate({
      target: ageProfilesTable.userId,
      set: {
        ageBand: input.ageBand,
        verifiedAt: null,
        socialEnabled: false,
        notificationsEnabled: false,
        updatedAt: now,
      },
    });
    for (const link of linksToInvalidate) {
      const [revoked] = await tx.update(guardianLinksTable).set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      }).where(and(
        eq(guardianLinksTable.id, link.id),
        eq(guardianLinksTable.guardianUserId, userId),
        eq(guardianLinksTable.status, "verified"),
      )).returning({ id: guardianLinksTable.id });
      if (!revoked) continue;
      await tx.update(ageProfilesTable).set({
        socialEnabled: false,
        notificationsEnabled: false,
        updatedAt: now,
      }).where(eq(ageProfilesTable.userId, link.minorUserId));
      await tx.insert(auditLogsTable).values({
        actorType: "user",
        actorId: userId,
        action: "identity.guardian_link_invalidated_by_age_change",
        resourceType: "guardian_link",
        resourceId: link.id,
        requestId: res.locals.requestId,
        after: { status: "revoked", reason: "guardian_not_adult" },
      });
      await tx.insert(outboxEventsTable).values({
        aggregateType: "guardian_link",
        aggregateId: link.id,
        eventType: "identity.guardian_link_revoked.v1",
        payload: {
          minorUserId: link.minorUserId,
          guardianLinkId: link.id,
          reason: "guardian_not_adult",
        },
      });
    }
    await tx.insert(identityOperationsTable).values({
      userId, idempotencyKey, operation, requestHash, response: { ageBand: input.ageBand },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user", actorId: userId, action: "identity.age_band_set", resourceType: "age_profile",
      resourceId: userId,
      requestId: res.locals.requestId,
      before: before ?? null,
      after: { ageBand: input.ageBand, socialEnabled: false, notificationsEnabled: false },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "age_profile", aggregateId: userId, eventType: "identity.age_band_changed.v1",
      payload: { userId, ageBand: input.ageBand, socialEnabled: false, notificationsEnabled: false },
    });
  });
  res.json(await onboardingFor(userId));
}));

router.post("/me/platform-age-signal", asyncRoute(async (req, res) => {
  const input = parse(PlatformAgeSignalReportRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const userId = res.locals.principal.userId;
  const operation = "identity.platform_age_signal.report.v1";
  const requestHash = identityRequestHash(operation, input);
  const source = input.platform === "ios" ? "apple_declared_age_range" : "google_play_age_signals";
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    const [existingOperation] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existingOperation) {
      if (existingOperation.operation !== operation || existingOperation.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return;
    }
    const [before] = await tx.select().from(platformAgeSignalsTable).where(and(
      eq(platformAgeSignalsTable.userId, userId),
      eq(platformAgeSignalsTable.platform, input.platform),
    )).limit(1);
    const now = new Date();
    const preservesServerVerified = before?.trustStatus === "server_verified";
    const conflictsWithVerified = preservesServerVerified
      && (before.sharingStatus !== input.status || before.ageBand !== input.ageBand);
    // A rota pública nunca cria nem substitui um sinal autenticado pelo
    // servidor. O payload do dispositivo é somente uma restrição/telemetria.
    if (!preservesServerVerified) {
      await tx.insert(platformAgeSignalsTable).values({
        userId,
        platform: input.platform,
        source,
        sharingStatus: input.status,
        ageBand: input.ageBand,
        trustStatus: "device_reported_monitoring",
        firstObservedAt: before?.firstObservedAt ?? now,
        lastObservedAt: now,
      }).onConflictDoUpdate({
        target: [platformAgeSignalsTable.userId, platformAgeSignalsTable.platform],
        set: {
          source,
          sharingStatus: input.status,
          ageBand: input.ageBand,
          trustStatus: "device_reported_monitoring",
          lastObservedAt: now,
        },
      });
    } else if (conflictsWithVerified) {
      await tx.update(platformAgeSignalsTable).set({
        pendingConflict: {
          status: input.status,
          ageBand: input.ageBand,
          observedAt: now.toISOString(),
        },
      }).where(and(
        eq(platformAgeSignalsTable.userId, userId),
        eq(platformAgeSignalsTable.platform, input.platform),
        eq(platformAgeSignalsTable.trustStatus, "server_verified"),
      ));
    }
    // No client-provided response is allowed to retain or elevate an optional
    // capability. A later server-verified path still requires a fresh choice.
    await tx.update(ageProfilesTable).set({
      socialEnabled: false,
      notificationsEnabled: false,
      updatedAt: now,
    }).where(eq(ageProfilesTable.userId, userId));
    await tx.insert(identityOperationsTable).values({
      userId,
      idempotencyKey,
      operation,
      requestHash,
      response: {
        platform: input.platform,
        status: preservesServerVerified ? before.sharingStatus : input.status,
        trust: preservesServerVerified ? "server_verified" : "device_reported_monitoring",
        pendingConflict: conflictsWithVerified || Boolean(before?.pendingConflict),
      },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: userId,
      action: "identity.platform_age_signal_reported",
      resourceType: "platform_age_signal",
      resourceId: `${userId}:${input.platform}`,
      requestId: res.locals.requestId,
      before: before ? {
        platform: before.platform,
        status: before.sharingStatus,
        ageBand: before.ageBand,
        trust: before.trustStatus,
      } : null,
      after: {
        platform: input.platform,
        status: preservesServerVerified ? before.sharingStatus : input.status,
        ageBand: preservesServerVerified ? before.ageBand : input.ageBand,
        trust: preservesServerVerified ? "server_verified" : "device_reported_monitoring",
        pendingConflict: conflictsWithVerified || Boolean(before?.pendingConflict),
      },
    });
  });
  res.json(await onboardingFor(userId));
}));

router.post("/me/legal-acknowledgements", asyncRoute(async (req, res) => {
  const input = parse(RecordLegalAcknowledgementRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const userId = res.locals.principal.userId;
  const operation = `identity.${input.kind}.record.v1`;
  const requestHash = identityRequestHash(operation, input);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-consent:${userId}:${input.kind}`}, 0))`);
    const [existing] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return;
    }
    // Carregado e comparado dentro da mesma transação que grava o aceite.
    // Um deploy que altere qualquer versão obriga o cliente a reler o estado.
    const policy = requireCurrentPolicySnapshot(input);
    const documentVersion = input.kind === "terms_acceptance" ? input.termsVersion : input.privacyNoticeVersion;
    const [age] = await tx.select({ ageBand: ageProfilesTable.ageBand }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, userId)).limit(1);
    if (!age) throw new HttpError(409, "Faixa etária necessária", "Registre a faixa etária antes dos documentos legais.");
    if (age.ageBand === "under_13") {
      throw new HttpError(403, "Conta inelegível", "O produto não oferece acesso para menores de 13 anos.", "https://api.iaaprova.com.br/problems/under-13-not-supported");
    }
    if (age.ageBand !== "18_plus") {
      throw new HttpError(
        403,
        "Autorização do responsável necessária",
        "Documentos obrigatórios de menores são registrados pelo responsável autenticado durante o aceite do convite.",
        "https://api.iaaprova.com.br/problems/guardian-permission-required",
      );
    }
    const [recorded] = await tx.insert(consentsTable).values({
      userId,
      kind: input.kind,
      documentVersion,
      policyVersion: policy.policyVersion,
      granted: true,
      actorUserId: userId,
      actorRole: "self",
      evidence: { channel: "authenticated_api", affirmativeAction: true },
    }).returning({ id: consentsTable.id });
    await tx.insert(identityOperationsTable).values({
      userId, idempotencyKey, operation, requestHash, resourceId: recorded.id,
      response: { kind: input.kind, acknowledged: true, documentVersion },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user", actorId: userId, action: `identity.${input.kind}_recorded`, resourceType: "consent",
      resourceId: recorded.id, requestId: res.locals.requestId,
      after: { kind: input.kind, documentVersion, policyVersion: policy.policyVersion, granted: true },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "consent", aggregateId: recorded.id, eventType: "identity.legal_acknowledgement_recorded.v1",
      payload: { userId, kind: input.kind, documentVersion, policyVersion: policy.policyVersion },
    });
  });
  res.json(await onboardingFor(userId));
}));

router.post("/me/optional-consents", asyncRoute(async (req, res) => {
  const input = parse(RecordOptionalConsentRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const userId = res.locals.principal.userId;
  const policy = requireIdentityPolicy();
  const operation = `identity.optional.${input.kind}.record.v1`;
  const requestHash = identityRequestHash(operation, { ...input, policyVersion: policy.policyVersion });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-consent:${userId}:${input.kind}`}, 0))`);
    const [existing] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return;
    }
    const [age] = await tx.select({ ageBand: ageProfilesTable.ageBand }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, userId)).limit(1);
    if (!age) throw new HttpError(409, "Faixa etária necessária", "Registre a faixa etária antes das escolhas opcionais.");
    if (age.ageBand === "under_13") {
      throw new HttpError(403, "Conta inelegível", "O produto não oferece acesso para menores de 13 anos.", "https://api.iaaprova.com.br/problems/under-13-not-supported");
    }
    if (age.ageBand !== "18_plus") {
      throw new HttpError(403, "Autorização do responsável necessária", "Permissões opcionais de menores são registradas pelo responsável autenticado.", "https://api.iaaprova.com.br/problems/guardian-permission-required");
    }
    if (input.granted && (input.kind === "social" || input.kind === "notifications")) {
      const platformSignalRows = await tx.select({
        platform: platformAgeSignalsTable.platform,
        source: platformAgeSignalsTable.source,
        status: platformAgeSignalsTable.sharingStatus,
        ageBand: platformAgeSignalsTable.ageBand,
        trust: platformAgeSignalsTable.trustStatus,
        pendingConflict: sql<boolean>`${platformAgeSignalsTable.pendingConflict} is not null`,
        observedAt: platformAgeSignalsTable.lastObservedAt,
      }).from(platformAgeSignalsTable).where(eq(platformAgeSignalsTable.userId, userId));
      const summarized = summarizePlatformAgeSignals(
        age.ageBand as AgeBand,
        platformSignalRows as StoredPlatformAgeSignal[],
      );
      const decision = evaluatePlatformAgeSignal({
        selfDeclaredAgeBand: age.ageBand as AgeBand,
        signal: summarized.evidence,
        required: PLATFORM_AGE_SIGNAL_REQUIRED,
      });
      if (!decision.eligible) {
        throw new HttpError(
          403,
          "Sinal etário da loja necessário",
          `Este recurso permanece bloqueado: ${decision.reason}.`,
          `https://api.iaaprova.com.br/problems/${decision.reason.replaceAll("_", "-")}`,
        );
      }
    }
    const [recorded] = await tx.insert(consentsTable).values({
      userId, kind: input.kind, documentVersion: policy.policyVersion, policyVersion: policy.policyVersion,
      granted: input.granted, actorUserId: userId, actorRole: "self",
      evidence: { channel: "authenticated_api", affirmativeAction: true },
    }).returning({ id: consentsTable.id });
    if (input.kind === "social") {
      await tx.update(ageProfilesTable).set({ socialEnabled: input.granted, updatedAt: new Date() })
        .where(eq(ageProfilesTable.userId, userId));
    } else if (input.kind === "notifications") {
      await tx.update(ageProfilesTable).set({ notificationsEnabled: input.granted, updatedAt: new Date() })
        .where(eq(ageProfilesTable.userId, userId));
    }
    await tx.insert(identityOperationsTable).values({
      userId, idempotencyKey, operation, requestHash, resourceId: recorded.id,
      response: { kind: input.kind, granted: input.granted, documentVersion: policy.policyVersion },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user", actorId: userId, action: "identity.optional_consent_recorded", resourceType: "consent",
      resourceId: recorded.id, requestId: res.locals.requestId,
      after: { kind: input.kind, granted: input.granted, policyVersion: policy.policyVersion },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "consent", aggregateId: recorded.id, eventType: "identity.optional_consent_recorded.v1",
      payload: { userId, kind: input.kind, granted: input.granted, policyVersion: policy.policyVersion },
    });
  });
  res.json(await onboardingFor(userId, policy));
}));

router.post("/me/guardian-invitations", asyncRoute(async (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req);
  const userId = res.locals.principal.userId;
  const policy = requireIdentityPolicy();
  let secret: string;
  try {
    secret = requireGuardianInviteSecret();
  } catch {
    throw new HttpError(503, "Convites indisponíveis", "O segredo de convites do responsável não está configurado.");
  }
  const operation = "identity.guardian_invitation.create.v1";
  const requestHash = identityRequestHash(operation, { policyVersion: policy.policyVersion });
  const token = deriveGuardianInviteToken(secret, userId, idempotencyKey);
  const response = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guardian-minor:${userId}`}, 0))`);
    const [existing] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash || !existing.resourceId) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      const [invitation] = await tx.select().from(guardianInvitationsTable)
        .where(and(eq(guardianInvitationsTable.id, existing.resourceId), eq(guardianInvitationsTable.minorUserId, userId))).limit(1);
      if (!invitation) throw new HttpError(409, "Convite indisponível", "O resultado idempotente não está mais disponível.");
      if (!guardianInviteTokenMatches(token, invitation.tokenDigest)) {
        throw new HttpError(
          409,
          "Convite indisponível",
          "O segredo do servidor mudou e este resultado idempotente não pode ser reconstruído com segurança.",
        );
      }
      return GuardianInvitationResponseSchema.parse({ invitationId: invitation.id, token, expiresAt: iso(invitation.expiresAt) });
    }
    const [age] = await tx.select({ ageBand: ageProfilesTable.ageBand }).from(ageProfilesTable)
      .where(eq(ageProfilesTable.userId, userId)).limit(1);
    if (!age || !["13_15", "16_17"].includes(age.ageBand)) {
      throw new HttpError(403, "Convite não permitido", "Somente perfis autodeclarados de 13 a 17 anos podem criar este convite.");
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.guardianInviteTtlSeconds * 1000);
    await tx.update(guardianInvitationsTable).set({ revokedAt: now, updatedAt: now })
      .where(and(
        eq(guardianInvitationsTable.minorUserId, userId),
        isNull(guardianInvitationsTable.usedAt),
        isNull(guardianInvitationsTable.revokedAt),
      ));
    const [created] = await tx.insert(guardianInvitationsTable).values({
      minorUserId: userId,
      tokenDigest: digestGuardianInviteToken(token),
      expiresAt,
    }).returning({ id: guardianInvitationsTable.id });
    const sanitized = { invitationId: created.id, expiresAt: iso(expiresAt) };
    await tx.insert(identityOperationsTable).values({
      userId, idempotencyKey, operation, requestHash, resourceId: created.id, response: sanitized,
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user", actorId: userId, action: "identity.guardian_invitation_created",
      resourceType: "guardian_invitation", resourceId: created.id, requestId: res.locals.requestId,
      after: { expiresAt: iso(expiresAt), delivery: "user_shared" },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "guardian_invitation", aggregateId: created.id, eventType: "identity.guardian_invitation_created.v1",
      payload: { minorUserId: userId, invitationId: created.id, expiresAt: iso(expiresAt) },
    });
    return GuardianInvitationResponseSchema.parse({ ...sanitized, token });
  });
  res.status(201).json(response);
}));

router.post("/guardian-invitations/accept", asyncRoute(async (req, res) => {
  const input = parse(AcceptGuardianInvitationRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const guardianUserId = res.locals.principal.userId;
  const tokenDigest = digestGuardianInviteToken(input.token);
  const operation = "identity.guardian_invitation.accept.v1";
  const requestHash = identityRequestHash(operation, {
    tokenDigest,
    acknowledgements: input.acknowledgements,
    permissions: input.permissions,
    policyVersion: input.policyVersion,
    termsVersion: input.termsVersion,
    privacyNoticeVersion: input.privacyNoticeVersion,
  });
  const response = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${guardianUserId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guardian-invite:${tokenDigest}`}, 0))`);
    const [existingOperation] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, guardianUserId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existingOperation) {
      if (existingOperation.operation !== operation || existingOperation.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return GuardianLinkResponseSchema.parse(existingOperation.response);
    }
    const policy = requireCurrentPolicySnapshot(input);
    const [candidateInvitation] = await tx.select().from(guardianInvitationsTable)
      .where(eq(guardianInvitationsTable.tokenDigest, tokenDigest)).limit(1);
    if (!candidateInvitation) throw new HttpError(404, "Convite inválido", "O convite não existe, expirou ou foi revogado.");
    if (candidateInvitation.minorUserId === guardianUserId) {
      throw new HttpError(409, "Vínculo inválido", "Uma conta não pode ser responsável por si mesma.");
    }
    const profileLockIds = [guardianUserId, candidateInvitation.minorUserId].sort();
    for (const profileUserId of profileLockIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${profileUserId}`}, 0))`);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guardian-minor:${candidateInvitation.minorUserId}`}, 0))`);
    // Creation/replacement revokes outstanding invitations under the
    // guardian-minor lock. Re-read after acquiring that lock so an acceptance
    // can never act on the pre-revocation row snapshot.
    const [invitation] = await tx.select().from(guardianInvitationsTable)
      .where(and(
        eq(guardianInvitationsTable.id, candidateInvitation.id),
        eq(guardianInvitationsTable.tokenDigest, tokenDigest),
        eq(guardianInvitationsTable.minorUserId, candidateInvitation.minorUserId),
      )).limit(1);
    if (!invitation) throw new HttpError(404, "Convite inválido", "O convite não existe, expirou ou foi revogado.");
    const [[guardianAge], [minorAge]] = await Promise.all([
      tx.select({ ageBand: ageProfilesTable.ageBand }).from(ageProfilesTable)
        .where(eq(ageProfilesTable.userId, guardianUserId)).limit(1),
      tx.select({
        ageBand: ageProfilesTable.ageBand,
        socialEnabled: ageProfilesTable.socialEnabled,
        notificationsEnabled: ageProfilesTable.notificationsEnabled,
      }).from(ageProfilesTable)
        .where(eq(ageProfilesTable.userId, invitation.minorUserId)).limit(1),
    ]);
    if (!minorAge || !["13_15", "16_17"].includes(minorAge.ageBand)) {
      throw new HttpError(409, "Perfil do aluno inelegível", "O convite não corresponde a um perfil atual de 13 a 17 anos.");
    }
    const decision = decideGuardianInviteAcceptance({
      now: new Date(), expiresAt: invitation.expiresAt, revokedAt: invitation.revokedAt,
      usedAt: invitation.usedAt, acceptedByUserId: invitation.acceptedByUserId,
      requestingGuardianUserId: guardianUserId, guardianAgeBand: guardianAge?.ageBand ?? null,
    });
    if (decision === "guardian_must_be_adult") {
      throw new HttpError(403, "Responsável inelegível", "A conta do responsável deve possuir faixa etária autodeclarada 18_plus.");
    }
    if (decision === "expired" || decision === "revoked") {
      throw new HttpError(410, "Convite indisponível", "O convite expirou ou foi revogado.");
    }
    if (decision === "already_used") {
      throw new HttpError(409, "Convite já utilizado", "Este convite já foi usado por outra conta autenticada.");
    }
    if (decision === "replay") {
      if (!invitation.guardianLinkId || !invitation.acceptanceRequestHash) {
        throw new HttpError(
          409,
          "Replay indisponível",
          "Este convite legado não possui vínculo criptográfico suficiente para reproduzir o aceite com segurança.",
        );
      }
      if (!guardianInviteReplayMatches(invitation.acceptanceRequestHash, requestHash)) {
        throw new HttpError(
          409,
          "Convite já utilizado",
          "Este convite já foi aceito com outro snapshot jurídico ou escolhas opcionais.",
        );
      }
      const [link] = await tx.select().from(guardianLinksTable).where(and(
        eq(guardianLinksTable.id, invitation.guardianLinkId),
        eq(guardianLinksTable.minorUserId, invitation.minorUserId),
        eq(guardianLinksTable.guardianUserId, guardianUserId),
        eq(guardianLinksTable.status, "verified"),
      )).limit(1);
      if (!link?.verifiedAt) throw new HttpError(410, "Vínculo revogado", "O vínculo criado por este convite não está mais ativo.");
      const persistedPermissions = {
        social: minorAge.socialEnabled,
        notifications: minorAge.notificationsEnabled,
      };
      if (
        persistedPermissions.social !== input.permissions.social
        || persistedPermissions.notifications !== input.permissions.notifications
      ) {
        throw new HttpError(
          409,
          "Convite já utilizado",
          "Este convite já foi aceito com escolhas opcionais diferentes.",
        );
      }
      const replayResult = GuardianLinkResponseSchema.parse({
        linkId: link.id, status: "verified", verifiedAt: iso(link.verifiedAt), permissions: persistedPermissions,
      });
      await tx.insert(identityOperationsTable).values({
        userId: guardianUserId,
        idempotencyKey,
        operation,
        requestHash,
        resourceId: link.id,
        response: replayResult,
      });
      return replayResult;
    }
    const now = new Date();
    await tx.update(guardianLinksTable).set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(and(eq(guardianLinksTable.minorUserId, invitation.minorUserId), eq(guardianLinksTable.status, "verified")));
    const [link] = await tx.insert(guardianLinksTable).values({
      minorUserId: invitation.minorUserId,
      guardianUserId,
      guardianEmailHash: null,
      status: "verified",
      verifiedAt: now,
    }).returning({ id: guardianLinksTable.id });
    await tx.update(guardianInvitationsTable).set({
      usedAt: now,
      acceptedByUserId: guardianUserId,
      guardianLinkId: link.id,
      acceptanceRequestHash: requestHash,
      updatedAt: now,
    })
      .where(eq(guardianInvitationsTable.id, invitation.id));
    const agreementRecords: Array<{ kind: AgreementKind; granted: boolean; documentVersion: string }> = [
      {
        kind: "guardian_responsibility_acknowledgement",
        granted: true,
        documentVersion: policy.policyVersion,
      },
      { kind: "terms_acceptance", granted: true, documentVersion: policy.termsVersion },
      {
        kind: "privacy_notice_acknowledgement",
        granted: true,
        documentVersion: policy.privacyNoticeVersion,
      },
      { kind: "social", granted: input.permissions.social, documentVersion: policy.policyVersion },
      { kind: "notifications", granted: input.permissions.notifications, documentVersion: policy.policyVersion },
    ];
    await tx.insert(consentsTable).values(agreementRecords.map((agreement) => ({
      userId: invitation.minorUserId,
      kind: agreement.kind,
      documentVersion: agreement.documentVersion,
      policyVersion: policy.policyVersion,
      granted: agreement.granted,
      actorUserId: guardianUserId,
      actorRole: "guardian",
      recordedAt: now,
      evidence: {
        channel: "authenticated_guardian_invite",
        guardianLinkId: link.id,
        affirmativeAction: true,
      },
    })));
    await tx.update(ageProfilesTable).set({
      socialEnabled: input.permissions.social,
      notificationsEnabled: input.permissions.notifications,
      updatedAt: now,
    }).where(eq(ageProfilesTable.userId, invitation.minorUserId));
    const result = GuardianLinkResponseSchema.parse({
      linkId: link.id, status: "verified", verifiedAt: iso(now), permissions: input.permissions,
    });
    await tx.insert(identityOperationsTable).values({
      userId: guardianUserId, idempotencyKey, operation, requestHash, resourceId: link.id, response: result,
    });
    await tx.insert(auditLogsTable).values({
      actorType: "guardian", actorId: guardianUserId, action: "identity.guardian_link_verified",
      resourceType: "guardian_link", resourceId: link.id, requestId: res.locals.requestId,
      after: {
        minorUserId: invitation.minorUserId,
        permissions: input.permissions,
        responsibilityAcknowledged: true,
        termsVersion: policy.termsVersion,
        privacyNoticeVersion: policy.privacyNoticeVersion,
        ageEvidence: "self_declared_band",
      },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "guardian_link", aggregateId: link.id, eventType: "identity.guardian_link_verified.v1",
      payload: {
        minorUserId: invitation.minorUserId,
        guardianUserId,
        guardianLinkId: link.id,
        responsibilityAcknowledged: true,
        permissions: input.permissions,
        policyVersion: policy.policyVersion,
        termsVersion: policy.termsVersion,
        privacyNoticeVersion: policy.privacyNoticeVersion,
      },
    });
    return result;
  });
  res.status(200).json(response);
}));

router.get("/me/guardian-links", asyncRoute(async (_req, res) => {
  const userId = res.locals.principal.userId;
  const links = await db.select({
    id: guardianLinksTable.id,
    minorUserId: guardianLinksTable.minorUserId,
    guardianUserId: guardianLinksTable.guardianUserId,
    verifiedAt: guardianLinksTable.verifiedAt,
  }).from(guardianLinksTable).where(and(
    or(eq(guardianLinksTable.minorUserId, userId), eq(guardianLinksTable.guardianUserId, userId)),
    eq(guardianLinksTable.status, "verified"),
  )).orderBy(desc(guardianLinksTable.verifiedAt), desc(guardianLinksTable.createdAt));
  res.json(GuardianLinksResponseSchema.parse({
    links: links.map((link) => {
      if (!link.verifiedAt) throw new HttpError(409, "Vínculo inconsistente", "Um vínculo ativo não possui data de verificação.");
      const role = link.guardianUserId === userId ? "guardian" as const : "student" as const;
      return {
        linkId: link.id,
        role,
        counterpartPseudonym: guardianCounterpartPseudonym(role, link.id),
        status: "verified" as const,
        verifiedAt: iso(link.verifiedAt),
      };
    }),
  }));
}));

async function revokeGuardianLink(input: {
  userId: string;
  requestedLinkId: string | null;
  idempotencyKey: string;
  requestId: string;
  legacy: boolean;
}) {
  const { userId, requestedLinkId, idempotencyKey, requestId, legacy } = input;
  const operation = legacy ? "identity.guardian_link.revoke_legacy.v1" : "identity.guardian_link.revoke_by_id.v1";
  const requestHash = identityRequestHash(operation, { linkId: requestedLinkId });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-op:${userId}:${idempotencyKey}`}, 0))`);
    // Every creation/acceptance path locks both participant profiles. Locking
    // the actor here keeps the legacy "single link" selection stable while a
    // guardian concurrently accepts a link for another student.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-profile:${userId}`}, 0))`);
    const [existingOperation] = await tx.select().from(identityOperationsTable)
      .where(and(eq(identityOperationsTable.userId, userId), eq(identityOperationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existingOperation) {
      if (existingOperation.operation !== operation || existingOperation.requestHash !== requestHash) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outra operação ou payload.");
      }
      return GuardianRevocationResponseSchema.parse(existingOperation.response);
    }
    const candidate = requestedLinkId
      ? (await tx.select().from(guardianLinksTable).where(and(
        eq(guardianLinksTable.id, requestedLinkId),
        or(eq(guardianLinksTable.minorUserId, userId), eq(guardianLinksTable.guardianUserId, userId)),
      )).limit(1))[0]
      : await (async () => {
        const activeLinks = await tx.select().from(guardianLinksTable).where(and(
          or(eq(guardianLinksTable.minorUserId, userId), eq(guardianLinksTable.guardianUserId, userId)),
          eq(guardianLinksTable.status, "verified"),
        )).orderBy(desc(guardianLinksTable.updatedAt)).limit(2);
        if (activeLinks.length > 1) {
          throw new HttpError(
            409,
            "Selecione o vínculo",
            "Esta conta participa de mais de um vínculo. Consulte a lista e revogue pelo identificador exato.",
            "https://api.iaaprova.com.br/problems/guardian-link-selection-required",
          );
        }
        return activeLinks[0];
      })();
    if (!candidate) throw new HttpError(404, "Vínculo não encontrado", "O vínculo não existe ou não pertence a esta conta.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guardian-minor:${candidate.minorUserId}`}, 0))`);
    const [link] = await tx.select().from(guardianLinksTable).where(and(
      eq(guardianLinksTable.id, candidate.id),
      or(eq(guardianLinksTable.minorUserId, userId), eq(guardianLinksTable.guardianUserId, userId)),
    )).limit(1);
    if (!link || link.minorUserId !== candidate.minorUserId) {
      throw new HttpError(409, "Vínculo alterado", "O vínculo mudou durante a revogação; consulte a lista e tente novamente.");
    }
    if (link.status === "revoked") {
      if (!link.revokedAt) throw new HttpError(409, "Vínculo inconsistente", "O vínculo revogado não possui data de revogação.");
      const alreadyRevoked = GuardianRevocationResponseSchema.parse({
        linkId: link.id,
        status: "revoked",
        revokedAt: iso(link.revokedAt),
      });
      await tx.insert(identityOperationsTable).values({
        userId, idempotencyKey, operation, requestHash, resourceId: link.id, response: alreadyRevoked,
      });
      return alreadyRevoked;
    }
    if (link.status !== "verified") throw new HttpError(409, "Vínculo indisponível", "O vínculo não está ativo.");
    const policy = requireIdentityPolicy();
    const now = new Date();
    const [revoked] = await tx.update(guardianLinksTable).set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(and(eq(guardianLinksTable.id, link.id), eq(guardianLinksTable.status, "verified")))
      .returning({ id: guardianLinksTable.id });
    if (!revoked) throw new HttpError(409, "Vínculo alterado", "O vínculo mudou durante a revogação; consulte a lista e tente novamente.");
    await tx.insert(consentsTable).values([
      {
        userId: link.minorUserId, kind: "social", documentVersion: policy.policyVersion,
        policyVersion: policy.policyVersion, granted: false, actorUserId: userId,
        actorRole: link.guardianUserId === userId ? "guardian" : "self", recordedAt: now,
        evidence: { channel: "guardian_link_revocation", guardianLinkId: link.id },
      },
      {
        userId: link.minorUserId, kind: "notifications", documentVersion: policy.policyVersion,
        policyVersion: policy.policyVersion, granted: false, actorUserId: userId,
        actorRole: link.guardianUserId === userId ? "guardian" : "self", recordedAt: now,
        evidence: { channel: "guardian_link_revocation", guardianLinkId: link.id },
      },
    ]);
    await tx.update(ageProfilesTable).set({ socialEnabled: false, notificationsEnabled: false, updatedAt: now })
      .where(eq(ageProfilesTable.userId, link.minorUserId));
    const result = GuardianRevocationResponseSchema.parse({ linkId: link.id, status: "revoked", revokedAt: iso(now) });
    await tx.insert(identityOperationsTable).values({
      userId, idempotencyKey, operation, requestHash, resourceId: link.id, response: result,
    });
    await tx.insert(auditLogsTable).values({
      actorType: link.guardianUserId === userId ? "guardian" : "user", actorId: userId,
      action: "identity.guardian_link_revoked", resourceType: "guardian_link", resourceId: link.id,
      requestId, after: { status: "revoked" },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "guardian_link", aggregateId: link.id, eventType: "identity.guardian_link_revoked.v1",
      payload: { minorUserId: link.minorUserId, guardianLinkId: link.id, policyVersion: policy.policyVersion },
    });
    return result;
  });
}

router.delete("/me/guardian-links/:linkId", asyncRoute(async (req, res) => {
  const response = await revokeGuardianLink({
    userId: res.locals.principal.userId,
    requestedLinkId: parse(z.string().uuid(), req.params.linkId),
    idempotencyKey: requireIdempotencyKey(req),
    requestId: res.locals.requestId,
    legacy: false,
  });
  res.json(response);
}));

router.delete("/me/guardian-link", asyncRoute(async (req, res) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/v1/me/guardian-links>; rel="successor-version"');
  const response = await revokeGuardianLink({
    userId: res.locals.principal.userId,
    requestedLinkId: null,
    idempotencyKey: requireIdempotencyKey(req),
    requestId: res.locals.requestId,
    legacy: true,
  });
  res.json(response);
}));

router.post("/learning/sessions", asyncRoute(async (req, res) => {
  const input = CreateLearningSessionRequestSchema.parse(req.body);
  await requireCapability(res.locals.principal.userId, "learning");
  res.status(201).json(await createSession(res.locals.principal.userId, input));
}));

router.get("/learning/sessions/:sessionId/next", asyncRoute(async (req, res) => {
  const sessionId = parse(z.string().uuid(), req.params.sessionId);
  await requireCapability(res.locals.principal.userId, "learning");
  const question = await nextQuestion(res.locals.principal.userId, sessionId);
  res.json({ question });
}));

router.post("/learning/sessions/:sessionId/attempts", asyncRoute(async (req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  const sessionId = parse(z.string().uuid(), req.params.sessionId);
  const input = parse(SubmitAttemptRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const result = await db.transaction(async (tx) => {
    // Duas travas são necessárias: a chave impede replay concorrente e a
    // exposição impede duas chaves diferentes de corrigirem a mesma questão.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attempt-key:${userId}:${idempotencyKey}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attempt-exposure:${input.exposureId}`}, 0))`);
    const [existing] = await tx.select().from(attemptsTable)
      .where(and(eq(attemptsTable.userId, userId), eq(attemptsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) {
      const sameRequest = isSameAttemptRequest({
        sessionId: existing.sessionId,
        exposureId: existing.exposureId,
        selectedOptionId: existing.selectedOptionId,
        elapsedMs: existing.elapsedMs,
      }, { sessionId, ...input });
      if (!sameRequest) {
        throw new HttpError(409, "Conflito de idempotência", "A Idempotency-Key já foi usada com outro payload.", "https://api.iaaprova.com.br/problems/idempotency-conflict");
      }
      const [version] = await tx.select({ topicId: questionVersionsTable.topicId }).from(questionVersionsTable)
        .where(eq(questionVersionsTable.id, existing.questionVersionId)).limit(1);
      return {
        created: false,
        attemptId: existing.id,
        isCorrect: existing.isCorrect,
        validForCalibration: existing.validForCalibration,
        topicId: version.topicId,
        mastery: { probability: existing.masteryProbability, observations: existing.masteryObservations },
      };
    }

    const [exposure] = await tx.select({
      id: itemExposuresTable.id,
      questionVersionId: itemExposuresTable.questionVersionId,
      answeredAt: itemExposuresTable.answeredAt,
    }).from(itemExposuresTable)
      .innerJoin(learningSessionsTable, and(
        eq(itemExposuresTable.sessionId, learningSessionsTable.id),
        eq(learningSessionsTable.userId, userId),
        eq(learningSessionsTable.status, "active"),
      ))
      .where(and(eq(itemExposuresTable.id, input.exposureId), eq(itemExposuresTable.sessionId, sessionId))).limit(1);
    if (!exposure || exposure.answeredAt) throw new HttpError(409, "Tentativa indisponível", "A questão já foi respondida ou não pertence à sessão.");

    const options = await tx.select().from(questionOptionsTable)
      .where(eq(questionOptionsTable.questionVersionId, exposure.questionVersionId));
    let grade: ReturnType<typeof gradeQuestion>;
    try {
      grade = gradeQuestion(options, input.selectedOptionId);
    } catch (error) {
      if (error instanceof GradingInvariantError && error.message === "selected_option_not_in_question") {
        throw new HttpError(400, "Alternativa inválida", "A alternativa não pertence à questão exposta.");
      }
      throw new HttpError(409, "Conteúdo indisponível", "A questão não possui um único gabarito válido.");
    }
    const [version] = await tx.select({ topicId: questionVersionsTable.topicId }).from(questionVersionsTable)
      .where(eq(questionVersionsTable.id, exposure.questionVersionId)).limit(1);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mastery:${userId}:${version.topicId}`}, 0))`);
    const [current] = await tx.select().from(topicMasteryTable)
      .where(and(eq(topicMasteryTable.userId, userId), eq(topicMasteryTable.topicId, version.topicId))).limit(1);
    const valid = isValidForCalibration(input.elapsedMs);
    const updated = updateMastery(current?.probability ?? null, current?.observations ?? 0, grade.isCorrect, valid);
    const [inserted] = await tx.insert(attemptsTable).values({
      userId,
      sessionId,
      exposureId: exposure.id,
      questionVersionId: exposure.questionVersionId,
      selectedOptionId: input.selectedOptionId,
      isCorrect: grade.isCorrect,
      elapsedMs: input.elapsedMs,
      validForCalibration: valid,
      masteryProbability: updated.probability,
      masteryObservations: updated.observations,
      idempotencyKey,
    }).returning({ id: attemptsTable.id });
    await tx.update(itemExposuresTable).set({ answeredAt: new Date() }).where(eq(itemExposuresTable.id, exposure.id));
    await tx.insert(topicMasteryTable).values({
      userId,
      topicId: version.topicId,
      probability: updated.probability,
      observations: updated.observations,
      algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
    }).onConflictDoUpdate({
      target: [topicMasteryTable.userId, topicMasteryTable.topicId],
      set: { probability: updated.probability, observations: updated.observations, algorithmVersion: ADAPTIVE_ALGORITHM_VERSION, updatedAt: new Date() },
    });
    const intervalDays = grade.isCorrect ? Math.min(30, Math.max(1, updated.observations * 2)) : 1;
    await tx.insert(reviewSchedulesTable).values({
      userId,
      topicId: version.topicId,
      dueAt: new Date(Date.now() + intervalDays * 86_400_000),
      intervalDays,
    }).onConflictDoUpdate({
      target: [reviewSchedulesTable.userId, reviewSchedulesTable.topicId],
      set: { dueAt: new Date(Date.now() + intervalDays * 86_400_000), intervalDays, updatedAt: new Date() },
    });
    await tx.insert(outboxEventsTable).values({
      aggregateType: "attempt",
      aggregateId: inserted.id,
      eventType: "learning.attempt_recorded.v1",
      payload: { userId, sessionId, questionVersionId: exposure.questionVersionId, isCorrect: grade.isCorrect, validForCalibration: valid },
    });
    return { created: true, attemptId: inserted.id, isCorrect: grade.isCorrect, validForCalibration: valid, topicId: version.topicId, mastery: updated };
  });

  const [attempt] = await db.select({ questionVersionId: attemptsTable.questionVersionId }).from(attemptsTable)
    .where(and(eq(attemptsTable.id, result.attemptId), eq(attemptsTable.userId, userId))).limit(1);
  const options = await db.select().from(questionOptionsTable)
    .where(eq(questionOptionsTable.questionVersionId, attempt.questionVersionId));
  const correctOptions = options.filter((option) => option.isCorrect);
  const [version] = await db.select({ solution: questionVersionsTable.solution }).from(questionVersionsTable)
    .where(eq(questionVersionsTable.id, attempt.questionVersionId)).limit(1);
  if (correctOptions.length !== 1) throw new HttpError(409, "Conteúdo indisponível", "A questão não possui gabarito válido.");
  let next: PublicQuestion | null;
  if (result.created) {
    next = await nextQuestion(userId, sessionId, "stop");
  } else {
    const [pending] = await db.select({ id: itemExposuresTable.id }).from(itemExposuresTable)
      .innerJoin(learningSessionsTable, and(
        eq(itemExposuresTable.sessionId, learningSessionsTable.id),
        eq(learningSessionsTable.userId, userId),
      ))
      .where(and(eq(itemExposuresTable.sessionId, sessionId), isNull(itemExposuresTable.answeredAt)))
      .orderBy(itemExposuresTable.sequence)
      .limit(1);
    next = pending ? await publicQuestion(pending.id) : null;
  }
  res.status(result.created ? 201 : 200).json(AttemptResponseSchema.parse({
    attemptId: result.attemptId,
    isCorrect: result.isCorrect,
    correctOptionId: correctOptions[0].id,
    solution: version.solution,
    optionRationales: Object.fromEntries(options.map((option) => [option.id, option.rationale])),
    validForCalibration: result.validForCalibration,
    mastery: { topicId: result.topicId, ...result.mastery },
    nextQuestion: next,
  }));
}));

router.get("/me/progress", asyncRoute(async (_req, res) => {
  res.json(await progressFor(res.locals.principal.userId));
}));

router.get("/billing/entitlement", asyncRoute(async (_req, res) => {
  res.json(await entitlementFor(res.locals.principal.userId));
}));

router.get("/billing/identity", asyncRoute(async (_req, res) => {
  res.setHeader("cache-control", "private, no-store, max-age=0");
  res.json(BillingIdentityResponseSchema.parse({
    appUserId: await canonicalBillingIdentity(res.locals.principal.userId),
  }));
}));

router.post("/billing/restore", asyncRoute(async (req, res) => {
  parse(RestoreBillingRequestSchema, req.body);
  const idempotencyKey = requireIdempotencyKey(req);
  const principal = res.locals.principal;
  const appUserId = await canonicalBillingIdentity(principal.userId);
  const requestId = deterministicRequestUuid(`billing-restore:${principal.userId}:${idempotencyKey}`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`billing-restore:${requestId}`}, 0))`);
    const [created] = await tx.insert(outboxEventsTable).values({
      id: requestId,
      aggregateType: "billing_restore",
      aggregateId: principal.userId,
      eventType: "billing.restore_requested.v1",
      payload: { userId: principal.userId, appUserId, provider: "revenuecat" },
    }).onConflictDoNothing().returning({ id: outboxEventsTable.id });
    if (!created) return;
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: principal.userId,
      action: "billing.restore_requested",
      resourceType: "user",
      resourceId: principal.userId,
      requestId: res.locals.requestId,
    });
  });
  res.status(202).json(AsyncRequestResponseSchema.parse({ requestId, status: "pending" }));
}));

router.get("/simulations/blueprints", asyncRoute(async (req, res) => {
  await requireCapability(res.locals.principal.userId, "learning");
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  res.json(SimulationBlueprintsResponseSchema.parse({
    blueprints: await listPublishedSimulationBlueprints(productId),
  }));
}));

router.post("/simulations", asyncRoute(async (req, res) => {
  const input = parse(CreateSimulationRequestSchema, req.body);
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  res.status(201).json(SimulationSessionResponseSchema.parse(await createProductSimulation(
    userId,
    input.blueprintVersionId,
    requireIdempotencyKey(req),
  )));
}));

router.get("/simulations/active", asyncRoute(async (_req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  res.json(ActiveSimulationResponseSchema.parse({
    simulation: await getActiveProductSimulation(userId),
  }));
}));

router.get("/simulations/:simulationId", asyncRoute(async (req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  const simulationId = parse(z.string().uuid(), req.params.simulationId);
  res.json(SimulationSessionResponseSchema.parse(await getProductSimulation(userId, simulationId)));
}));

router.post("/simulations/:simulationId/answers", asyncRoute(async (req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  const simulationId = parse(z.string().uuid(), req.params.simulationId);
  const input = parse(SubmitSimulationAnswerRequestSchema, req.body);
  res.json(SimulationAnswerResponseSchema.parse(await answerProductSimulation(
    userId,
    simulationId,
    input,
    requireIdempotencyKey(req),
  )));
}));

router.get("/simulations/:simulationId/result", asyncRoute(async (req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "learning");
  const simulationId = parse(z.string().uuid(), req.params.simulationId);
  res.json(SimulationResultResponseSchema.parse(await getProductSimulationResult(userId, simulationId)));
}));

router.get("/social/summary", asyncRoute(async (_req, res) => {
  const userId = res.locals.principal.userId;
  await requireCapability(userId, "social");
  const [[age], [profile], [friends], [pending], [duels]] = await Promise.all([
    db.select().from(ageProfilesTable).where(eq(ageProfilesTable.userId, userId)).limit(1),
    db.select().from(socialProfilesTable).where(eq(socialProfilesTable.userId, userId)).limit(1),
    db.select({ total: count() }).from(friendshipsTable).where(and(
      eq(friendshipsTable.status, "accepted"),
      sql`(${friendshipsTable.requesterId} = ${userId} or ${friendshipsTable.addresseeId} = ${userId})`,
    )),
    db.select({ total: count() }).from(friendshipsTable).where(and(eq(friendshipsTable.addresseeId, userId), eq(friendshipsTable.status, "pending"))),
    db.select({ total: count() }).from(duelMatchesTable).where(and(
      sql`(${duelMatchesTable.playerOneId} = ${userId} or ${duelMatchesTable.playerTwoId} = ${userId})`,
      eq(duelMatchesTable.status, "active"),
    )),
  ]);
  res.json(SocialSummaryResponseSchema.parse({
    enabled: age?.socialEnabled ?? false,
    profile: profile ? { pseudonym: profile.pseudonym, avatarKey: profile.avatarKey, inviteCode: profile.inviteCode } : null,
    friendCount: Number(friends?.total ?? 0),
    pendingInvites: Number(pending?.total ?? 0),
    activeDuels: Number(duels?.total ?? 0),
  }));
}));

router.get("/me/home", asyncRoute(async (_req, res) => {
  const userId = res.locals.principal.userId;
  const [user] = await db.select({
    activeProductId: usersTable.concursoId,
    dailyGoalMinutes: usersTable.dailyGoalMinutes,
    currentStreak: usersTable.currentStreak,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [selection] = await db.select().from(userProductSelectionsTable).where(eq(userProductSelectionsTable.userId, userId)).limit(1);
  res.json(HomeResponseSchema.parse({
    activeProductId: selection?.productId ?? user.activeProductId,
    dailyGoalMinutes: user.dailyGoalMinutes ?? 30,
    streak: user.currentStreak ?? 0,
    progress: await progressFor(userId),
    entitlement: await entitlementFor(userId),
  }));
}));

router.post("/reports", asyncRoute(async (req, res) => {
  const input = parse(ReportRequestSchema, req.body);
  const userId = res.locals.principal.userId;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`report:${userId}:${input.targetType}:${input.targetId}:${input.reason}`}, 0))`);
    const [existing] = await tx.select({ id: reportsTable.id, status: reportsTable.status }).from(reportsTable)
      .where(and(
        eq(reportsTable.reporterUserId, userId),
        eq(reportsTable.targetType, input.targetType),
        eq(reportsTable.targetId, input.targetId),
        eq(reportsTable.reason, input.reason),
        eq(reportsTable.status, "open"),
      ))
      .limit(1);
    if (existing) return { report: existing, created: false };
    const [created] = await tx.insert(reportsTable).values({ reporterUserId: userId, ...input })
      .returning({ id: reportsTable.id, status: reportsTable.status });
    return { report: created, created: true };
  });
  res.status(result.created ? 201 : 200).json(ReportResponseSchema.parse({ reportId: result.report.id, status: result.report.status }));
}));

async function createDataRequest(
  userId: string,
  kind: "export" | "deletion",
  requestId: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`privacy:${userId}`}, 0))`);
    const [existing] = await tx.select({ id: dataRequestsTable.id, kind: dataRequestsTable.kind }).from(dataRequestsTable)
      .where(and(
        eq(dataRequestsTable.userId, userId),
        inArray(dataRequestsTable.status, ["pending", "processing"]),
      ))
      .orderBy(desc(dataRequestsTable.requestedAt))
      .limit(1);
    if (existing) {
      if (existing.kind !== kind) {
        throw new HttpError(409, "Pedido de privacidade em andamento", "Conclua o pedido atual antes de iniciar outro tipo de solicitação.");
      }
      return AsyncRequestResponseSchema.parse({ requestId: existing.id, status: "pending" });
    }
    const subjectHash = createHash("sha256").update(userId, "utf8").digest("hex");
    const [created] = await tx.insert(dataRequestsTable).values({ userId, subjectHash, kind }).returning({ id: dataRequestsTable.id });
    await tx.insert(dataRequestEvidenceTable).values({
      requestId: created.id,
      step: "requested",
      idempotencyKey: `request:${created.id}`,
      evidence: { kind },
    });
    if (kind === "deletion") {
      await tx.update(usersTable).set({ deletionRequestedAt: new Date() }).where(eq(usersTable.id, userId));
    }
    await tx.insert(outboxEventsTable).values({
      aggregateType: "data_request",
      aggregateId: created.id,
      eventType: `privacy.${kind}_requested.v1`,
      payload: { userId, dataRequestId: created.id },
    });
    await tx.insert(auditLogsTable).values({
      actorType: "user",
      actorId: userId,
      action: `privacy.${kind}_requested`,
      resourceType: "data_request",
      resourceId: created.id,
      requestId,
    });
    return AsyncRequestResponseSchema.parse({ requestId: created.id, status: "pending" });
  });
}

router.post("/me/export", asyncRoute(async (_req, res) => {
  res.status(202).json(await createDataRequest(res.locals.principal.userId, "export", res.locals.requestId));
}));

router.get("/me/data-requests/:requestId", asyncRoute(async (req, res) => {
  const requestId = parse(z.string().uuid(), req.params.requestId);
  const [request] = await db.select({
    id: dataRequestsTable.id,
    kind: dataRequestsTable.kind,
    status: dataRequestsTable.status,
    phase: dataRequestsTable.phase,
    requestedAt: dataRequestsTable.requestedAt,
    updatedAt: dataRequestsTable.updatedAt,
    completedAt: dataRequestsTable.completedAt,
    exportChecksumSha256: dataRequestsTable.exportChecksumSha256,
    exportSizeBytes: dataRequestsTable.exportSizeBytes,
    exportObjectGeneration: dataRequestsTable.exportObjectGeneration,
    exportExpiresAt: dataRequestsTable.exportExpiresAt,
    exportRevokedAt: dataRequestsTable.exportRevokedAt,
    userDeletionRequestedAt: usersTable.deletionRequestedAt,
    errorCode: dataRequestsTable.errorCode,
  }).from(dataRequestsTable).innerJoin(usersTable, eq(usersTable.id, dataRequestsTable.userId)).where(and(
    eq(dataRequestsTable.id, requestId),
    eq(dataRequestsTable.userId, res.locals.principal.userId),
  )).limit(1);
  if (!request) throw new HttpError(404, "Pedido não encontrado", "O pedido não existe para esta conta.");
  const exportMetadata = request.kind === "export"
    && request.exportChecksumSha256 !== null
    && request.exportSizeBytes !== null
    && request.exportExpiresAt !== null
    ? {
      checksumSha256: request.exportChecksumSha256,
      sizeBytes: request.exportSizeBytes,
      expiresAt: request.exportExpiresAt.toISOString(),
      available: request.status === "completed"
        && request.exportObjectGeneration !== null
        && request.exportRevokedAt === null
        && request.userDeletionRequestedAt === null
        && request.exportExpiresAt.getTime() > Date.now(),
      downloadPath: `/api/v1/me/data-requests/${request.id}/export`,
    }
    : null;
  res.json(DataRequestStatusResponseSchema.parse({
    requestId: request.id,
    kind: request.kind,
    status: request.status,
    phase: request.phase,
    requestedAt: request.requestedAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    export: exportMetadata,
    errorCode: request.errorCode,
  }));
}));

router.get("/me/data-requests/:requestId/export", asyncRoute(async (req, res) => {
  const requestId = parse(z.string().uuid(), req.params.requestId);
  const userId = res.locals.principal.userId;
  let config: PrivacyExportDeliveryConfig | null;
  try {
    config = loadPrivacyExportDeliveryConfig();
  } catch {
    throw new HttpError(503, "Exportação indisponível", "A entrega privada ainda não está configurada com todos os controles exigidos.");
  }
  if (!config) {
    throw new HttpError(503, "Exportação indisponível", "A entrega privada ainda não está habilitada.");
  }
  const [request] = await db.select({
    id: dataRequestsTable.id,
    userId: dataRequestsTable.userId,
    subjectHash: dataRequestsTable.subjectHash,
    kind: dataRequestsTable.kind,
    status: dataRequestsTable.status,
    exportChecksumSha256: dataRequestsTable.exportChecksumSha256,
    exportSizeBytes: dataRequestsTable.exportSizeBytes,
    exportObjectKey: dataRequestsTable.exportObjectKey,
    exportObjectGeneration: dataRequestsTable.exportObjectGeneration,
    exportExpiresAt: dataRequestsTable.exportExpiresAt,
    exportRevokedAt: dataRequestsTable.exportRevokedAt,
    userDeletionRequestedAt: usersTable.deletionRequestedAt,
  }).from(dataRequestsTable).innerJoin(usersTable, eq(usersTable.id, dataRequestsTable.userId)).where(and(
    eq(dataRequestsTable.id, requestId),
    eq(dataRequestsTable.userId, userId),
  )).limit(1);
  if (!request || request.kind !== "export") {
    throw new HttpError(404, "Exportação não encontrada", "A exportação não existe para esta conta.");
  }
  if (request.status !== "completed" || !request.exportChecksumSha256
      || request.exportSizeBytes === null || !request.exportObjectKey
      || !request.exportObjectGeneration || !request.exportExpiresAt) {
    throw new HttpError(409, "Exportação ainda não disponível", "A exportação ainda não foi concluída.");
  }
  if (request.exportRevokedAt !== null) {
    throw new HttpError(410, "Exportação revogada", "Este arquivo foi revogado e não pode mais ser baixado.");
  }
  if (request.userDeletionRequestedAt !== null) {
    throw new HttpError(410, "Exportação revogada", "A exclusão da conta revogou o acesso aos exports existentes.");
  }
  const descriptor: PrivacyExportDescriptor = {
    requestId: request.id,
    objectKey: request.exportObjectKey,
    generation: request.exportObjectGeneration,
    checksumSha256: request.exportChecksumSha256,
    sizeBytes: request.exportSizeBytes,
    expiresAt: request.exportExpiresAt,
  };
  if (request.exportExpiresAt.getTime() <= Date.now()) {
    await db.insert(dataRequestExportAccessEventsTable).values({
      requestId: request.id,
      subjectHash: request.subjectHash,
      eventType: "expired_denied",
      objectGeneration: request.exportObjectGeneration,
      requestCorrelationId: res.locals.requestId,
    }).onConflictDoNothing();
    throw new HttpError(410, "Exportação expirada", "Solicite uma nova exportação para receber um arquivo atualizado.");
  }
  try {
    validatePrivacyExportDescriptor(descriptor, config);
  } catch {
    throw new HttpError(503, "Exportação indisponível", "Os metadados privados da exportação não passaram na validação.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  let download: PrivacyExportDownload;
  try {
    download = await new GcsPrivacyExportReader(config).download(
      descriptor,
      req.header("range"),
      controller.signal,
    );
  } catch (error) {
    if (error instanceof PrivacyExportDeliveryError) {
      if (error.code === "privacy_export_range_invalid" || error.code === "privacy_export_range_required") {
        res.setHeader("content-range", `bytes */${descriptor.sizeBytes}`);
        throw new HttpError(416, "Faixa inválida", "Solicite uma única faixa dentro do limite permitido.");
      }
      if (error.code === "privacy_export_expired" || error.code === "privacy_export_object_unavailable") {
        throw new HttpError(410, "Exportação indisponível", "O arquivo expirou ou foi removido.");
      }
      throw new HttpError(503, "Exportação indisponível", "Não foi possível recuperar o arquivo privado com segurança.");
    }
    throw error;
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`privacy:${userId}`}, 0))`);
    await tx.execute(sql`select id from data_requests where id = ${requestId} and user_id = ${userId} for update`);
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    const [current] = await tx.select({
      subjectHash: dataRequestsTable.subjectHash,
      status: dataRequestsTable.status,
      generation: dataRequestsTable.exportObjectGeneration,
      expiresAt: dataRequestsTable.exportExpiresAt,
      revokedAt: dataRequestsTable.exportRevokedAt,
    }).from(dataRequestsTable).where(and(
      eq(dataRequestsTable.id, requestId),
      eq(dataRequestsTable.userId, userId),
    )).limit(1);
    const [owner] = await tx.select({ deletionRequestedAt: usersTable.deletionRequestedAt })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!current || current.status !== "completed" || current.generation !== descriptor.generation
        || !owner || owner.deletionRequestedAt !== null
        || current.revokedAt !== null || !current.expiresAt || current.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(410, "Exportação indisponível", "O acesso foi revogado ou expirou durante a solicitação.");
    }
    await tx.insert(dataRequestExportAccessEventsTable).values({
      requestId,
      subjectHash: current.subjectHash,
      eventType: "accessed",
      objectGeneration: descriptor.generation,
      byteStart: download.range.start,
      byteEnd: download.range.end,
      sizeBytes: download.bytes.byteLength,
      requestCorrelationId: res.locals.requestId,
    });
  });

  res.status(download.partial ? 206 : 200);
  res.setHeader("cache-control", "private, no-store, max-age=0");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="ia-aprova-export-${requestId}.json"`);
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-length", String(download.bytes.byteLength));
  res.setHeader("x-content-sha256", descriptor.checksumSha256);
  if (download.partial) {
    res.setHeader("content-range", `bytes ${download.range.start}-${download.range.end}/${descriptor.sizeBytes}`);
  }
  res.send(Buffer.from(download.bytes));
}));

router.delete("/me", asyncRoute(async (_req, res) => {
  res.status(202).json(await createDataRequest(res.locals.principal.userId, "deletion", res.locals.requestId));
}));

export default router;
