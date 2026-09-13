import { clerkClient, getAuth } from "@clerk/express";
import { authIdentitiesTable, db, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { HttpError } from "../lib/http";
import {
  resolveOrProvisionClerkPrincipal,
  type PrincipalProvisioningStore,
  type VerifiedClerkProfile,
} from "../services/principal-provisioning";

export type Principal = {
  userId: string;
  provider: "clerk";
  providerSubject: string;
  providerSessionId: string | null;
};

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      principal: Principal;
    }
  }
}

async function findByVerifiedSubject(subject: string) {
  const selection = {
    userId: usersTable.id,
    deletionRequestedAt: usersTable.deletionRequestedAt,
    deletedAt: usersTable.deletedAt,
  };
  const [record] = await db.select(selection)
    .from(authIdentitiesTable)
    .innerJoin(usersTable, eq(authIdentitiesTable.userId, usersTable.id))
    .where(and(eq(authIdentitiesTable.provider, "clerk"), eq(authIdentitiesTable.subject, subject)))
    .limit(1);
  if (record) return record;

  // Compatibilidade expand/contract: encontra a identidade legada se a linha
  // de auth_identities ainda não tiver sido backfilled por uma implantação.
  const [legacy] = await db.select(selection)
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, subject))
    .limit(1);
  if (!legacy) return null;
  await db.insert(authIdentitiesTable).values({ userId: legacy.userId, provider: "clerk", subject })
    .onConflictDoNothing();
  return legacy;
}

const provisioningStore: PrincipalProvisioningStore = {
  findByVerifiedSubject,
  async createOrGetByVerifiedSubject(subject, profile) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity:clerk:${subject}`}, 0))`);
        const selection = {
          userId: usersTable.id,
          deletionRequestedAt: usersTable.deletionRequestedAt,
          deletedAt: usersTable.deletedAt,
        };
        const [mapped] = await tx.select(selection)
          .from(authIdentitiesTable)
          .innerJoin(usersTable, eq(authIdentitiesTable.userId, usersTable.id))
          .where(and(eq(authIdentitiesTable.provider, "clerk"), eq(authIdentitiesTable.subject, subject)))
          .limit(1);
        if (mapped) return mapped;

        const [legacy] = await tx.select(selection)
          .from(usersTable).where(eq(usersTable.clerkUserId, subject)).limit(1);
        if (legacy) {
          await tx.insert(authIdentitiesTable).values({ userId: legacy.userId, provider: "clerk", subject })
            .onConflictDoNothing();
          return legacy;
        }

        const [created] = await tx.insert(usersTable).values({
          clerkUserId: subject,
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        }).returning(selection);
        await tx.insert(authIdentitiesTable).values({ userId: created.userId, provider: "clerk", subject });
        return created;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
        throw new HttpError(409, "Identidade em conflito", "Já existe um perfil incompatível com os dados verificados desta identidade.");
      }
      throw error;
    }
  },
};

async function loadVerifiedClerkProfile(subject: string): Promise<VerifiedClerkProfile> {
  let externalUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    externalUser = await clerkClient.users.getUser(subject);
  } catch {
    throw new HttpError(503, "Identidade indisponível", "Não foi possível validar o perfil no provedor de identidade.");
  }
  const primary = externalUser.emailAddresses.find((address) =>
    address.id === externalUser.primaryEmailAddressId && address.verification?.status === "verified",
  ) ?? externalUser.emailAddresses.find((address) => address.verification?.status === "verified");
  if (!primary) {
    throw new HttpError(409, "E-mail não verificado", "Confirme um endereço de e-mail no provedor de identidade antes de continuar.");
  }
  const fullName = [externalUser.firstName, externalUser.lastName].filter(Boolean).join(" ").trim();
  return {
    email: primary.emailAddress.toLowerCase(),
    displayName: fullName || primary.emailAddress.split("@", 1)[0] || "Aluno",
    avatarUrl: externalUser.imageUrl || null,
  };
}

export const requirePrincipal: RequestHandler = async (req, res, next) => {
  try {
    let providerSubject: string | null = null;
    let providerSessionId: string | null = null;
    try {
      const auth = getAuth(req);
      providerSubject = auth.userId;
      providerSessionId = auth.sessionId;
    } catch {
      providerSubject = null;
      providerSessionId = null;
    }

    if (!providerSubject) {
      throw new HttpError(401, "Não autenticado", "É necessário entrar na conta para acessar este recurso.");
    }

    const user = await resolveOrProvisionClerkPrincipal(
      providerSubject,
      loadVerifiedClerkProfile,
      provisioningStore,
    );

    if (user.deletionRequestedAt || user.deletedAt) {
      throw new HttpError(
        409,
        "Perfil indisponível",
        "A identidade foi autenticada, mas o perfil interno não está ativo.",
        "https://api.iaaprova.com.br/problems/profile-unavailable",
      );
    }

    res.locals.principal = {
      userId: user.userId,
      provider: "clerk",
      providerSubject,
      providerSessionId,
    };
    next();
  } catch (error) {
    next(error);
  }
};
