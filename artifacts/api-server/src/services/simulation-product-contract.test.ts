import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SimulationSessionResponseSchema,
  SubmitSimulationAnswerRequestSchema,
} from "../../../../lib/api-zod/src/contracts.ts";

const ID = {
  simulation: "10000000-0000-4000-8000-000000000001",
  blueprint: "10000000-0000-4000-8000-000000000002",
  exam: "10000000-0000-4000-8000-000000000003",
  question: "10000000-0000-4000-8000-000000000004",
  optionA: "10000000-0000-4000-8000-000000000005",
  optionB: "10000000-0000-4000-8000-000000000006",
} as const;

function session() {
  return {
    simulationId: ID.simulation,
    status: "active" as const,
    serverNow: "2026-08-23T12:00:00.000Z",
    startedAt: "2026-08-23T12:00:00.000Z",
    deadlineAt: "2026-08-23T13:00:00.000Z",
    blueprint: {
      id: ID.blueprint,
      productId: "eear",
      examVersionId: ID.exam,
      version: 1,
      rules: {
        schemaVersion: "simulation-blueprint-rules.v1" as const,
        questionCount: 1,
        durationMinutes: 60,
        scoring: {
          model: "weighted-sum.v1" as const,
          rounding: { decimalPlaces: 2, mode: "half-away-from-zero" as const },
          aggregateFloor: { policy: "none" as const },
        },
        subjects: [{
          subjectId: "matematica",
          questionCount: 1,
          correctPoints: "1",
          weight: "1",
          incorrect: { policy: "zero" as const },
          unanswered: { policy: "zero" as const },
        }],
      },
    },
    answeredQuestionVersionIds: [],
    answers: [],
    questions: [{
      position: 0,
      questionVersionId: ID.question,
      subject: { id: "matematica", name: "Matemática" },
      statement: "Quanto é dois mais dois?",
      difficulty: "easy" as const,
      options: [
        { id: ID.optionA, key: "A", body: "3" },
        { id: ID.optionB, key: "B", body: "4" },
      ],
    }],
    resultAvailable: false,
  };
}

test("active session allowlist never accepts grading material or snapshot hash", () => {
  assert.deepEqual(SimulationSessionResponseSchema.parse(session()), session());
  for (const injected of [
    { ...session(), snapshotHash: "a".repeat(64) },
    { ...session(), score: "999" },
    { ...session(), questions: [{ ...session().questions[0], correctOptionId: ID.optionB }] },
    { ...session(), questions: [{ ...session().questions[0], solution: "gabarito" }] },
  ]) {
    assert.equal(SimulationSessionResponseSchema.safeParse(injected).success, false);
  }
});

test("answer command accepts only question and selected option", () => {
  const valid = { questionVersionId: ID.question, selectedOptionId: ID.optionB };
  assert.deepEqual(SubmitSimulationAnswerRequestSchema.parse(valid), valid);
  assert.equal(SubmitSimulationAnswerRequestSchema.safeParse({ ...valid, isCorrect: true }).success, false);
  assert.equal(SubmitSimulationAnswerRequestSchema.safeParse({ ...valid, score: 100 }).success, false);
  assert.equal(SubmitSimulationAnswerRequestSchema.safeParse({ ...valid, receivedAt: Date.now() }).success, false);
});

test("integration source locks ownership, uses server time and never updates mastery", async () => {
  const source = await readFile(new URL("./simulation-product.ts", import.meta.url), "utf8");
  const create = source.split("export async function createProductSimulation", 2)[1]
    ?.split("export async function getProductSimulation", 1)[0] ?? "";
  const get = source.split("export async function getProductSimulation", 2)[1]
    ?.split("export async function getActiveProductSimulation", 1)[0] ?? "";
  const answer = source.split("export async function answerProductSimulation", 2)[1]
    ?.split("export async function getProductSimulationResult", 1)[0] ?? "";
  const result = source.split("export async function getProductSimulationResult", 2)[1] ?? "";
  assert.match(source, /clock_timestamp\(\) as "serverNow"/);
  assert.ok(create.indexOf("pg_advisory_xact_lock") < create.indexOf("databaseClock(tx)"));
  assert.ok(get.indexOf("lockOwnedSession(tx, userId, simulationId)") < get.indexOf("databaseClock(tx)"));
  assert.match(answer, /lockOwnedSession\(tx, userId, simulationId\)/);
  assert.ok(answer.indexOf("lockOwnedSession(tx, userId, simulationId)") < answer.indexOf("databaseClock(tx)"));
  assert.ok(result.indexOf("lockOwnedSession(tx, userId, simulationId)") < result.indexOf("databaseClock(tx)"));
  assert.match(answer, /receivedAtMs: serverNow\.getTime\(\)/);
  assert.match(answer, /simulationAnswersTable/);
  assert.doesNotMatch(`${create}\n${get}\n${answer}\n${result}`, /const serverNow = new Date\(\)/);
  assert.doesNotMatch(answer, /req\.|input\.(?:score|isCorrect|receivedAt|elapsed)/);
  assert.doesNotMatch(source, /topicMastery|reviewSchedule|validForCalibration|adaptive/);
});

test("route exposes grading material only through finalized result endpoint", async () => {
  const source = await readFile(new URL("../routes/v1.ts", import.meta.url), "utf8");
  const sessionRoute = source.split('router.get("/simulations/:simulationId"', 2)[1]
    ?.split('router.post("/simulations/:simulationId/answers"', 1)[0] ?? "";
  assert.doesNotMatch(sessionRoute, /correctOptionId|solution|score|snapshotHash/);
  assert.match(source, /router\.get\("\/simulations\/:simulationId\/result"/);
});
