# PostgreSQL integration harness

This harness is deliberately opt-in and fail-closed. It never falls back to
`DATABASE_URL`, never invents a default connection and does not execute when
`TEST_DATABASE_URL` is absent.

## Safety boundary

The guard accepts only PostgreSQL URLs where both boundaries are explicit:

- database name: `ia_aprova_test_*`, `ia_aprova_ci_*` (underscore/hyphen
  variants are accepted);
- host: loopback, the `postgres` CI service, or an isolated hostname containing
  a `test`, `testing` or `ci` label.

Production/live/main markers, generic databases (`postgres`, `test`), remote
hosts without a test label and connection parameters capable of changing the
database/search path are rejected. Query parameters are fail-closed: only one
`sslmode=require`, `verify-ca` or `verify-full` is accepted. Errors never echo
credentials.

The integration suite creates a random `ia_aprova_it_*` schema inside the
guarded test database, points every tested connection at that schema, and only
drops that exact schema during cleanup. The migration runner independently
checks both `current_database()` and `current_schema()` and refuses `public` or
any schema outside `ia_aprova_it_*`. The GitHub Actions service itself is
ephemeral and contains no real secret or production data.

## Commands

These tests require no database and should run on every workstation:

```sh
pnpm test:postgres:guard
```

The real suite is intentionally skipped without an approved URL:

```sh
TEST_DATABASE_URL=postgresql://iaaprova_test:local@localhost:5432/ia_aprova_test \
  pnpm test:postgres:integration
```

The separate `postgres-integration.yml` workflow runs PostgreSQL 16 and Node
22, applies every SQL migration in order, reruns the migration set to prove
runner idempotency, verifies checksums, and exercises real transactions for:

- identity idempotency and conflicting payloads;
- single-use guardian invitation acceptance under concurrency;
- attempt uniqueness and immutable grading snapshots;
- referenced question-version/option immutability while allowing editorial
  status transitions and account-deletion semantics;
- `FOR UPDATE SKIP LOCKED`, leases and attempt-number fencing in the worker;
- monotonic entitlement reconciliation by occurrence time and event id.

The tests use PostgreSQL and the production worker repository, not ORM mocks.
They intentionally stop at the SQL/service boundary: authenticated route E2E
still needs a controlled Clerk test tenant or a verified-token test adapter and
belongs in a separate E2E gate.

Checksums are recorded in the same transaction as each newly applied migration
and are validated before any later migration runs. A pre-existing test schema
whose migration history predates this harness has no trustworthy baseline and
is rejected; recreate that disposable test schema/database instead of adopting
unknown checksums.

No local PostgreSQL execution was performed when this harness was introduced;
the database-dependent result must come from the isolated CI job (or an
explicitly configured local test database).
