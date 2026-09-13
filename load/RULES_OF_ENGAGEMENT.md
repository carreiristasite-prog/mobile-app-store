# Regras de engajamento — carga em staging

Status atual: **NO-GO para execução**. Este documento é um modelo operacional;
não há janela, infraestrutura de staging nem responsáveis aprovados registrados.

## Autorizações obrigatórias

- [ ] Responsável legal/técnico autorizou por escrito o ambiente e a janela.
- [ ] SRE responsável pelo staging aprovou capacidade dos geradores e alvo.
- [ ] Segurança aprovou dataset, hash e contas exclusivamente sintéticas.
- [ ] Dono do banco confirmou seed descartável e restauração testada.
- [ ] Suporte/operações foi informado; não há usuários reais no ambiente.
- [ ] `BASE_URL` e `STAGING_HOST_ALLOWLIST` foram conferidos por duas pessoas.
- [ ] ID da autorização: `PREENCHER`
- [ ] Janela UTC/BRT: `PREENCHER`
- [ ] Aprovadores: `PREENCHER`

Nunca registrar tokens neste documento. O arquivo externo é injetado no runtime
por cofre/runner protegido e conferido por `SYNTHETIC_DATASET_SHA256`.
O manifesto de autorização também é externo, tem hash conferido, janela máxima de
24 horas e vincula exatamente host, run ID, perfil, alvo, dataset e escopo de
mutação. Ele deve ser emitido/aprovado fora da conta executora.

## Escopo permitido

- Saúde e catálogo público nos perfis RPS aprovados.
- Leituras autenticadas somente nas rotas allowlisted no código.
- Mutações somente no fluxo `seeded-learning-idempotency`, em seed descartável,
  usando 5.000 contas `loadtest-*` e `ALLOW_MUTATIONS=true`.
- Sem billing, webhook, compra, restore, exclusão, exportação, consentimento,
  social, denúncia, admin, scraping ou publicação de conteúdo.
- Sem produção e sem dados, contas, tokens ou IDs de usuários reais.

## Stop imediato

Interromper o ensaio se qualquer item ocorrer:

- host, autorização, dataset ou hash não corresponder ao pacote aprovado;
- tráfego aparecer em produção ou em conta não sintética;
- erro HTTP atingir 1% por 2 minutos ou ultrapassar 5% em qualquer janela;
- p99 ultrapassar 2 segundos por 2 minutos;
- saturação de banco/Redis/API atingir o limite operacional aprovado;
- fila/outbox crescer sem recuperação, réplica atrasar ou orçamento alertar;
- monitoramento, logs seguros ou pessoa de plantão ficarem indisponíveis;
- efeito colateral não previsto, risco de perda de dados ou incidente de segurança.

O comando de interrupção e o canal da pessoa de plantão devem estar abertos
antes do início. Não continuar para “obter o número” após um stop condition.

## Evidência mínima

- hash do commit/build do alvo e dos scripts;
- `TEST_RUN_ID`, perfil, alvo, janela e aprovadores;
- hash do seed/dataset sintético, nunca o conteúdo ou token;
- resumo JSON sanitizado, dashboards e `dropped_iterations`;
- métricas de API, banco, Redis, filas, custo e erros;
- decisão PASS/FAIL/INCONCLUSIVO assinada por executor e fiscal independente;
- registro de restauração/limpeza do seed após o ensaio.

PASS exige p95 <= 300 ms, p99 <= 800 ms, erro HTTP < 0,5%, erro funcional <
0,5% e zero iteração descartada no perfil de chegada. Resultado parcial,
gerador saturado ou observabilidade incompleta é INCONCLUSIVO, não PASS.

## Gate realtime

**NO-GO/skipped:** 10.000 WebSockets não serão testados até existir endpoint
realtime real. Um novo pacote de ROE deverá definir URL, handshake, token de
curta duração, protocolo, mensagens, reconexão, presença, rate limits, métrica
de conexões estabelecidas e limpeza. A mudança precisa de executor e fiscal
independentes. Não adicionar código WebSocket antes desse gate.

## CI

É obrigatório **não executar carga em pull request**. A CI só pode rodar o
validador estático e seus testes locais. Uma execução futura deve ser manual,
usar ambiente protegido, aprovação humana e secrets efêmeros fora do repositório.
