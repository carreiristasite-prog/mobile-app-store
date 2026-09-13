# Sinais etários das lojas: arquitetura, evidência e gate

**Data da revisão técnica:** 23/08/2026  
**Escopo:** Expo SDK 57, iOS e Android  
**Status:** implementado internamente; bloqueado para produção até prova nativa e homologação externa

## Decisão de segurança

A faixa autodeclarada e o sinal da loja são entradas distintas. O app pede os
limiares 13, 16 e 18 e envia ao backend somente uma das quatro faixas do
produto, plataforma e status. Não envia limites numéricos brutos, data de
nascimento, `installId`, controles parentais, método de documento/pagamento ou
datas de aprovação da loja.

O `expo-age-range` entrega o resultado ao processo do aplicativo, sem uma prova
criptográfica verificável pelo backend. Por isso a rota pública fixa `source`
no servidor e grava `trust_status=device_reported_monitoring`; o cliente não
pode enviar `source`, `trust`, `verified` ou `assurance`. Esse estado pode
desligar ou bloquear social/notificações, mas nunca liberá-los. Cada reporte
público também restaura os dois defaults para desligado. Um futuro sinal
`server_verified` não poderá ser sobrescrito pela rota pública.

O produto brasileiro considera o sinal obrigatório. Assim, social e
notificações falham fechados quando o sinal:

- está ausente, não compartilhado ou exige verificação na loja;
- está indisponível/errou;
- indica pessoa menor de 18 anos;
- conflita com a faixa autodeclarada;
- é apenas `device_reported_monitoring`.

Ausência, recusa, indisponibilidade ou um sinal adulto ainda sem prova do
servidor não bloqueiam o aprendizado; continuam valendo o age gate 13+, Termos
e fluxo autenticado de responsável. Porém, uma faixa compartilhada que contradiz
a autodeclaração interrompe também o fluxo de aprendizado e exige correção ou
uma nova consulta. Assim, um possível menor não conclui o onboarding como adulto.
Permissão do responsável não substitui um bloqueio etário da loja.

## Fluxo mobile

1. O usuário informa somente a faixa no onboarding.
2. Em iOS 26+, o app consulta elegibilidade regulatória e, quando aplicável ou
   desconhecida, solicita Declared Age Range.
3. Em Android 23+, o app solicita compartilhamento; só consulta a faixa se o
   resultado for `SHARED`.
4. Sistemas não suportados e qualquer erro produzem um status sem faixa.
5. Faixas ambíguas/invertidas são rejeitadas, sem inferência otimista.
6. A mutação autenticada e idempotente não entra na fila offline.
7. A tela permite nova consulta quando houver recusa, erro, conflito ou mudança
   de faixa; nenhum status local fica permanentemente sem caminho de correção.

## Evidências automatizadas

- `pnpm --filter @workspace/ia-aprova test:age-signals` valida normalização,
  entitlement, versão Expo, thresholds, minimização e autoridade do servidor.
- Os testes de `identity-policy` validam ausência, menor, conflito,
  indisponibilidade e impossibilidade de elevação por payload do dispositivo.
- O contrato de migrations valida a migration aditiva `0010` e proíbe campos
  de nascimento/installId.
- O alinhamento de contratos exige a rota no OpenAPI, cliente e servidor.

## Pendências que mantêm `MINOR-001` aberto

- integrar e validar App Attest/Play Integrity (ou mecanismo oficial posterior)
  para que o backend possa produzir `server_verified`;
- builds assinados com a capability da Apple aprovada no App ID/provisioning;
- teste em dispositivo e sandbox Apple por faixa, recusa e revogação;
- teste Play Console da API beta 0.0.4 no Brasil por faixa, recusa,
  `VERIFICATION_REQUIRED` e revogação;
- revisar transição aos 18, mudança significativa e notificções de servidor;
- RIPD, declarações das lojas e sign-off jurídico/DPO.

## Fontes oficiais consultadas

- [Expo SDK 57 — AgeRange](https://docs.expo.dev/versions/v57.0.0/sdk/age-range/)
- [Apple — Declared Age Range](https://developer.apple.com/documentation/DeclaredAgeRange)
- [Apple — Age assurance developer Q&A](https://developer.apple.com/support/age-assurance)
- [Google — Play Age Signals API](https://developer.android.com/google/play/age-signals/use-age-signals-api)
- [Google Play — requisitos de distribuição no Brasil](https://support.google.com/googleplay/android-developer/answer/6223646)
