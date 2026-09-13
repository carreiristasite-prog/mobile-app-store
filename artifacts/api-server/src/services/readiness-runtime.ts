import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createPostgresReadinessCheck,
  createReadinessService,
  readReadinessTimeoutMs,
} from "./readiness";

const timeoutMs = readReadinessTimeoutMs();

export const apiReadiness = createReadinessService({
  timeoutMs,
  checkDatabase: async (signal) => {
    try {
      await createPostgresReadinessCheck(pool)(signal);
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      logger.error(
        { code: failure.code, message: failure.message },
        "Database readiness check failed",
      );
      throw error;
    }
  },
});
