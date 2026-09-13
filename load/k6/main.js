import http from "k6/http";
import { check } from "k6";
import execution from "k6/execution";
import { buildRuntime } from "./lib/guardrails.js";
import { recordFunctionalResult, safeSummary, tags } from "./lib/observability.js";

const profiles = JSON.parse(open("../profiles.json"));
const runtime = buildRuntime(profiles);
const selectedProfile = { ...profiles[runtime.profile], exec: "runSelectedTarget" };

export const options = {
  scenarios: { selected: selectedProfile },
  thresholds: {
    http_req_duration: ["p(95)<=300", "p(99)<=800"],
    http_req_failed: ["rate<0.005"],
    functional_errors: ["rate<0.005"],
    dropped_iterations: ["count==0"],
  },
  systemTags: ["status", "method", "name", "scenario", "expected_response"],
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  tags: { suite: "iaaprova-staging-load" },
};

function safeJson(response) {
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
}

function syntheticUser() {
  const index = runtime.profile === "sessions_5000"
    ? execution.vu.idInTest - 1
    : execution.scenario.iterationInTest % runtime.dataset.users.length;
  return runtime.dataset.users[index];
}

function authHeaders(user, extra = {}) {
  return { Authorization: `Bearer ${user.accessToken}`, "Content-Type": "application/json", ...extra };
}

function getHealth() {
  const operation = "health";
  const response = http.get(`${runtime.baseUrl}/api/healthz`, tags(runtime, operation, "/api/healthz"));
  const body = safeJson(response);
  const ok = check(response, { "health returns 200 and ok": () => response.status === 200 && body?.status === "ok" });
  recordFunctionalResult(ok, runtime, operation);
}

function getCatalog() {
  const operation = "catalog.active";
  const response = http.get(`${runtime.baseUrl}/api/v1/catalog/active`, tags(runtime, operation, "/api/v1/catalog/active"));
  const body = safeJson(response);
  const ok = check(response, { "catalog returns a product array": () => response.status === 200 && Array.isArray(body?.products) });
  recordFunctionalResult(ok, runtime, operation);
}

function getAuthenticatedRead() {
  const operation = "auth.read";
  const user = syntheticUser();
  const params = tags(runtime, operation, runtime.authReadPath);
  params.headers = authHeaders(user);
  const response = http.get(`${runtime.baseUrl}${runtime.authReadPath}`, params);
  const body = safeJson(response);
  const ok = check(response, { "authenticated read returns JSON 200": () => response.status === 200 && body !== null && typeof body === "object" });
  recordFunctionalResult(ok, runtime, operation);
}

function learningIdempotencyFlow() {
  const user = syntheticUser();
  const createOperation = "learning.session.create";
  const createBody = { productId: user.productId, mode: user.mode || "practice" };
  if (user.examVersionId) createBody.examVersionId = user.examVersionId;
  const createParams = tags(runtime, createOperation, "/api/v1/learning/sessions");
  createParams.headers = authHeaders(user);
  const created = http.post(`${runtime.baseUrl}/api/v1/learning/sessions`, JSON.stringify(createBody), createParams);
  const createdBody = safeJson(created);
  const question = createdBody?.nextQuestion;
  const createOk = check(created, {
    "learning session is seeded and exposes a question": () =>
      created.status === 201 && typeof createdBody?.sessionId === "string" && Array.isArray(question?.options) && question.options.length >= 2,
  });
  recordFunctionalResult(createOk, runtime, createOperation);
  if (!createOk) return;

  const optionIndex = execution.scenario.iterationInTest % question.options.length;
  const attemptBody = JSON.stringify({
    exposureId: question.exposureId,
    selectedOptionId: question.options[optionIndex].id,
    elapsedMs: 1500,
  });
  const idempotencyKey = `load-${runtime.runId}-${execution.vu.idInTest}-${execution.scenario.iterationInTest}`.slice(0, 128);
  const attemptPath = `/api/v1/learning/sessions/${createdBody.sessionId}/attempts`;
  const attemptName = "/api/v1/learning/sessions/:sessionId/attempts";
  const firstParams = tags(runtime, "learning.attempt.create", attemptName);
  firstParams.headers = authHeaders(user, { "Idempotency-Key": idempotencyKey });
  const first = http.post(`${runtime.baseUrl}${attemptPath}`, attemptBody, firstParams);
  const firstBody = safeJson(first);
  const firstOk = check(first, { "first attempt is created": () => first.status === 201 && typeof firstBody?.attemptId === "string" });
  recordFunctionalResult(firstOk, runtime, "learning.attempt.create");
  if (!firstOk) return;

  const replayParams = tags(runtime, "learning.attempt.replay", attemptName);
  replayParams.headers = authHeaders(user, { "Idempotency-Key": idempotencyKey });
  const replay = http.post(`${runtime.baseUrl}${attemptPath}`, attemptBody, replayParams);
  const replayBody = safeJson(replay);
  const replayOk = check(replay, {
    "idempotent replay is JSON-stable": () => replay.status === 200 && JSON.stringify(replayBody) === JSON.stringify(firstBody),
  });
  recordFunctionalResult(replayOk, runtime, "learning.attempt.replay");
}

export function runSelectedTarget() {
  if (runtime.target === "health") return getHealth();
  if (runtime.target === "catalog") return getCatalog();
  if (runtime.target === "auth_read") return getAuthenticatedRead();
  return learningIdempotencyFlow();
}

export function handleSummary(data) {
  const summaryPath = (__ENV.SUMMARY_PATH || "load/results/summary.json").trim();
  if (!/^load[\\/]results[\\/][a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}\.json$/.test(summaryPath)) {
    throw new Error("SUMMARY_PATH must be a JSON file directly inside load/results.");
  }
  return { [summaryPath]: `${JSON.stringify(safeSummary(data, runtime), null, 2)}\n` };
}
