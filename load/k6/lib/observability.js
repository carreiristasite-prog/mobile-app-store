import { Rate } from "k6/metrics";

export const functionalErrors = new Rate("functional_errors");

export function tags(runtime, operation, name) {
  return {
    tags: {
      test_run_id: runtime.runId,
      profile: runtime.profile,
      target: runtime.target,
      operation,
      name,
    },
  };
}

export function recordFunctionalResult(ok, runtime, operation) {
  functionalErrors.add(ok ? 0 : 1, {
    test_run_id: runtime.runId,
    profile: runtime.profile,
    target: runtime.target,
    operation,
  });
  return ok;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function safeSummary(data, runtime) {
  const duration = data.metrics.http_req_duration?.values || {};
  const failed = data.metrics.http_req_failed?.values || {};
  const functional = data.metrics.functional_errors?.values || {};
  const iterations = data.metrics.iterations?.values || {};
  const dropped = data.metrics.dropped_iterations?.values || {};
  const requiredThresholdMetrics = ["http_req_duration", "http_req_failed", "functional_errors", "dropped_iterations"];
  const thresholdsPassed = requiredThresholdMetrics.every((name) => {
    const thresholds = data.metrics[name]?.thresholds;
    return thresholds && Object.keys(thresholds).length > 0 && Object.values(thresholds).every((threshold) => threshold.ok === true);
  });
  const httpRequests = finite(data.metrics.http_reqs?.values?.count);
  const iterationCount = finite(iterations.count);
  const droppedCount = finite(dropped.count);
  const errorRate = finite(failed.rate);
  const functionalErrorRate = finite(functional.rate);
  const durationP95Ms = finite(duration["p(95)"]);
  const durationP99Ms = finite(duration["p(99)"]);
  const completionPassed = iterationCount === runtime.expectedIterations && httpRequests === runtime.expectedHttpRequests &&
    (runtime.arrivalRateProfile ? droppedCount === 0 : (droppedCount === 0 || droppedCount === null));
  const requiredMetricsPresent = [httpRequests, iterationCount, errorRate, functionalErrorRate, durationP95Ms, durationP99Ms]
    .every((value) => value !== null);
  const evidencePassed = thresholdsPassed && completionPassed && requiredMetricsPresent;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    testRunId: runtime.runId,
    profile: runtime.profile,
    target: runtime.target,
    thresholdsPassed,
    completionPassed,
    requiredMetricsPresent,
    evidencePassed,
    expected: {
      iterations: runtime.expectedIterations,
      httpRequests: runtime.expectedHttpRequests,
    },
    metrics: {
      httpRequests,
      iterations: iterationCount,
      droppedIterations: droppedCount,
      errorRate,
      functionalErrorRate,
      durationP95Ms,
      durationP99Ms,
    },
  };
}
