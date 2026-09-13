# API: liveness, readiness e desligamento

## Endpoints

- `GET /api/healthz` é uma liveness superficial. Retorna `200 {"status":"ok"}` enquanto o processo HTTP responde e não consulta dependências.
- `GET /api/readyz` é a readiness para receber tráfego. Executa `SELECT 1` no PostgreSQL real e retorna somente `200 {"status":"ready"}` ou `503 {"status":"not_ready"}`. Erros internos nunca são incluídos na resposta.

A única dependência de prontidão da API neste estágio é PostgreSQL. Worker, Redis, realtime e serviços ainda não consumidos diretamente pela API não entram neste probe.

`API_READINESS_TIMEOUT_MS` controla o limite total do probe, em milissegundos. O padrão é `1000`; valores aceitos vão de `100` a `5000`. Valor inválido impede o processo de iniciar. Apenas uma tentativa fica pendente por processo e o resultado opaco é reutilizado por no máximo um segundo, evitando que chamadas públicas amplifiquem consultas ao banco. Se o tempo esgotar durante uma consulta, a conexão é destruída para interromper o trabalho no PostgreSQL; se esgotar enquanto aguarda o pool, o único waiter continua compartilhado até poder ser liberado, sem formar uma fila de probes. O drain invalida o cache e aborta a tentativa ativa.

## Operação

O `HEALTHCHECK` do Docker permanece intencionalmente em `/api/healthz`: uma falha transitória do banco deve retirar tráfego, não reiniciar em cascata todos os contêineres.

**Configuração presente; evidência operacional ainda aberta:** a fundação Terraform usa `/api/readyz` no startup e na readiness contínua, mantendo `/api/healthz` somente para liveness. A readiness do Cloud Run está GA desde 29/06/2026 e o provider estável `hashicorp/google` 7.45.0 fixado pela stack suporta `readiness_probe`; não é necessário `google-beta` nem `launch_stage`. O startup aceita até 120 segundos para o PostgreSQL ficar pronto. Depois disso, três falhas de readiness em intervalos de dez segundos retiram a instância do tráfego sem reiniciá-la, e dois sucessos a tornam elegível novamente.

Produção permanece fail-closed: `confirm_api_readiness_probe_staging` é `false` por padrão e uma precondition impede workloads de produção enquanto esse gate não for aberto. Ele só pode ser definido como `true` depois de `terraform validate/plan` com o provider real e de um ensaio em staging que comprove startup fechado, retirada/recuperação de tráfego durante perda do PostgreSQL, liveness estável e drenagem por `SIGTERM`. Consulte as [health checks do Cloud Run](https://cloud.google.com/run/docs/configuring/healthchecks), as [release notes](https://cloud.google.com/run/docs/release-notes) e o [runbook de deploy](../../infra/runbooks/deploy-rollback.md).

Ao receber `SIGTERM` ou `SIGINT`, a API marca readiness como indisponível, para de aceitar novas conexões, aguarda as requisições em curso e fecha o pool PostgreSQL. O processo encerra forçadamente em oito segundos, deixando margem antes do `SIGKILL` que o Cloud Run normalmente envia aos dez segundos. Requisições que não terminarem dentro dessa janela podem ser interrompidas e precisam respeitar idempotência.
