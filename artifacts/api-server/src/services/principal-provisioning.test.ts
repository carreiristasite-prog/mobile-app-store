import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOrProvisionClerkPrincipal,
  type InternalPrincipalRecord,
  type PrincipalProvisioningStore,
} from "./principal-provisioning.ts";

test("concurrent first requests converge on one internal UUID", async () => {
  let current: InternalPrincipalRecord | null = null;
  let writes = 0;
  let lock = Promise.resolve();
  const store: PrincipalProvisioningStore = {
    async findByVerifiedSubject() {
      return current;
    },
    async createOrGetByVerifiedSubject() {
      let release!: () => void;
      const previous = lock;
      lock = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        if (!current) {
          writes += 1;
          current = { userId: "3d813cbb-9b9c-40b6-932f-e66d5b64bdd5", deletionRequestedAt: null, deletedAt: null };
        }
        return current;
      } finally {
        release();
      }
    },
  };
  const load = async (subject: string) => ({ email: `${subject}@example.test`, displayName: "Aluno", avatarUrl: null });
  const [first, second] = await Promise.all([
    resolveOrProvisionClerkPrincipal("clerk-subject", load, store),
    resolveOrProvisionClerkPrincipal("clerk-subject", load, store),
  ]);
  assert.equal(first.userId, second.userId);
  assert.equal(writes, 1);
});

test("existing identity does not call the Clerk profile loader", async () => {
  let loads = 0;
  const record = { userId: "3d813cbb-9b9c-40b6-932f-e66d5b64bdd5", deletionRequestedAt: null, deletedAt: null };
  const result = await resolveOrProvisionClerkPrincipal("verified-subject", async () => {
    loads += 1;
    throw new Error("must not load");
  }, {
    findByVerifiedSubject: async () => record,
    createOrGetByVerifiedSubject: async () => { throw new Error("must not create"); },
  });
  assert.equal(result.userId, record.userId);
  assert.equal(loads, 0);
});
