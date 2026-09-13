const SAFE_TEST_DATABASE = Symbol("ia-aprova-safe-test-database");

const APP_TEST_DATABASE = /^ia[_-]?aprova[_-](?:test|testing|ci)(?:[_-][a-z0-9]+)*$/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
const EXPLICIT_TEST_HOST = /(^|[.-])(?:test|testing|ci)(?=$|[.-])/i;
const PRODUCTION_MARKER = /(^|[._-])(?:prod|production|live|main)(?=$|[._-])/i;
const ALLOWED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

export class UnsafeTestDatabaseError extends Error {
  constructor(reason) {
    super(`TEST_DATABASE_URL recusada: ${reason}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

function parseDatabaseName(url) {
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    throw new UnsafeTestDatabaseError("nome do banco possui codificação inválida");
  }
  if (!path || path.includes("/")) {
    throw new UnsafeTestDatabaseError("o nome do banco deve ser um único segmento explícito");
  }
  return path;
}

function decodedUsername(url) {
  try {
    return decodeURIComponent(url.username);
  } catch {
    throw new UnsafeTestDatabaseError("usuário possui codificação inválida");
  }
}

/**
 * Fail-closed guard for destructive integration-test setup. It deliberately
 * accepts only this application's explicitly named test databases and either a
 * local/container host or a host with an isolated test/CI label.
 */
export function assertSafeTestDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new UnsafeTestDatabaseError("variável ausente ou vazia");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTestDatabaseError("URL inválida");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new UnsafeTestDatabaseError("somente postgres:// ou postgresql:// é permitido");
  }
  if (!url.hostname) throw new UnsafeTestDatabaseError("host ausente");
  if (!url.username) throw new UnsafeTestDatabaseError("usuário do banco ausente");
  if (url.hash) throw new UnsafeTestDatabaseError("fragmentos de URL não são permitidos");

  const hostname = url.hostname.toLowerCase();
  const database = parseDatabaseName(url);
  const username = decodedUsername(url);
  if (PRODUCTION_MARKER.test(hostname) || PRODUCTION_MARKER.test(database) || PRODUCTION_MARKER.test(username)) {
    throw new UnsafeTestDatabaseError("marcador de produção detectado");
  }
  if (!APP_TEST_DATABASE.test(database)) {
    throw new UnsafeTestDatabaseError("o banco deve seguir ia_aprova_test_* ou ia_aprova_ci_*");
  }
  if (!LOCAL_HOSTS.has(hostname) && !EXPLICIT_TEST_HOST.test(hostname)) {
    throw new UnsafeTestDatabaseError("o host precisa ser local/container ou possuir rótulo test/ci isolado");
  }
  const queryKeys = new Set();
  for (const [rawKey, rawValue] of url.searchParams.entries()) {
    const key = rawKey.toLowerCase();
    if (queryKeys.has(key)) throw new UnsafeTestDatabaseError(`parâmetro de conexão ${rawKey} está duplicado`);
    queryKeys.add(key);
    if (key !== "sslmode" || !ALLOWED_SSL_MODES.has(rawValue.toLowerCase())) {
      throw new UnsafeTestDatabaseError(`parâmetro de conexão ${rawKey} não é permitido`);
    }
  }

  return Object.freeze({
    connectionString: rawUrl,
    database,
    hostname,
    [SAFE_TEST_DATABASE]: true,
  });
}

export function isSafeTestDatabaseTarget(value) {
  return Boolean(value?.[SAFE_TEST_DATABASE] === true);
}

export function requireSafeTestDatabaseTarget(value) {
  if (!isSafeTestDatabaseTarget(value)) {
    throw new UnsafeTestDatabaseError("o guard de TEST_DATABASE_URL não foi executado");
  }
  return value;
}
