import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenDependencyComponents,
  parseDrizzleTables,
  parseMigrationTables,
  parseLockfileComponents,
  parseOpenApiEndpoints,
} from "../privacy_inventory.mjs";

test("extracts only OpenAPI operations under paths", () => {
  const source = `paths:\n  /healthz:\n    get:\n      responses: {}\n  /billing/restore:\n    post:\n      responses: {}\ncomponents:\n  /not-a-path:\n    get:\n`;
  assert.deepEqual(parseOpenApiEndpoints(source), [
    { method: "POST", path: "/billing/restore" },
    { method: "GET", path: "/healthz" },
  ]);
});

test("extracts Drizzle table names across line breaks", () => {
  assert.deepEqual(parseDrizzleTables(`pgTable("users", {});\npgTable(\n  'attempts',\n  {}\n);`), ["attempts", "users"]);
});

test("extracts migration tables with optional guards and public schema", () => {
  assert.deepEqual(parseMigrationTables(`CREATE TABLE users ();\nCREATE TABLE IF NOT EXISTS public."attempts" ();`), ["attempts", "users"]);
});

test("deduplicates dependency components and omits local paths", () => {
  const components = flattenDependencyComponents([
    {
      name: "app",
      version: "1.0.0",
      dependencies: {
        zod: { version: "3.25.76", path: "C:/secret/workspace/node_modules/zod" },
        "@workspace/core": { version: "link:../../lib/core", dependencies: { zod: { version: "3.25.76" } } },
      },
    },
  ]);
  assert.equal(components.filter((component) => component.name === "zod").length, 1);
  assert.equal(JSON.stringify(components).includes("C:/secret"), false);
  assert.equal(components.some((component) => component.purl === "pkg:npm/zod@3.25.76"), true);
});

test("creates components and hashes from the pnpm packages section only", () => {
  const components = parseLockfileComponents(`lockfileVersion: '9.0'\npackages:\n\n  '@scope/pkg@1.2.3':\n    resolution: {integrity: sha512-YWJj}\n\n  zod@3.25.76:\n    resolution: {integrity: sha256-YWJj}\n\nsnapshots:\n  zod@3.25.76: {}\n`);
  assert.deepEqual(components.map(({ name, version }) => ({ name, version })), [
    { name: "@scope/pkg", version: "1.2.3" },
    { name: "zod", version: "3.25.76" },
  ]);
  assert.equal(components.every((component) => component.hashes?.[0].content === "616263"), true);
});
