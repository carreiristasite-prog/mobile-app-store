import { pool } from "@workspace/db";
import {
  createPostgresReadinessCheck,
  createReadinessService,
  readReadinessTimeoutMs,
} from "./readiness";

const timeoutMs = readReadinessTimeoutMs();

export const apiReadiness = createReadinessService({
  timeoutMs,
  checkDatabase: createPostgresReadinessCheck(pool),
});
