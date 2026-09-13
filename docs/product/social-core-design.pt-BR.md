# Núcleo social seguro — arquitetura do MVP

**Data:** 27/08/2026
**Status:** desenho autoral para implementação; não comprova funcionalidade pronta
**Escopo:** pseudônimo, avatar interno, convite por código, amizade, bloqueio,
denúncia, ranking por temporada e duelo ao vivo
**Fora do escopo:** chat, feed, foto, upload, localização, nome real, busca
pública de pessoas, mensagem livre, bot e adversário fictício
**Revisões obrigatórias:** engenharia independente, segurança, privacidade,
jurídico, produto, acessibilidade e operação

## 1. Decisão executiva

O núcleo social deve ser um subsistema online, server-authoritative e desligado
por padrão. PostgreSQL é a fonte canônica; Redis é apenas projeção efêmera para
presença, matchmaking, fan-out e rate limit. O cliente nunca decide
capability, amizade, pergunta, tempo, acerto, score, resultado ou posição.

O MVP social só pode ser liberado quando todos estes gates estiverem verdes:

1. App Attest e Play Integrity verificam no servidor uma prova vinculada à
   conta, instalação e reporte etário; `device_reported_monitoring` nunca abre
   social.
2. A capability social exige `server_verified` fresco, consentimento vigente e
   as demais condições deste documento. Um texto `trust_status` isolado no
   banco não satisfaz o gate.
3. Para menor de 13 anos o produto permanece indisponível. Para 13–17 anos,
   social começa desligado e exige vínculo vigente com responsável, autorização
   social vigente e garantias etárias fortes para estudante e responsável.
4. Existe serviço realtime real, revisado, com autenticação, revogação,
   reconexão e teste de 10 mil WebSockets/5 mil duelos simultâneos.
5. Bloqueio, denúncia, moderação, recurso, DSR e retenção estão operacionais.
6. As questões usadas em duelo estão publicadas, licenciadas e elegíveis. Este
   desenho não libera nem fabrica conteúdo.
7. Testes de concorrência, fraude, invasão e carga passaram em staging com
   dados sintéticos e revisão independente.

Até lá, todas as flags sociais permanecem `false`, as telas não anunciam o
recurso e nenhum mock/bot simula atividade.

## 2. Auditoria do estado real

### 2.1 O que já existe

- A API é montada em `/api/v1` e autentica o principal por UUID interno.
- `requireCapability(userId, "social")` protege hoje apenas
  `GET /api/v1/social/summary`.
- `age_profiles`, `platform_age_signals`, `guardian_links` e `consents`
  fornecem uma fundação de identidade, responsável e escolha opcional.
- A migration `0003_platform_v1.sql` criou `social_profiles`, `friendships`,
  `user_blocks`, `duel_matches_v1`, `ranking_seasons`, `reports`,
  `risk_events`, `outbox_events`, `audit_logs` e `feature_flags`.
- O worker de DSR já exporta perfil social, papéis de amizade/bloqueio, duelos
  e denúncias sem revelar o identificador da outra pessoa em amizade/bloqueio.
- Redis HA está desenhado na infraestrutura, mas o próprio repositório registra
  que ainda não há consumidor.
- As regras jurídicas em rascunho limitam o social ao escopo deste documento.
- A migration expand-only `0014_app_integrity_phase_a.sql` e o schema Drizzle
  correspondente agora modelam `integrity_device_bindings`,
  `app_integrity_keys`, `integrity_challenges`, `integrity_verifications` e os
  campos de assurance de `platform_age_signals`. Ela também rebaixa qualquer
  legado `server_verified` sem verification record para
  `device_reported_monitoring`.
- A Phase A inclui canonicalização compartilhada e adapters deliberadamente
  fail-closed. Ela não inclui SDK nativo, credenciais/consoles, verificação real
  dos provedores, build assinado ou homologação em aparelho; portanto, não
  produz assurance apta a abrir social.

### 2.2 Lacunas de capability e App Integrity

O estado atual não pode liberar social:

- A migration 0014 fornece a cadeia persistente mínima de verification record,
  assurance, conta, instalação e expiração, mas o avaliador de capability
  social ainda não consome essa cadeia completa nem compara frescor e revogação
  no mesmo snapshot transacional da decisão.
- Os adapters da Phase A retornam resultado não verificável de propósito. Até
  existir validação criptográfica real de Apple/Google, nenhuma linha pode ser
  elevada a `server_verified` e nenhuma coorte pode abrir social.
- A rota pública de reporte só grava `device_reported_monitoring`; o desenho de
  App Integrity está documentado, mas não implementado/homologado.
- A política atual rejeita qualquer sinal etário 13–17 como
  `platform_age_signal_minor`, mesmo que haja responsável. Para entregar o MVP
  aprovado, será necessária uma mudança explícita, revisada por jurídico/DPO:
  sinal menor coerente e verificado não libera sozinho, mas pode compor o gate
  com responsável e consentimento. Não se deve contornar o bloqueio atual.
- O estado do responsável confere hoje sua faixa autodeclarada 18+, não uma
  prova etária fresca vinculada ao ato de autorizar o social.

Assim, a migration 0014 é uma fundação de banco e contrato, não evidência de
funcionalidade pronta. O gate permanece fechado para adultos e menores até a
Phase B homologada, a integração do avaliador e os testes físicos independentes.

### 2.3 Lacunas do schema social atual

| Objeto atual | O que preserva | Constraints e dados ausentes |
|---|---|---|
| `social_profiles` | um perfil por UUID; pseudônimo e convite únicos | pseudônimo é case-sensitive e sem formato/tamanho/moderação; `avatar_key` não referencia catálogo; convite fica em claro e aparece no resumo; não há `public_id`, estado, versão ou `created_at`; `discoverable` não tem política verificável |
| `friendships` | FKs, par direcional e usuários distintos | A→B e B→A podem coexistir; status é texto aberto; faltam ID opaco, índices de inbox, ator de transição, versão, histórico e constraints temporais |
| `user_blocks` | bloqueio dirigido e usuários distintos | não há revogação auditável, motivo, versão, índices nos dois sentidos nem efeito atômico sobre amizade/fila/duelo |
| `duel_matches_v1` | UUID, produto, dois participantes distintos e seed | status aberto; sem temporada, regras/blueprint/snapshot, rounds, respostas, deadlines, resultado/hash, idempotência, versionamento, risk hold ou política de DSR; FKs impedem apagar usuário sem tratamento prévio |
| `ranking_seasons` | produto e intervalo válido | status aberto; sem escopo/regra imutável, prevenção de sobreposição, publicação, entries ou ledger |
| `reports` | protocolo básico e índices por alvo/reportante | alvo polimórfico sem FK/ownership; enums abertos; sem `Idempotency-Key`, request hash, snapshot de evidência, caso/decisão/recurso; `ON DELETE CASCADE` do reportante conflita com a retenção `SOC-M2Y` proposta |
| `risk_events` | evento relacionado a usuário | tipo/severidade/evidência sem contrato fechado; não substitui caso de moderação nem ledger competitivo |

### 2.4 API, OpenAPI, mobile, realtime e DSR

- OpenAPI contém somente `/social/summary` e `/reports` para esse domínio.
- `/social/summary` devolve `inviteCode` em claro. No modelo-alvo, um código
  novo é exibido uma única vez e nunca integra um resumo/cache genérico.
- `/reports` aceita `question|user|duel`, mas não valida que o alvo exista ou
  tenha sido visível ao reportante. A deduplicação atual considera apenas uma
  denúncia aberta com a mesma tupla, não uma chave idempotente com hash.
- As abas legadas de duelo e ranking apenas redirecionam para Progresso. A tela
  Progresso mostra somente contadores de `social/summary`.
- Não há CRUD de perfil, convite, amizade, block list, leaderboard,
  matchmaking, protocolo de duelo ou token WebSocket.
- Não existe deployable realtime revisado; os outputs da infraestrutura são
  explicitamente nulos. Redis, por isso, não é evidência de realtime pronto.
- O DSR atual exporta `SELECT *` do perfil, inclusive o convite em claro, e não
  possui ranking entries porque elas ainda não existem. A exclusão apaga
  denúncias feitas pelo titular por cascade, apesar da retenção `SOC-M2Y` proposta.

### 2.5 Legado que não pode virar fonte competitiva

A tabela `duels` da migration inicial usa subjects do Clerk em texto, scores
armazenados diretamente, modos abertos e nenhum snapshot/resposta verificável.
Ela deve ficar em quarentena/read-only. Nenhum score, vitória ou estatística
dessa tabela pode alimentar temporada, badge, fraude ou leaderboard. Após DSR
e janela de compatibilidade, sua remoção exige fase contract separada.

`duel_matches_v1` também é insuficiente para produção. A migração correta é um
modelo v2 paralelo; não completar partidas v1 preenchendo colunas à mão.

## 3. Invariantes não negociáveis

1. Todo endpoint e comando realtime passa por capability server-side. Ações
   de segurança usam capability estreita e não reabrem o social.
2. O servidor escolhe e versiona questões/opções, mede prazos, corrige,
   calcula resultado e aplica ranking. Payload do cliente contém somente a
   intenção e IDs opacos já autorizados.
3. Nunca enviar gabarito, racional, score interno, seed secreta ou resposta do
   oponente antes do fechamento autoritativo do round.
4. PostgreSQL é canônico. Redis pode ser reconstruído ou perdido sem criar
   amizade, conceder capability ou alterar resultado definitivo.
5. Competição nunca funciona offline. Comando criado offline não entra em
   outbox mobile e não é aceito depois como se tivesse chegado no prazo.
6. Primeira resposta válida recebida pelo servidor vence. Retry com o mesmo
   request preimage canônico devolve o mesmo ACK; preimage diferente com a
   mesma chave recebe conflito.
7. Toda tentativa aponta para question versions e rules versions imutáveis.
8. Respostas de duelo não alimentam mastery, revisão adaptativa, IRT ou
   calibração editorial.
9. Não há busca pública de pessoas. API nunca expõe UUID interno, idade,
   responsável, contato, presença detalhada, estado de bloqueio ou grafo.
10. Pseudônimo do MVP é gerado pelo servidor a partir de léxico revisado;
    avatar vem de catálogo interno. Não há texto/foto livre no perfil.
11. Bloquear é imediato e independe de denunciar. O alvo não é informado de
    quem bloqueou nem do motivo.
12. Toda alteração relevante grava audit log minimizado e transactional
    outbox na mesma transação do estado canônico.
13. Relógio do banco/servidor decide expiração e deadline. Tempo do cliente é
    apenas telemetria não confiável.
14. Feature flag e entitlement são restrições adicionais, nunca provas de
    idade, consentimento ou integridade.
15. Falha de App Integrity, capability, Redis, conteúdo, moderação ou estado
    inconsistente fecha a operação; não há fallback para mock ou cliente.

## 4. Capabilities e menores

### 4.1 Capabilities distintas

O backend deve avaliar, por request/comando, capabilities separadas:

| Capability | Permite | Não permite |
|---|---|---|
| `social_profile` | criar/ver/alterar o próprio perfil seguro | descobrir pessoas, competir |
| `social_relationships` | usar convite, gerir solicitações e amizades | ranking/duelo |
| `social_competition` | ver ranking, entrar em fila e disputar duelo | moderação/admin |
| `social_safety` | bloquear ou denunciar alvo previamente visível | consultar perfil/grafo ou iniciar contato |

As três primeiras exigem todos os gates sociais. `social_safety` continua
disponível de forma estreita para participante histórico autenticado mesmo
após revogar consentimento ou expirar App Integrity; bloquear/denunciar não
ativa perfil, não revela o alvo e não cria interação. Assim, toda rota ainda
tem capability server-side sem transformar um controle de segurança em prêmio
dependente de consentimento.

### 4.2 Gate comum de interação social

No instante da decisão, usando relógio do banco:

- conta interna existe, está ativa e a sessão autenticada corresponde a ela;
- faixa autodeclarada é 13–15, 16–17 ou 18+; `under_13` falha;
- termos e aviso vigentes estão atendidos pelo ator juridicamente correto;
- consentimento social mais recente está concedido, na policy version atual;
- `age_profiles.social_enabled=true` e flags server-side permitem a coorte;
- reporte etário coerente está `shared`, tem `trust=server_verified`, assurance
  vinculada à integridade, `verified_at` e `expires_at` válidos e nenhuma
  revogação/conflito; a janela inicial proposta é até 30 dias;
- a habilitação, emissão do primeiro token realtime e mudança etária exigem
  prova emitida nas últimas 24 horas, conforme o desenho de App Integrity;
- conta/dispositivo não estão suspensos do social nem sob hold que proíba a
  operação; App Integrity não serve isoladamente para banir;
- limites de dispositivo/sessão, rate limit e entitlement aplicável passam.

O avaliador recebe `now` explicitamente ou consulta `clock_timestamp()`; nunca
usa apenas um boolean cacheado. A decisão devolve `capabilityDecisionId`,
policy/integrity versions, motivo fechado e validade máxima curta. Logs não
contêm a faixa etária.

### 4.3 Condições adicionais para 13–17 anos

- vínculo `guardian_links.status=verified`, não revogado e pertencente ao
  estudante;
- responsável autenticado continua 18+ e possui sua própria assurance
  server-side fresca ao conceder/renovar a autorização;
- consentimento social vigente foi praticado por esse responsável e referencia
  o vínculo/policy version;
- perfil segue privado e não pesquisável; como o MVP não oferece busca pública,
  `discoverable` é sempre falso para todas as idades;
- revogação, correção de idade, expiração de assurance ou troca de responsável
  revoga tokens, cancela filas, bloqueia novos comandos e encerra duelo ativo
  como `no_contest`, salvo decisão de segurança auditada;
- ao completar 18 anos, a autorização anterior não é reaproveitada: a pessoa
  aceita documentos e consentimento como adulto e obtém assurance fresca.

O código atual precisa ser alterado e testado para representar essa composição;
não se deve simplesmente remover `platform_age_signal_minor`.

### 4.4 Matriz de decisão por coorte

A avaliação é uma conjunção fail-closed. `permit` só existe quando todas as
condições da linha e do gate comum são verdadeiras no mesmo snapshot. Campo
ausente, leitura inconsistente, timeout, assurance `monitoring`, conflito entre
faixas, provider indeterminado ou dependência indisponível resulta em `deny` com
reason code interno fechado; nunca se escolhe a hipótese mais adulta.

| Coorte autodeclarada | Evidência obrigatória no instante da decisão | Decisão |
|---|---|---|
| `under_13` | qualquer sinal ou responsável | `deny_under_13`; produto indisponível |
| `13_15` ou `16_17` | sinal de menor coerente `server_verified` e fresco; guardian link verificado e fresco; assurance 18+ fresca do responsável; consentimento social do responsável vinculado ao link/policy; flags de menor ativas | `permit_minor` somente se tudo passar; caso contrário `deny` |
| `18_plus` | sinal 18+ coerente `server_verified` e fresco; documentos e consentimento próprios na policy atual; flags de adulto ativas | `permit_adult` somente se tudo passar; caso contrário `deny` |
| desconhecida, `not_shared`, `unsupported`, `verification_required`, `error` ou sinal conflitante | não há assurance suficiente | `deny_assurance_unavailable_or_conflicting` |
| transição 17→18 | assurance/consentimento anterior de menor | `deny_reverification_required` até assurance 18+ e aceite próprio novos |

Na versão atual do repositório, a Phase A não produz `server_verified` por
design. Portanto, o resultado esperado dessa matriz é `deny` tanto para adulto
quanto para menor, sem exceção por ambiente, entitlement ou feature flag.

## 5. Arquitetura de execução

```text
Mobile hostil
  | HTTPS: perfil, amizades, fila, ranking, token
  | WSS: auth inicial, eventos e comandos do duelo
  v
API /api/v1 ---------> PostgreSQL canônico
  |                         | estado, idempotência, ledger, outbox, auditoria
  | token curto             v
  v                    Worker durável
Realtime <-----------> Redis HA
  | presença/fan-out      presença, fila quente, rate limit, revogação
  +--------------------> PostgreSQL (transações autoritativas)
```

- **API:** capabilities, recursos sociais, tokens realtime e leituras.
- **Realtime:** conexões, protocolo de sala e comando online; não mantém verdade
  apenas em memória.
- **Worker:** deadlines, fechamento de rounds/partidas, projeção de ranking,
  detecção assíncrona e moderação/DSR. Jobs são idempotentes e fenced.
- **PostgreSQL:** grafo, snapshots, respostas, resultados, ledger, casos e
  sequência durável de eventos.
- **Redis:** conexão/presença com TTL, fila quente, pub/sub/stream de fan-out,
  rate limit e cache de leaderboard. Redis indisponível impede nova competição.
- **Admin/moderação:** aplicação separada, MFA/RBAC e auditoria; sua ausência
  bloqueia o rollout público.

## 6. Schema-alvo expand-only

Nenhuma migration abaixo é autorizada por este documento. A implementação deve
seguir `expand -> dual read/write -> backfill auditado -> switch -> contract`
em releases separados. Constraints pesadas entram `NOT VALID`, são auditadas e
depois validadas. Não renomear/apagar coluna no mesmo release que muda o leitor.

### 6.1 Perfil, avatar e convite

1. `social_avatar_catalog`
   - `id`, `key`, asset version/hash, estado `active|retired`, revisão e datas;
   - `key` única e assets sem upload do usuário.
2. Expandir `social_profiles`
   - `public_id uuid` único e aleatório para contratos externos;
   - `pseudonym_normalized`, `pseudonym_source=generated_v1`,
     `moderation_status`, `avatar_catalog_id`, `status`, `state_version`,
     `created_at`;
   - unique em `pseudonym_normalized`; tamanho/formato fechado; nenhum e-mail,
     telefone, URL, `@` ou campo livre;
   - manter colunas legadas durante dual-read; `discoverable` não é consultado.
3. `social_pseudonym_events`
   - histórico append-only de geração, rotação, remoção por moderação e versão
     do léxico; snapshots retidos conforme caso, não para descoberta.
4. `social_invite_codes`
   - `id`, `owner_user_id`, `code_digest`, `status`, `created_at`, `expires_at`,
     `revoked_at`, `use_count` limitado e `version`;
   - digest HMAC com chave do Secret Manager, unique; raw com pelo menos 80 bits
     de CSPRNG nunca persiste nem aparece em log/cache/analytics;
   - um código ativo por perfil por partial unique index; código é mostrado uma
     vez e, se perdido, deve ser rotacionado;
   - os convites atuais em claro são revogados/rotacionados no cutover. A
     coluna legada só é removida em fase contract posterior.

### 6.2 Relacionamentos e bloqueios v2

Criar `social_friendships_v2` em paralelo:

- `id` opaco, `user_low_id`, `user_high_id`, `requested_by_user_id`;
- check `user_low_id < user_high_id`, requested_by pertence ao par e unique do
  par canônico, eliminando A→B/B→A;
- estados fechados `pending|accepted|rejected|cancelled|removed|blocked`;
- `state_version`, actor/timestamps de cada transição e reason code interno;
- índices de inbox/outbox/amizade por participante e estado;
- `social_friendship_events` append-only para reconstrução/auditoria.

Criar `social_blocks_v2` dirigido:

- `id`, blocker, blocked, `active|revoked`, timestamps e versão;
- check de usuários distintos e unique partial para um bloqueio ativo por
  direção; índices para consultar os dois sentidos antes de qualquer contato;
- o motivo não é mostrado ao alvo. Eventos de moderação ficam em tabela
  segregada, não no grafo comum.

Ativar bloqueio cancela solicitações, remove amizade, cancela filas/convites
diretos e grava outbox na mesma transação. Partida não iniciada é cancelada.
Em partida unranked ativa, a interação termina como `no_contest`.

Em partida **ranked** ativa, o efeito de segurança também é imediato, mas o
bloqueio não escolhe o vencedor nem apaga o que já foi recebido. Sob lock da
partida/round, a transação:

1. encerra os dois leases/controladores com motivo público genérico e impede
   novos frames, pareamento ou contato entre as contas;
2. congela snapshot, respostas aceitas, sequência de eventos, deadlines,
   result hash candidato e ledger ainda pendente;
3. muda a partida para `under_review`, o resultado para `provisional` e cria
   `risk_state=block_conflict`/case link; nenhum delta entra no ranking;
4. emite aos dois participantes somente `match_interrupted_under_review`, sem
   informar que houve bloqueio, quem bloqueou, sua direção ou motivo.

A adjudicação versionada, feita por worker/política aprovada ou moderador com
RBAC e evidência independente, fecha em exatamente um outcome:
`no_contest` (sem ledger), `forfeit` (apenas se prova independente do ato de
bloquear demonstrar abandono/fraude previsto na rules version) ou `normal`
(somente quando o resultado já era autoritativamente determinado e o bloqueio
não o afetou). O simples ato ou a direção do bloqueio nunca fundamenta
`forfeit`. Eventos repetidos, recíprocos ou estrategicamente correlacionados
geram risk hold crescente, cooldown/fila separada e revisão de ambos os lados,
sem punição automática irreversível e sem revelar o bloqueador ao oponente.

### 6.3 Idempotência e visibilidade

`social_operations` registra:

- `(actor_user_id, idempotency_key)` unique;
- operation enum, canonical request hash, status, resource ID e projeção de
  resposta sanitizada;
- `request_hash_key_version`, para verificar retries durante rotação de chave;
- mesma chave/mesma requisição canônica reproduz a resposta; mesma chave/outro
  preimage recebe `409`; retenção definida sem guardar invite raw.

O `canonical request hash v1` não depende de whitespace, ordem de propriedades,
locale ou serialização do framework. Depois de validar o schema fechado, ele
normaliza recursivamente toda string para Unicode NFC e, antes de aplicar
defaults internos, substitui todo segredo de uso único
(por exemplo `inviteCode`) por `inviteCodeDigest` e
`inviteCodeDigestKeyVersion`, e descarta o raw. Para convite, o código já
validado é ASCII uppercase sem separador e o digest é
`lowercase_hex(HMAC-SHA-256(K_invite_vN, preimage_invite))`, onde
`preimage_invite` são os bytes UTF-8 exatos, com LF final:

```text
domain=iaaprova.social.invite
version=1
code=<ASCII uppercase validado>
```

Em seguida serializa o body transformado com RFC 8785/JCS e constrói **estes
bytes UTF-8 exatos**, com LF (`0x0A`) entre linhas e também no final, sem BOM:

```text
domain=iaaprova.social.request
version=1
operation=<operation enum ASCII>
actor_user_id=<UUID lowercase no formato 8-4-4-4-12>
method=<método HTTP uppercase ou WS_COMMAND>
route_template=<template registrado, sem query livre>
resource_scope=<ID opaco canônico ou ->
body_jcs_b64u=<Base64URL sem padding dos bytes UTF-8 do JCS>
```

`request_hash = lowercase_hex(HMAC-SHA-256(K_request_vN, preimage))`. A chave de
idempotência não integra o preimage porque já é a chave única da operação; seu
valor também não vai a logs. `K_request_vN` vem do Secret Manager, tem versão
persistida e é distinta da chave HMAC de convite. Vetores dourados cobrem
Unicode/NFC, null versus ausente, arrays, rota com path param, segredo
transformado e rotação. O mesmo algoritmo é usado por
`duel_command_inbox`; nenhuma implementação local cria um hash alternativo.

`social_visibility_edges` não é necessário no MVP: a visibilidade é provada por
join com solicitação, amizade, ranking ou participação em duelo. Nenhuma rota
aceita UUID interno ou perfil arbitrário sem esse vínculo.

### 6.4 Matchmaking e duelo v2

Criar as tabelas canônicas abaixo:

- `duel_rules_versions`: produto/exam version, distribuição de matérias,
  número/duração de rounds, scoring, elegibilidade de conteúdo,
  `ranked_eligible_per_iso_week`, `free_total_duels_per_iso_week`,
  `pro_unranked_practice_per_iso_week`, regra de janela/restituição, status,
  canonical hash e publicação imutável;
- `duel_matchmaking_tickets`: owner, product, mode `friend|ranked_random`, rules
  version, estado, rating bucket, alvo amigo opcional, capability snapshot,
  timestamps, expiry e version; um ticket ativo por usuário/mode;
- `duel_matches_v2`: season/rules/snapshot hash, estado, deadlines,
  `state_version`, finish reason, result/result hash, risk state e audit cols;
- `duel_participants_v2`: match, seat, `user_id` nullable para DSR,
  public profile snapshot mínimo, ready/connection state, capability version,
  score server-side, state, `connection_epoch`, controller connection digest,
  device binding e lease expiry; um usuário em no máximo uma participação
  ativa por partial unique index;
- `duel_question_snapshots`: question version elegível, round, ordem e ordem de
  opções por seat; nenhum cliente escolhe IDs;
- `duel_rounds_v2`: sequência, `pending|open|closed`, open/deadline/closed pelo
  relógio do banco e state version;
- `duel_answers_v2`: participante, round, selected option, received_at,
  correção calculada e request hash; unique da primeira resposta válida por
  participante/round;
- `duel_command_inbox`: unique `(match_id, participant_id, client_command_id)`,
  command type, request hash/key version e ACK reproduzível;
- `duel_match_events`: `(match_id, server_seq)` unique, evento durável mínimo
  para reconnect; payload referencia recursos, não replica gabarito/texto;
- `realtime_token_grants`: `jti_digest` unique, user/participant/match,
  auth-session/device binding, capability decision/policy, audience/purpose,
  estado fechado `issued|redeemed|revoked|expired`, issued/expiry/redeemed/
  revoked timestamps, `redeemed_connection_digest`, `connection_epoch` e
  state version. Nunca persiste JWT/raw token; grants expirados têm retenção
  curta para provar anti-replay;
- `duel_deadline_jobs`: deadline, lease owner/token/expiry, attempts e estado;
  fencing impede worker vencido de fechar estado.

Máquina de estado da partida:

```text
queued -> matched -> ready -> active -> completed
                    |          |  \-> under_review
                    |          |        \-> completed(normal)|forfeited|no_contest
                    |          \----> no_contest
                    \---------------> cancelled|expired
```

Cada transição possui lista explícita de predecessores, incrementa
`state_version`, valida capability/bloqueio e usa `clock_timestamp()` dentro da
transação. Estado impossível ou hash divergente falha fechado e gera alerta.
Uma partida ranked em `under_review` preserva `provisional_result_hash`,
`adjudication_policy_version`, case/risk link e ledger pendente; somente a
transição adjudicada pode publicar/descartar o delta.

### 6.5 Temporadas e ranking

Expandir/substituir de forma compatível `ranking_seasons` com:

- scope (produto, exam/rules version), status fechado
  `draft|scheduled|active|closing|published|cancelled`;
- rules version/hash, publicação, janela e timestamps de fechamento;
- prevenção transacional/constraint de temporadas ativas sobrepostas no mesmo
  scope; regras não mudam após `scheduled`.

Adicionar:

- `ranking_score_ledger`: append-only, unique por season/match/participant,
  delta/outcome, result hash, risk status e adjustment reference;
- `ranking_entries`: projeção por season/participante com rating/pontos,
  vitórias/empates/derrotas, partidas válidas, version e last ledger sequence;
- `ranking_adjustments`: decisão auditada que compensa um ledger anterior; não
  edita silenciosamente o resultado histórico.

Rank público usa apenas public profile ID, pseudônimo seguro, avatar, posição e
métricas aprovadas. Empates de desempenho compartilham posição; o cursor opaco
usa ID estável só para paginação, nunca velocidade de rede como desempate.

### 6.6 Denúncia e moderação

Manter `/reports` legado para questão durante a migração e criar
`social_reports_v2` tipado para `user|duel`:

- target user public ID ou duel ID, com exactly-one check e FK;
- reportante nullable/`ON DELETE SET NULL`, subject hash segregado quando a
  retenção legal exigir; nunca cascade destrutivo de caso aberto;
- reason enum, nota opcional curta sem URL/anexo, snapshot server-side mínimo,
  request hash, status e policy version;
- target deve ter sido visível ao reportante por relacionamento/ranking/duelo;
- reportar a si mesmo falha sem revelar existência externa.

Adicionar `moderation_cases`, `moderation_case_events` e
`moderation_decisions` com RBAC, dual control para sanção grave, reason codes,
evidence hashes, legal hold, prazo, recurso e audit log. Texto livre não vai a
logs, métricas ou Redis.

## 7. Contratos `/api/v1`

OpenAPI continua fonte única, com schemas `additionalProperties: false`, IDs
opacos e RFC 9457. Toda mutação abaixo exige `Idempotency-Key`, exceto DELETE
que também deve ser idempotente e pode aceitar a chave para replay auditável.

### 7.1 Perfil e convite

| Método e path | Semântica |
|---|---|
| `GET /social/summary` | resumo próprio, sem raw invite code |
| `POST /social/profile` | cria perfil server-generated com avatar allowlisted |
| `GET /social/profile` | lê somente o próprio perfil/capabilities sanitizadas |
| `PATCH /social/profile` | troca apenas avatar allowlisted; ETag/state version |
| `POST /social/profile/pseudonym-regenerations` | gera novo pseudônimo seguro, com cooldown |
| `POST /social/invite-codes` | revoga anterior, cria e devolve raw uma única vez |

Não existe `GET /users`, busca por pseudônimo/código ou endpoint de presença.

### 7.2 Amizade, bloqueio e denúncia

| Método e path | Semântica |
|---|---|
| `POST /social/friend-requests` | recebe raw code; sempre responde `202` sanitizado |
| `GET /social/friend-requests?direction=...` | inbox/outbox próprios com cursor opaco |
| `POST /social/friend-requests/{id}/accept` | somente destinatário, par ainda elegível |
| `POST /social/friend-requests/{id}/reject` | somente destinatário; resposta não notifica motivo |
| `DELETE /social/friend-requests/{id}` | cancela solicitação própria pendente |
| `GET /social/friends` | lista própria, paginada, sem grafo/idade/presença |
| `DELETE /social/friends/{id}` | remove amizade de forma idempotente |
| `POST /social/blocks` | bloqueia perfil previamente visível e aplica efeitos atômicos |
| `GET /social/blocks` | lista mínima de bloqueios criados pelo titular |
| `DELETE /social/blocks/{id}` | revoga bloqueio; não restaura amizade/convite |
| `POST /social/reports` | protocolo tipado, evidência anexada pelo servidor |

Código inexistente, expirado, próprio, bloqueado ou rate-limited não revela
qual condição ocorreu: `202` com envelope/tamanho equivalentes e processamento
interno. Só uma solicitação realmente criada aparece para o destinatário.
Recurso que não pertence ao principal responde `404`, não `403` revelador.

### 7.3 Temporada, fila e duelo

| Método e path | Semântica |
|---|---|
| `GET /social/seasons/current?productId=...` | temporada publicada/ativa no scope autorizado |
| `GET /social/seasons/{id}/ranking?cursor=...` | leaderboard pseudônimo, estável e paginado |
| `GET /social/me/ranking?seasonId=...` | posição própria e estado provisional/final |
| `POST /social/matchmaking-tickets` | entra online em fila compatível ou desafia amigo |
| `GET /social/matchmaking-tickets/{id}` | estado próprio sem identidade prematura do par |
| `DELETE /social/matchmaking-tickets/{id}` | cancela ticket ainda não consumido |
| `GET /social/duels/{id}` | snapshot autorizado/reconnect/result próprio |
| `POST /social/duels/{id}/realtime-tokens` | token curto, single-purpose, single-use |
| `POST /social/duels/{id}/ready` | readiness idempotente; não inicia por relógio cliente |

Ready pode usar HTTPS; respostas competitivas fluem pelo protocolo realtime.
Se futuramente houver fallback HTTPS, ele deve usar o mesmo command inbox e
deadline, nunca uma regra paralela.

## 8. Idempotência, locks e concorrência

### 8.1 Ordem de locks

Para evitar deadlock e dupla relação:

1. `social_operations` pelo ator/chave;
2. usuários do par ordenados por UUID interno;
3. relação/bloqueio canônico;
4. ticket/match/round;
5. ledger/outbox/audit.

Convite é localizado pelo HMAC digest e bloqueado antes de criar relação. O
servidor relê capability e blocks depois de adquirir os locks. Uma solicitação
concorrente reversa converge para a mesma linha canônica; não surgem duas
amizades.

### 8.2 Matchmaking

- Redis sugere pares, mas uma transação PostgreSQL bloqueia tickets ordenados,
  revalida produto/rules/capability/block/cota e cria uma única partida.
- Claim Redis carrega fencing token; consumidor antigo não confirma ticket.
- Unique partial index impede dois tickets/duelos ativos por usuário.
- Falha após commit é recuperada pelo outbox; falha antes do commit não publica
  match em Redis.

### 8.3 Comandos e deadlines

- Cada comando contém `clientCommandId` UUID e a state/round version observada.
- O servidor bloqueia match/round/participante, lê `clock_timestamp()`, valida
  estado, option membership e primeira resposta, persiste e só então envia ACK.
- Atraso é decidido por `received_at` do servidor. Timestamp do dispositivo não
  amplia prazo.
- Replay com o mesmo canonical request hash retorna o ACK original. Mesmo ID
  com preimage divergente vira risco+`409`/erro de protocolo.
- Deadline job e reconnect podem concorrer: `state_version`, row lock e lease
  fenced garantem um único fechamento/result hash.
- Resultado já finalizado é reproduzido e verificado; divergência entre
  respostas, snapshot, ledger e hash é corrupção fail-closed.

## 9. WebSocket seguro e reconexão

### 9.1 Emissão e autenticação

1. App autenticado chama o endpoint de token com match ID e device binding.
2. API reavalia `social_competition`, ownership, participant state e sessão.
3. Emite token com audience do realtime, user/participant/match, device,
   `jti`, capability decision/version e expiração de resgate de 60–120 s.
4. Na mesma transação, persiste em PostgreSQL um
   `realtime_token_grants` `issued` com `jti_digest` e bindings. Redis pode
   receber uma cópia com TTL para rejeição antecipada, nunca para conceder uso.
5. Cliente abre `wss://` e envia token no primeiro frame autenticador ou
   subprotocol aprovado. Nenhum evento da sala sai antes do ACK de auth.

O resgate verifica assinatura/audience/expiry e todos os bindings e executa uma
transação PostgreSQL única: bloqueia grant e participante, revalida capability,
sessão, device, revogação e match, então realiza a transição condicional
`issued -> redeemed` somente se `expires_at > clock_timestamp()`. A mesma
transação incrementa `duel_participants_v2.connection_epoch`, grava o digest
da nova conexão/lease e o epoch no grant. ACK de auth só sai depois do commit.
Dois resgates concorrentes do mesmo `jti` produzem exatamente um vencedor;
zero rows atualizadas significa replay/expirado/revogado e fecha o socket.

PostgreSQL é a autoridade de uso único. `SET NX`/cache no Redis apenas reduz
carga e pode ser apagado a qualquer momento: sucesso no Redis jamais substitui
o update canônico, falha do PostgreSQL fecha o resgate e falha/restart/failover
do Redis não torna um grant `redeemed` reutilizável. Restart do realtime relê o
grant e o epoch persistidos; restore/failover de banco segue RPO e, até a
reconciliação, revoga grants emitidos antes do recovery point em vez de aceitar
replay. Token/JWT raw não aparece em query string, banco, logs, analytics ou
crash report.

Após resgate, a conexão tem lease curto, reauth periódico e revogação push.
Capability é revalidada no máximo a cada poucos minutos e antes de toda
transição competitiva. Revogação de consentimento, guardian, sessão, device ou
integrity fecha o socket imediatamente; cache nunca estende a validade.

### 9.2 Um controlador e sequência durável

- Um participante pode observar somente seu match. O
  `connection_epoch` global por participante é durável em PostgreSQL, monotônico
  e incrementado atomicamente no resgate de cada novo grant. Redis só o acelera.
  Todo comando mutável compara, dentro da transação autoritativa, o epoch e o
  connection digest apresentados com a linha atual; socket antigo após
  reconnect/failover recebe `stale_connection` e não responde.
- Todo evento tem `serverSeq` monotônico por match e schema version.
- Cliente confirma `lastServerSeq`; reconnect pede resume a partir dele.
- Se os eventos ainda existirem, servidor reproduz em ordem. Se a janela
  expirou, devolve snapshot autoritativo sanitizado e a sequência corrente.
- ACK só é enviado após persistência canônica. Pub/sub perdido é recuperado por
  event log; evento duplicado é ignorado pela sequência.
- Heartbeat/presença têm TTL. Desconexão não pausa deadline nem transforma
  resposta local em válida.

Frames aceitos são allowlist (`auth`, `resume`, `ready`, `answer`, `ack`,
`heartbeat`), com tamanho máximo, schema fechado e rate limit. Não existe frame
de chat, reação, texto livre, perfil, score ou admin.

### 9.3 Falhas

- Redis indisponível: recusar fila/token novo; nunca reutilizar grant por falta
  do cache. Partidas que perderem capacidade de sincronização encerram conforme
  regra `no_contest`, sem inventar vencedor.
- Realtime restart: reconectar e reidratar do PostgreSQL/event log.
- Reconnect storm: backoff com jitter no cliente e admission control no edge.
- Capability expirada: fechar com motivo genérico; oponente vê apenas que a
  partida foi interrompida.
- Partição/latência: não aceitar client clock, não aumentar prazo por seat e não
  usar velocidade como desempate.

## 10. Fairness, conteúdo e antifraude

### 10.1 Seleção e correção

- Ambos recebem as mesmas question versions na mesma sequência. A ordem de
  opções pode ser determinística por seat e fica no snapshot imutável.
- Só entram itens publicados com licença, provenance, revisão, solution e
  direitos válidos para aquela product/exam/rules version.
- Se não houver pool elegível suficiente para ambos, o match não começa. Não
  recorrer ao banco em quarentena nem repetir mocks.
- O round fecha quando ambos responderam ou no deadline. Correção e score usam
  snapshot do servidor; feedback/gabarito só depois do fechamento.
- Acerto é o critério de desempenho. Latência de rede não desempata; igualdade
  resulta em empate conforme rules version.

### 10.2 Ranking sem pay-to-win

O Pro oferece duelos de prática unranked ilimitados, mas a quantidade de
partidas que altera ranking é idêntica para Free e Pro. A rules version inicial
registra, de forma imutável e server-authoritative:

- `ranked_eligible_per_iso_week=3` para **Free e Pro**;
- `free_total_duels_per_iso_week=3`;
- `pro_unranked_practice_per_iso_week=null` (`null` significa sem cota do plano,
  ainda sujeito a antifraude/rate limit);
- janela ISO em UTC, segunda 00:00 até a segunda seguinte; tentative consumida
  somente quando o match inicia, com idempotência e restituição definida para
  `cancelled|no_contest` sem culpa do participante.

Esses valores e a regra de restituição entram no canonical hash de
`duel_rules_versions`, no ticket e no snapshot da partida. Não podem mudar por
entitlement ou remote config durante a temporada. Alterá-los exige nova rules
version, aprovação de produto e publicação futura; Pro nunca compra mais chances
ranked.

Somente partida `completed`, sem block conflict **não adjudicado**, com result
hash válido e risk state liberado gera ledger. Resultado suspeito fica
`provisional/under_review`.
Correção de fraude gera ajuste compensatório auditado e permite recurso; não se
reescreve o histórico.

### 10.3 Sinais e limites antifraude

Monitorar, sem decisão automática irreversível por um único sinal:

- múltiplas contas/dispositivos, sessões simultâneas e troca de integridade;
- respostas impossivelmente rápidas, padrões idênticos, collusion recorrente,
  pareamento dirigido, abandono seletivo e win trading;
- scraping sequencial, enumeração de códigos, replay de comando e socket bot;
- anomalias de score/result hash/ledger e uso após revogação.

Medidas graduais: rate limit, cooldown, fila separada, resultado provisional,
hold de ranking, challenge de integridade, revisão e sanção. Pentest/fraude
somente em staging autorizado, com dados sintéticos.

## 11. Anti-enumeração e rate limits

Limites são server-side, combinam conta, device binding e IP/ASN com cuidado
para NAT e acessibilidade. Respostas incluem `Retry-After`; detalhes internos
não são expostos. Config inicial a validar em staging:

| Ação | Limite inicial e constraint |
|---|---|
| gerar/rotacionar convite | 5/dia; um ativo |
| resolver código | 5/min e 20/dia por conta/device; limite adicional por IP |
| criar solicitação | 20/dia; 50 pendentes; 250 amizades |
| regenerar pseudônimo | 3/30 dias, salvo moderação |
| trocar avatar | 10/dia |
| bloquear | 30/dia; ação de segurança nunca depende de target lookup público |
| denunciar | 10/dia com canal de suporte para excedente legítimo |
| criar/cancelar ticket | 6/min, 30/h, um ativo |
| conexão realtime | limites globais de 5 devices/2 sessões; um controlador por match |
| frame/command | 10/s, burst 20; `answer` continua limitado a um por round |

Body HTTP/frame tem limite de 4 KiB salvo contrato menor. Cursor é opaco,
expira e carrega scope. Pseudônimo não é searchable. Leaderboard não oferece
endpoint de paginação arbitrária suficiente para enumerar toda a base sem
limites e detecção de scraping.

## 12. Moderação, DSR e retenção

### 12.1 Fluxo de segurança

1. Block produz efeito síncrono e protocolo local.
2. Report grava apenas categoria, nota mínima e snapshot server-side do
   pseudônimo/match/result hashes necessários.
3. Triage separa abuso, ameaça, exploração de menor, fraude e conteúdo.
4. Moderador com RBAC decide; sanção grave exige revisão independente.
5. Afetado recebe motivo geral e canal de recurso quando isso não prejudicar
   segurança/investigação.
6. Ameaça crível ou exploração de menor segue o runbook jurídico, sem promessa
   de sigilo absoluto.

Não há conteúdo de chat a preservar. Evidence não inclui answer key além do
estritamente necessário ao time antifraude com acesso segregado.

### 12.2 Exportação

Exportar do titular:

- perfil/pseudônimo/avatar e histórico de alterações permitido;
- amizades/bloqueios somente por papel e estado, sem UUID/pseudônimo de terceiro;
- participações, resultado/ranking próprios e **cada resposta do titular**
  como round, opção apresentada selecionada, instante de recebimento e estado
  aceita/rejeitada; sem stem completo, gabarito, `isCorrect`, racional, resposta,
  score por round ou identidade do oponente;
- denúncias próprias com target de pessoa redigido e sem evidência interna;
- decisões que o afetaram, nos limites jurídicos.

Não exportar invite raw/digest, token, grafo, presença, regra antifraude,
question key, resposta alheia ou identificador interno.

### 12.3 Classes propostas de retenção

As classes abaixo são parâmetros de engenharia para impedir retenção
indefinida; não são parecer jurídico. Base legal, prazo, transparência,
necessidade e legal hold exigem sign-off documentado de jurídico/DPO antes da
primeira migration com dados reais:

| Classe | Prazo proposto | Finalidade/base legal candidata, ainda não aprovada |
|---|---|---|
| `SOC-R0` referência imutável | versão publicada + 5 anos | accountability, execução das regras e exercício regular de direitos; sem vínculo direto ao titular |
| `SOC-A30` conta/grafo | conta ativa; eliminação em até 30 dias após DSR/encerramento | execução contratual e interesse legítimo de operação/segurança |
| `SOC-E30` efêmero terminal | estado terminal + 30 dias | idempotência, suporte e segurança operacional |
| `SOC-T7` anti-replay | expiry/revogação + 7 dias | segurança, prevenção de replay e exercício regular de direitos |
| `SOC-C90` competição | publicação/cancelamento da temporada + 90 dias | execução das regras, recurso e integridade competitiva |
| `SOC-I180` assurance | terminal/revogação + 180 dias; proof cifrado Google no máximo 5 min | segurança, prevenção de fraude e comprovação de consentimento/capability |
| `SOC-M2Y` moderação/risco | encerramento do caso + 2 anos | obrigação legal/regulatória quando aplicável e exercício regular de direitos |

`SOC-M2Y` não autoriza conservar tudo: somente evidência necessária,
segregada e vinculada a caso. Legal hold é individual, tem autoridade, motivo,
escopo, início, revisão e expiração; nunca é uma flag eterna ou global.

### 12.4 Matriz DSR tabela por tabela

Na coluna "exclusão", `hard delete` ocorre somente depois de revogar acesso e
preservar o tombstone mínimo necessário para impedir replay/restauração. IDs de
terceiros nunca aparecem na resposta do titular. Referências de moderator,
reviewer ou actor são redigidas ou substituídas por papel.

| Tabela/campos cobertos | Exportação/redaction | Exclusão ou pseudonimização | Classe/base/hold |
|---|---|---|---|
| `social_avatar_catalog` | somente key/asset do avatar usado; sem reviewer | catálogo não pessoal permanece; reviewer é pseudonimizado ao sair | `SOC-R0`; sem hold do titular |
| `social_profiles` incluindo `public_id`, pseudonym, avatar, status/version/datas e legados | próprio perfil; sem UUID interno/invite legado | desativa; hard delete do vínculo e das colunas legadas em até 30 dias; snapshots competitivos seguem linha própria | `SOC-A30`; hold somente via case link segregado |
| `social_pseudonym_events` | eventos próprios permitidos, sem léxico interno/moderador | hard delete; evento necessário a caso é copiado minimamente e pseudonimizado na evidence | `SOC-A30` ou `SOC-M2Y` no case |
| `social_invite_codes` incluindo digest/status/usage/version | apenas datas/estado, nunca raw/digest | revoga imediatamente; remove owner; digest vira suppression até expiry e é apagado em até 30 dias | `SOC-E30`; sem hold salvo incidente documentado |
| `social_friendships_v2` | papel/estado/datas do titular; par redigido | hard delete do grafo nos dois sentidos | `SOC-A30`; evento abusivo vai ao case, não segura o grafo inteiro |
| `social_friendship_events` | transições próprias sem actor/terceiro | hard delete; cópia mínima pseudonimizada somente em case | `SOC-A30` ou `SOC-M2Y` no case |
| `social_blocks_v2` | papel de bloqueador e estado, sem blocked ID/motivo interno | bloqueio é revogado logicamente após cortar interação; grafo é hard deleted, com suppression bilateral não reversível pelo restore | `SOC-A30`; `SOC-M2Y` só se evidência de case |
| `social_operations`, inclusive request hash/key version/response sanitizada | tipo, data, status e recurso próprio; sem hash/chave/payload de terceiro | hard delete após janela; suppression preserva somente digest não reversível até expirar retry | `SOC-E30`; hold somente para operação ligada a case |
| `duel_rules_versions` | versão/regras públicas aplicadas | permanece imutável; author/reviewer redigidos | `SOC-R0`; não é dado do titular |
| `duel_matchmaking_tickets` | próprio produto/mode/status/datas; target/par/bucket exatos redigidos | cancela e hard delete; estatística agregada deve ser não identificável | `SOC-E30`; hold apenas via risk case segregado |
| `duel_matches_v2` incluindo snapshot/result/risk/adjudicação | participação, finish/outcome/result próprios; sem opponent, seed, risk rule ou hashes internos | remove vínculos diretos e pseudonimiza match; preserva integridade do resultado até fim da classe | `SOC-C90`; `SOC-M2Y` apenas se case/hold válido |
| `duel_participants_v2`, inclusive profile snapshot, score, capability e connection fields | somente seat/estado/score final próprios; sem outro seat, UUID, capability internals ou connection digest | `user_id=null`, snapshot público substituído por label neutro, connection/device fields apagados e participant ID rotacionado na export projection | `SOC-C90`; case segregado pode usar `SOC-M2Y` |
| `duel_question_snapshots` | round e referência curta da questão apresentada quando licenciada; sem stem integral, option map secreto, key ou seat alheio | permanece sem vínculo direto; option permutation do titular é eliminada ao pseudonimizar participante | `SOC-C90`/`SOC-R0` para auditoria da rules version |
| `duel_rounds_v2` | número/estado/deadlines do duelo próprio | permanece ligado ao match pseudonimizado | `SOC-C90`; hold herda somente do case do match |
| `duel_answers_v2` | **resposta do titular**: round, opção que lhe foi apresentada, `received_at` e aceita/rejeitada; sem key, `is_correct`, resposta/tempo/score do oponente | após entrega, remove `selected_option` e correction fields ou hard delete; case antifraude retém somente digest/sinal necessário, sem gabarito | `SOC-C90`; excepcional `SOC-M2Y` no case |
| `duel_command_inbox` | tipo/data/ACK sanitizado dos comandos próprios; sem hash/frame | hard delete; digest de replay sem user pode persistir até a janela fechar | `SOC-C90` (ou `SOC-E30` para match não iniciado) |
| `duel_match_events` | timeline sanitizada visível ao titular; sem payload do oponente/key | payload pessoal redigido; log mínimo permanece no match pseudonimizado | `SOC-C90`; evento de case é copiado para `SOC-M2Y` |
| `realtime_token_grants` | somente issued/expiry/redeemed/revoked do próprio acesso; sem `jti`, digest, session/device/capability IDs | revoga; zera bindings pessoais após encerrar sockets; mantém `jti_digest` sem user somente para anti-replay e apaga no prazo | `SOC-T7`; hold apenas por incidente de auth documentado |
| `duel_deadline_jobs` | não exportado separadamente; estado refletido na timeline | hard delete ao encerrar janela operacional; lease owner/token nunca é dado do titular | `SOC-E30`; sem hold direto |
| `ranking_seasons` e campos expandidos | regras/estado públicos da temporada | permanece imutável; reviewer/actor redigidos | `SOC-R0`; sem hold do titular |
| `ranking_score_ledger` | deltas/outcome do titular sem match/opponent/hash interno | participant vira ID pseudônimo não reversível; ledger não é reescrito | `SOC-C90`; adjustment/case pode usar `SOC-M2Y` |
| `ranking_entries` | posição e métricas próprias | remove perfil público e substitui por entrada anônima ou agrega após janela | `SOC-C90`; sem hold direto |
| `ranking_adjustments` | ajuste e motivo geral que afetou o titular; sem moderador/evidência/regra antifraude | actor redigido; participant pseudonimizado; decisão ligada a case segue retenção segregada | `SOC-C90` ou `SOC-M2Y` no case |
| `social_reports_v2` | protocolo/status/categoria da denúncia feita e decisão que afeta o titular; target/evidence/nota interna redigidos | reportante/target `NULL`; subject hash versionado e segregado somente se necessário; nota livre apagada quando não necessária | `SOC-M2Y`; legal hold granular |
| `moderation_cases` | decisão/motivo geral e recurso do titular nos limites jurídicos | remove vínculo direto; usa subject hash controlado; minimiza evidence | `SOC-M2Y`; hold com revisão/expiração |
| `moderation_case_events` | somente eventos comunicáveis, sem equipe/evidence | actor e subject pseudonimizados; texto não necessário apagado | `SOC-M2Y`; herda hold do case |
| `moderation_decisions` | decisão que afeta o titular, motivo geral e canal de recurso | moderator/reviewer redigidos; evidence hashes sem dado excedente | `SOC-M2Y`; herda hold do case |
| `integrity_device_bindings` (0014) | platform/environment/status/datas do próprio device, sem installation digest | revoga imediatamente; remove user e digest ao fim da janela, salvo case | `SOC-I180`; `SOC-M2Y` somente via incidente |
| `app_integrity_keys` (0014), inclusive SPKI/receipt/counter/bundle fields | estado/datas da chave própria, sem key ID, SPKI, receipt, counter ou attestation internals | marca revoked; elimina receipt ciphertext/SPKI/key ID e vínculo pessoal; hash anti-reuso somente até prazo | `SOC-I180`; hold granular por incidente |
| `integrity_challenges` (0014) | purpose/platform/status/datas/outcome geral; sem nonce/proof/request/principal digest, lease ou key binding | expira/revoga; proof ciphertext é apagado em até 5 min; demais bindings/digests são eliminados/pseudonimizados | `SOC-I180`, mas material de prova segue TTL de 5 min; hold não prolonga proof raw |
| `integrity_verifications` (0014) | provider/status/datas/outcome geral/policy; sem envelope/proof/request digest, device ou testing internals | remove vínculos e pseudonimiza registro terminal; digests ficam apenas se incidente documentado | `SOC-I180`; excepcional `SOC-M2Y` via case |
| `platform_age_signals` e novos `verification_id`, assurance/freshness/build/policy/conflict (0014) | faixa/status compartilhados e datas/policy do titular; sem IDs/detalhes de conflito internos | hard delete do perfil/sinal; registro probatório minimizado segue sua classe quando legalmente necessário | `SOC-A30` + verification em `SOC-I180`; requer validação DPO específica de menores |
| `risk_events` usados pelo social | eventos que afetaram o titular em linguagem geral; sem regra/evidence | pseudonimiza ou hard delete; eventos anexados a case são minimizados | `SOC-E30` ou `SOC-M2Y` no case |
| `outbox_events`/dead-letter sociais | não exportar payload técnico; somente efeito de negócio já coberto | suppression impede retry; payload pessoal apagado/criptoapagado após consumo | menor entre classe da origem e `SOC-E30`; hold somente na origem |
| `audit_logs` sociais | eventos de conta comunicáveis, sem actor interno/before-after bruto | actor/subject pseudonimizados, before/after minimizados; trilha de case segregada | `SOC-I180` ou `SOC-M2Y` no case |
| `feature_flags` sociais | não é dado do titular | permanece como configuração, sem coorte identificável no valor | `SOC-R0`; sem hold do titular |
| legados `friendships`, `user_blocks`, `duel_matches_v1`, `duels`, `reports` e invite em `social_profiles` | somente projeção sanitizada equivalente; scores v1 não verificados são rotulados/não exportados como verdade competitiva | dual-read termina com hard delete/pseudonimização e migration contract posterior; `reports` nunca cascade antes de separar caso | mesma classe do sucessor; nenhum legado ganha retenção indefinida |

### 12.5 Exclusão, suppression, backups e prova

Na confirmação de DSR:

- revogar realtime tokens/sessões, remover presença/fila/cache Redis e impedir
  novo match;
- cancelar/no-contest ativos, desativar perfil/código, remover grafo e
  pseudonimizar participações/leaderboard conforme política;
- separar reports/casos sujeitos a retenção/legal hold e remover o vínculo
  direto, preservando apenas subject hash controlado quando justificado;
- propagar suppression marker para retries, outbox, objetos e restore de backup;
- provar contagens/checksums e não concluir se qualquer adapter falhar.

O suppression manifest é durável, versionado e contém somente request ID, hash
controlado do subject, adapters esperados, cutoff e status por adapter. Cada
adapter devolve contagem antes/depois, IDs de classe (não IDs pessoais) e
SHA-256 de um manifest determinístico das ações `deleted|redacted|pseudonymized|
retained_with_hold`. Divergência de contagem/checksum, adapter ausente ou hold
sem autoridade mantém a DSR aberta e alerta operação.

Backups/PITR não são editados retroativamente. A proposta é expirar toda cópia
operacional em no máximo 35 dias; qualquer restore inicia isolado, reaplica o
suppression manifest e as revogações antes de rede/consumidores serem abertos e
executa novamente contagens/checksums. Cópia sob legal hold fica segregada,
criptografada, sem uso operacional, com acesso auditado e descarte ao fim do
hold. Esse prazo, as bases candidatas e cada exceção da matriz dependem de
parecer e sign-off jurídico/DPO; sem isso o rollout social permanece bloqueado.

## 13. Observabilidade e operação

### 13.1 Telemetria permitida

- capability denied por reason code fechado e policy version;
- perfil/convite/amizade/block/report por resultado agregado;
- WebSockets ativos, auth failures, reconnects, connection age, fan-out lag e
  stale epochs;
- queue depth/wait, match state/duration, commands accepted/replayed/rejected,
  deadline lag, no-contest e result hash mismatch;
- ledger/projection lag, provisional/adjustment counts e moderação SLA;
- Redis memory/eviction/failover, PostgreSQL pool/locks/latência, worker lease,
  retry/dead-letter e outbox lag;
- DSR adapter/count/checksum sem dados do titular.

Proibido em logs/traces/métricas: raw invite/token, pseudônimo, UUID de usuário,
faixa etária, guardian, IP completo além do armazenamento de segurança
aprovado, stem/opções/gabarito, selected option, nota de denúncia ou evidence.
Match/report IDs só aparecem em logs restritos e com retenção definida.

### 13.2 Alertas e kill switch

Alertar sobre auth/replay, spike de código inválido, reconnect storm, result hash
divergente, ledger duplicado, atraso de deadline, fila travada, Redis eviction,
dead-letter, report de alto risco e capability aceita sem assurance fresca.

Flags independentes: `social_core`, `social_adults`, `social_minors`,
`friendships`, `realtime`, `duels`, `ranked_duels`. Kill switch server-side
impede novas interações, cancela filas e torna ranking read-only. Block/report
histórico permanecem acessíveis pela capability estreita de segurança.

## 14. Capacidade: 10 mil WebSockets e 5 mil duelos

O gate representa 10 mil clientes autenticados, agrupados em 5 mil partidas de
dois participantes, não 10 mil sockets ociosos. Staging deve reproduzir região,
TLS, edge, Cloud Run, VPC, PostgreSQL e Redis de produção com dados sintéticos.

### 14.1 Perfil mínimo

1. smoke de 100 conexões e 50 partidas;
2. rampa até 10 mil conexões sem thundering herd;
3. 5 mil partidas com ready, rounds, resposta, timeout e conclusão;
4. sustentação por 60 min e soak por 2 h;
5. 20% de reconnect em 60 s, sockets antigos tentando comandar;
6. Redis failover, restart de instância realtime e worker atrasado;
7. block/consent/guardian revocation durante fila e partida;
8. fan-out duplicado/fora de ordem, retry e event-log resume;
9. HTTP em paralelo conforme gate geral de 300/600/1.000 RPS.

### 14.2 Aceitação

- 10 mil sockets autenticados e 5 mil matches ativos sem misturar salas;
- nenhuma resposta aceita perdida/duplicada e um result hash por match;
- 100% dos sockets antigos fenced após reconnect/revogação;
- p95 HTTP ≤300 ms, p99 ≤800 ms e erro inesperado <0,5%;
- ACK end-to-end de comando realtime aceito ou replay idêntico, medido do envio
  do frame pelo cliente de carga até o recebimento do ACK pós-commit: p95
  ≤250 ms, p99 ≤600 ms, erro inesperado <0,5% e zero ACK sem persistência;
- broadcast pós-commit, medido do `committed_at` server-side até o recebimento
  por cada socket autorizado com relógios do harness sincronizados: p95
  ≤350 ms, p99 ≤800 ms, zero entrega cross-room e zero evento perdido após
  resume; duplicata é tolerada somente com o mesmo `serverSeq`;
- reconnect+resume de uma janela ainda retida: p95 ≤2 s e p99 ≤5 s, sem
  ampliar deadline; snapshot fallback tem p99 ≤5 s;
- reconnect recupera sequência/snapshot sem resposta do oponente ou gabarito;
- Redis <70% de memória no perfil aprovado, sem eviction de estado necessário;
- Cloud SQL/connector/pools abaixo de 70% sustentado e sem lock/deadlock crescente;
- deadline/outbox/ledger voltam ao baseline em até 15 min após pico;
- custo por 1 mil partidas é medido; extrapolação linear não vale como teste.

Qualquer corrupção, vazamento entre salas, capability bypass, perda de comando
aceito, split-brain de resultado ou fallback client-side reprova o gate.

## 15. Estratégia de testes

### 15.1 Banco e concorrência real

- A→B/B→A, accept/reject/block/remove concorrentes convergem para um estado;
- code rotation/resolution, limite e replay não enumeram nem duplicam amizade;
- unique partial de ticket/participação e matchmaking concorrente;
- answer vs deadline vs reconnect, worker lease expirado e fencing;
- dois resgates simultâneos do mesmo `jti`, Redis flush/failover e restart do
  realtime aceitam exatamente um controlador; PostgreSQL indisponível fecha;
- resgate e reconnect concorrentes incrementam um único epoch durável e todo
  socket com epoch anterior é rejeitado mesmo após restart;
- finalização/ledger/replay uma vez; result hash reproduzível;
- constraints de enum, par distinto/canônico, timestamps e exactly-one target;
- DSR concorrente com invite/friend/match/report falha fechado e termina limpo.
- DSR percorre cada linha da matriz, exporta a resposta própria sem key/opponent,
  reaplica suppression em restore isolado e confere contagens/checksums.

### 15.2 Contrato e autorização

- OpenAPI, Zod e cliente gerado em paridade;
- BOLA/IDOR em todo ID/cursor, cross-account/cross-match/cross-season;
- target invisível, block em ambos os sentidos e resposta anti-enumeração;
- ausência/expiração/conflito/replay de integrity proof;
- consentimento, policy version, guardian, revogação e transição 18+;
- `social_safety` não abre perfil, ranking, convite ou duelo;
- payload forjado com score/isCorrect/deadline/question é rejeitado/ignorado.

### 15.3 Realtime e fraude

- token em query/reuso/audience errada/device trocado/session revogada;
- dois sockets controladores, frame gigante/desconhecido, seq gap/duplicate;
- reconnect antes/depois do deadline e sem sticky session;
- bot, scraping, win trading, abandono, multiaccount, collusion e ranking replay;
- block no meio de ranked corta interação sem revelar blocker, congela
  snapshot/ledger em provisional e testa adjudicação
  `normal|no_contest|forfeit`; bloqueios repetidos criam hold sem auto-sanção;
- block/report/kill switch no meio do match;
- nenhum answer key/PII em frame, Redis, log, trace ou dead-letter.

### 15.4 Produto e mobile

- iOS/Android físicos: loading, erro, vazio, offline, reconnect e Reduce Motion;
- VoiceOver/TalkBack, texto 200%, contraste AA e foco de evento ao vivo;
- offline informa indisponibilidade e não oferece “enviar depois”;
- convite raw aparece uma vez com aviso; rotação invalida o anterior;
- pseudônimo/avatar não aceitam entrada externa;
- denúncia/bloqueio acessíveis em perfil visível, request, ranking e duelo;
- Free/Pro respeitam a mesma cota ranked e limites de prática contratados.

## 16. Rollout e gates de publicação

### Fase 0 — schema dormente

- migrations expand-only e backfill em staging;
- flags desligadas, sem mobile público, DSR/export atualizado;
- revisão independente de constraints, threat model e contratos.

### Fase 1 — App Integrity e moderação

- builds assinados físicos, consoles e verificação server-side homologados;
- freshness/revogação/guardian testados; capability nunca aceita monitoring;
- console/runbook/SLA de moderação e DSR operacional.

### Fase 2 — equipe interna adulta

- perfis, amizade e block/report com dados sintéticos/contas internas;
- realtime/duelo unranked, sem leaderboard público;
- pentest/fraude e carga parcial.

### Fase 3 — beta adulta

- ramp 1% → 5% → 25% → 100% somente após coortes sem gate crítico;
- ranked em temporada de teste claramente identificada, sem dados fictícios;
- carga integral de 10k/5k e game day.

### Fase 4 — menores 13–17

- apenas após revisão DPO/jurídica específica e E2E de responsável, revogação,
  mudança etária e segurança; flag separada começa em 0%;
- nenhuma liberação por simples remoção do deny atual.

### Fase 5 — loja

- screenshots/textos só mencionam social após implementação, fiscalização e
  build final aprovados;
- Apple/Google data safety, age rating, moderação e deletion paths coincidem
  com captura real de rede/SDK;
- reviewer accounts e instruções usam dados não sensíveis e fluxo real.

## 17. Critérios de pronto

O núcleo social só está pronto para publicação quando:

- todos os gates da seção 1 têm evidência versionada;
- nenhum path aceita `device_reported_monitoring` ou assurance expirada;
- adulto e menor autorizado funcionam; menor sem responsável/revogado falha;
- schema v2 e migrations reais passaram PostgreSQL com concorrência e restore;
- API/realtime/worker/mobile/admin estão implementados, integrados e revisados;
- conteúdo de duelo elegível é suficiente para a rules version publicada;
- 10k WebSockets/5k duelos e os SLOs passaram em staging equivalente;
- pentest/fraude não têm finding crítico/alto aberto;
- DSR, moderação, recurso, retenção e incident response foram ensaiados;
- jurídico/DPO assinaram documentos, bases legais e prazos;
- build público não contém mock, bot, promessa futura ou claim não comprovado.

## 18. Riscos residuais e decisões pendentes

| Risco/decisão | Tratamento antes do código/release |
|---|---|
| App Integrity não comprova identidade civil/idade | manter semântica restrita, responsável e consentimentos; sign-off jurídico |
| política atual bloqueia todo menor | especificar e revisar composição minor+guardian; testes e rollout separado |
| frescor ausente no capability atual | implementar verification record/expiry e decisão pelo relógio do banco |
| pseudônimos abusivos/PII | geração server-side por léxico revisado, rotação e moderação |
| pay-to-win por Pro ilimitado | mesma cota ranked para todos; excedente unranked |
| rede afeta velocidade | não usar latência como desempate; empate explícito |
| Redis/realtime ausentes | não liberar; implementar e provar 10k/5k |
| conteúdo insuficiente/licença expirada | match falha fechado; editorial gate por snapshot |
| DSR vs retenção de denúncia | schema segregado, pseudonimização e prazo assinado por DPO/jurídico |
| legado com scores não verificáveis | quarentena/read-only; zero import para ranking |
| abuso coordenado sem chat | risk hold, ledger compensatório, revisão e recurso |
| custos de 10k conexões | load/cost test real e quotas aprovadas, sem extrapolação otimista |

Este documento não é autoaprovação. A próxima etapa é uma fiscalização
independente do desenho; somente depois devem ser quebrados pacotes autorais de
schema, capability/App Integrity, API, realtime, worker, mobile, moderação e
testes.
