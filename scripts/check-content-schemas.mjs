import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaDirectory = path.resolve("content", "schemas");
const schemaNames = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

if (schemaNames.length === 0) {
  throw new Error("Nenhum JSON Schema editorial foi encontrado.");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const checkedInDocuments = new Map([
  ["blueprints.schema.json", path.resolve("content", "catalog", "blueprints.json")],
  ["eligible-batches.schema.json", path.resolve("content", "eligible", "batches.manifest.json")],
  ["rights-registry.schema.json", path.resolve("content", "rights", "registry.json")],
]);

for (const name of schemaNames) {
  const source = await readFile(path.join(schemaDirectory, name), "utf8");
  const schema = JSON.parse(source);
  const validate = ajv.compile(schema);
  const documentPath = checkedInDocuments.get(name);
  if (documentPath) {
    const document = JSON.parse(await readFile(documentPath, "utf8"));
    if (!validate(document)) {
      throw new Error(`${path.relative(process.cwd(), documentPath)} não respeita ${name}: ${ajv.errorsText(validate.errors)}`);
    }
  }
}

process.stdout.write(`JSON Schemas editoriais compilados em modo estrito: ${schemaNames.length}; registries validados: ${checkedInDocuments.size}\n`);
