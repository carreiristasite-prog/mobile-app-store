# Runbook — deploy e rollback

## Pré-condições

- incidente ativo não está consumindo o error budget rapidamente;
- CI autenticada sem chaves via Workload Identity Federation;
- testes, typecheck, builds dos dois Dockerfiles e scan de vulnerabilidade aprovados;
- imagem-base oficial Node 22.13+ e imagens no Artifact Registry referenciadas por digest, nunca por tag;
- versões numéricas explícitas de Secret Manager presentes e acessíveis somente ao runtime correto; `latest` é proibido;
- mudanças de banco, se houverem em outra entrega, usam expand/contract e foram validadas separadamente;
- plano Terraform salvo, legível e aprovado por uma segunda pessoa.
- `/api/readyz` comprova PostgreSQL sem expor detalhes e alimenta startup e readiness contínua; `/api/healthz` é somente liveness. O provider estável fixado suporta os três probes, mas produção continua bloqueada por `confirm_api_readiness_probe_staging=false` até existir evidência do ensaio em staging.

## Deploy

1. Registre digests atual e novo da API/worker e o nome das revisões atuais.
2. Atualize apenas `api_image` e/ou `worker_image` no input protegido da automação.
3. Execute `fmt -check`, `validate` e `plan`. Rejeite o plano se substituir Cloud SQL, Redis, VPC, buckets, chaves ou service accounts.
4. Aplique exatamente o plano aprovado. Esta stack envia 100% para a revisão nova; portanto o rollback por digest deve estar preparado antes do apply.
5. Valide `/api/healthz` e `/api/readyz`. O startup admite até 24 tentativas a cada 5 s (janela de 120 s) e cada probe tem timeout de 2 s, acima do timeout interno de readiness de 1 s. Em uma revisão já pronta, a readiness exige três falhas a cada 10 s para retirar a instância e duas respostas boas para devolvê-la ao tráfego. Confirme `503` controlado durante indisponibilidade sintética do PostgreSQL, retirada sem reinício, liveness continuamente verde e retorno a `200`/tráfego após recuperação. Observe taxa de 5xx, p95, burn rate, CPU/conexões SQL e logs sem PII por pelo menos 15 minutos.
6. Envie `SIGTERM` em staging e confirme que a API muda readiness para `503` imediatamente, para de aceitar novas requisições e encerra em até 8 s, dentro da janela de 10 s do Cloud Run. O timeout Cloud Run de 60 s limita requisições normais, mas não amplia a janela de shutdown; registre qualquer requisição interrompida e valide retry/idempotência do cliente.
7. Para worker, confirme `/health/ready`, `worker_started`, batches processados, retries e ausência de dead letters. Health verde sozinho não comprova drenagem de backlog.
8. Registre aprovação, digests, plano, revisões, horários e evidência do gate de readiness no change record.

## Rollback

Dispare rollback com aumento material de 5xx/p95, burn rate rápido, dead letters, regressão de segurança ou corrupção funcional.

1. Congele novos deploys e preserve logs/revisão falha.
2. Reponha no input Terraform o digest anterior conhecido como bom.
3. Gere novo plano; ele deve alterar somente a revisão Cloud Run afetada.
4. Aplique o plano e confirme saúde/telemetria.
5. Se uma versão de segredo causou a falha, crie uma nova versão com o valor anterior; não destrua histórico durante o incidente. Atualize `secret_versions` e force nova revisão controlada.
6. Não reverta migração destrutivamente. Use compatibilidade expand/contract ou restauração conforme [restore-pitr.md](restore-pitr.md).

Rollback encerra a mitigação, não o incidente: mantenha o registro aberto até causa raiz, impacto, evidências e ações preventivas serem revisados.
