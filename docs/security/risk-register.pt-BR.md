# Matriz de riscos de segurança e fraude

**Status:** riscos inerentes estimados; residual não homologado  
**Escala:** impacto (I) e probabilidade (P) de 1 a 5; `score = I × P`  
**Faixas:** crítico 20–25, alto 12–19, médio 6–11, baixo 1–5

O score não substitui julgamento de impacto em menores, direitos, pagamento ou
exposição sistêmica. Um achado de exploração simples com dado de menor pode ser
elevado pelo responsável de segurança/privacidade. “Existente” abaixo significa
somente evidência estática no repositório, não controle homologado.

| ID | Risco/ativo | STRIDE | I | P | Score | Evidência existente | Gate para reduzir residual | Blockers |
|---|---|---:|---:|---:|---:|---|---|---|
| R-001 | tomada/mistura de conta Clerk | S/E | 5 | 3 | 15 alto | middleware e UUID interno | E2E token expirado/audience/conta trocada; session/device policy; logs | SEC-001, PRIV-001 |
| R-002 | token ou payload sensível no dispositivo/outbox | I/T | 4 | 4 | 16 alto | SQLite transacional v3; allowlist/body fechado; owner por hash; TTL/limites; purge solicitado; web sem fila | lock/build nativo, armazenamento protegido conforme classificação, inspeção de backup e device lab de troca/logout/exclusão/adulteração | SEC-001, PRIV-001 |
| R-003 | bypass Pro ou receipt replay | S/T/E | 5 | 4 | 20 crítico | entitlement server-side, inbox, SKU exato | sandbox Apple/Google/RC, concorrência, refund/grace/reconcile e pentest | BILL-001, SEC-001 |
| R-004 | IDOR/BOLA em learning, guardian, billing ou DSR | S/E | 5 | 3 | 15 alto | ownership em rotas observadas | suite de autorização por endpoint/objeto em PostgreSQL real | SEC-001, DSR-001, MINOR-001 |
| R-005 | gabarito/solução exposto antes da resposta | I | 5 | 3 | 15 alto | DTO público sem chave e correção server-side | contrato + proxy capture + scraping autorizado | SEC-001, RIGHTS-001 |
| R-006 | dupla resposta/replay altera domínio ou score | T/R | 4 | 4 | 16 alto | idempotência/locks/constraints | teste concorrente real com mesma/diferente chave e primeira resposta | SEC-001 |
| R-007 | scraping/bot exfiltra banco e degrada serviço | I/D | 5 | 4 | 20 crítico | quota Free e Armor amplo em projeto | limite IP+conta+rota, attestation monitorada, canário, teste distribuído autorizado | SEC-001, RIGHTS-001 |
| R-008 | fraude de ranking/duelo/multiaccount/collusion | T/R/E | 4 | 4 | 16 alto | social limitado; realtime ausente | servidor autoritativo, anti-replay, risk holds, recurso, testes realtime | SEC-001, MINOR-001 |
| R-009 | menor acessa social/notificação sem responsável | E/I | 5 | 3 | 15 alto | capability gate backend | onboarding mobile, E2E 13–15/16–17/revogação/transição 18 | MINOR-001, CONSENT-001 |
| R-010 | guardian invite interceptado/reusado/race | S/E/R | 5 | 3 | 15 alto | digest/single-use/locks no desenho | PostgreSQL real concorrente, expiração e cross-account E2E | MINOR-001, SEC-001 |
| R-011 | DSR parcial é marcado concluído | R/I | 5 | 4 | 20 crítico | worker falha sem adapter | adapters reais para todos operadores, prova E2E, ledger de backup | DSR-001, PRIV-002, VEND-001 |
| R-012 | export DSR entregue a invasor ou URL duradoura | I/E | 5 | 3 | 15 alto | fluxo assíncrono inicial | reauth, storage privado, URL curta/uso único, revogação e alerta | DSR-001, SEC-001 |
| R-013 | worker duplica/abandona evento; poison queue | T/R/D | 4 | 3 | 12 alto | lease/fencing/retry no código | PostgreSQL concorrente; dead-letter/requeue auditado e alerta | SEC-001, DSR-001, BILL-001 |
| R-014 | segredo em repo/log/tfstate ou IAM excessivo | I/E | 5 | 3 | 15 alto | Secret Manager/KMS/SA separados no Terraform | secret scan histórico, WIF, IAM analyzer, rotação ensaiada | SEC-001, VEND-001 |
| R-015 | dependência/build comprometido | T/E | 5 | 3 | 15 alto | imagens por digest no desenho | lockfile reproduzível, SAST/SCA/SBOM, assinatura/proveniência e policy | SEC-001, PRIV-001 |
| R-016 | log/telemetria vaza token, PII, recibo ou resposta | I | 5 | 3 | 15 alto | redaction parcial e log de URL sem query | canários, busca em logs, SDK inventory e retenção aprovada | PRIV-001, PRIV-002, SEC-001 |
| R-017 | upload admin malicioso ou publicação sem direitos | T/E/I | 5 | 4 | 20 crítico | admin ausente; storage privado no desenho | RBAC/MFA/quatro-olhos, quarentena/scan/hash/licença e audit log | RIGHTS-001, SEC-001 |
| R-018 | indisponibilidade/ataque de custo excede escala | D | 4 | 4 | 16 alto | HA/PITR/budgets/Armor no Terraform | carga, limites, alertas, failover, restore e runbook | SEC-001, INC-001 |
| R-019 | backup não restaura ou retém dado apagado sem ledger | D/I/R | 5 | 3 | 15 alto | PITR/retenção declarados | restore testado, amostragem, ledger de supressão e matriz legal | SEC-001, DSR-001, PRIV-002 |
| R-020 | incidente sem owner/notificação tempestiva | R/I | 5 | 3 | 15 alto | runbook draft | nomes/canais, tabletop, decisão ANPD/titular e ata | INC-001, LEGAL-002, LEGAL-003 |
| R-021 | coleta/permissão/SDK diverge das declarações | I/R | 5 | 3 | 15 alto | worksheet draft | data map + SBOM do build, traffic capture e lojas preenchidas | PRIV-001, STORE-001, VEND-001, VEND-002 |
| R-022 | aceite legal agrupado, forjado ou não revogável | T/R/E | 5 | 3 | 15 alto | registros versionados backend | UI afirmativa separada, E2E adulto/menor/revogação, auditoria de dark pattern | CONSENT-001, MINOR-001 |
| R-023 | documento/site publicado diverge da versão aceita | T/R | 4 | 3 | 12 alto | drafts e checker legal | hash fonte/site/build, HTTPS, sem placeholder, aceite jurídico | SITE-001, SITE-002, LEGAL-003 |
| R-024 | fornecedor transfere/processa dado fora do aprovado | I/R | 5 | 3 | 15 alto | lista preliminar | DPA, regiões/suboperadores e data flow aprovados | VEND-001, VEND-002, PRIV-002 |
| R-025 | marketing afirma capacidade/validação inexistente | R | 4 | 3 | 12 alto | gate de copy | scanner + revisão humana de build e metadados das lojas | CONTENT-001, STORE-001 |

## Tratamento e aceite

Para cada achado, registrar: risco, build/imagem, ambiente, reprodução
segura, impacto, evidência redigida, owner, prazo, correção, reteste e fiscal.

- crítico: bloquear imediatamente release e teste que possa ampliar dano;
- alto: bloquear release; correção e reteste independentes obrigatórios;
- médio: corrigir antes do release ou aceitar formalmente com compensação;
- baixo: backlog com owner/prazo, sem mascarar regressão.

Residual só pode ser calculado após evidência de staging. Na data desta
matriz, nenhum risco está marcado como aceito ou encerrado.
