import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mobileRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(mobileRoot, '..', '..');
const read = (root, path) => readFileSync(resolve(root, path), 'utf8');
const app = JSON.parse(read(mobileRoot, 'app.json'));
const pkg = JSON.parse(read(mobileRoot, 'package.json'));
const native = read(mobileRoot, 'src/features/identity/platform-age-native.ts');
const domain = read(mobileRoot, 'src/features/identity/platform-age-domain.ts');
const api = read(mobileRoot, 'src/features/identity/api.ts');
const paths = read(mobileRoot, 'src/services/api/paths.ts');
const onboarding = read(mobileRoot, 'app/(onboarding)/identity.tsx');
const gate = read(mobileRoot, 'src/features/identity/OnboardingGate.tsx');
const route = read(workspaceRoot, 'artifacts/api-server/src/routes/v1.ts');
const policy = read(workspaceRoot, 'artifacts/api-server/src/services/identity-policy.ts');
const contracts = read(workspaceRoot, 'lib/api-zod/src/contracts.ts');
const migration = read(workspaceRoot, 'lib/db/migrations/0010_platform_age_signals.sql');
const openapi = read(workspaceRoot, 'lib/api-spec/openapi.yaml');
const workerRepository = read(workspaceRoot, 'artifacts/worker/src/repository.ts');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(label);
};
const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return '';
  const bodyStart = startIndex + start.length;
  const endIndex = source.indexOf(end, bodyStart);
  return endIndex < 0 ? source.slice(bodyStart) : source.slice(bodyStart, endIndex);
};

if (pkg.dependencies?.['expo-age-range'] !== '~57.0.3') failures.push('expo-age-range não está fixado na linha oficial do SDK 57');
if (app.expo?.ios?.entitlements?.['com.apple.developer.declared-age-range'] !== true) failures.push('entitlement Declared Age Range ausente');
for (const threshold of ['threshold1: 13', 'threshold2: 16', 'threshold3: 18']) {
  requireText(native, threshold, `threshold nativo ausente: ${threshold}`);
}
requireText(native, "access !== 'SHARED'", 'Android não falha fechado sem status SHARED');
requireText(domain, 'return null', 'normalizador não rejeita faixas ambíguas');
requireText(paths, '/api/v1/me/platform-age-signal', 'rota mobile de sinal etário ausente');
requireText(api, 'queueWhenOffline: false', 'sinal etário não pode entrar na fila offline');
requireText(onboarding, 'collectPlatformAgeSignal', 'onboarding não solicita o sinal nativo');
requireText(onboarding, 'Consultar faixa novamente', 'onboarding não oferece nova consulta para recusa, erro ou conflito');
requireText(onboarding, "state.learning.reason === 'platform_age_signal_conflict'", 'conflito etário não bloqueia a saída do onboarding');
requireText(gate, "platformAgeSignal.status === 'missing'", 'sessão existente não retorna ao age gate quando o sinal é obrigatório');
requireText(route, 'trustStatus: "device_reported_monitoring"', 'API não fixa o sinal público como monitoramento');
requireText(route, 'const preservesServerVerified = before?.trustStatus === "server_verified"', 'payload público pode sobrescrever sinal verificado');
requireText(route, 'if (!preservesServerVerified)', 'proteção do sinal verificado não governa o upsert');
requireText(route, 'evaluatePlatformAgeSignal', 'gate server-side do sinal etário ausente');
requireText(policy, 'evaluatePlatformAgeConsistency', 'conflito entre autodeclaração e loja não governa o aprendizado');
requireText(policy, 'if (learning.eligible && !platformAgeConsistency.eligible)', 'conflito etário não fecha o onboarding adulto');
requireText(contracts, 'PlatformAgeSignalReportRequestSchema', 'schema Zod do reporte etário ausente');
requireText(contracts, '}).strict().superRefine', 'schema Zod do reporte não é estrito/relacional');
requireText(openapi, 'PlatformAgeSignalReportRequest', 'contrato OpenAPI do sinal etário ausente');
requireText(migration, "'0010_platform_age_signals'", 'migration 0010 não se autorregistra');
requireText(migration, 'REFERENCES users(id) ON DELETE CASCADE', 'sinal etário não acompanha exclusão do titular');
requireText(workerRepository, 'read("platformAgeSignals"', 'exportação LGPD não inclui sinais etários');
for (const dataset of ['integrityDeviceBindings', 'appIntegrityKeys', 'integrityChallenges', 'integrityVerifications']) {
  requireText(workerRepository, `read("${dataset}"`, `exportação LGPD não inclui o dataset seguro ${dataset}`);
}
const integrityExport = between(
  workerRepository,
  'await read("platformAgeSignals"',
  'await read("simulationSessions"',
);
for (const forbidden of [
  'nonce_hash',
  'proof_digest',
  'request_digest',
  'envelope_digest',
  'key_id',
  'key_id_hash',
  'public_key_spki',
  'last_assertion_counter',
  'receipt_ciphertext',
  'proof_ciphertext',
]) {
  if (new RegExp(`\\b${forbidden}\\b`, 'i').test(integrityExport)) {
    failures.push(`exportação LGPD expõe material de replay/integridade: ${forbidden}`);
  }
}

const storedShape = `${migration}\n${domain}`;
if (/date_of_birth|birth_date|\bdob\b/i.test(storedShape)) failures.push('schema tenta persistir data de nascimento');
for (const forbidden of ['install_id', 'active_parental_controls', 'government_id', 'payment_method']) {
  if (new RegExp(`\\b${forbidden}\\b`, 'i').test(migration)) failures.push(`campo nativo excessivo persistido: ${forbidden}`);
}
const publicRoute = between(
  route,
  'router.post("/me/platform-age-signal"',
  'router.post("/me/legal-acknowledgements"',
);
if (/input\.(?:trust|source|verified|assurance)/.test(publicRoute)) failures.push('cliente controla source/trust/assurance');
requireText(publicRoute, 'const userId = res.locals.principal.userId', 'rota não vincula o reporte ao titular autenticado');
const profileLock = publicRoute.indexOf('identity-profile:${userId}');
const existingSignalRead = publicRoute.indexOf('const [before]');
if (profileLock < 0 || existingSignalRead < 0 || profileLock > existingSignalRead) {
  failures.push('leitura/upsert do sinal não está serializado pelo lock do perfil');
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('platform age signals checks: ok\n');
