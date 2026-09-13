# Runbook — teste de capacidade

Objetivo: validar, em staging isolado e com dados sintéticos, os gates de 300 RPS por 1 hora, 600 RPS por 15 minutos e 1.000 RPS por 60 segundos. O teste não autoriza publicar nem usar dados reais.

## Pré-condições

- staging reproduz região, tamanhos, ingress, connector, SQL/Redis e configuração do Cloud Run;
- banco usa dataset sintético representativo em volume/distribuição, sem questões licenciadas nem PII;
- rotas têm cenários autenticados e anônimos com tokens exclusivos de teste;
- terceiros pagos são sandboxados ou excluídos explicitamente; nunca dispare billing, email ou notificação real;
- budget/quotas e janela do teste aprovados; pessoa com autoridade pode abortar.

## Perfil

1. **Smoke:** 10 RPS por 5 min para validar scripts e asserts.
2. **Warm-up:** rampa 10→300 RPS em 10 min.
3. **Sustentado:** 300 RPS por 60 min com mix realista de leitura/escrita.
4. **Pico intermediário:** 600 RPS por 15 min, com rampa e redução controladas.
5. **Burst:** 1.000 RPS por 60 s, depois reduzir sem descartar escritas aceitas.
6. **Sessões:** manter 5 mil sessões autenticadas simultâneas com tokens exclusivos e mix realista.
7. **Soak adicional:** 300 RPS por 2 h para detectar vazamentos/pool exhaustion.
8. **Falha controlada:** somente em game day separado, testar restart de revisão e failover HA com aprovação.

O gate de 10 mil conexões WebSocket permanece **bloqueado**: não existe deployable realtime revisado. Não substitua esse teste por HTTP, não simule um serviço inexistente e não aprove publicação social/duelos antes dessa entrega.

Distribua endpoints por telemetria de produto quando existir. Até lá, registre que o mix é hipótese e rode ao menos leitura 60%, escrita idempotente 30%, health 1% e fluxos pesados 9%. Não inclua `/api/healthz` nos percentis de negócio.

## Critérios de aceitação

- disponibilidade HTTP ≥ 99,9% excluindo 4xx esperados do gerador;
- p95 ≤ 300 ms e p99 ≤ 800 ms nas rotas críticas;
- nenhuma perda/duplicidade em escritas idempotentes;
- CPU API sustentada <70%, memória sem crescimento monotônico e sem restart por OOM;
- Cloud SQL CPU <70% sustentada, conexões <70% do limite, disco/IO/locks sem saturação;
- Redis <70% de memória e sem erro TLS/AUTH, apenas depois de existir consumidor real;
- outbox retorna ao baseline em até 15 min após burst, sem dead letters;
- VPC connector sem throughput/drop e custo projetado dentro do budget.

Aborte com corrupção, efeito externo real, error rate >2% por 2 min, CPU SQL >90% por 5 min, conexões >85% ou dead letters.

## Evidência e decisão

Guarde commit/digests, plano, configuração, perfil, timestamps UTC, dashboards exportados, resultados brutos, erros e custo. Ajuste concorrência/max instances/pool/tier uma variável por vez e repita. A aprovação exige uma execução independente; extrapolação linear ou health verde não prova 1.000 RPS.
