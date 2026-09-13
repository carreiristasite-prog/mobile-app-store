import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const walkRuntime = (relative) => {
  const absolute = path.join(root, relative);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return walkRuntime(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [[child.replaceAll('\\', '/'), read(child)]] : [];
  });
};
const domain = read('src/services/api/outbox-domain.ts');
const storage = read('src/services/api/outbox.ts');
const webStorage = read('src/services/api/outbox.web.ts');
const legacyMigration = read('src/services/api/outbox-legacy-migration.ts');
const packageJson = read('package.json');
const client = read('src/services/api/client.ts');
const provider = read('src/services/api/ApiProvider.tsx');
const quiz = read('app/quiz/index.tsx');
const simulation = read('app/simulados/active.tsx');
const billing = read('src/services/billing/BillingProvider.tsx');
const settings = read('app/settings/index.tsx');
const profile = read('app/(tabs)/profile.tsx');
const onboarding = read('app/(onboarding)/identity.tsx');

const failures = [];
const requireText = (source, expected, message) => {
  if (!source.includes(expected)) failures.push(message);
};

requireText(domain, "OUTBOX_SCHEMA_VERSION = 3", 'schema do outbox deve permanecer versionado em v3');
requireText(domain, "OUTBOX_TTL_MS = 24 * 60 * 60 * 1_000", 'TTL explícito de 24h ausente');
requireText(domain, 'OUTBOX_MAX_ITEMS = 50', 'limite de itens ausente');
requireText(domain, 'OUTBOX_MAX_BYTES = 128 * 1_024', 'limite total em bytes ausente');
requireText(domain, 'OUTBOX_MAX_ITEM_BYTES = 4 * 1_024', 'limite por item ausente');
requireText(domain, 'OUTBOX_MAX_DELIVERY_ATTEMPTS = 5', 'limite de tentativas ausente');
requireText(domain, "code = 'OUTBOX_STORAGE_ERROR'", 'erro de storage distinto ausente');
requireText(domain, "OUTBOX_OPERATION = 'non_competitive_learning_attempt'", 'classe não competitiva obrigatória ausente');
requireText(domain, '^/api/v1/learning/sessions/', 'allowlist exata de tentativas ausente');
requireText(domain, "status === 401 || status === 408 || status === 425 || status === 429 || status >= 500", 'classificação HTTP transitória/terminal ausente');
requireText(domain, "input.ownerNamespace !== input.ownerNamespace.toLowerCase()", 'namespace de owner não é canônico');
requireText(domain, "hasExactKeys(value, ['elapsedMs', 'exposureId', 'selectedOptionId'])", 'body fechado exato ausente');
if (domain.includes("startsWith('/api/v1/')")) failures.push('allowlist genérica /api/v1 proibida');
for (const forbidden of ['/billing/', '/guardian', '/social/', '/reports', '/me/export']) {
  if (domain.includes(forbidden)) failures.push(`rota sensível apareceu no domínio do outbox: ${forbidden}`);
}

requireText(packageJson, '"expo-sqlite": "~57.0.1"', 'expo-sqlite compatível com SDK 57 ausente');
requireText(storage, "DATABASE_NAME = 'ia_aprova_outbox_v3.db'", 'banco SQLite v3 ausente');
requireText(storage, 'SQLITE_STORAGE_VERSION = 3', 'versão SQLite fail-closed ausente');
requireText(storage, 'SQLite.openDatabaseAsync', 'outbox nativo não abre SQLite');
requireText(storage, 'withExclusiveTransactionAsync', 'operações SQLite não são exclusivas/transacionais');
requireText(storage, 'OutboxStorageError', 'falha SQLite pode ser confundida com mutação inválida');
requireText(storage, 'PRAGMA journal_mode = WAL', 'tentativa de WAL quando suportado ausente');
requireText(storage, 'PRAGMA user_version', 'schema SQLite não usa user_version');
requireText(storage, "version.user_version !== SQLITE_STORAGE_VERSION", 'schema SQLite desconhecido não falha fechado');
requireText(storage, 'STORAGE_SCHEMA_MARKER', 'schema SQLite não verifica marcador próprio');
requireText(storage, 'CREATE TABLE outbox_items', 'tabela de itens SQLite ausente');
requireText(storage, 'STRICT;', 'tabelas SQLite não são STRICT');
requireText(storage, 'idx_outbox_owner_state_expires', 'índice owner/state/expires ausente');
requireText(storage, 'idx_outbox_expires', 'índice de expiração ausente');
requireText(storage, 'Crypto.CryptoDigestAlgorithm.SHA256', 'namespace opaco por SHA-256 ausente');
if (/from ['"]@react-native-async-storage\/async-storage['"]|AsyncStorage\./.test(storage)) {
  failures.push('outbox SQLite ativo ainda importa ou usa AsyncStorage');
}
requireText(storage, 'discardLegacyOutboxQueues()', 'inicialização SQLite não executa descarte legado');
requireText(storage, 'LEGACY_PURGE_MARKER', 'migração única não possui marcador transacional');
requireText(legacyMigration, "'ia_aprova_api_outbox_v1'", 'chave legada v1 não é removida');
requireText(legacyMigration, "'ia_aprova_api_outbox_v2'", 'chave legada v2 não é removida');
requireText(legacyMigration, "'ia_aprova_api_outbox_v3'", 'chave legada v3 não é removida');
requireText(legacyMigration, 'AsyncStorage.multiRemove([...LEGACY_UNSAFE_KEYS])', 'filas legadas não são removidas');
if (/getItem|multiGet|setItem|mergeItem/.test(legacyMigration)) {
  failures.push('migração legada deve somente apagar; leitura/reprodução detectada');
}
if (/AsyncStorage|SQLite|localStorage|sessionStorage|indexedDB/i.test(webStorage)) {
  failures.push('fallback web não pode persistir fila offline');
}
requireText(webStorage, 'function noWebQueue(): never', 'fallback web não rejeita enqueue offline');
requireText(storage, 'revalidateDelivery', 'revalidação do item antes do envio ausente');
requireText(storage, 'markServerRejected', 'retenção opaca de rejeição ausente');
requireText(storage, "existing.state !== 'pending'", 'chave terminal pode ser falsamente reenfileirada');
requireText(storage, 'markRetryableHttpFailure', 'falha HTTP transitória não permanece retentável');

const tokenIndex = client.indexOf('const token = await this.getToken()');
const postTokenValidationIndex = client.indexOf('if (beforeAuthenticatedFetch) await beforeAuthenticatedFetch()');
const fetchIndex = client.indexOf('const response = await fetch');
if (!(tokenIndex >= 0 && postTokenValidationIndex > tokenIndex && fetchIndex > postTokenValidationIndex)) {
  failures.push('flush deve revalidar depois do token e antes do fetch');
}
requireText(client, 'await apiOutbox.beginDelivery', 'flush não revalida/limita antes de obter token');
requireText(client, 'await apiOutbox.revalidateDelivery', 'flush não revalida owner/TTL/allowlist depois do token');
requireText(client, 'await apiOutbox.markNetworkFailure', 'falha de rede não contabilizada');
requireText(client, 'await apiOutbox.markServerRejected', 'rejeição do servidor não é retida');
requireText(client, "classifyHttpDeliveryStatus(error.problem.status) === 'retryable'", 'flush não distingue HTTP transitório de rejeição terminal');
requireText(client, 'status: response.status', 'body remoto pode sobrescrever o status HTTP autoritativo');

const runtimeFiles = [...walkRuntime('app'), ...walkRuntime('src'), ...walkRuntime('components')];
const queueSites = runtimeFiles.filter(([, source]) => /offlineQueue\s*:/.test(source));
if (queueSites.length !== 1 || queueSites[0][0] !== 'app/quiz/index.tsx') {
  failures.push(`somente quiz não competitivo pode pedir fila offline; encontrados: ${queueSites.map(([file]) => file).join(', ') || 'nenhum'}`);
}
requireText(quiz, "offlineQueue: 'non_competitive_learning_attempt'", 'quiz não marca tentativa como não competitiva');
if (simulation.includes('offlineQueue:') || simulation.includes('queueWhenOffline: true')) failures.push('simulado/competição entrou no outbox');
if (billing.includes('offlineQueue:') || billing.includes('queueWhenOffline: true')) failures.push('billing entrou no outbox');
if (settings.includes('offlineQueue:') || settings.includes('queueWhenOffline: true')) failures.push('DSR/settings entrou no outbox');
if (quiz.includes('Denúncia salva para envio quando a conexão voltar.')) failures.push('UI ainda alega fila offline para denúncia');

const allRuntime = runtimeFiles.map(([, source]) => source).join('\n');
if (/queueWhenOffline\s*:\s*true/.test(allRuntime)) failures.push('fila genérica queueWhenOffline:true ainda existe');
requireText(provider, 'apiOutbox.clearForOwnerId(cacheOwnerId)', 'troca de conta não solicita purge do owner anterior');
for (const [name, source] of [['settings', settings], ['profile', profile], ['onboarding', onboarding]]) {
  requireText(source, 'apiOutbox.clearForOwnerId', `logout em ${name} não solicita purge namespaced`);
}

if (failures.length > 0) {
  console.error(`offline outbox checker: ${failures.length} falha(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const domainTests = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', path.join(root, 'scripts/outbox-domain.test.mts')],
  { encoding: 'utf8' },
);
if (domainTests.status !== 0) {
  process.stderr.write(domainTests.stdout || '');
  process.stderr.write(domainTests.stderr || '');
  console.error('offline outbox checker: testes de domínio falharam');
  process.exit(1);
}

console.log('offline outbox checker: OK (SQLite v3 transacional, migração destrutiva v1-v3, web sem fila, allowlist estrita, owner, TTL, limites, purge e no-competition; testes de domínio executados)');
