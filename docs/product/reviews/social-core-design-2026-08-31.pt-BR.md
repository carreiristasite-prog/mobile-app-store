# Revisão independente — desenho do núcleo social

Data: 31/08/2026

Parecer: **APROVADO como desenho técnico**

Documento fiscalizado: `docs/product/social-core-design.pt-BR.md`

SHA-256 congelado:
`0d69093e6c11c8d210c58e66b363f27c2e6f9a6550e2865bf40604cf8738588f`

Achados finais: P0 = 0, P1 = 0, P2 = 0.

## Pontos confirmados pelo fiscal

- Grant realtime single-use e `connection_epoch` são canônicos no PostgreSQL;
  Redis é somente aceleração e não reabre token após restart ou failover.
- Bloqueio durante duelo ranked interrompe a interação, preserva evidências e
  produz resultado provisório sujeito a adjudicação; o ato de bloquear não
  escolhe vencedor nem causa forfeit sozinho.
- A matriz DSR/retenção cobre tabelas sociais, realtime, ranking, moderação,
  integridade 0014, filas, auditoria, suppression e restore de backup.
- Coortes adulto/menor, transição aos 18 anos, preimage canônico de request,
  SLOs ACK/broadcast e limites Free/Pro estão definidos de forma fail-closed.
- A migration 0014 foi classificada corretamente como fundação fail-closed,
  sem produzir `server_verified`.

## Verificações

- 16 de 16 testes de alinhamento contratual aprovados.
- 11 de 11 testes da política etária aprovados.
- O hash do documento foi confirmado antes do parecer.

## Limite do parecer

Esta aprovação permite decompor a implementação; não aprova código, realtime,
moderação, migration social v2, mobile, carga ou homologação. O social continua
bloqueado para publicação até esses pacotes existirem, passarem por fiscalização
independente e serem validados com App Integrity em ambiente e aparelhos reais.
