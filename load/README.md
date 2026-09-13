# IA Aprova — fundação de testes de carga

Esta pasta prepara testes k6 para **staging sintético e autorizado**. Ela não
contém credenciais, não executa tráfego durante a validação e não autoriza
ninguém a testar produção. O preço do produto (R$ 39,90) não muda a regra:
capacidade, segurança e billing precisam ser validados sem atingir assinantes.

## O que existe

- `health`: uma requisição por iteração em `GET /api/healthz`.
- `catalog`: uma requisição por iteração em `GET /api/v1/catalog/active`.
- `auth_read`: uma leitura autenticada allowlisted por iteração, usando apenas
  contas sintéticas de staging.
- `learning_idempotency`: cria uma sessão seedada, responde com uma alternativa
  exposta pelo servidor e repete a mesma tentativa com a mesma chave. O cliente
  nunca envia gabarito, acerto, score ou XP.
- perfis exatos: 300 RPS/1h, 600 RPS/15min, 1.000 RPS/60s e exatamente 5.000
  usuários virtuais com uma iteração por usuário para o gate de sessões.

Os três perfis RPS só aceitam alvos de **uma requisição por iteração**, para que
a taxa de chegada corresponda a requisições HTTP. O fluxo de aprendizagem tem
três requisições e, por isso, só pode usar `sessions_5000`.

## Gate offline

Execute apenas a validação estática em desenvolvimento e CI:

```powershell
python load/tools/validate_load_foundation.py
python -m unittest discover -s load/tests -p "test_*.py"
```

Esses comandos não importam k6, não abrem socket e não fazem rede. O workflow
`load-static-validation.yml` executa somente os mesmos checks. A política é
**não executar carga em pull request**. Qualquer workflow futuro de carga deve
ser manual, protegido por ambiente e aprovação, separado da CI de PR.

## Variáveis exigidas em uma execução futura autorizada

| Variável | Regra |
| --- | --- |
| `RUN_AUTHORIZED=true` | Confirma autorização desta janela; qualquer outro valor bloqueia. |
| `AUTHORIZATION_MANIFEST_PATH` | Manifesto externo aprovado, vinculado ao host, janela, perfil, alvo, run ID, dataset e mutação. |
| `AUTHORIZATION_MANIFEST_SHA256` | Hash SHA-256 conferido do manifesto de autorização. |
| `BASE_URL` | URL HTTPS sem path, query ou credenciais. |
| `STAGING_HOST_ALLOWLIST` | Lista exata de hosts de staging aprovados. |
| `TEST_RUN_ID` | Identificador não sensível de 8–64 caracteres. |
| `PROFILE` | Um nome exato de `profiles.json`. |
| `TARGET` | `health`, `catalog`, `auth_read` ou `learning_idempotency`. |
| `SYNTHETIC_DATASET_PATH` | Arquivo injetado fora do repositório, necessário para alvos autenticados. |
| `SYNTHETIC_DATASET_SHA256` | Hash SHA-256 aprovado do dataset injetado. |
| `ALLOW_MUTATIONS=true` | Exigido somente para aprendizagem. |
| `MUTATION_SCOPE=seeded-learning-idempotency` | Limita as únicas mutações implementadas. |

Todo host de `iaaprova.com.br` é bloqueado por padrão. Um subdomínio que
contenha explicitamente `stage`, `staging`, `perf` ou `loadtest` ainda exige
allowlist e `ALLOW_IAAPROVA_STAGING_SUBDOMAIN=true`. Os hosts de produção
conhecidos permanecem bloqueados mesmo com override.

`authorization.example.json` e `dataset.example.json` são deliberadamente não
executáveis: suas janelas/tokens estão expirados. O manifesto real deve ser
produzido e aprovado fora do executor, ter janela UTC de no máximo 24 horas e
seu hash deve ser conferido no runner protegido. `RUN_AUTHORIZED=true` ou um
hash criado pelo próprio executor não substituem a aprovação formal.

O dataset real do
ensaio deve conter somente aliases `loadtest-*`, tokens efêmeros de contas
sintéticas, expiração em até 24 horas e IDs do seed aprovado. O schema é
fechado: qualquer campo extra, inclusive PII, é recusado. Para `sessions_5000`,
são obrigatórias exatamente 5.000 contas sintéticas únicas.

## Resultados e interpretação

O resumo JSON contém somente ID do ensaio, perfil, alvo, aprovação de thresholds,
completude e métricas agregadas. Tokens, URL, alias, ID de autorização e payload não entram no resumo. Tags de
URL dinâmica foram removidas para evitar alta cardinalidade e exposição.

Gates configurados:

- p95 menor ou igual a 300 ms;
- p99 menor ou igual a 800 ms;
- erros HTTP menores que 0,5%;
- erros funcionais menores que 0,5%.

`evidencePassed` só pode ser verdadeiro quando todos os thresholds existem e
passam, todas as métricas obrigatórias existem e as contagens de iterações e
requisições são exatamente as planejadas. Taxa configurada não é taxa atingida. `dropped_iterations > 0` indica que o
gerador não sustentou o perfil e invalida a evidência, mesmo se os thresholds
restantes passarem. O ensaio de 5.000 VUs normalmente exige geradores
distribuídos e dimensionados fora da aplicação alvo.

O alvo `learning_idempotency` verifica replay sequencial, comparando a resposta
JSON completa, mas não prova corrida concorrente entre duplicatas; esse risco
continua coberto por testes de integração do banco e por um ensaio específico futuro.

## WebSocket

**NO-GO:** o gate de 10.000 WebSockets está `skipped` porque ainda não existe um
endpoint realtime real e contratual no produto. Não há código `ws.connect` nesta
pasta. Criar um teste fictício daria uma falsa evidência de prontidão. O gate só
pode ser implementado após endpoint, autenticação, protocolo, limites,
reconexão, presença e critérios de sucesso serem revisados independentemente.

Antes de qualquer execução k6, preencher e aprovar
[`RULES_OF_ENGAGEMENT.md`](./RULES_OF_ENGAGEMENT.md).
