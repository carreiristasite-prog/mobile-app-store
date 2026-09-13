import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const api = read('src/features/identity/api.ts');
const paths = read('src/services/api/paths.ts');
const gate = read('src/features/identity/OnboardingGate.tsx');
const student = read('app/(onboarding)/identity.tsx');
const guardian = read('app/guardian/accept.tsx');
const register = read('app/(auth)/register.tsx');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(label);
};

for (const path of [
  '/api/v1/me/onboarding-state',
  '/api/v1/me/age-profile',
  '/api/v1/me/platform-age-signal',
  '/api/v1/me/legal-acknowledgements',
  '/api/v1/me/optional-consents',
  '/api/v1/me/guardian-invitations',
  '/api/v1/guardian-invitations/accept',
  '/api/v1/me/guardian-links',
]) requireText(paths, path, `rota ausente: ${path}`);

requireText(gate, '!stateQuery.data.onboardingComplete', 'guarda não bloqueia onboarding incompleto');
requireText(gate, '!stateQuery.data.social.eligible', 'guarda social ausente');
requireText(gate, '!stateQuery.data.notifications.eligible', 'guarda de notificações ausente');
requireText(gate, "rootSegment === '(onboarding)' && childSegment === 'identity'", 'allowlist do onboarding não está limitada à rota identity');
requireText(gate, "rootSegment === 'guardian' && childSegment === 'accept'", 'allowlist do responsável não está limitada à rota accept');
requireText(register, "decorateUrl('/(onboarding)/identity')", 'cadastro não termina no onboarding');
requireText(student, "state.ageBand === 'under_13'", 'bloqueio under_13 ausente');
requireText(guardian, 'responsibility: true', 'declaração do responsável ausente');
requireText(guardian, 'termsAccepted: true', 'aceite de termos do responsável ausente');
requireText(guardian, 'privacyNoticeAcknowledged: true', 'reconhecimento de privacidade ausente');
for (const versionField of ['policyVersion', 'termsVersion', 'privacyNoticeVersion']) {
  requireText(api, versionField, `snapshot jurídico ausente na API mobile: ${versionField}`);
  requireText(student, versionField, `snapshot jurídico ausente no aceite do aluno: ${versionField}`);
  requireText(guardian, versionField, `snapshot jurídico ausente no aceite do responsável: ${versionField}`);
}
requireText(guardian, "versão ${state.policyVersion", 'versão da declaração de responsabilidade não é exibida ao responsável');
requireText(api, 'apiPaths.guardianLink(linkId)', 'revogação mobile não usa linkId explícito');
requireText(student, 'link.counterpartPseudonym', 'seleção pseudonimizada de vínculo ausente');

if ((api.match(/queueWhenOffline: false/g) || []).length !== 7) {
  failures.push('mutações de identidade devem falhar offline, sem fila');
}
if (/AsyncStorage|SecureStore|console\.|logger\./.test(`${api}\n${student}\n${guardian}`)) {
  failures.push('fluxo de identidade persiste ou registra dado sensível');
}
if (/useLocalSearchParams|params\s*\.\s*token|[?&]token=/.test(guardian)) {
  failures.push('token do responsável não pode vir de URL, deep link ou parâmetro de rota');
}
if (/\b(dateOfBirth|birthDate|guardianEmail|responsibleEmail)\b/.test(`${student}\n${guardian}`)) {
  failures.push('campo proibido de data de nascimento ou e-mail do responsável');
}

// The UI must not own correctness, score or entitlement decisions.
if (/\b(isCorrect|correctOptionId|score|entitlement)\b/.test(`${student}\n${guardian}`)) {
  failures.push('decisão autoritativa indevida no fluxo mobile');
}

if (failures.length) {
  for (const failure of failures.filter(Boolean)) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('identity onboarding static checks: ok\n');
