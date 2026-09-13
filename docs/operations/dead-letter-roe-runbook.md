# Dead-letter: regras de engajamento e runbook

Status: ferramenta operacional restrita. Este documento **não** declara painel
administrativo, realtime, automação de incidentes ou operação de produção
prontos.

## Finalidade e limites

O worker representa um dead-letter como um registro de `outbox_events` ainda
pendente (`processed_at IS NULL`) cujo contador chegou ao limite
(`attempts >= maxAttempts`) **e cujo lease já expirou**
(`available_at <= CURRENT_TIMESTAMP`). Essa última condição impede confundir a
tentativa final ainda em execução com um dead-letter. A ferramenta
`scripts/ops/dead-letter.mjs` pode:

- listar somente UUID, tipo, tentativas e horários de eventos suportados;
- inspecionar um UUID exato com todos os valores do payload redigidos;
- simular ou reencaminhar um único UUID elegível.

Ela não oferece busca por usuário, payload ou agregado; não faz lote, exclusão,
alteração de `processed_at`, edição do payload nem reenvio por filtro. A
ferramenta não substitui a correção da causa do erro.

## Regras de engajamento (ROE)

1. Abrir e aprovar um change ticket antes de qualquer escrita. O ticket deve
   registrar incidente, causa corrigida, tipo do evento, evidência do dry-run,
   janela e plano de observação.
2. Usar identidade operacional pseudônima rotativa (`op_...`), nunca nome,
   e-mail ou outro identificador pessoal. O código de razão (`reason_...`) não
   pode conter texto livre ou dados pessoais.
3. Confirmar que o adaptador/dependência que causou o dead-letter está saudável.
   Reencaminhar exportação/exclusão sem adaptador real só repetirá a falha.
4. Obter revisão de uma segunda pessoa para produção. A pessoa que executa não
   autoaprova o ticket.
5. Executar listagem, inspeção e dry-run antes da escrita. Copiar do dry-run a
   confirmação exata; não a montar manualmente.
6. Um ticket autoriza apenas os UUIDs explicitamente registrados. Executar um
   por vez e observar worker, erro, latência e auditoria antes do próximo.
7. Não colocar URL, credenciais ou payload em ticket, terminal compartilhado,
   captura de tela ou log. `OPS_DATABASE_URL` deve vir do cofre/injetor aprovado.
8. Se qualquer fence divergir (tipo, tentativas, processado ou UUID), parar. Não
   alterar os valores esperados para “fazer passar”. Investigar concorrência.
9. Não usar a ferramenta durante migração, restore, failover não estabilizado ou
   incidente de integridade do banco.
10. Em execução indevida, pausar o worker pelo procedimento de incidente e
    escalar. Este utilitário não possui “undo” e deliberadamente não deleta.

## Guardas obrigatórios

O processo falha antes de conectar se faltar qualquer guarda aplicável:

- `OPS_DATABASE_URL`: URL recebida pelo injetor de segredos;
- `OPS_ENVIRONMENT`: `development`, `staging` ou `production`;
- `OPS_ALLOWED_ENVIRONMENTS`: lista explícita que contém o ambiente atual;
- `OPS_ALLOWED_DB_HOSTS`: host exato, sem curingas;
- `OPS_ALLOWED_DB_NAMES`: nome exato do banco, sem curingas;
- `OPS_WORKER_MAX_ATTEMPTS`: mesmo valor injetado no worker; o argumento
  `--max-attempts` deve ser idêntico e não pode reduzir esse limite;
- `OPS_CHANGE_TICKET`: formato como `CHG-1042` para requeue e toda operação em
  produção;
- `OPS_AUTHORIZED=true`: obrigatório para qualquer escrita e toda operação em
  produção.

Produção exige simultaneamente ambiente permitido, host permitido,
autorização, ticket e, para escrita, confirmação forte. A URL e as credenciais
nunca aparecem na saída. Instalação das dependências do workspace é uma
pré-condição; a ferramenta não instala nada. A URL não aceita fragmento nem
parâmetros de consulta, evitando que opções do driver alterem `search_path`,
TLS ou metadados da conexão. Host, banco, ambiente e limite devem vir de
configuração operacional revisada/injetada, não de valores improvisados no
terminal.

## Procedimento

Use Node 22.13.x. Os exemplos omitem de propósito a injeção de
`OPS_DATABASE_URL`, allowlists e `OPS_WORKER_MAX_ATTEMPTS`.

### 1. Listar metadados

```powershell
node scripts/ops/dead-letter.mjs list --max-attempts 12 --limit 25
```

A listagem é limitada a 100 registros e aos quatro tipos atualmente tratados
pelo worker. Não contém `payload`, `aggregate_id` ou outros dados do usuário.

### 2. Inspecionar um UUID

```powershell
node scripts/ops/dead-letter.mjs inspect --id 00000000-0000-4000-8000-000000000000 --max-attempts 12
```

A saída mostra apenas nomes de campos conhecidos e `[REDACTED]`. Nomes
desconhecidos são substituídos por uma contagem; nenhum
valor do payload é exibido.

### 3. Dry-run obrigatório

Defina o ticket, mantenha `OPS_AUTHORIZED` desligado fora de produção e não use
`--execute`:

```powershell
node scripts/ops/dead-letter.mjs requeue `
  --id 00000000-0000-4000-8000-000000000000 `
  --event-type privacy.export_requested.v1 `
  --expected-attempts 12 `
  --max-attempts 12 `
  --reason reason_adapter_restored `
  --operator op_rotation7
```

O resultado deve ser `eligible` e fornece `requiredConfirmation`. Qualquer
outro resultado bloqueia a escrita.

### 4. Requeue exato

Depois da dupla aprovação, defina `OPS_AUTHORIZED=true` e repita exatamente o
comando, acrescentando `--execute` e a confirmação retornada:

```powershell
node scripts/ops/dead-letter.mjs requeue `
  --id 00000000-0000-4000-8000-000000000000 `
  --event-type privacy.export_requested.v1 `
  --expected-attempts 12 `
  --max-attempts 12 `
  --reason reason_adapter_restored `
  --operator op_rotation7 `
  --execute `
  --confirm "REQUEUE staging 00000000-0000-4000-8000-000000000000 privacy.export_requested.v1 ATTEMPTS=12 THRESHOLD=12 REASON=reason_adapter_restored OPERATOR=op_rotation7 TICKET=CHG-1042"
```

A transação usa lock consultivo por evento e `FOR UPDATE`. Ela só altera o
registro se UUID, tipo e tentativas ainda forem exatamente os esperados,
`attempts >= maxAttempts`, o lease já tiver expirado e `processed_at IS NULL`.
O update repete todos esses fences no próprio `WHERE`, define
`attempts = 0` e `available_at = now` explicitamente. A mesma transação grava
um `audit_logs` com metadados seguros nas colunas `before` e `after`; payload e
identificadores do agregado não são copiados.

Repetir o mesmo UUID, tipo, tentativas e ticket retorna `already_requeued` sem
novo update. Uma nova rodada de falha exige novo ticket e nova inspeção.

## Verificação e observação

- Confirmar `requeued` ou `already_requeued`; qualquer código de conflito exige
  parada.
- Acompanhar o worker até `processed_at` ser preenchido ou o evento voltar a
  atingir o limite.
- Verificar a entrada `dead_letter.requeue` em `audit_logs`, sem payload.
- Registrar no ticket resultado e horário, sem copiar conteúdo do evento.
- Para eventos de privacidade, verificar o estado da solicitação por processo
  autorizado separado; o requeue por si só não prova atendimento ao titular.
- Para `simulation.deadline_reached.v1`, corrigir primeiro qualquer divergência
  de snapshot, estado ou resultado. Requeue não autoriza editar respostas nem
  recalcular pontuação fora do motor versionado.

## Testes

Unitários, incluindo o teste PostgreSQL que pula por padrão:

```powershell
node --test scripts/ops/dead-letter-core.test.mjs scripts/ops/dead-letter.postgres.test.mjs
```

O teste PostgreSQL só roda quando
`RUN_DEAD_LETTER_OPS_POSTGRES_TESTS=true` e `OPS_TEST_DATABASE_URL` aponta para
loopback e para um banco cujo nome contém `test`. Além disso,
`OPS_TEST_EXPECTED_DATABASE_NAME` precisa corresponder exatamente ao nome da
URL. O teste fixa `search_path=pg_temp` e cria apenas tabelas temporárias da
sessão; não usa dados reais e não exige migração. Sem todas essas condições,
ele aparece como ignorado e não conecta.
