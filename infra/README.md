# IA Aprova — fundação SRE no GCP

Esta pasta define uma fundação **não implantada** para o primeiro patamar de aproximadamente 80 mil usuários ativos mensais. Ela não é evidência de capacidade ou prontidão de produção: os limites iniciais precisam ser confirmados pelo teste de capacidade e por um plano Terraform revisado.

## O que existe

- GCP em `southamerica-east1`, com VPC dedicada, Private Service Access e Serverless VPC Access connector.
- API e worker reais do repositório como serviços Cloud Run v2, ambos bloqueados por `enable_workloads=false`.
- API com startup e readiness contínua em `/api/readyz` (PostgreSQL) e liveness independente em `/api/healthz`. A readiness contínua está GA no Cloud Run desde 29/06/2026 e é suportada pelo provider estável `hashicorp/google` fixado exatamente em 7.45.0 nesta stack; não se usa `google-beta` nem `launch_stage`.
- Artifact Registry regional e imagens obrigatoriamente fixadas por digest SHA-256.
- Cloud SQL PostgreSQL 16 Enterprise, `REGIONAL`, SSD, IP público desligado, CMEK, backups diários, 14 backups e 7 dias de PITR.
- Memorystore Redis 7.2 `STANDARD_HA`, TLS, AUTH e snapshots RDB. O código atual ainda não usa Redis.
- buckets privados com acesso uniforme, prevenção de acesso público e CMEK. O bucket DSR dedicado desliga explicitamente versionamento e soft delete e usa `customTime` para exclusão; a API recebe apenas `storage.objects.get` e o worker recebe somente create/delete/get, sem permissão de listar. A entrega continua bloqueada por evidência de staging.
- Secret Manager regional com CMEK. O Terraform cria somente os recipientes; nunca cria versões ou recebe valores secretos.
- identidades separadas para API, worker, deploy e futura produção de Cloud Tasks, sem chaves persistentes.
- Load Balancer HTTPS global e Cloud Armor opcionais. Rate limiting é aplicado; regras WAF começam em preview para ajuste com tráfego real.
- SLOs de 99,9% de disponibilidade, p95 até 300 ms e p99 até 800 ms, alertas de burn rate, worker, Cloud SQL e Redis, dashboard e budget opcional.
- fila Cloud Tasks reservada, **sem target nem integração fictícia**. Hoje a API grava outbox transacional no PostgreSQL e o worker faz polling.

Não existem deployables revisados de realtime ou admin. Os outputs correspondentes são `null`; nenhum serviço é criado para simular essas funções.

## O que ainda bloqueia produção

- `terraform init/validate/plan` e os builds Docker precisam rodar em uma máquina com Terraform, Docker, Node 22.13+ e acesso ao registry; o checker estático não valida o schema real do provider. `infra/scripts/verify.ps1` falha de propósito quando Terraform não está disponível, em vez de transformar validação incompleta em sucesso.
- A semântica de probes ainda precisa ser comprovada em staging com o provider real: startup fechado enquanto PostgreSQL falha, retirada/retorno de tráfego pela readiness e liveness estável durante falha de banco. Produção exige `confirm_api_readiness_probe_staging=true`; o valor default é `false`.
- As regras OWASP do Cloud Armor começam em preview e precisam de evidência de falso positivo antes de enforcement; preview não conta como WAF aprovado.
- Nenhum canal de paging, budget, secret version, domínio, certificado, WIF ou digest real foi criado/testado por esta fundação.
- Restore/PITR, migração real, carga, failover, varredura das imagens e rollback ainda exigem evidência em staging.
- Redis não tem consumidor; realtime/admin não existem; a fila Cloud Tasks não tem produtor nem handler. Esses recursos não podem constar como funcionalidades prontas.

O deploy público e a publicação nas lojas permanecem reprovados enquanto qualquer item acima estiver aberto.

## Barreiras de segurança

1. `confirm_paid_platform_provisioning`, `enable_workloads`, `enable_external_https_load_balancer`, `confirm_api_readiness_probe_staging` e `confirm_privacy_export_delivery_staging` são `false` por padrão. Os dois últimos só mudam depois da respectiva evidência em staging e são preconditions dos workloads.
2. Produção ativa proteção contra exclusão em Cloud SQL, Redis e Cloud Run. Chaves KMS e state bucket têm `prevent_destroy` literal.
3. Imagens mutáveis falham nas preconditions; somente `@sha256:<64 hex>` é aceito. Os checks adicionais são diagnóstico, não a barreira de aplicação.
4. Valores de segredo não entram em `.tf`, `.tfvars`, plano ou state. Cada revisão usa uma versão numérica explícita, nunca `latest`. O state ainda deve ser tratado como sensível porque provedores podem armazenar atributos computados, como o AUTH do Redis.
5. O LB é a única entrada pública pretendida em produção. O ingress do Cloud Run fica em `INTERNAL_LOAD_BALANCER`; o `allUsers` necessário ao backend não permite contornar essa restrição de ingress.
6. Nenhum `apply`, deploy, criação de segredo, migração ou alteração de DNS é executado por estes arquivos.

## State remoto

O backend não pode criar o próprio bucket. Um administrador executa uma única vez a stack pequena em `infra/bootstrap`, usando estado local temporário e uma identidade Terraform previamente criada:

```powershell
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan `
  -var='project_id=PROJECT_ID' `
  -var='state_bucket_name=GLOBAL_UNIQUE_BUCKET' `
  -var='terraform_principal=serviceAccount:terraform@PROJECT_ID.iam.gserviceaccount.com' `
  -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
```

Depois de revisão em quatro olhos, inicialize a stack principal:

```powershell
terraform -chdir=infra init -reconfigure `
  -backend-config='bucket=GLOBAL_UNIQUE_BUCKET' `
  -backend-config='prefix=iaaprova/prod'
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra plan -var-file=terraform.prod.tfvars -out=prod.tfplan
terraform -chdir=infra show -no-color prod.tfplan > prod.tfplan.txt
```

O state bucket usa CMEK, versionamento, acesso uniforme e `prevent_destroy`. Conceda acesso somente ao principal de automação e a um grupo de recuperação auditado. Não guarde `bootstrap.tfplan`, `prod.tfplan`, state ou cópias textuais de planos no Git.

## Sequência antes do primeiro deploy

1. Criar projeto dedicado, vincular billing e confirmar quotas regionais de Cloud Run, VPC connector, Cloud SQL e Redis.
2. Gerar e revisar o plano pago com `confirm_paid_platform_provisioning=true` e `enable_workloads=false`; só aplicar plataforma após aprovação de custos e IAM.
3. Criar o login PostgreSQL de runtime fora do Terraform, com privilégios mínimos definidos pela equipe de banco.
4. Adicionar diretamente ao Secret Manager as seis versões exigidas e registrar somente seus números em `secret_versions`. Para `DATABASE_URL`, usar o socket montado, por exemplo `postgresql://USER:URL_ENCODED_PASSWORD@localhost/iaaprova?host=%2Fcloudsql%2FPROJECT%3AREGION%3AINSTANCE`. O hostname `localhost` é necessário porque o worker valida URLs com hostname; o parâmetro `host` direciona `pg` ao socket criptografado do Cloud SQL connector.
5. Resolver e aprovar o digest do manifesto oficial `node:22.x-bookworm-slim`, construir e testar os dois containers com `--build-arg NODE_IMAGE=node:22.x-bookworm-slim@sha256:<64-hex>`; publicar no Artifact Registry e capturar os digests finais.
6. Executar a checklist em [deploy-rollback.md](runbooks/deploy-rollback.md), inclusive revisão independente do plano.
7. Em staging, confirmar o comportamento das três probes, inclusive perda e recuperação sintética do PostgreSQL, e guardar revisão, timestamps e métricas como evidência. Só então definir `confirm_api_readiness_probe_staging=true` no input protegido de produção.
8. Em produção, habilitar workloads e LB no mesmo plano; as preconditions impedem API pública sem borda ou sem o gate de readiness. Criar o A record e aguardar o certificado ficar `ACTIVE`. O `run.app` permanece restrito a tráfego interno/LB em todos os estágios.

Nunca crie chave JSON de service account. Use Workload Identity Federation para CI; este módulo cria a identidade de deploy, mas a federação depende do repositório/organização definitivos e ficou intencionalmente fora do escopo.

## Dimensionamento inicial, não garantia

| Componente | Base inicial | Limite/observação |
|---|---:|---|
| API | 3–100 instâncias, 2 vCPU, 1 GiB, concorrência 40 | Envelope teórico amplo para burst de 1.000 RPS; validar latência e conexões SQL |
| Worker | 2 instâncias quentes, 2 vCPU, CPU sempre alocada | Escala de request não enxerga backlog; alterar `min_instances` por evidência |
| PostgreSQL | HA, 4 vCPU, 15 GiB RAM, 100 GiB SSD com auto-grow | Pool padrão do `pg` pode multiplicar conexões por instância; medir antes de elevar API max |
| Redis | HA, 5 GiB, TLS/AUTH, RDB 12h | Ainda sem consumidor; não conceder acesso até integração revisada |
| VPC connector | 2–10 `e2-standard-4` | Verificar throughput e custo no teste de capacidade |

O cálculo de primeira ordem para API é `instâncias ≈ RPS × p95(seg) / (concorrência × utilização-alvo)`. A 1.000 RPS, p95 de 300 ms, concorrência 40 e alvo 70%, são cerca de 11 instâncias; cauda, dependências e conexões podem impor limite antes da CPU.

## Validação

Com ferramentas instaladas:

```powershell
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
docker build --build-arg NODE_IMAGE=node:22.x-bookworm-slim@sha256:<64-hex> -f artifacts/api-server/Dockerfile -t iaaprova-api:verify .
docker build --build-arg NODE_IMAGE=node:22.x-bookworm-slim@sha256:<64-hex> -f artifacts/worker/Dockerfile -t iaaprova-worker:verify .
```

Sem Terraform/Docker, execute `powershell -File infra/scripts/static-check.ps1`. Esse check detecta erros de segurança e estrutura, mas **não substitui** `terraform validate` nem os builds.

Referências oficiais verificadas em 23/08/2026: [health checks do Cloud Run](https://cloud.google.com/run/docs/configuring/healthchecks), [release notes do Cloud Run](https://cloud.google.com/run/docs/release-notes) e [schema do `google_cloud_run_v2_service`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service). A readiness tornou-se GA, mas `terraform validate`, um plan revisado e o ensaio em staging continuam obrigatórios antes de abrir o gate de produção.

## Runbooks

- [Deploy e rollback](runbooks/deploy-rollback.md)
- [Restore e PITR](runbooks/restore-pitr.md)
- [Resposta a incidentes](runbooks/incident-response.md)
- [Teste de capacidade](runbooks/capacity-test.md)
- [Entrega privada de export DSR](runbooks/privacy-export-delivery.md)
