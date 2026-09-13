import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  notFoundHandler,
  problemDetailsHandler,
  requestContext,
  securityHeaders,
} from "./lib/http";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { isRevenueCatWebhookRequestTarget } from "./services/revenuecat";
import { createRateLimiter } from "./middlewares/rateLimit";

const app: Express = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext());
app.use(securityHeaders());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:19006,http://localhost:8081"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  allowedHeaders: ["authorization", "content-type", "idempotency-key", "range", "x-request-id"],
  exposedHeaders: ["accept-ranges", "content-disposition", "content-range", "x-content-sha256", "x-request-id"],
}));
// Apply the bounded request budget before body parsing so rejected bursts do
// not spend JSON parsing memory or CPU.
app.use("/api/v1", createRateLimiter({ windowMs: 60_000, max: 120 }));
app.use(express.json({
  limit: "256kb",
  strict: true,
  verify(req, _res, buffer) {
    if (isRevenueCatWebhookRequestTarget(req.url)) {
      const rawBodyRequest = req as typeof req & { rawBody?: Buffer };
      rawBodyRequest.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// Health endpoints are intentionally public so the load balancer can probe
// liveness/readiness even while Clerk is unavailable. All v1 application
// routes, including webhooks that need provider authentication, remain behind
// Clerk request authentication.
app.use(
  "/api/v1",
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
app.use(notFoundHandler);
app.use(problemDetailsHandler);

export default app;
