# Auditoria independente — fundação de billing

Data: 31/08/2026

Parecer: **REPROVADO**

Achados: P0 = 2, P1 = 4, P2 = 5.

## P0

1. O SDK móvel identifica o cliente RevenueCat pelo subject do Clerk, mas o
   restore/reconcile consulta pelo UUID interno. Um customer inexistente pode
   ser interpretado como assinatura inativa e remover um Pro válido.
2. O SKU Android não incorpora o base plan `monthly-auto-renewing`. A igualdade
   fixa com `iaaprova.pro.monthly` não representa o identificador moderno
   `iaaprova.pro.monthly:monthly-auto-renewing` usado no vínculo Google/RevenueCat.

## P1

- Webhook não valida ambiente nem restringe lojas autorizadas em produção.
- Resolução de identidade ignora `original_app_user_id` e `aliases`.
- Grace period, pausa, refund reversal, transfer e grants temporários não têm
  uma matriz de lifecycle segura e completa.
- Não existe reconciliação periódica diária, apesar do schema previsto.

## P2

- Não há testes mobile do lifecycle de identidade/compra/restore.
- Webhook não cobre os casos P1 nem concorrência real no PostgreSQL.
- Retry do paywall não reinicializa SDK/offering.
- Falha de reconcile após cobrança pode ser apresentada como falha da compra.
- Colunas críticas do banco ainda aceitam textos livres sem checks suficientes.

## Baseline confirmado

- API: 92 de 92 testes.
- Worker: 45 de 45 testes.
- Contratos: 16 de 16 testes.
- Typecheck de API, worker e mobile aprovado.

Os testes existentes não cobrem os P0 acima. A fundação continua bloqueada até
unificar a identidade RevenueCat, separar os IDs por loja, validar
ambiente/loja/aliases, corrigir lifecycle/grace, implementar reconciliação
periódica e executar a matriz sandbox em aparelhos reais.

Referências oficiais usadas pelo fiscal:

- https://www.revenuecat.com/docs/getting-started/entitlements/android-products
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
