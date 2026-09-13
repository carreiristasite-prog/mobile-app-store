# Motor de simulados por blueprint — contrato de integração

Status: núcleo puro implementado e testado; ainda não integrado a rota, banco,
OpenAPI, worker de expiração ou aplicativo. Este documento não declara o fluxo de
simulados pronto para produção.

## Objetivo e limite

O módulo `artifacts/api-server/src/services/simulation-blueprint.ts` transforma
uma regra editorial explícita e uma lista ordenada de versões de questões em um
snapshot imutável. Ele aceita somente a primeira resposta de cada questão,
encerra por quantidade ou prazo absoluto e calcula um resultado reproduzível.

O motor não seleciona conteúdo, não libera questões da quarentena, não autentica
usuários e não persiste estado. A integração deve fornecer apenas versões de
questões publicadas e licenciadas para aquele `blueprintVersionId`.

## Regra v1 obrigatória

Todas as chaves são fechadas: campos desconhecidos, omitidos ou versões futuras
são rejeitados. Valores decimais são strings sem sinal, com até seis casas.

```json
{
  "schemaVersion": "simulation-blueprint-rules.v1",
  "questionCount": 3,
  "durationMinutes": 60,
  "scoring": {
    "model": "weighted-sum.v1",
    "rounding": {
      "decimalPlaces": 2,
      "mode": "half-away-from-zero"
    },
    "aggregateFloor": { "policy": "none" }
  },
  "subjects": [
    {
      "subjectId": "portugues",
      "questionCount": 2,
      "correctPoints": "1",
      "weight": "2",
      "incorrect": { "policy": "penalty", "penaltyPoints": "0.25" },
      "unanswered": { "policy": "zero" }
    },
    {
      "subjectId": "matematica",
      "questionCount": 1,
      "correctPoints": "2.5",
      "weight": "1.2",
      "incorrect": { "policy": "zero" },
      "unanswered": { "policy": "zero" }
    }
  ]
}
```

- A soma de `subjects[].questionCount` deve ser exatamente `questionCount`.
- O limite técnico da v1 é 10.000 questões, 10.080 minutos (sete dias) e 100
  alternativas por questão. O compilador rejeita valores maiores antes de
  alocar ou percorrer o snapshot.
- Cada matéria deve aparecer uma vez e a seleção deve conter exatamente a sua
  quantidade declarada.
- Acerto soma `correctPoints * weight`.
- Erro soma zero quando a política é `zero`; com `penalty`, subtrai
  `penaltyPoints * weight`.
- Não respondida soma zero. Outra política não existe na v1.
- `aggregateFloor` é explicitamente `none` ou `zero` e afeta somente a nota
  total. A nota por matéria preserva valor negativo como evidência.
- A soma é feita com inteiros decimais exatos e arredondada uma única vez no
  total. Relatórios por matéria são arredondados separadamente. Empates usam
  `half-away-from-zero`.

Um edital com anulação, crédito parcial, normalização, nota de corte por bloco,
penalidade para omissão, pesos por item, casas decimais acima de seis ou outra
fórmula exige uma nova versão do motor. A integração não pode aproximar nem
"completar" essa regra.

## Snapshot e apresentação

`createSimulationSnapshot` recebe:

- `sessionId` e `blueprintVersionId` imutáveis;
- instante inicial em milissegundos fornecido pelo servidor;
- regra v1 completa;
- versões das questões na ordem oficial, com matéria, alternativas e gabarito.

O prazo é `startedAtMs + durationMinutes * 60_000`. Overflow é rejeitado. A
ordem do array é a ordem fixa; o motor não embaralha. O hash SHA-256 cobre regra,
ordem, versões, início e prazo.

O snapshot interno contém `correctOptionId` e **nunca pode ser serializado ao
cliente**. A rota futura deve usar `createSimulationPresentation`, que devolve
somente posição, versão da questão, matéria e IDs das alternativas. Enunciado e
texto das alternativas devem ser buscados pela versão já congelada, também sem
gabarito, solução ou racional antes da resposta.

Antes da finalização, `snapshotHash` também é somente servidor. Como é um hash
sem chave sobre dados que incluem alternativas corretas de baixa entropia, ele
pode funcionar como verificador de tentativa de adivinhação se o restante do
snapshot for conhecido. A apresentação pública não contém gabarito nem hash.

## Relógio, respostas e encerramento

- Todos os tempos são recebidos do relógio do servidor. Tempo enviado pelo
  aplicativo não é autoridade.
- A janela de resposta é `startedAtMs <= receivedAtMs < deadlineAtMs`.
- No milissegundo exato do prazo a resposta já não entra. O estado encerra em
  `deadlineAtMs`, mesmo que o worker observe a expiração depois.
- O primeiro envio aceito por questão vence. Novo envio para a mesma questão é
  rejeitado.
- Repetir a mesma chave idempotente, questão e alternativa devolve o estado
  original. Reusar a chave com outro payload é conflito.
- Regressão do relógio entre respostas é rejeitada.
- Ao aceitar `questionCount` respostas únicas, o estado encerra pelo horário da
  última. Sem todas as respostas, `finishSimulationAtTime` encerra pelo prazo.
- Não existe encerramento manual antecipado na v1. Se o edital/produto exigir,
  deve ser especificado como nova regra, não inferido pela rota.

## Persistência transacional exigida na integração

1. Validar principal autenticado e propriedade da sessão.
2. Em transação, bloquear a linha da simulação antes de reconstruir o estado.
3. Conferir `snapshotHash`, versões e estado antes de chamar o motor.
4. Usar timestamp do banco ou do processo servidor monotônico, nunca do corpo.
5. Persistir resposta e transição na mesma transação.
6. Impor unicidade por `(simulation_id, question_version_id)` e por
   `(simulation_id, idempotency_key)`.
7. Persistir o snapshot integral e imutável, não apenas referências mutáveis.
8. Gerar o resultado no servidor e armazenar `resultHash`; score, acerto,
   gabarito e motivo de encerramento nunca são aceitos do cliente.
9. Agendar expiração durável para o prazo. A leitura do resultado também pode
   encerrar de forma oportunista, usando a mesma transação.
10. Atualizar em conjunto migração, validação da API, OpenAPI e cliente mobile.

Snapshots e estados carregados de JSON são revalidados com schemas fechados,
arrays densos sem propriedades laterais, relações internas (prazo, posições,
contagens e versões), hash e tipos antes de qualquer operação; depois são
congelados recursivamente. Campo adicional, objeto exótico, estado parcialmente
corrompido ou hash recalculado sobre prazo inconsistente é rejeitado. A
integração ainda deve validar a linha e a propriedade no banco: essa validação
estrutural não autentica o dado.

Uma hash SHA-256 detecta divergência acidental e torna a reprodução comparável;
ela não substitui autorização, controle de escrita do banco ou assinatura
criptográfica.

## Gates antes de integrar

- Revisão independente deste núcleo e de seus casos adversariais.
- Teste de concorrência real em PostgreSQL com duas respostas simultâneas.
- Teste de expiração/retentativa do worker e mensagens fora de ordem.
- Testes de contrato garantindo que nenhum gabarito aparece antes da resposta.
- E2E de pausar/reabrir, offline, expirar em background e reconciliar relógio.
- Blueprint editorial aprovado por concurso/edital, sem regra presumida.
