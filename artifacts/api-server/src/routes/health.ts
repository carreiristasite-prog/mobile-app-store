import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { readinessHttpResult, type ReadinessService } from "../services/readiness";

export function createHealthRouter(readiness: ReadinessService): IRouter {
  const router: IRouter = Router();

  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.set("Cache-Control", "no-store").json(data);
  });

  router.get("/readyz", async (_req, res) => {
    const result = readinessHttpResult(await readiness.check());
    const data = ReadinessCheckResponse.parse(result.body);
    res.status(result.statusCode).set("Cache-Control", "no-store").json(data);
  });

  return router;
}
