# Plano de testes de segurança MASVS/ASVS

**Regra absoluta:** somente staging isolado, contas e dados sintéticos,
autorização escrita vigente e janela aprovada. Nenhum comando deste documento
autoriza teste; os exemplos são modelos que o test lead deve preencher.

## 1. Gates do ambiente

Antes de qualquer teste dinâmico, anexar ao ticket:

1. autorização assinada, owner, fiscal, IPs/origens, horário, contatos e
   critério de parada;
2. `STAGING_BASE_URL` confirmado como não produção e allowlist do scanner;
3. banco isolado com identificadores `secsynthetic-*`, sem cópia de produção;
4. RevenueCat/Apple/Google sandbox e projeto Clerk de staging;
5. backups/rollback, dashboards e incident commander de teste;
6. hash do IPA/AAB, imagens de API/worker, OpenAPI, Terraform aplicado e SBOM;
7. limite de taxa/carga; DAST destrutivo, DoS e social engineering fora do
   escopo salvo autorização separada.

O executor interrompe imediatamente em caso de produção, dado real, impacto a
terceiro, perda de isolamento, custo anormal ou indisponibilidade fora do
limite.

## 2. Matriz MASVS mobile

| Domínio MASVS | Testes IA Aprova | Critério automatizável/aceite |
|---|---|---|
| STORAGE | tokens, SQLite do outbox, respostas, guardian invite, DSR, RC IDs, backup e screenshot | nenhum token/PII/gabarito no outbox/log/backup; logout/troca/exclusão apaga escopo anterior; não presumir cifragem |
| CRYPTO | TLS, RNG/UUID, armazenamento protegido, pinning como decisão de risco | sem algoritmo próprio; TLS válido; chaves fora do bundle; falha segura |
| AUTH | Clerk e-mail/Apple/Google, PKCE/deep link, expiração, troca/revogação | token inválido/expirado/audience errada recebe 401; conta apagada não provisiona novamente |
| NETWORK | endpoint HTTPS, proxy/VPN do laboratório, timeout e erros | release rejeita HTTP/credencial/path na base URL; nenhuma PII em query |
| PLATFORM | intents/deep links, clipboard, screenshots, permissões, WebView | somente schemes/associações declarados; zero permissão não usada; sem WebView privilegiada |
| CODE | build release, debug, minificação, segredos, dependências | debug desligado; sourcemap restrito; SAST/SCA/SBOM/secret scan aprovados |
| RESILIENCE | device comprometido, hook, app repackaged, attestation | adulterar UI nunca concede Pro/score; signal monitorado e fallback documentado |
| PRIVACY | SDK traffic, age band, consentimentos, identificadores e deleção | data map coincide com captura e lojas; sem DOB/localização/foto social |

Casos mobile obrigatórios iOS e Android:

- login, logout, troca de conta e reinstalação com outbox pendente;
- responder offline, alterar payload local, expirar item, replay com mesmo e
  outro usuário; servidor rejeita e ranking não muda;
- patch/hook da UI Pro; endpoint premium continua negado;
- purchase, restore, cancelamento, grace, refund e troca de aparelho em sandbox;
- faixa 13–15, 16–17, 18+, menor de 13, responsável inexistente/revogado e
  transição aos 18;
- export/exclusão, reautenticação e impedimento de conta durante deleção;
- VoiceOver/TalkBack e texto 200% nos avisos de segurança/consentimento.

## 3. Matriz ASVS/API/worker

| Domínio ASVS | Testes IA Aprova | Aceite |
|---|---|---|
| Arquitetura | trust boundaries, inventário de rotas/dependências/dados | modelo e SBOM correspondem ao hash candidato |
| Autenticação | Clerk issuer/audience/expiry, conta apagada, proxy | default deny; 401 uniforme; sem trust em ID do body |
| Sessão | revogação, máx. dispositivos/sessões, replay | limites e auditoria server-side; recuperação testada |
| Autorização | BOLA/IDOR em todos UUIDs e papéis | outra conta nunca lê/muta recurso; admin default deny |
| Validação | JSON/body/header/path, UUID, enum, tamanho, content-type | 4xx controlado, sem stack/SQL; corpo limitado |
| Criptografia | TLS, authorization do webhook; HMAC somente quando emitido por integração compatível; KMS/segredos/rotação | segredo ausente falha fechado; chave velha revogada |
| Erros/log | canários de token/e-mail/resposta/recibo | zero canário sensível em log; request ID preservado |
| Dados | constraints, concorrência, backup/restore, retenção | migração e restore reais; nenhuma deleção parcial declarada |
| Comunicação | HTTPS/HSTS/CORS/headers e egress | origem indevida negada; TLS configurado; egress inventariado |
| Código malicioso | SAST/SCA/secret scan/SBOM/imagem | zero crítico/alto; imagem por digest e proveniência |
| Negócio | quota, primeira resposta, entitlement, guardian, publicação | invariantes resistem a replay/concorrência/ordem |
| API/WebSocket | rate limit, schema, token WS, sequence/backpressure | limites por rota/conta; token curto; mensagens fora de ordem negadas |
| Configuração | Cloud Run/IAM/SQL/Redis/Storage/Armor | policy/IAM scan; sem endpoint/objeto público acidental |

## 4. Casos negativos automatizáveis

| ID | Ação sintética | Resultado esperado |
|---|---|---|
| N01 | `PublicQuestion` antes da resposta | schema não contém `isCorrect`, `correctOptionId`, solução ou rationales |
| N02 | mesma tentativa, mesma chave/payload | mesma resposta, um registro/efeito |
| N03 | mesma chave, payload diferente | 409, nenhuma mutação adicional |
| N04 | duas chaves na mesma exposure concorrente | uma primeira resposta; outra 409 |
| N05 | UUID de sessão/exposure de outra conta | 404/403 uniforme; nenhuma informação |
| N06 | webhook inválido, expirado, duplicado e fora de ordem | 401/200 idempotente; entitlement converge ao evento válido mais novo |
| N07 | restore com `appUserId` alheio | 403; nenhum evento |
| N08 | status Pro no body/cliente | campo rejeitado/ignorado; entitlement inalterado |
| N09 | menor sem guardian/consentimento ou após revogação | learning/social/notificação conforme policy, default deny |
| N10 | guardian token duplicado, expirado, de menor errado | falha sem criar segundo vínculo |
| N11 | DSR sem adapter/fornecedor indisponível | pending/retry/dead-letter, nunca completed |
| N12 | poison outbox e lease expirado | fila continua; fencing impede worker antigo; alerta dispara |
| N13 | 257 KiB JSON/64 KiB form | 413 controlado, sem stack |
| N14 | burst por IP+conta nas rotas sensíveis | 429 com retry; saúde não degrada fora do SLO |
| N15 | upload HTML/SVG/script, ZIP bomb, `../`, CSV `=...` | quarentena/rejeição; nada publicado/executado |
| N16 | WebSocket replay/seq regressiva/reconexão após logout | ignorado/fechado; snapshot server-side prevalece |

## 5. Comandos-modelo seguros

Estes comandos locais não atacam rede e podem rodar no repositório:

```powershell
python scripts/security/check_security_docs.py
python -m unittest discover -s scripts/security/tests -p "test_*.py"
python scripts/release_gate.py
pnpm run typecheck
pnpm run test:contracts
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/worker test
```

Para ferramentas dinâmicas, o ticket autorizado deve substituir os
placeholders e o wrapper precisa abortar se o host não terminar no domínio de
staging aprovado. Exemplos intencionais, não executáveis como copiados:

```text
AUTHORIZED_STAGING_ONLY scanner --target https://<staging-approved>/openapi \
  --rate <approved-rps> --header "Authorization: Bearer <synthetic-token>"

AUTHORIZED_STAGING_ONLY mobile-lab --build <sha256-candidate> \
  --account secsynthetic-<case> --platform ios|android
```

Nunca colocar token/segredo real na linha de comando, relatório ou shell
history; usar secret injection efêmero do ambiente de teste aprovado.

## 6. Evidência e aprovação

Cada execução produz manifest assinado/imutável com ferramenta/versão, regra,
timestamp UTC, escopo, hash dos artefatos, caso, resultado, request IDs e link
da evidência redigida. Falha deve ser reproduzível sem conter token, PII,
gabarito integral ou dado de terceiro.

Gates finais:

- 100% dos casos obrigatórios executados no hash candidato;
- zero crítico/alto aberto; médio somente com aceite formal quando permitido;
- reteste por fiscal independente;
- DAST/pentest, restore, billing sandbox, E2E menor/consentimento e incidente
  tabletop possuem evidências separadas;
- todos os 19 release blockers continuam abertos até seus owners registrarem a
  evidência canônica; este plano sozinho não fecha nenhum.

Referências: [OWASP MASVS](https://mas.owasp.org/MASVS/) e
[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).
