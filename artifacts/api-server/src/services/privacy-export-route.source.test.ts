import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("export route binds request ownership and rechecks revocation under the privacy lock", async () => {
  const source = await readFile(new URL("../routes/v1.ts", import.meta.url), "utf8");
  const route = source.split('router.get("/me/data-requests/:requestId/export"', 2)[1]
    ?.split('router.delete("/me"', 1)[0] ?? "";
  assert.match(route, /eq\(dataRequestsTable\.id, requestId\)/);
  assert.match(route, /eq\(dataRequestsTable\.userId, userId\)/);
  assert.match(route, /pg_advisory_xact_lock[\s\S]*privacy:\$\{userId\}/);
  assert.match(route, /userDeletionRequestedAt[\s\S]*Exportação revogada/);
  assert.match(route, /eventType: "accessed"/);
  assert.ok(route.indexOf('eventType: "accessed"') < route.indexOf("res.send(Buffer.from(download.bytes))"));
});

test("export route never accepts a bucket/key/URL from the client or returns the private object key", async () => {
  const source = await readFile(new URL("../routes/v1.ts", import.meta.url), "utf8");
  const route = source.split('router.get("/me/data-requests/:requestId/export"', 2)[1]
    ?.split('router.delete("/me"', 1)[0] ?? "";
  assert.doesNotMatch(route, /req\.(?:body|query).*?(?:bucket|objectKey|url)/s);
  assert.doesNotMatch(route, /res\.(?:json|send)\([^)]*objectKey/s);
  assert.doesNotMatch(route, /signedUrl|storage\.cloud\.google\.com|makePublic/);
});

test("CORS admits Range and exposes only the download response metadata needed by clients", async () => {
  const source = await readFile(new URL("../app.ts", import.meta.url), "utf8");
  assert.match(source, /allowedHeaders:\s*\[[^\]]*"range"/s);
  assert.match(source, /exposedHeaders:\s*\[[^\]]*"accept-ranges"[^\]]*"content-disposition"[^\]]*"content-range"[^\]]*"x-content-sha256"/s);
  assert.doesNotMatch(source, /exposedHeaders:\s*\[[^\]]*(?:authorization|objectKey|bucket)/s);
});
