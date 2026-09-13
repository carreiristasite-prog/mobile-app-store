# Assinatura, cancelamento e reembolso

**Versão:** 0.1.0-draft  
**Vigência:** `{{EFFECTIVE_DATE}}`  
**Status:** minuta bloqueada para publicação

## Oferta de lançamento

O IA Aprova terá um único produto recorrente:

- produto/SKU: `iaaprova.pro.monthly`;
- entitlement interno: `pro`;
- periodicidade: mensal;
- preço pretendido no Brasil: R$39,90;
- sem teste grátis automático;
- sem plano anual no lançamento.

O valor vinculante, a moeda, os tributos e a data da cobrança são exibidos
pela Apple App Store ou Google Play antes da confirmação. O app não deve
inserir um preço fixo quando ele divergir do preço localizado retornado pela
loja.

## O que o Pro libera

Durante a vigência do entitlement Pro, a pessoa assinante tem acesso a todos
os concursos publicados, questões e simulados ilimitados, duelos ilimitados,
revisão personalizada, análises detalhadas e pacotes offline, respeitadas
regras de uso justo, disponibilidade e segurança informadas nos Termos.

## Renovação e cobrança

A assinatura é renovada automaticamente pela loja até ser cancelada. A
cobrança, os meios de pagamento e o gerenciamento pertencem à conta da loja.
O IA Aprova usa a RevenueCat para interpretar eventos e liberar o entitlement,
mas não recebe o número completo do cartão.

Falha de pagamento, período de graça, pausa, reembolso, revogação ou
chargeback podem alterar o acesso. O backend, e não o aplicativo, é a fonte de
verdade do entitlement.

## Como cancelar

Cancelar impede renovações futuras e, em regra, mantém o Pro até o fim do
período já pago, conforme as regras exibidas pela loja.

- Apple: Ajustes/Conta Apple/Assinaturas ou
  <https://apps.apple.com/account/subscriptions>.
- Google Play: Play Store/Pagamentos e assinaturas/Assinaturas ou
  <https://play.google.com/store/account/subscriptions>.

O app deve oferecer botão **Gerenciar assinatura** que abra o destino correto.

## Exclusão da conta

Excluir a conta IA Aprova **não cancela automaticamente a assinatura da
loja**. Antes da confirmação, o app e a página web devem:

1. mostrar o estado da assinatura conhecido;
2. orientar o cancelamento na loja;
3. permitir iniciar e confirmar imediatamente o pedido de exclusão, mesmo se
   a assinatura continuar ativa, sem prometer eliminação instantânea de todos
   os sistemas e backups;
4. explicar que a cobrança poderá continuar até o cancelamento na loja.

## Restaurar compras

O app deve fornecer **Restaurar compras** sem nova cobrança. A restauração
consulta a loja/RevenueCat e associa o entitlement à conta autenticada após
controles contra transferência indevida. Erros devem apresentar suporte e não
simular sucesso.

## Reembolso

Pedidos de reembolso seguem o processo e as regras da loja em que ocorreu a
compra:

- Apple: <https://reportaproblem.apple.com/>;
- Google Play: <https://support.google.com/googleplay/workflow/9813244>.

O IA Aprova prestará informações de suporte e cumprirá direitos obrigatórios
do consumidor, inclusive o direito de arrependimento quando aplicável ao caso
concreto. Este texto não reduz direitos legais, transfere integralmente a
responsabilidade do fornecedor à loja nem promete aprovação de reembolso.

## Contato

- Suporte: `{{SUPPORT_EMAIL}}`
- Identificador da compra/protocolo: solicitar apenas o mínimo necessário;
  nunca pedir senha, número completo do cartão ou código de autenticação.

Referências operacionais: [Apple — exclusão de conta](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
e [Google Play — política de pagamentos](https://support.google.com/googleplay/android-developer/answer/10281818).
