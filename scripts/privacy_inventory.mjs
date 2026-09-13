#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".tf"]);
const SOURCE_ROOTS = ["artifacts/api-server/src", "artifacts/worker/src", "artifacts/ia-aprova/app", "artifacts/ia-aprova/src", "lib", "infra"];
const HASH_INPUTS = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "lib/api-spec/openapi.yaml", "artifacts/ia-aprova/app.json", "lib/db/migrations"];
const IGNORED_DIRECTORIES = new Set([".git", ".expo", "coverage", "dist", "generated", "node_modules"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posix(path) {
  return path.split(sep).join("/");
}

function walkFiles(path) {
  if (!existsSync(path)) return [];
  const status = statSync(path);
  if (status.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry) => !entry.isDirectory() || !IGNORED_DIRECTORIES.has(entry.name))
    .flatMap((entry) => walkFiles(join(path, entry.name)));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const result = { outputDir: resolve(ROOT, "docs/compliance/generated"), buildArtifact: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") result.outputDir = resolve(argv[++index] ?? "");
    else if (argument === "--build-artifact") result.buildArtifact = resolve(argv[++index] ?? "");
    else if (argument === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (result.buildArtifact && !existsSync(result.buildArtifact)) {
    throw new Error(`Build artifact does not exist: ${result.buildArtifact}`);
  }
  return result;
}

export function parseOpenApiEndpoints(source) {
  const endpoints = [];
  let currentPath = null;
  let inPaths = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^paths:\s*$/u.test(line)) {
      inPaths = true;
      currentPath = null;
      continue;
    }
    if (inPaths && /^[a-zA-Z][^:]*:\s*$/u.test(line)) {
      inPaths = false;
      currentPath = null;
    }
    if (!inPaths) continue;
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/u);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^    ([a-z]+):\s*$/u);
    if (currentPath && methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      endpoints.push({ method: methodMatch[1].toUpperCase(), path: currentPath });
    }
  }
  return endpoints.sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`));
}

export function parseDrizzleTables(source) {
  return [...source.matchAll(/pgTable\(\s*["']([^"']+)["']/gu)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
}

export function parseMigrationTables(source) {
  return [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-zA-Z0-9_]+)["']?/giu)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
}

function packageManifests() {
  const childManifestPaths = (directory) => existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name, "package.json"))
      .filter(existsSync)
    : [];
  const paths = [
    resolve(ROOT, "package.json"),
    ...childManifestPaths(resolve(ROOT, "artifacts")),
    ...childManifestPaths(resolve(ROOT, "lib")),
    ...childManifestPaths(resolve(ROOT, "lib/integrations")),
    resolve(ROOT, "scripts/package.json"),
  ];
  return [...new Set(paths)]
    .map((path) => ({ path, manifest: readJson(path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function directRuntimePackages(manifests) {
  const map = new Map();
  for (const { path, manifest } of manifests) {
    for (const [name, declaredVersion] of Object.entries(manifest.dependencies ?? {})) {
      const record = map.get(name) ?? { name, declaredVersions: new Set(), consumers: new Set() };
      record.declaredVersions.add(String(declaredVersion));
      record.consumers.add(posix(relative(ROOT, path)));
      map.set(name, record);
    }
  }
  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      declaredVersions: [...entry.declaredVersions].sort(),
      consumers: [...entry.consumers].sort(),
      privacyReviewRequired: /clerk|purchases|firebase|sentry|analytics|segment|amplitude|expo-(?:notifications|location|camera|contacts)|one-signal/iu.test(entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function flattenDependencyComponents(workspaces) {
  const components = new Map();
  const visit = (name, node) => {
    if (!node || typeof node !== "object") return;
    const version = typeof node.version === "string" ? node.version : "unknown";
    const isWorkspace = version.startsWith("link:") || name.startsWith("@workspace/");
    const key = `${name}@${version}`;
    if (!components.has(key)) {
      components.set(key, {
        type: "library",
        name,
        version,
        ...(isWorkspace ? { group: "ia-aprova-workspace" } : { purl: `pkg:npm/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}@${encodeURIComponent(version)}` }),
      });
    }
    for (const collection of [node.dependencies, node.optionalDependencies]) {
      for (const [childName, child] of Object.entries(collection ?? {})) visit(childName, child);
    }
  };
  for (const workspace of workspaces) {
    visit(workspace.name ?? basename(workspace.path ?? "workspace"), { version: workspace.version ?? "0.0.0", dependencies: workspace.dependencies });
  }
  return [...components.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

export function parseLockfileComponents(source) {
  const components = [];
  const lines = source.split(/\r?\n/u);
  let inPackages = false;
  let current = null;
  const flush = () => {
    if (current) components.push(current);
    current = null;
  };
  for (const line of lines) {
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[a-zA-Z][^:]*:\s*$/u.test(line)) {
      flush();
      break;
    }
    if (!inPackages) continue;
    const keyMatch = line.match(/^  (?:'([^']+)'|([^'\s][^:]*)):\s*$/u);
    if (keyMatch) {
      flush();
      const key = keyMatch[1] ?? keyMatch[2];
      const separator = key.lastIndexOf("@");
      if (separator <= 0) continue;
      const name = key.slice(0, separator);
      const version = key.slice(separator + 1);
      current = {
        type: "library",
        name,
        version,
        purl: `pkg:npm/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}@${encodeURIComponent(version)}`,
      };
      continue;
    }
    const integrityMatch = line.match(/^    resolution: \{[^}]*integrity: (sha(?:256|384|512))-([^,}\s]+)[^}]*\}\s*$/iu);
    if (current && integrityMatch) {
      current.hashes = [{ alg: integrityMatch[1].toUpperCase().replace("SHA", "SHA-"), content: Buffer.from(integrityMatch[2], "base64").toString("hex") }];
    }
  }
  flush();
  return components.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function permissionsInventory(appConfig) {
  const expo = appConfig.expo ?? {};
  return {
    android: {
      requested: [...(expo.android?.permissions ?? [])].sort(),
      explicitlyBlocked: [...(expo.android?.blockedPermissions ?? [])].sort(),
      allowBackup: expo.android?.allowBackup ?? null,
    },
    ios: {
      entitlements: Object.keys(expo.ios?.entitlements ?? {}).sort(),
      infoPlistUsageDescriptions: Object.keys(expo.ios?.infoPlist ?? {}).filter((key) => /^NS.+UsageDescription$/u.test(key)).sort(),
      privacyAccessedApiTypes: (expo.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? []).map((entry) => entry.NSPrivacyAccessedAPIType).sort(),
    },
    expoPlugins: (expo.plugins ?? []).map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin).sort(),
  };
}

function sourceInventory() {
  const sourceFiles = SOURCE_ROOTS.flatMap((path) => walkFiles(resolve(ROOT, path)))
    .filter((path) => SOURCE_EXTENSIONS.has(extname(path)))
    .filter((path) => !/\.(?:test|spec)\.[^.]+$/u.test(path));
  const logging = [];
  const localStorage = new Set();
  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    const rel = posix(relative(ROOT, path));
    const calls = [...source.matchAll(/\b(logger\.(?:trace|debug|info|warn|error|fatal)|console\.(?:log|warn|error))\s*\(/gu)].map((match) => match[1]);
    if (calls.length) logging.push({ path: rel, calls: [...new Set(calls)].sort() });
    if (/expo-sqlite|SQLiteProvider|openDatabaseAsync/gu.test(source)) localStorage.add("mobile:expo-sqlite");
    if (/AsyncStorage/gu.test(source)) localStorage.add("mobile:async-storage");
    if (/expo-secure-store|SecureStore/gu.test(source)) localStorage.add("mobile:secure-store");
  }
  const terraform = walkFiles(resolve(ROOT, "infra")).filter((path) => extname(path) === ".tf").map((path) => readFileSync(path, "utf8")).join("\n");
  const terraformResources = [...terraform.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/gu)]
    .map((match) => ({ type: match[1], name: match[2] }))
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
  return {
    logging,
    queues: [
      { type: "postgres-transactional-outbox", status: "implemented", evidence: "outbox_events" },
      { type: "google-cloud-tasks", status: terraformResources.some((item) => item.type === "google_cloud_tasks_queue") ? "provisioned-not-integrated" : "not-provisioned" },
    ],
    caches: terraformResources.filter((item) => item.type === "google_redis_instance"),
    objectStorage: terraformResources.filter((item) => item.type === "google_storage_bucket"),
    localStorage: [...localStorage].sort(),
  };
}

function sourceSnapshotDigest() {
  const files = HASH_INPUTS.flatMap((path) => walkFiles(resolve(ROOT, path))).sort();
  const records = files.map((path) => `${posix(relative(ROOT, path))}\0${sha256(readFileSync(path))}`);
  return { sha256: sha256(records.join("\n")), files: files.length };
}

function databaseInventory() {
  const schemaFiles = walkFiles(resolve(ROOT, "lib/db/src/schema")).filter((path) => path.endsWith(".ts"));
  const migrationFiles = walkFiles(resolve(ROOT, "lib/db/migrations")).filter((path) => path.endsWith(".sql"));
  const schemaTables = [...new Set(schemaFiles.flatMap((path) => parseDrizzleTables(readFileSync(path, "utf8"))))].sort();
  const migrationTables = [...new Set(migrationFiles.flatMap((path) => parseMigrationTables(readFileSync(path, "utf8"))))].sort();
  return {
    drizzleTables: schemaTables,
    migrationTables,
    onlyInDrizzle: schemaTables.filter((name) => !migrationTables.includes(name)),
    onlyInMigrations: migrationTables.filter((name) => !schemaTables.includes(name)),
  };
}

function generatedAt() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/u.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return new Date().toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("Usage: node scripts/privacy_inventory.mjs [--output-dir DIR] [--build-artifact FILE]\n");
    return;
  }
  const appConfig = readJson(resolve(ROOT, "artifacts/ia-aprova/app.json"));
  const manifests = packageManifests();
  const sourceSnapshot = sourceSnapshotDigest();
  const timestamp = generatedAt();
  const buildArtifact = args.buildArtifact ? {
    path: basename(args.buildArtifact),
    bytes: statSync(args.buildArtifact).size,
    sha256: sha256(readFileSync(args.buildArtifact)),
  } : null;
  const inventory = {
    schemaVersion: 1,
    generatedAt: timestamp,
    scope: buildArtifact ? "source-inventory-associated-with-build-artifact" : "repository-snapshot-only",
    releaseEvidence: false,
    limitations: [
      "This inventory is source-derived and does not inspect the compiled IPA/AAB manifest or runtime network traffic.",
      ...(buildArtifact ? [] : ["No candidate IPA/AAB hash was supplied."]),
      "PRIV-001 remains open until binary inspection, traffic capture, DPO review and candidate-build approval are recorded.",
    ],
    sourceSnapshot,
    buildArtifact,
    application: {
      name: appConfig.expo?.name ?? null,
      version: appConfig.expo?.version ?? null,
      iosBundleIdentifier: appConfig.expo?.ios?.bundleIdentifier ?? null,
      androidPackage: appConfig.expo?.android?.package ?? null,
    },
    permissions: permissionsInventory(appConfig),
    endpoints: parseOpenApiEndpoints(readFileSync(resolve(ROOT, "lib/api-spec/openapi.yaml"), "utf8")),
    database: databaseInventory(),
    runtimePackages: directRuntimePackages(manifests),
    platform: sourceInventory(),
  };
  const components = parseLockfileComponents(readFileSync(resolve(ROOT, "pnpm-lock.yaml"), "utf8"));
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${sourceSnapshot.sha256.slice(0, 8)}-${sourceSnapshot.sha256.slice(8, 12)}-4${sourceSnapshot.sha256.slice(13, 16)}-a${sourceSnapshot.sha256.slice(17, 20)}-${sourceSnapshot.sha256.slice(20, 32)}`,
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: "IA Aprova", name: "privacy_inventory.mjs", version: "1" }],
      component: { type: "application", name: "IA Aprova", version: appConfig.expo?.version ?? "unknown" },
      properties: [
        { name: "iaaprova:scope", value: inventory.scope },
        { name: "iaaprova:sourceSnapshotSha256", value: sourceSnapshot.sha256 },
        { name: "iaaprova:binaryVerified", value: "false" },
      ],
    },
    components,
  };
  mkdirSync(args.outputDir, { recursive: true });
  const inventoryPath = resolve(args.outputDir, "privacy-inventory.json");
  const sbomPath = resolve(args.outputDir, "sbom.cdx.json");
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ inventoryPath, sbomPath, components: components.length, releaseEvidence: false })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
