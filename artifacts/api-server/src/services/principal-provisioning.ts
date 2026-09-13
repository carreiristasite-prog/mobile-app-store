export type VerifiedClerkProfile = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export type InternalPrincipalRecord = {
  userId: string;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
};

export type PrincipalProvisioningStore = {
  findByVerifiedSubject(subject: string): Promise<InternalPrincipalRecord | null>;
  createOrGetByVerifiedSubject(subject: string, profile: VerifiedClerkProfile): Promise<InternalPrincipalRecord>;
};

/**
 * Orquestra o primeiro acesso sem jamais receber identidade do payload HTTP.
 * A garantia contra duplicação fica no createOrGet transacional do store.
 */
export async function resolveOrProvisionClerkPrincipal(
  verifiedSubject: string,
  loadVerifiedProfile: (subject: string) => Promise<VerifiedClerkProfile>,
  store: PrincipalProvisioningStore,
): Promise<InternalPrincipalRecord> {
  const existing = await store.findByVerifiedSubject(verifiedSubject);
  if (existing) return existing;
  const profile = await loadVerifiedProfile(verifiedSubject);
  return store.createOrGetByVerifiedSubject(verifiedSubject, profile);
}
