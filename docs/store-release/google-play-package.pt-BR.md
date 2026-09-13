# Google Play Console — pacote de revisão

**Não submeter:** este documento é um rascunho operacional. O checker bloqueia
a liberação até registro da organização, binário, URLs, formulários e testes.

## Configuração

- Package pretendido: `br.com.iaaprova.app` — comprovar reserva no Play Console.
- Version name/code inicial: `1.0.0 / 1`.
- Formato de produção: Android App Bundle (AAB).
- SDK alvo: Expo SDK 57 gera target/compile SDK 36; confirmar no AAB final.
- Categoria: Educação.
- País inicial: Brasil.
- Contém anúncios: **No**.
- Target audience: **13–15, 16–17 e 18+**; não selecionar grupos abaixo de 13.
- Designed for Families/Kids: **No**.
- Acesso restrito: fornecer conta adulta de revisão e instruções na área App
  access; usar dados sintéticos e senha somente no Console/cofre.

## IARC — respostas candidatas

- Aplicativo educacional, sem violência, sexo, linguagem ofensiva, drogas,
  apostas, dinheiro simulado ou conteúdo de horror.
- Interação entre usuários: **No no candidato atual**. Arena, amizade,
  ranking e duelo ainda não estão completos e não podem ser anunciados nem
  habilitados; refazer o IARC quando forem entregues.
- Compartilhamento de conteúdo/localização entre usuários: **No** no
  candidato atual.
- Compras digitais: assinatura mensal opcional pelo Google Play.
- Responder no questionário vigente e guardar o certificado. A classificação
  final é calculada pela IARC/Play Console; não estimar na listagem.

## Assinatura

- Subscription product ID: `iaaprova.pro.monthly`.
- Base plan ID: `monthly-auto-renewing`.
- Período/renovação: mensal auto-renovável; sem trial no lançamento.
- Entitlement RevenueCat: `pro`.
- Preço: localizado pelo Google Play; objetivo no Brasil de R$ 39,90 sujeito à
  configuração e aprovação da loja.
- Explicitar custo, ciclo mensal, renovação automática, benefícios e existência
  do plano gratuito antes da compra; manter restore e link de gerenciamento.
- Testar license testers, pendência, grace period, account hold, reembolso,
  revogação, duplicidade de webhook e troca de aparelho.

## App access — texto candidato em inglês

IA Aprova requires an account to synchronize progress and apply age/guardian
protections. Use the adult test credentials entered in Play Console. On first
access choose “18 anos ou mais” and acknowledge the Terms and Privacy Notice in
separate steps. The test account contains only synthetic data.

Main paths:

1. Today/Hoje: study overview.
2. Questions/Questões: start a study session.
3. Simulados: start and finish a simulation.
4. Profile > IA Aprova Pro: localized monthly offer, purchase and restore.
5. Profile > Settings: privacy, export and in-app account deletion.
The free experience is available with limits. Do not complete a real charge;
use the Google Play license-test account configured for this release.

## Data Safety e exclusão

Usar o mapeamento em `privacy-disclosures.pt-BR.md`. Não marcar “No data
collected”. Incluir práticas dos SDKs e backend, testar TLS e classificar
processadores conforme as definições do formulário.

Como o app cria conta, registrar os dois caminhos:

- no app: Perfil > Configurações > Excluir minha conta;
- web: `https://iaaprova.com.br/account-deletion/`.

O link web deve abrir diretamente as instruções/mecanismo de exclusão, estar
publicamente acessível e identificar IA Aprova e o desenvolvedor. Exclusão da
conta e cancelamento da assinatura são ações separadas; explicar ambas.

## Faixa etária fornecida pelo Google Play

Para o lançamento brasileiro 13+, integrar e testar a Play Age Signals API
antes da submissão. A autodeclaração interna não substitui o sinal da loja.
Registrar cenários 0–12, 13–15, 16–17, 18+, indisponível/erro, supervisão e
revogação; o backend nunca deve promover uma faixa mais jovem para adulta por
falha ou ausência do sinal.

## Release e segurança operacional

O perfil `store-draft` em `eas.json` aponta somente para track interno e
`releaseStatus: draft`. A primeira entrega Google pode exigir upload manual.
Não promover para produção sem closed test aplicável, Data Safety aprovado,
IARC, listagem, países/preço, testers e gates técnicos concluídos.
