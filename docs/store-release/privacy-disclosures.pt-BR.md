# App Privacy e Data Safety — mapeamento candidato

**Auditado em:** 23/08/2026  
**Status:** conservador e bloqueado; as respostas finais dependem do binário,
tráfego observado, contratos e fichas vigentes de Clerk, RevenueCat, GCP,
Apple e Google. A empresa é responsável pelas declarações nas lojas.

## Comportamento observado no código

- Conta autenticada por Clerk: identificador, e-mail e, quando fornecidos pelo
  provedor de identidade, nome e imagem de perfil.
- Faixa etária, aceite de termos, reconhecimento do aviso de privacidade,
  vínculo de responsável e escolhas opcionais de social/notificações.
- Concurso/trilha, sessões, questões exibidas, respostas, tempo, progresso,
  revisões e simulados.
- Preferência opcional de social e resumo vazio da Arena. O build atual não
  entrega criação de amizade, ranking, matchmaking, duelo ou bloqueio; esses
  recursos não podem ser declarados como disponíveis.
- Produto, loja, estado da assinatura e entitlement por RevenueCat/backend; o
  app não recebe dados completos de cartão.
- IP, identificadores técnicos, integridade, sessões e logs podem ser tratados
  pelo backend/infraestrutura para segurança, fraude e operação.
- Pedido de suporte por e-mail e solicitações de exportação/exclusão.
- Sem SDK de publicidade, sem pedido ATT e sem finalidade declarada de tracking.

`expo-location` e `expo-image-picker` foram removidos do pacote. Isso ainda
precisa ser confirmado no Info.plist/PrivacyInfo agregados, no Android merged
manifest e no tráfego do binário candidato; o `app.json` isolado não prova
ausência de coleta.

O build também ainda não integra a Declared Age Range API nem a Play Age
Signals API. Para o público brasileiro 13+, a declaração interna de faixa
etária não substitui os sinais fornecidos pelas lojas.

## Apple App Privacy — respostas candidatas

Marcar **Yes, data is collected**. Para todos os itens abaixo: tracking **No**.

| Tipo no formulário | Coleta | Ligado ao usuário | Finalidades candidatas |
|---|---:|---:|---|
| Contact Info — Name | Sim, quando fornecido | Sim | App Functionality |
| Contact Info — Email Address | Sim | Sim | App Functionality, Other Purposes quando necessário para suporte |
| User Content — Photos or Videos | Possível via foto retornada pelo provedor de identidade | Sim | App Functionality; confirmar Clerk/SSO |
| User Content — Customer Support | Sim, quando a pessoa contata o suporte | Sim | App Functionality, Other Purposes |
| User Content — Other User Content | Sim: denúncia de questão e escolhas opcionais | Sim | App Functionality |
| Purchases — Purchase History | Sim para Pro | Sim | App Functionality; Analytics somente se confirmado |
| Identifiers — User ID | Sim | Sim | App Functionality, Product Personalization |
| Identifiers — Device ID | Possível/planejado para sessão e integridade | Sim ou pseudonimizado | App Functionality, Other Purposes; confirmar SDKs |
| Usage Data — Product Interaction | Sim | Sim | App Functionality, Product Personalization, Analytics |
| Diagnostics — Other Diagnostic Data | Sim se logs de cliente/SDK forem transmitidos | A confirmar | App Functionality, Other Purposes |
| Other Data | Sim: faixa etária, responsável, progresso e mastery | Sim | App Functionality, Product Personalization |

Não declarar `Precise Location`, contatos, saúde, biometria, áudio ou dados de
pagamento. IP pode permitir inferência geográfica: o encarregado deve confirmar
se a prática entra em `Coarse Location` segundo a configuração final dos logs.
Não declarar Crash Data enquanto não existir coleta real; reavaliar se uma
ferramenta de crash for adicionada.

O plugin SecureStore está configurado com `faceIDPermission: false`: o cache de
token não usa `requireAuthentication` e o build não deve declarar nem solicitar
Face ID. Confirmar a ausência de `NSFaceIDUsageDescription` no IPA final.

URLs do App Store Connect:

- Privacy Policy URL: `https://iaaprova.com.br/privacy/`
- User Privacy Choices URL: `https://iaaprova.com.br/account-deletion/`
- Lista de operadores: `https://iaaprova.com.br/subprocessors/`

## Google Play Data Safety — respostas candidatas

- O app coleta dados: **Sim**.
- O app compartilha dados: **não decidir automaticamente**. Classificar Clerk,
  RevenueCat, GCP e lojas pela definição e exceções de service provider após
  DPA/fichas de SDK. O checker exige essa aprovação.
- Dados criptografados em trânsito: responder **Sim** somente após teste do
  build e dos endpoints; HTTPS no código não é evidência suficiente.
- Exclusão disponível: **Sim** somente após E2E no app e URL pública válida.
- Independent security review: **Não**, salvo certificação aceita e vigente.

| Categoria / tipo Google | Coleta | Obrigatório? | Finalidades candidatas |
|---|---:|---|---|
| Personal info — Name | Sim, quando fornecido | Opcional | App functionality, Account management |
| Personal info — Email address | Sim | Obrigatório para a conta | App functionality, Account management, Developer communications |
| Personal info — User IDs | Sim | Obrigatório | App functionality, Account management, Fraud prevention/security |
| Personal info — Other info | Sim: faixa etária e responsável | Obrigatório conforme idade | App functionality, Account management, Safety |
| Financial info — Purchase history | Sim para Pro | Opcional | App functionality, Account management, Fraud prevention/security |
| Photos and videos — Photos | Possível via provedor de identidade | Opcional | App functionality; confirmar Clerk/SSO |
| App activity — App interactions | Sim | Obrigatório para estudo sincronizado | App functionality, Personalization, Analytics interna |
| App activity — Other user-generated content | Sim: denúncia de questão | Opcional | App functionality, Fraud prevention/security |
| App info and performance — Other performance data | Possível via logs/SDK | A confirmar | App functionality, Analytics, Fraud prevention/security |
| Device or other IDs | Possível/planejado | A confirmar | App functionality, Fraud prevention/security |

Não declarar coleta de localização, contatos, arquivos, áudio, saúde, mensagens
ou dados completos de cartão sem nova evidência no build candidato.

## Verificação obrigatória antes de copiar para as lojas

1. Gerar SBOM e inventário de SDKs do AAB/IPA.
2. Inspecionar `PrivacyInfo.xcprivacy` agregado e Android merged manifest.
3. Observar tráfego de instalação, login, Apple/Google SSO, estudo, social,
   compra, restore, exportação e exclusão.
4. Conferir painéis e documentação de privacidade dos operadores na versão
   realmente empacotada.
5. Obter aprovação de privacidade/jurídico e exportar as respostas submetidas.
6. Reexecutar o checker com hashes e evidências do build.
7. Testar os sinais de idade das lojas, indisponibilidade/erro e revogação
   sem promover silenciosamente uma conta menor para adulta.
