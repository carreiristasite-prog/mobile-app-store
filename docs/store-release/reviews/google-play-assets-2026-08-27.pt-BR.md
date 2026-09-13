# Revisão independente — assets candidatos da Google Play

Data: 27/08/2026

Parecer: **APROVADO como candidato local**

Achados finais: P0 = 0, P1 = 0, P2 = 0.

## Escopo congelado

- `google-play-icon-v3.png`: 512 × 512, PNG RGBA de 32 bits, alpha totalmente
  opaco, 409.868 bytes, SHA-256
  `2bb35672b2e06d119e5de2bde0b03e2aeda2aa91ea17a655d95a6564733dddb9`.
- `google-play-feature-graphic-v3.png`: 1024 × 500, PNG RGB de 24 bits sem
  alpha, 675.325 bytes, SHA-256
  `ece535f621f8419ec4fbbf7f3633172f350b18d4ab5415b6e72858b86a66bc12`.

## Verificações do fiscal

- Dimensões, formato, tamanho, hash e caminhos conferidos contra o manifesto.
- Ícone quadrado completo, sem máscara/cantos externos; banner com elementos
  centrais e apenas decoração nas bordas.
- Sem preço, ranking, chamada para ação, selo de loja, garantia de aprovação,
  afiliação oficial ou logo de terceiro.
- Caminhos ambíguos, escape, links simbólicos, `kind` duplicado e promoção
  prematura de aprovação são rejeitados pelo gate.
- A suíte `scripts.tests.test_store_release_check` passou 7 de 7 testes e a
  auditoria objetiva dos assets retornou zero achados.

## Limite do parecer

Este parecer não representa upload ou aceite pelo Play Console, aprovação
jurídica/visual final nem prontidão geral para publicação. As quatro aprovações
do manifesto permanecem explicitamente `false` até existirem os sign-offs e as
evidências do build candidato exigidos pelo pacote de loja.

Referências oficiais usadas pelo fiscal:

- https://developer.android.com/distribute/google-play/resources/icon-design-specifications
- https://support.google.com/googleplay/android-developer/answer/9866151
