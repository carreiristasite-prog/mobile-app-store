# Worksheet App Privacy (Apple) e Data Safety (Google)

**Versão:** 0.1.0-draft  
**Build auditado:** `{{STORE_BUILD_HASH}}`  
**Data da auditoria:** `{{STORE_AUDIT_DATE}}`  
**Responsável:** `{{STORE_PRIVACY_OWNER}}`

> Isto é um rascunho, não a declaração final. Respostas devem ser refeitas a
> partir do build candidato, manifests de privacidade, SDKs, tráfego observado
> e contratos. Processamento por fornecedor ainda pode ser coleta/compartilhamento
> segundo as definições específicas de cada loja.

## Escopo declarado

- Conta obrigatória para recursos sincronizados.
- Sem publicidade e sem rastreamento entre apps/sites.
- Sem venda de dados.
- Sem foto, contatos, localização precisa, saúde, biometria ou chat.
- Autenticação, GCP, RevenueCat, StoreKit/Play Billing, App Attest e Play
  Integrity sujeitos à auditoria do build.

## Apple App Privacy — respostas preliminares

| Tipo Apple aproximado | Coletado? | Ligado ao usuário? | Tracking? | Finalidade | Evidência antes do envio |
|---|---:|---:|---:|---|---|
| Contact Info / Email Address | Sim | Sim | Não | conta, autenticação, suporte | payload Clerk e banco |
| User ID | Sim | Sim | Não | conta, estudo, assinatura | UUIDs e RevenueCat App User ID |
| Other Data / faixa etária, sinal etário da loja e status de responsável | Sim | Sim | Não | proteção de menores e autorizações | onboarding, platform_age_signals, consentimentos e guardian link |
| Purchases | Sim | Sim | Não | entitlement, restore, fraude | StoreKit/RevenueCat eventos |
| Product Interaction | Sim | Sim | Não | progresso, personalização, funcionalidade | eventos/tabelas de tentativa |
| Other User Content | Sim | Sim | Não | pseudônimo e denúncia | formulários e payloads sociais |
| User Content / Customer Support | Se o app coletar | Sim | Não | atendimento e exercício de direitos | mensagens e anexos do build candidato |
| Diagnostics / Crash Data | `{{CRASH_SDK_ENABLED}}` | A confirmar | Não | estabilidade e segurança | SDK/config/tráfego |
| Device ID | Sim, se integridade/sessão | Sim/pseudonimizado | Não | segurança, fraude | App Attest e device registry |
| Coarse Location via IP | Possível | A confirmar | Não | segurança/routing | logs e política do provedor |

Confirmar se pseudônimo/denúncia encaixa em `Other User Content`, se IP
gera localização e como cada SDK trata diagnóstico. Se qualquer SDK usar dados
para tracking, a resposta `Não` deixa de ser válida e pode haver requisito ATT.

## Google Play Data Safety — respostas preliminares

| Categoria Google aproximada | Coleta | Compartilha?* | Obrigatória/opcional | Finalidade |
|---|---:|---:|---|---|
| Personal info / Email address | Sim | A confirmar | obrigatória para conta | account management |
| Personal info / User IDs | Sim | A confirmar | obrigatória | account management, security |
| Personal info / Other info | Sim | A confirmar | faixa etária obrigatória; autorizações conforme idade | child safety, account management |
| App activity / App interactions | Sim | A confirmar | obrigatória para estudo | app functionality, personalization |
| App activity / Other user-generated content | Sim | A confirmar | social opcional; suporte voluntário | functionality, fraud prevention |
| Files and docs | Se houver anexo no suporte | A confirmar | opcional | customer support |
| Financial info / Purchase history | Sim | A confirmar | somente Pro | purchase, account management, fraud prevention |
| App info and performance / Crash logs | `{{CRASH_SDK_ENABLED}}` | A confirmar | diagnóstico | analytics/performance |
| Device or other IDs | Sim, se integridade/sessão | A confirmar | segurança | security, fraud prevention |

\* Classificar conforme a definição vigente do formulário e exceções de
service provider; não assumir que DPA elimina a necessidade de declarar.

Respostas planejadas adicionais:

- dados criptografados em trânsito: **Sim**, somente após teste TLS;
- usuário pode solicitar exclusão: **Sim**, app + URL pública;
- revisão de segurança independente: responder apenas com certificação aceita
  e vigente; caso contrário, **Não**;
- dados efêmeros: responder por categoria, não genericamente;
- direcionado a crianças: produto é 13+, mas faixa etária/declarações devem
  ser validadas com o comportamento e políticas vigentes.

## URLs e metadados obrigatórios

- Privacidade: `https://{{DOMAIN}}/privacy/`
- Termos: `https://{{DOMAIN}}/terms/`
- Exclusão: `https://{{DOMAIN}}/account-deletion/`
- Suporte: `https://{{DOMAIN}}/support/`
- Apple App ID: `{{APPLE_STORE_APP_ID}}`
- Android package: `{{GOOGLE_PLAY_PACKAGE}}`

## Checklist do build candidato

- [ ] gerar SBOM e inventário de SDKs/permissões;
- [ ] inspecionar PrivacyInfo.xcprivacy e manifests Android;
- [ ] observar tráfego de primeiro uso, login, estudo, social, compra e suporte;
- [ ] confirmar a classificação de faixa etária, vínculo/autorizações
  do responsável e anexos de suporte em ambos os formulários;
- [ ] testar consentimento, menor, opt-out, export e exclusão;
- [ ] testar Declared Age Range/Play Age Signals em aparelhos e sandboxes reais, inclusive recusa, revogação, conflito e ausência;
- [ ] confrontar tabelas/filas/logs e painel de cada operador;
- [ ] exportar respostas submetidas e anexar ao release;
- [ ] revisar políticas imediatamente antes de submeter.

Referências: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
e [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111).
