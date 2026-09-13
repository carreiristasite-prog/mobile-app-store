# Runbook — resposta a incidentes

## Severidade inicial

- **SEV-1:** indisponibilidade ampla, perda/corrupção de dados, vazamento, entitlement incorreto em escala ou risco a menores.
- **SEV-2:** SLO em burn rápido, degradação relevante, backlog/dead letters crescentes ou dependência crítica instável.
- **SEV-3:** impacto limitado sem ameaça imediata ao SLO ou dados.

## Primeiros 15 minutos

1. Nomeie incident commander e scribe; registre horário UTC, sintomas e escopo conhecido.
2. Congele deploys e mudanças de infraestrutura.
3. Confirme por telemetria: burn rate, 5xx, p95, instâncias Cloud Run, CPU/conexões Cloud SQL, Redis, worker failures/dead letters e status de dependências.
4. Proteja usuários e dados primeiro. Desligue o fluxo afetado se ele puder gerar score, entitlement, resultado competitivo ou comunicação incorretos.
5. Escolha a mitigação reversível mais curta: rollback de digest, bloquear rota no edge, reduzir tráfego, pausar worker ou failover gerenciado.
6. Não copie tokens, payloads pessoais, respostas de prova ou segredos para chat/ticket. Use IDs de correlação e error codes seguros.

## Trilhas frequentes

| Sintoma | Verificar | Mitigação inicial |
|---|---|---|
| 5xx após deploy | revisão, logs, segredo resolvido, DB | rollback por digest |
| p95 alto sem 5xx | concorrência, cold starts, SQL/terceiros | limitar tráfego; revisar pools/queries; escalar somente com evidência |
| SQL saturado | CPU, conexões, locks, disco, query insights | reduzir instâncias/concorrência API se tempestade de conexões; conter rota cara |
| worker em retry | `errorCode`, dependência, lease | pausar novas side effects; preservar outbox; corrigir e replay idempotente |
| dead letter | tipo, tentativas, handler | não apagar; reconciliar caso a caso |
| suspeita de segredo | Audit Logs, revisões, principal | revogar/rotacionar, nova revisão, investigar acesso |
| abuso de edge | Cloud Armor preview/enforced | regra temporária com expiração e revisão de falso positivo |

Escalar imediatamente ao responsável de privacidade/segurança em suspeita de incidente com dados. Obrigações legais e comunicação externa são decisões humanas fora deste runbook.

## Encerramento

Exija confirmação de recuperação pelos SLOs e pelos invariantes funcionais, linha do tempo, causa contribuinte, impacto, dados afetados, decisões, follow-ups com dono/data e revisão sem culpa. Alertas sem canal configurado não notificam ninguém; a existência dos recursos Terraform não substitui o teste do paging.

