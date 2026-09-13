# Política para responsáveis e menores

**Versão:** 0.1.0-draft  
**Vigência:** `{{EFFECTIVE_DATE}}`  
**Público do produto:** 13+  
**Status:** minuta; fluxo técnico e jurídico ainda devem ser homologados

## Princípios

O melhor interesse, a privacidade, a segurança e o desenvolvimento da pessoa
menor orientam o produto. A coleta deve ser mínima, a explicação adequada à
idade e as escolhas protetivas devem ser o padrão.

O IA Aprova não é destinado a menores de 13 anos. Se uma conta abaixo dessa
idade for identificada, ela deve ser restringida, sua compra impedida e o caso
encaminhado ao fluxo de privacidade, preservando apenas o necessário para
resolver a situação e cumprir a lei.

## Fluxo de faixa etária

O onboarding solicita somente a faixa:

- menos de 13;
- 13 a 15;
- 16 a 17;
- 18 ou mais.

Não solicitar data de nascimento completa sem justificativa documentada. Para
13 a 17 anos, o acesso inicial é privado e limitado enquanto o vínculo com o
responsável não for concluído.

O aplicativo também consulta, mediante a interface da Apple ou Google, a faixa
etária compartilhada pela loja. Esse sinal permanece separado da declaração
do titular: não a substitui e não libera recursos por si só. Ausência quando
obrigatório, recusa, erro, indicação de menor ou incompatibilidade mantêm
social e notificações desligados. Não retemos data de nascimento, installId da
Play Store, lista bruta de controles parentais ou documento usado pela loja.

## Vínculo e autorização

O responsável recebe convite em canal separado e confirma:

- que é responsável pela pessoa menor identificada por pseudônimo;
- que leu os Termos e a Política de Privacidade;
- autorizações granulares para conta, social, notificações e Pro;
- canal para revogar autorizações e solicitar acesso/exclusão.

O método de verificação deve ser proporcional e aprovado em RIPD; não se
presume que clicar em um e-mail seja suficiente em todos os casos. Não usar
documento ou biometria sem avaliação específica de necessidade, fornecedor,
retenção e alternativa menos invasiva.

## Configurações protetivas

Para menores:

- pseudônimo e avatar interno; sem foto, nome real ou localização;
- perfil não pesquisável fora de convite por código;
- social e notificações desligados por padrão;
- sem chat, feed, mensagem livre ou link externo enviado por usuário;
- ranking mostra somente pseudônimo e dados de desempenho necessários;
- denúncia e bloqueio sempre acessíveis;
- sem publicidade comportamental, venda de dados ou dark patterns;
- limites de horário/intensidade e lembretes de pausa devem ser avaliados no
  design apropriado à idade.

Autorização do responsável não remove o dever de minimização nem torna
qualquer prática aceitável.

## Assinatura

A compra depende dos controles da loja e, para a conta menor, da autorização
do responsável registrada no IA Aprova. Preço, recorrência, cancelamento e
ausência de trial devem ser apresentados ao responsável sem urgência artificial.

## Direitos e revogação

O menor deve receber explicação apropriada e pode solicitar ajuda diretamente.
O responsável pode revisar autorizações, desligar social/notificações,
desvincular ou pedir exclusão. Revogação futura não invalida tratamentos
anteriores legítimos, mas interrompe o tratamento opcional correspondente.

Ao atingir 18 anos, a conta deve apresentar novo aviso e permitir que a pessoa
confirme suas próprias escolhas antes de remover o vínculo do responsável.

## Contato

- Privacidade: `{{PRIVACY_EMAIL}}`
- Suporte: `{{SUPPORT_EMAIL}}`

Referências para a revisão: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
e [Lei nº 15.211/2025 — ECA Digital](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm).
