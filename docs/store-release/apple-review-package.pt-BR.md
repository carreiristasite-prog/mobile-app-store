# Apple App Store Connect — pacote de revisão

**Não submeter:** campos de acesso e contato permanecem em
`release-evidence.json` e o checker deve falhar enquanto estiverem vazios.

## Configuração

- Bundle ID pretendido: `br.com.iaaprova.app` — comprovar reserva na conta da
  organização.
- Versão/build inicial: `1.0.0 (1)`.
- Plataforma: iPhone, orientação retrato, iPad não selecionado. Mesmo assim,
  testar o modo de compatibilidade no iPad antes da revisão.
- Categoria: Educação; secundária Referência.
- Made for Kids: **No**. Produto direcionado a 13+.
- Conteúdo de terceiros: **Yes**, com direitos comerciais comprovados antes de
  publicação de cada item.
- Sign in with Apple: habilitado por capability/plugin e botão nativo; validar
  em aparelho e configurar Private Email Relay.
- Export compliance: `usesNonExemptEncryption: false` porque a hipótese atual é
  somente criptografia de sistema/HTTPS e armazenamento seguro. Jurídico e
  mobile devem confirmar também as bibliotecas do IPA.

## Rascunho de classificação etária Apple

O questionário vigente deve ser respondido no App Store Connect e exportado.
Valores candidatos:

- In-app controls: age assurance — **No no build atual**. A autodeclaração
  interna de faixa etária não substitui a Declared Age Range API. Mudar para
  **Yes** somente depois da integração e do teste em sandbox. Parental controls
  — responder **Yes** apenas se o fluxo de responsável satisfizer a definição
  exibida no questionário e tiver E2E aprovado.
- User-generated content e social media: **No no candidato atual**. O produto
  planejado inclui Arena, mas os fluxos completos não estão implementados e
  não podem ser anunciados ou habilitados. Refazer as respostas quando forem
  entregues.
- Messaging and chat: **No**.
- Advertising: **No**.
- Unrestricted web access: **No**; somente links delimitados de
  termos/privacidade/suporte e autenticação do sistema.
- Gambling, simulated gambling, loot boxes, sexual content, violence, horror,
  profanity, alcohol/tobacco/drugs: **None/No**.
- Contests: **No no candidato atual**. Reavaliar conservadoramente quando
  ranking/duelos forem implementados, ainda que não tenham prêmio ou sorte.
- Override: **13+**, alinhado ao público mínimo do produto. Não entrar na Kids
  Category.

## Assinatura auto-renovável

- Product ID: `iaaprova.pro.monthly`.
- Entitlement RevenueCat: `pro`.
- Duração: um mês; sem trial no lançamento.
- Preço: localizado pela App Store; objetivo comercial no Brasil de R$ 39,90,
  sujeito ao preço aprovado na loja.
- Tela de compra deve mostrar preço/moeda da StoreKit, renovação mensal,
  benefícios, acesso gratuito disponível, Termos e Privacidade.
- Restore e gerenciamento devem permanecer visíveis.
- Criar grupo de assinatura, localização pt-BR, screenshot de revisão do IAP e
  testar compra, restore, expiração, grace period, reembolso e troca de aparelho.

## Notes for Review — texto candidato em inglês

IA Aprova is an independent educational study app for Brazilian exams. It is
not affiliated with any exam board or public agency and does not guarantee
approval.

An account is required to synchronize study progress, enforce age/guardian
protections, restore the optional Pro subscription, and support account export
and deletion. Please use the adult reviewer account supplied in App Store
Connect. On first access select “18 anos ou mais”, then review and affirm the
Terms and the Privacy Notice separately.

The free experience remains available with usage limits. Pro is an optional
monthly auto-renewable subscription. The app displays the StoreKit localized
price. Purchase and Restore Purchases are available under Profile > IA Aprova
Pro. Apple remains the billing authority; our backend is authoritative for the
Pro entitlement after store validation.

Account deletion is available under Profile > Settings > Excluir minha conta.
The user can initiate permanent deletion in the app without contacting support.
The screen explains that deleting the IA Aprova account does not cancel an
active Apple subscription and links to Apple subscription management.

Sign in with Apple uses the native Apple button. The app uses only standard
operating-system/HTTPS encryption according to the current export-compliance
assessment. Legal, privacy, support and account-deletion pages are linked in
the metadata and in the app.

## Instruções de acesso ao revisor

Preencher os campos secretos somente no App Store Connect e no cofre de
credenciais, nunca neste repositório:

1. conta adulta Free dedicada, sem MFA ou com procedimento de MFA documentado;
2. senha/referência secreta;
3. estado inicial limpo e dados sintéticos;
4. passos para chegar a Questões, Simulados, Social, Pro e Exclusão;
5. contato de revisão disponível durante a janela da Apple.

Não fornecer uma conta menor ficticiamente aprovada. Se o fluxo menor precisar
de revisão, fornecer duas contas sintéticas e explicar o vínculo sem expor
dados reais de criança/adolescente.

## Bloqueio de idade e social

Antes de qualquer submissão, integrar e testar a Declared Age Range API no
iOS. A autodeclaração interna continua sendo uma regra de produto, mas não é
evidência do sinal fornecido pela loja. Arena, amizade, ranking e duelo
permanecem fora da listagem e devem ficar desabilitados até a entrega integral
de idade, responsável, denúncia, bloqueio e moderação.
