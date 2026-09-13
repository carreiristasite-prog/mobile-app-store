import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly errors?: Record<string, string[]>;

  constructor(
    status: number,
    title: string,
    message: string,
    type = "about:blank",
    errors?: Record<string, string[]>,
  ) {
    super(message);
    this.status = status;
    this.title = title;
    this.type = type;
    this.errors = errors;
  }
}

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const supplied = req.header("x-request-id");
    const requestId = supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)
      ? supplied
      : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  };
}

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("cache-control", "no-store");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.header("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new HttpError(
      400,
      "Idempotency-Key inválida",
      "Envie o cabeçalho Idempotency-Key com 8 a 128 caracteres.",
      "https://api.iaaprova.com.br/problems/invalid-idempotency-key",
    );
  }
  return key;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Rota não encontrada", `Não existe rota para ${req.method} ${req.path}.`));
}

function zodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "request";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

export function problemDetailsHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = String(res.locals.requestId ?? randomUUID());
  const frameworkStatus = error && typeof error === "object" && "status" in error
    ? Number((error as { status: unknown }).status)
    : Number.NaN;
  const normalized = error instanceof ZodError
    ? new HttpError(400, "Requisição inválida", "Um ou mais campos são inválidos.", "https://api.iaaprova.com.br/problems/validation", zodErrors(error))
    : error instanceof HttpError
      ? error
      : Number.isInteger(frameworkStatus) && frameworkStatus >= 400 && frameworkStatus < 500
        ? new HttpError(frameworkStatus, frameworkStatus === 413 ? "Corpo muito grande" : "Requisição inválida", frameworkStatus === 413 ? "O corpo excede o limite permitido." : "O corpo da requisição não pôde ser interpretado.")
        : new HttpError(500, "Erro interno", "Não foi possível concluir a operação.");

  if (!(error instanceof HttpError) && !(error instanceof ZodError)) {
    req.log?.error({ err: error, requestId }, "Unhandled request error");
  }

  res.status(normalized.status).type("application/problem+json").json({
    type: normalized.type,
    title: normalized.title,
    status: normalized.status,
    detail: normalized.message,
    instance: req.originalUrl,
    requestId,
    ...(normalized.errors ? { errors: normalized.errors } : {}),
  });
}
