# Fontes oficiais consultadas em 23/08/2026

Esta fotografia de requisitos expira em **23/11/2026** ou antes se Apple,
Google ou Expo anunciarem mudança. Revalidar nos 90 dias anteriores à
submissão e na data do build candidato.

## Apple

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  — cobrança digital, login, privacidade, metadados e revisão.
- [Upcoming SDK minimum requirements](https://developer.apple.com/news/?id=ueeok6yw)
  — desde 28/04/2026, upload iOS/iPadOS exige build com SDK 26 ou posterior.
- [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
  — questionário obrigatório; app unrated não pode ser publicado; permite
  override para idade mínima maior.
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)
  — autodeclaração interna não deve ser confundida com age assurance; social
  media desabilitada para menores de 13 exige ao menos Declared Age Range.
- [Declared Age Range](https://developer.apple.com/documentation/DeclaredAgeRange)
  — a capability/API do sistema fornece faixa e origem preservando privacidade.
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
  — URL de privacidade e declarações abrangendo app e terceiros.
- [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
  — apps com criação de conta devem iniciar exclusão completa no app.
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
  — 1 a 10 screenshots, PNG/JPEG sem alpha e tamanhos por display.
- [Complying with encryption export regulations](https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations)
  — `ITSAppUsesNonExemptEncryption=NO` somente para ausência de criptografia
  ou uso exclusivamente isento, considerando bibliotecas de terceiros.
- [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
  — ícone quadrado, conteúdo centrado e sem máscara pré-aplicada.

## Google Play / Android

- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
  — a partir de 31/08/2026, novos apps/updates precisam target API 36+.
- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152)
  — AAB, assinatura e incremento de versionCode; nome 30, descrição curta 80 e
  completa 4000 caracteres.
- [Provide information for Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
  — formulário obrigatório, inclusive práticas dos SDKs/terceiros.
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
  — conta criada no app exige exclusão no app e recurso web público.
- [Requisitos de distribuição por país/região](https://support.google.com/googleplay/android-developer/answer/6223646?hl=pt-BR)
  — ECA Digital vigente desde 17/03/2026; apps destinados ou provavelmente
  acessados por menores no Brasil devem ingerir sinais etários da loja. A Play
  Age Signals API beta é o mecanismo disponibilizado pelo Google Play.
- [Subscriptions policy](https://support.google.com/googleplay/android-developer/answer/9900533)
  — custo, frequência, renovação e termos materiais devem estar claros.
- [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)
  — requisitos de ícone, feature graphic e screenshots da listagem.
- [Google Play icon design specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)
  — store icon 512 × 512, PNG 32-bit, sRGB, até 1024 KB, sem máscara/sombra da
  loja.

## Expo

- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
  — SDK 57: React Native 0.86, React 19.2.3, Node mínimo 22.13, Android
  compile/target 36, iOS 16.4+ e Xcode 26.4+.
- [App config](https://docs.expo.dev/versions/v57.0.0/config/app/)
  — bundle/package, versões, permissões, blockedPermissions e manifests.
- [Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
  — `ios.privacyManifests` e auditoria das required-reason APIs de dependências.
- [Expo AgeRange](https://docs.expo.dev/versions/v57.0.0/sdk/age-range/)
  — `expo-age-range` integra Declared Age Range no iOS e Play Age Signals no
  Android; no SDK 57 ainda é alpha e exige teste real/sandbox.
- [Splash screen and app icon](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)
  — requisitos de ícone iOS e adaptive/monochrome Android.
- [Submit to app stores](https://docs.expo.dev/deploy/submit-to-app-stores/)
  — EAS Submit envia binário, mas não conclui metadados, screenshots nem
  publicação; AAB/IPA precisa estar assinado.

## Decisões derivadas

- Fixar EAS em Node 22.23.1 e image `sdk-57` para builds candidatos.
- Não adicionar associated domains/universal links: o build atual não depende
  deles; capabilities sem uso aumentam superfície e exigem verificação de DNS.
- Manter custom URL scheme do Expo/AuthSession e testar redirects Clerk em
  binário nativo.
- Manter permissões de localização/câmera/mídia bloqueadas e auditar sua
  ausência no merged manifest depois da remoção das dependências não usadas.
- Não marcar Kids/Designed for Families; público mínimo 13+ com proteções de
  responsável.
- Integrar os sinais etários das lojas antes do lançamento brasileiro 13+; a
  faixa informada manualmente no cadastro não substitui esse gate.
