import { createHash, randomUUID } from "node:crypto";
import {
  blueprintSubjectsTable,
  blueprintVersionsTable,
  db,
  entitlementsTable,
  examVersionsTable,
  licensesTable,
  outboxEventsTable,
  productsTable,
  publicationsTable,
  questionItemsTable,
  questionOptionsTable,
  questionVersionsTable,
  reviewDecisionsTable,
  simulationAnswersTable,
  simulationQuestionsTable,
  simulationSessionsTable,
  sourcesTable,
  subjectsTable,
  userProductSelectionsTable,
} from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HttpError } from "../lib/http";
import {
  compileSimulationBlueprintRules,
  computeSimulationResult,
  createSimulationPresentation,
  createSimulationSnapshot,
  createSimulationState,
  finishSimulationAtTime,
  SimulationBlueprintError,
  submitSimulationAnswer,
  type SimulationBlueprintRulesV1,
  type SimulationResult,
  type SimulationSnapshot,
  type SimulationState,
} from "./simulation-blueprint";
import { hasEligibleSimulationQuestionRights } from "./simulation-rights";
import { hasEligibleSimulationQuestionReviews } from "./simulation-reviews";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StoredSession = typeof simulationSessionsTable.$inferSelect;

export type PublicSimulationQuestion = {
  position: number;
  questionVersionId: string;
  subject: { id: string; name: string };
  statement: string;
  difficulty: "easy" | "medium" | "hard";
  options: Array<{ id: string; key: string; body: string }>;
};

export type PublicSimulationSession = {
  simulationId: string;
  status: "active" | "finalized";
  serverNow: string;
  startedAt: string;
  deadlineAt: string;
  blueprint: {
    id: string;
    productId: string;
    examVersionId: string;
    version: number;
    rules: SimulationBlueprintRulesV1;
  };
  answeredQuestionVersionIds: string[];
  answers: Array<{ questionVersionId: string; selectedOptionId: string }>;
  questions: PublicSimulationQuestion[];
  resultAvailable: boolean;
};

type CandidateQuestion = {
  id: string;
  subjectId: string;
  contentHash: string;
  origin: string;
  authorId: string | null;
  sourceTransformation: string | null;
  presentationKind: string;
  sourceId: string | null;
  sourceOwner: string | null;
  sourceContentHash: string | null;
  licenseId: string | null;
  licenseSourceId: string | null;
  licenseType: string | null;
  licensePermissions: string[] | null;
  licenseStatus: string | null;
  licenseTerritory: string | null;
  licensePlatforms: string[] | null;
  licenseStartsAt: Date | null;
  licenseExpiresAt: Date | null;
  licenseEvidenceHash: string | null;
  licenseApprovedBy: string | null;
};

function normalizedDifficulty(value: string): "easy" | "medium" | "hard" {
  if (value === "easy") return "easy";
  if (value === "hard") return "hard";
  return "medium";
}

function engineHttpError(error: unknown): never {
  if (!(error instanceof SimulationBlueprintError)) throw error;
  const conflictCodes = new Set([
    "idempotency_key_conflict",
    "question_already_answered",
    "simulation_not_finalized",
  ]);
  const serverCodes = new Set(["clock_regression", "clock_before_simulation_start"]);
  if (conflictCodes.has(error.code)) {
    throw new HttpError(409, "Resposta em conflito", "A primeira resposta válida da questão prevalece e não pode ser alterada.");
  }
  if (serverCodes.has(error.code)) {
    throw new HttpError(503, "Relógio do servidor indisponível", "Não foi possível validar o prazo com segurança. Tente novamente.");
  }
  throw new HttpError(409, "Simulado inconsistente", "O simulado não passou nas validações de integridade.");
}

function asSnapshot(value: unknown): SimulationSnapshot {
  return value as SimulationSnapshot;
}

function asState(value: unknown): SimulationState {
  return value as SimulationState;
}

function asResult(value: unknown): SimulationResult {
  return value as SimulationResult;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertStoredSession(row: StoredSession): { snapshot: SimulationSnapshot; state: SimulationState } {
  const snapshot = asSnapshot(row.snapshot);
  const state = asState(row.state);
  let storedRules: SimulationBlueprintRulesV1;
  try {
    // Both calls strictly rehydrate/freeze untrusted JSON from PostgreSQL.
    storedRules = compileSimulationBlueprintRules(row.rules);
    createSimulationPresentation(snapshot);
    finishSimulationAtTime(snapshot, state, Math.max(snapshot.startedAtMs, state.answers.at(-1)?.receivedAtMs ?? 0));
  } catch (error) {
    engineHttpError(error);
  }
  if (snapshot.sessionId !== row.id
      || snapshot.blueprintVersionId !== row.blueprintVersionId
      || snapshot.snapshotHash !== row.snapshotHash
      || state.sessionId !== row.id
      || state.snapshotHash !== row.snapshotHash
      || snapshot.startedAtMs !== row.startedAt.getTime()
      || snapshot.deadlineAtMs !== row.deadlineAt.getTime()
      || canonicalJson(storedRules) !== canonicalJson(snapshot.rules)
      || state.status !== row.status) {
    throw new HttpError(409, "Simulado inconsistente", "O snapshot persistido divergiu dos campos imutáveis da sessão.");
  }
  return { snapshot, state };
}

function deterministicOrder(seed: string, questionVersionId: string): string {
  return createHash("sha256").update(`${seed}:${questionVersionId}`, "utf8").digest("hex");
}

async function databaseClock(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ serverNow: Date | string }>(
    sql`select clock_timestamp() as "serverNow"`,
  );
  const raw = result.rows[0]?.serverNow;
  const observed = raw instanceof Date ? raw : new Date(raw ?? Number.NaN);
  if (!Number.isFinite(observed.getTime())) {
    throw new HttpError(503, "Relógio do servidor indisponível", "Não foi possível obter o horário autoritativo do banco de dados.");
  }
  return observed;
}

function isProActive(row: { status: string; expiresAt: Date | null } | undefined, now: Date): boolean {
  return Boolean(row
    && ["active", "grace_period"].includes(row.status)
    && (!row.expiresAt || row.expiresAt > now));
}

async function enforceCreateEntitlement(
  tx: Transaction,
  userId: string,
  productId: string,
  now: Date,
): Promise<void> {
  const [entitlement] = await tx.select({
    status: entitlementsTable.status,
    expiresAt: entitlementsTable.expiresAt,
  }).from(entitlementsTable)
    .where(and(eq(entitlementsTable.userId, userId), eq(entitlementsTable.key, "pro")))
    .limit(1);
  if (isProActive(entitlement, now)) return;

  const [selection] = await tx.select().from(userProductSelectionsTable)
    .where(eq(userProductSelectionsTable.userId, userId)).limit(1);
  if (selection && selection.productId !== productId) {
    throw new HttpError(403, "Concurso bloqueado", "O plano Free permite somente um concurso ativo.", "https://api.iaaprova.com.br/problems/free-product-limit");
  }
  if (!selection) await tx.insert(userProductSelectionsTable).values({ userId, productId });

  const [monthly] = await tx.select({ total: count() }).from(simulationSessionsTable).where(and(
    eq(simulationSessionsTable.userId, userId),
    sql`${simulationSessionsTable.startedAt} >= (date_trunc('month', ${now} at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`,
  ));
  if (Number(monthly?.total ?? 0) >= 1) {
    throw new HttpError(403, "Limite mensal atingido", "O plano Free permite um simulado por mês.", "https://api.iaaprova.com.br/problems/free-simulation-limit");
  }
}

async function persistFinalized(
  tx: Transaction,
  row: StoredSession,
  snapshot: SimulationSnapshot,
  state: SimulationState,
): Promise<SimulationResult> {
  let result: SimulationResult;
  try {
    result = computeSimulationResult(snapshot, state);
  } catch (error) {
    engineHttpError(error);
  }
  await tx.update(simulationSessionsTable).set({
    status: "finalized",
    state: state as unknown as Record<string, unknown>,
    result: result as unknown as Record<string, unknown>,
    resultHash: result.resultHash,
    finalizedAt: new Date(result.finalizedAtMs),
    finishReason: result.finishReason,
    updatedAt: new Date(),
  }).where(and(eq(simulationSessionsTable.id, row.id), eq(simulationSessionsTable.userId, row.userId)));
  return result;
}

async function finalizeIfDue(
  tx: Transaction,
  row: StoredSession,
  now: Date,
): Promise<StoredSession> {
  const { snapshot, state } = assertStoredSession(row);
  const answerRows = await tx.select({
    idempotencyKey: simulationAnswersTable.idempotencyKey,
    questionVersionId: simulationAnswersTable.questionVersionId,
    selectedOptionId: simulationAnswersTable.selectedOptionId,
    receivedAt: simulationAnswersTable.receivedAt,
  }).from(simulationAnswersTable)
    .where(eq(simulationAnswersTable.simulationId, row.id))
    .orderBy(simulationAnswersTable.receivedAt, simulationAnswersTable.createdAt);
  const relationalAnswers = answerRows.map((answer) => ({
    idempotencyKey: answer.idempotencyKey,
    questionVersionId: answer.questionVersionId,
    selectedOptionId: answer.selectedOptionId,
    receivedAtMs: answer.receivedAt.getTime(),
  }));
  if (canonicalJson(relationalAnswers) !== canonicalJson(state.answers)) {
    throw new HttpError(409, "Simulado inconsistente", "As respostas relacionais divergiram do estado imutável.");
  }
  let next: SimulationState;
  try {
    next = finishSimulationAtTime(snapshot, state, now.getTime());
  } catch (error) {
    engineHttpError(error);
  }
  if (next.status === "finalized" && row.status !== "finalized") {
    await persistFinalized(tx, row, snapshot, next);
    const [updated] = await tx.select().from(simulationSessionsTable)
      .where(and(eq(simulationSessionsTable.id, row.id), eq(simulationSessionsTable.userId, row.userId))).limit(1);
    if (!updated) throw new HttpError(404, "Simulado não encontrado", "O simulado não existe para esta conta.");
    return updated;
  }
  return row;
}

async function lockOwnedSession(tx: Transaction, userId: string, simulationId: string): Promise<StoredSession> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`simulation:${simulationId}`}, 0))`);
  await tx.execute(sql`select id from simulation_sessions where id = ${simulationId} and user_id = ${userId} for update`);
  const [row] = await tx.select().from(simulationSessionsTable).where(and(
    eq(simulationSessionsTable.id, simulationId),
    eq(simulationSessionsTable.userId, userId),
  )).limit(1);
  if (!row) throw new HttpError(404, "Simulado não encontrado", "O simulado não existe para esta conta.");
  return row;
}

async function publicQuestions(simulationId: string, snapshot: SimulationSnapshot): Promise<PublicSimulationQuestion[]> {
  const rows = await db.select({
    position: simulationQuestionsTable.position,
    questionVersionId: simulationQuestionsTable.questionVersionId,
    subjectId: subjectsTable.id,
    subjectName: subjectsTable.name,
    statement: questionVersionsTable.statement,
    difficulty: questionVersionsTable.difficulty,
  }).from(simulationQuestionsTable)
    .innerJoin(questionVersionsTable, eq(simulationQuestionsTable.questionVersionId, questionVersionsTable.id))
    .innerJoin(subjectsTable, eq(simulationQuestionsTable.subjectId, subjectsTable.id))
    .where(eq(simulationQuestionsTable.simulationId, simulationId))
    .orderBy(simulationQuestionsTable.position);
  const optionRows = rows.length === 0 ? [] : await db.select({
    questionVersionId: questionOptionsTable.questionVersionId,
    id: questionOptionsTable.id,
    key: questionOptionsTable.key,
    body: questionOptionsTable.body,
    orderIndex: questionOptionsTable.orderIndex,
  }).from(questionOptionsTable)
    .where(inArray(questionOptionsTable.questionVersionId, rows.map((row) => row.questionVersionId)))
    .orderBy(questionOptionsTable.questionVersionId, questionOptionsTable.orderIndex);
  const optionsByQuestion = new Map<string, typeof optionRows>();
  for (const option of optionRows) {
    const existing = optionsByQuestion.get(option.questionVersionId) ?? [];
    existing.push(option);
    optionsByQuestion.set(option.questionVersionId, existing);
  }
  const expected = createSimulationPresentation(snapshot);
  if (rows.length !== expected.length) {
    throw new HttpError(409, "Simulado inconsistente", "A apresentação persistida está incompleta.");
  }
  return rows.map((row, index) => {
    const options = optionsByQuestion.get(row.questionVersionId) ?? [];
    const presentation = expected[index];
    if (presentation.position !== row.position
        || presentation.questionVersionId !== row.questionVersionId
        || presentation.subjectId !== row.subjectId
        || options.length !== presentation.optionIds.length
        || options.some((option, optionIndex) => option.id !== presentation.optionIds[optionIndex])) {
      throw new HttpError(409, "Simulado inconsistente", "A versão imutável da questão divergiu do snapshot.");
    }
    return {
      position: row.position,
      questionVersionId: row.questionVersionId,
      subject: { id: row.subjectId, name: row.subjectName },
      statement: row.statement,
      difficulty: normalizedDifficulty(row.difficulty),
      options: options.map(({ id, key, body }) => ({ id, key, body })),
    };
  });
}

async function toPublicSession(row: StoredSession, serverNow: Date): Promise<PublicSimulationSession> {
  const { snapshot, state } = assertStoredSession(row);
  const [blueprint] = await db.select({ version: blueprintVersionsTable.version })
    .from(blueprintVersionsTable).where(eq(blueprintVersionsTable.id, row.blueprintVersionId)).limit(1);
  if (!blueprint) throw new HttpError(409, "Simulado inconsistente", "O blueprint imutável não foi encontrado.");
  return {
    simulationId: row.id,
    status: row.status as "active" | "finalized",
    serverNow: serverNow.toISOString(),
    startedAt: row.startedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    blueprint: {
      id: row.blueprintVersionId,
      productId: row.productId,
      examVersionId: row.examVersionId,
      version: blueprint.version,
      rules: snapshot.rules,
    },
    answeredQuestionVersionIds: state.answers.map((answer) => answer.questionVersionId),
    answers: state.answers.map((answer) => ({
      questionVersionId: answer.questionVersionId,
      selectedOptionId: answer.selectedOptionId,
    })),
    questions: await publicQuestions(row.id, snapshot),
    resultAvailable: row.status === "finalized",
  };
}

export async function listPublishedSimulationBlueprints(productId?: string) {
  const rows = await db.select({
    id: blueprintVersionsTable.id,
    productId: examVersionsTable.productId,
    examVersionId: blueprintVersionsTable.examVersionId,
    version: blueprintVersionsTable.version,
    rules: blueprintVersionsTable.rules,
  }).from(blueprintVersionsTable)
    .innerJoin(examVersionsTable, eq(blueprintVersionsTable.examVersionId, examVersionsTable.id))
    .innerJoin(productsTable, eq(examVersionsTable.productId, productsTable.id))
    .where(and(
      eq(blueprintVersionsTable.status, "published"),
      eq(examVersionsTable.status, "active"),
      eq(productsTable.status, "active"),
      productId ? eq(examVersionsTable.productId, productId) : undefined,
    ))
    .orderBy(examVersionsTable.productId, desc(blueprintVersionsTable.version));
  return rows.flatMap((row) => {
    try {
      return [{ ...row, rules: compileSimulationBlueprintRules(row.rules) }];
    } catch {
      // A malformed published blueprint is never advertised to clients.
      return [];
    }
  });
}

export async function createProductSimulation(
  userId: string,
  blueprintVersionId: string,
  idempotencyKey: string,
): Promise<PublicSimulationSession> {
  const createdId = await db.transaction(async (tx) => {
    // Serialize every create for this user, not just a repeated key. This makes
    // the Free monthly quota authoritative under two concurrent different keys.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`simulation-create:${userId}`}, 0))`);
    const [replay] = await tx.select().from(simulationSessionsTable).where(and(
      eq(simulationSessionsTable.userId, userId),
      eq(simulationSessionsTable.createIdempotencyKey, idempotencyKey),
    )).limit(1);
    if (replay) {
      if (replay.blueprintVersionId !== blueprintVersionId) {
        throw new HttpError(409, "Chave idempotente em conflito", "A chave já iniciou outro blueprint.");
      }
      return replay.id;
    }
    const [active] = await tx.select({ id: simulationSessionsTable.id })
      .from(simulationSessionsTable)
      .where(and(
        eq(simulationSessionsTable.userId, userId),
        eq(simulationSessionsTable.status, "active"),
      ))
      .limit(1);
    if (active) {
      throw new HttpError(
        409,
        "Simulado em andamento",
        "Conclua ou aguarde a finalização do simulado atual antes de iniciar outro.",
        "https://api.iaaprova.com.br/problems/simulation-already-active",
      );
    }
    // `clock_timestamp()` must be sampled after the serialized user lock. A
    // process clock captured before waiting could admit an expired entitlement
    // or rights instrument and could start the deadline in the past.
    const serverNow = await databaseClock(tx);

    const [blueprint] = await tx.select({
      id: blueprintVersionsTable.id,
      rules: blueprintVersionsTable.rules,
      examVersionId: blueprintVersionsTable.examVersionId,
      productId: examVersionsTable.productId,
    }).from(blueprintVersionsTable)
      .innerJoin(examVersionsTable, eq(blueprintVersionsTable.examVersionId, examVersionsTable.id))
      .innerJoin(productsTable, eq(examVersionsTable.productId, productsTable.id))
      .where(and(
        eq(blueprintVersionsTable.id, blueprintVersionId),
        eq(blueprintVersionsTable.status, "published"),
        eq(examVersionsTable.status, "active"),
        eq(productsTable.status, "active"),
      )).limit(1);
    if (!blueprint) throw new HttpError(404, "Simulado indisponível", "O blueprint não está publicado.");

    let rules: SimulationBlueprintRulesV1;
    try {
      rules = compileSimulationBlueprintRules(blueprint.rules);
    } catch {
      throw new HttpError(409, "Simulado indisponível", "As regras publicadas não são compatíveis com o motor atual.");
    }
    const quotas = await tx.select().from(blueprintSubjectsTable)
      .where(eq(blueprintSubjectsTable.blueprintVersionId, blueprint.id));
    if (quotas.length !== rules.subjects.length || rules.subjects.some((rule) => {
      const quota = quotas.find((candidate) => candidate.subjectId === rule.subjectId);
      return !quota || quota.questionCount !== rule.questionCount;
    })) {
      throw new HttpError(409, "Simulado indisponível", "As quotas editoriais divergem das regras publicadas.");
    }

    await enforceCreateEntitlement(tx, userId, blueprint.productId, serverNow);

    const candidates = await tx.select({
      id: questionVersionsTable.id,
      subjectId: questionVersionsTable.subjectId,
      contentHash: questionVersionsTable.contentHash,
      origin: questionItemsTable.origin,
      authorId: questionItemsTable.authorId,
      sourceTransformation: questionItemsTable.sourceTransformation,
      presentationKind: questionVersionsTable.presentationKind,
      sourceId: questionItemsTable.sourceId,
      sourceOwner: sourcesTable.owner,
      sourceContentHash: sourcesTable.contentHash,
      licenseId: questionItemsTable.licenseId,
      licenseSourceId: licensesTable.sourceId,
      licenseType: licensesTable.licenseType,
      licensePermissions: licensesTable.permissions,
      licenseStatus: licensesTable.status,
      licenseTerritory: licensesTable.territory,
      licensePlatforms: licensesTable.platforms,
      licenseStartsAt: licensesTable.startsAt,
      licenseExpiresAt: licensesTable.expiresAt,
      licenseEvidenceHash: licensesTable.evidenceHash,
      licenseApprovedBy: licensesTable.approvedBy,
    }).from(questionVersionsTable)
      .innerJoin(questionItemsTable, eq(questionVersionsTable.questionItemId, questionItemsTable.id))
      .leftJoin(sourcesTable, eq(questionItemsTable.sourceId, sourcesTable.id))
      .innerJoin(publicationsTable, and(
        eq(publicationsTable.questionVersionId, questionVersionsTable.id),
        eq(publicationsTable.blueprintVersionId, blueprint.id),
      ))
      .leftJoin(licensesTable, eq(questionItemsTable.licenseId, licensesTable.id))
      .where(and(
        eq(questionVersionsTable.examVersionId, blueprint.examVersionId),
        eq(questionVersionsTable.status, "published"),
        eq(publicationsTable.status, "published"),
        isNull(publicationsTable.suspendedAt),
      ));

    const reviewRows = candidates.length === 0 ? [] : await tx.select({
      id: reviewDecisionsTable.id,
      questionVersionId: reviewDecisionsTable.questionVersionId,
      stage: reviewDecisionsTable.stage,
      reviewerId: reviewDecisionsTable.reviewerId,
      decision: reviewDecisionsTable.decision,
      contentHash: reviewDecisionsTable.contentHash,
      decidedAt: reviewDecisionsTable.decidedAt,
    }).from(reviewDecisionsTable)
      .where(inArray(reviewDecisionsTable.questionVersionId, candidates.map((candidate) => candidate.id)))
      .orderBy(desc(reviewDecisionsTable.decidedAt), desc(reviewDecisionsTable.id));
    const reviewsByQuestion = new Map<string, typeof reviewRows>();
    for (const review of reviewRows) {
      const existing = reviewsByQuestion.get(review.questionVersionId) ?? [];
      existing.push(review);
      reviewsByQuestion.set(review.questionVersionId, existing);
    }
    const requiredThrough = new Date(serverNow.getTime() + rules.durationMinutes * 60_000);
    const rightsCleared = candidates.filter((candidate) => hasEligibleSimulationQuestionRights(
      candidate,
      serverNow,
      requiredThrough,
    ) && hasEligibleSimulationQuestionReviews(
      candidate.contentHash,
      candidate.authorId ?? "",
      reviewsByQuestion.get(candidate.id) ?? [],
    ));
    const optionRows = rightsCleared.length === 0 ? [] : await tx.select({
      questionVersionId: questionOptionsTable.questionVersionId,
      id: questionOptionsTable.id,
      isCorrect: questionOptionsTable.isCorrect,
      orderIndex: questionOptionsTable.orderIndex,
    }).from(questionOptionsTable)
      .where(inArray(questionOptionsTable.questionVersionId, rightsCleared.map((candidate) => candidate.id)))
      .orderBy(questionOptionsTable.questionVersionId, questionOptionsTable.orderIndex);
    const optionsByQuestion = new Map<string, typeof optionRows>();
    for (const option of optionRows) {
      const existing = optionsByQuestion.get(option.questionVersionId) ?? [];
      existing.push(option);
      optionsByQuestion.set(option.questionVersionId, existing);
    }
    const valid = rightsCleared.filter((candidate) => {
      const options = optionsByQuestion.get(candidate.id) ?? [];
      return options.length >= 2 && options.length <= 100 && options.filter((option) => option.isCorrect).length === 1;
    });

    const sessionId = randomUUID();
    const selected = rules.subjects.flatMap((rule) => {
      const subjectCandidates = valid
        .filter((candidate) => candidate.subjectId === rule.subjectId)
        .sort((left, right) => deterministicOrder(sessionId, left.id).localeCompare(deterministicOrder(sessionId, right.id)));
      if (subjectCandidates.length < rule.questionCount) {
        throw new HttpError(
          409,
          "Simulado indisponível",
          `A matéria ${rule.subjectId} não possui questões publicadas e licenciadas suficientes para a quota.`,
          "https://api.iaaprova.com.br/problems/simulation-content-unavailable",
        );
      }
      return subjectCandidates.slice(0, rule.questionCount);
    });
    const snapshot = createSimulationSnapshot({
      sessionId,
      blueprintVersionId: blueprint.id,
      rules,
      startedAtMs: serverNow.getTime(),
      questions: selected.map((question) => {
        const options = optionsByQuestion.get(question.id) ?? [];
        const correct = options.find((option) => option.isCorrect);
        if (!correct) throw new HttpError(409, "Simulado indisponível", "Uma questão selecionada não possui gabarito válido.");
        return {
          questionVersionId: question.id,
          subjectId: question.subjectId,
          optionIds: options.map((option) => option.id),
          correctOptionId: correct.id,
        };
      }),
    });
    const state = createSimulationState(snapshot);
    await tx.insert(simulationSessionsTable).values({
      id: sessionId,
      userId,
      productId: blueprint.productId,
      examVersionId: blueprint.examVersionId,
      blueprintVersionId: blueprint.id,
      createIdempotencyKey: idempotencyKey,
      status: "active",
      rules: rules as unknown as Record<string, unknown>,
      snapshot: snapshot as unknown as Record<string, unknown>,
      snapshotHash: snapshot.snapshotHash,
      state: state as unknown as Record<string, unknown>,
      startedAt: serverNow,
      deadlineAt: new Date(snapshot.deadlineAtMs),
    });
    await tx.insert(simulationQuestionsTable).values(snapshot.questions.map((question) => ({
      simulationId: sessionId,
      position: question.position,
      questionVersionId: question.questionVersionId,
      subjectId: question.subjectId,
      optionIds: [...question.optionIds],
      correctOptionId: question.correctOptionId,
    })));
    await tx.insert(outboxEventsTable).values({
      aggregateType: "simulation",
      aggregateId: sessionId,
      eventType: "simulation.deadline_reached.v1",
      payload: { simulationId: sessionId, deadlineAt: new Date(snapshot.deadlineAtMs).toISOString() },
      availableAt: new Date(snapshot.deadlineAtMs),
    });
    return sessionId;
  });
  return getProductSimulation(userId, createdId);
}

export async function getProductSimulation(userId: string, simulationId: string): Promise<PublicSimulationSession> {
  const loaded = await db.transaction(async (tx) => {
    const locked = await lockOwnedSession(tx, userId, simulationId);
    const serverNow = await databaseClock(tx);
    return { row: await finalizeIfDue(tx, locked, serverNow), serverNow };
  });
  return toPublicSession(loaded.row, loaded.serverNow);
}

export async function getActiveProductSimulation(userId: string): Promise<PublicSimulationSession | null> {
  const [candidate] = await db.select({ id: simulationSessionsTable.id }).from(simulationSessionsTable)
    .where(eq(simulationSessionsTable.userId, userId))
    .orderBy(desc(simulationSessionsTable.startedAt)).limit(1);
  return candidate ? getProductSimulation(userId, candidate.id) : null;
}

export async function answerProductSimulation(
  userId: string,
  simulationId: string,
  input: { questionVersionId: string; selectedOptionId: string },
  idempotencyKey: string,
) {
  return db.transaction(async (tx) => {
    const stored = await lockOwnedSession(tx, userId, simulationId);
    // Sample only after ownership and row serialization. Otherwise a request
    // queued behind another answer could submit using a pre-deadline timestamp.
    const serverNow = await databaseClock(tx);
    const row = await finalizeIfDue(tx, stored, serverNow);
    const { snapshot, state } = assertStoredSession(row);
    let submission: ReturnType<typeof submitSimulationAnswer>;
    try {
      submission = submitSimulationAnswer(snapshot, state, {
        idempotencyKey,
        questionVersionId: input.questionVersionId,
        selectedOptionId: input.selectedOptionId,
        receivedAtMs: serverNow.getTime(),
      });
    } catch (error) {
      engineHttpError(error);
    }
    if (submission.outcome === "accepted") {
      const accepted = submission.state.answers.at(-1);
      if (!accepted) throw new HttpError(409, "Simulado inconsistente", "A resposta aceita não foi persistida.");
      await tx.insert(simulationAnswersTable).values({
        simulationId,
        questionVersionId: accepted.questionVersionId,
        selectedOptionId: accepted.selectedOptionId,
        idempotencyKey: accepted.idempotencyKey,
        receivedAt: new Date(accepted.receivedAtMs),
      });
    }
    if (submission.state.status === "finalized" && row.status !== "finalized") {
      await persistFinalized(tx, row, snapshot, submission.state);
    } else if (submission.outcome === "accepted") {
      await tx.update(simulationSessionsTable).set({
        state: submission.state as unknown as Record<string, unknown>,
        updatedAt: serverNow,
      }).where(and(eq(simulationSessionsTable.id, simulationId), eq(simulationSessionsTable.userId, userId)));
    }
    return {
      outcome: submission.outcome,
      status: submission.state.status,
      serverNow: serverNow.toISOString(),
      answeredQuestionVersionIds: submission.state.answers.map((answer) => answer.questionVersionId),
      resultAvailable: submission.state.status === "finalized",
    };
  });
}

export async function getProductSimulationResult(userId: string, simulationId: string) {
  const row = await db.transaction(async (tx) => {
    const locked = await lockOwnedSession(tx, userId, simulationId);
    const serverNow = await databaseClock(tx);
    return finalizeIfDue(tx, locked, serverNow);
  });
  if (row.status !== "finalized" || !row.result || !row.resultHash) {
    throw new HttpError(409, "Resultado ainda indisponível", "Responda todas as questões ou aguarde o prazo absoluto do simulado.");
  }
  const { snapshot, state } = assertStoredSession(row);
  let computed: SimulationResult;
  try {
    computed = computeSimulationResult(snapshot, state);
  } catch (error) {
    engineHttpError(error);
  }
  const stored = asResult(row.result);
  if (computed.resultHash !== row.resultHash
      || stored.resultHash !== row.resultHash
      || canonicalJson(stored) !== canonicalJson(computed)) {
    throw new HttpError(409, "Resultado inconsistente", "O resultado persistido não pôde ser reproduzido.");
  }

  const questionRows = await db.select({
    position: simulationQuestionsTable.position,
    questionVersionId: questionVersionsTable.id,
    statement: questionVersionsTable.statement,
    solution: questionVersionsTable.solution,
    subjectId: subjectsTable.id,
    subjectName: subjectsTable.name,
  }).from(simulationQuestionsTable)
    .innerJoin(questionVersionsTable, eq(simulationQuestionsTable.questionVersionId, questionVersionsTable.id))
    .innerJoin(subjectsTable, eq(simulationQuestionsTable.subjectId, subjectsTable.id))
    .where(eq(simulationQuestionsTable.simulationId, simulationId))
    .orderBy(simulationQuestionsTable.position);
  const optionRows = await db.select({
    questionVersionId: questionOptionsTable.questionVersionId,
    id: questionOptionsTable.id,
    key: questionOptionsTable.key,
    body: questionOptionsTable.body,
    rationale: questionOptionsTable.rationale,
    orderIndex: questionOptionsTable.orderIndex,
  }).from(questionOptionsTable)
    .where(inArray(questionOptionsTable.questionVersionId, questionRows.map((question) => question.questionVersionId)))
    .orderBy(questionOptionsTable.questionVersionId, questionOptionsTable.orderIndex);
  const optionsByQuestion = new Map<string, typeof optionRows>();
  for (const option of optionRows) {
    const existing = optionsByQuestion.get(option.questionVersionId) ?? [];
    existing.push(option);
    optionsByQuestion.set(option.questionVersionId, existing);
  }
  const answerByQuestion = new Map(state.answers.map((answer) => [answer.questionVersionId, answer.selectedOptionId]));
  const snapshotByQuestion = new Map(snapshot.questions.map((question) => [question.questionVersionId, question]));
  const subjectNames = new Map(questionRows.map((question) => [question.subjectId, question.subjectName]));
  return {
    simulationId,
    resultHash: computed.resultHash,
    finalizedAt: new Date(computed.finalizedAtMs).toISOString(),
    finishReason: computed.finishReason,
    score: computed.score,
    maxScore: computed.maxScore,
    correctCount: computed.correctCount,
    incorrectCount: computed.incorrectCount,
    unansweredCount: computed.unansweredCount,
    subjects: computed.subjects.map((subject) => ({
      ...subject,
      subjectName: subjectNames.get(subject.subjectId) ?? subject.subjectId,
    })),
    questions: questionRows.map((question) => {
      const selectedOptionId = answerByQuestion.get(question.questionVersionId) ?? null;
      const correctOptionId = snapshotByQuestion.get(question.questionVersionId)?.correctOptionId;
      if (!correctOptionId) throw new HttpError(409, "Resultado inconsistente", "O gabarito imutável não foi encontrado.");
      return {
        position: question.position,
        questionVersionId: question.questionVersionId,
        statement: question.statement,
        subject: { id: question.subjectId, name: question.subjectName },
        selectedOptionId,
        correctOptionId,
        isCorrect: selectedOptionId === null ? null : selectedOptionId === correctOptionId,
        solution: question.solution,
        options: (optionsByQuestion.get(question.questionVersionId) ?? [])
          .map(({ id, key, body, rationale }) => ({ id, key, body, rationale })),
      };
    }),
  };
}
