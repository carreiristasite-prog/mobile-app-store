# Política de Privacidade do IA Aprova

**Versão:** 0.1.0-draft  
**Vigência:** `{{EFFECTIVE_DATE}}`  
**Controlador:** `{{LEGAL_NAME}}`, CNPJ `{{CNPJ}}`, `{{LEGAL_ADDRESS}}`  
**Encarregado/canal:** `{{DPO_NAME}}`, `{{DPO_EMAIL}}`  
**Status:** minuta bloqueada para publicação

## 1. A quem esta política se aplica

Esta Política explica como o IA Aprova trata dados pessoais no aplicativo,
site, suporte, recursos sociais e operações de assinatura. O serviço é
destinado a pessoas com 13 anos ou mais. Para menores de 18 anos, aplicam-se
proteções adicionais e o fluxo de responsável.

## 2. Dados tratados e finalidades

| Categoria | Exemplos | Finalidades principais |
|---|---|---|
| Conta e identidade | identificador interno, e-mail, provedor de login, faixa etária | autenticar, proteger e administrar a conta |
| Responsável | e-mail, vínculo, autorizações, histórico de revogação | proteger menores e gerenciar permissões |
| Perfil de estudo | concurso, matérias, metas e preferências | personalizar a experiência educacional |
| Aprendizado | questões exibidas, respostas, tempo, progresso e simulados | corrigir, recomendar revisões e apresentar desempenho |
| Social | pseudônimo, avatar interno, amizades, duelo, ranking, bloqueios e denúncias | operar recursos sociais e moderar abuso |
| Assinatura | produto, entitlement, estado, loja, recibo/token pseudonimizado e eventos | liberar Pro, restaurar acesso, reconciliar e prevenir fraude |
| Dispositivo e segurança | IP, plataforma, versão, identificadores antifraude, logs e sinais de integridade | segurança, prevenção a fraude, diagnóstico e disponibilidade |
| Suporte e direitos | mensagens, anexos voluntários, protocolo e evidência de identidade | responder solicitações e cumprir obrigações |
| Consentimentos | versões aceitas, data, finalidade e prova do ato | demonstrar escolhas e obrigações de transparência |

Não planejamos coletar foto, localização precisa, contatos, agenda, chat,
feed, nome real para o social, dados de saúde ou biometria. Sinais produzidos
por App Attest/Play Integrity não devem ser usados para identificação
biométrica. Se a implementação real divergir, esta Política e as declarações
das lojas deverão ser atualizadas antes da coleta.

## 3. Bases legais

Conforme a finalidade e o contexto, o tratamento poderá se apoiar em:

- execução do contrato e procedimentos preliminares para conta, estudo e Pro;
- cumprimento de obrigação legal/regulatória;
- exercício regular de direitos;
- legítimo interesse, após teste documentado de necessidade e balanceamento,
  para segurança, melhoria estritamente necessária e prevenção de fraude;
- consentimento específico e destacado quando exigido, inclusive para escolhas
  opcionais e situações envolvendo menores em que essa seja a base aplicável;
- proteção da vida/incolumidade, quando aplicável a uma situação concreta.

O consentimento não será usado como base genérica quando outra base mais
adequada reger o tratamento. A matriz operacional registra a base por
finalidade e depende de aprovação jurídica. O melhor interesse de crianças e
adolescentes orienta todas as decisões, mas não é tratado como uma base legal
autônoma.

## 4. Como os dados são obtidos

Recebemos dados informados no app/site, gerados durante o uso, enviados pela
loja/RevenueCat e pelos provedores contratados de autenticação e
infraestrutura. Não compramos listas de dados pessoais e não vendemos dados.
Não usamos publicidade comportamental nem trackers publicitários no escopo de
lançamento.

## 5. Compartilhamento e operadores

Dados são compartilhados somente no limite necessário com:

- Apple e Google, que operam loja, cobrança e seus próprios ambientes;
- `{{REVENUECAT_LEGAL_NAME}}`, para eventos e entitlement de assinatura;
- `{{CLERK_LEGAL_NAME}}`, para autenticação;
- `{{GCP_LEGAL_NAME}}`, para infraestrutura, banco, cache, armazenamento,
  logs e entrega;
- fornecedores aprovados de suporte, segurança ou comunicação listados em
  `https://{{DOMAIN}}/subprocessors/`;
- autoridades ou terceiros quando exigido por lei, ordem válida, defesa de
  direitos ou resposta proporcional a fraude/incidente.

Cada integração exige contrato/DPA, controle de acesso e verificação das
práticas do fornecedor. A lista exata dos fornecedores é um bloqueador de
release.

## 6. Transferências internacionais

Embora a região primária pretendida seja São Paulo, alguns fornecedores podem
tratar ou prestar suporte fora do Brasil. Antes do lançamento,
`{{LEGAL_NAME}}` documentará países, finalidade, destinatários e mecanismo
aplicável de transferência internacional, incluindo garantias contratuais
quando necessário. A matriz de transferências deverá estar aprovada antes de
qualquer fluxo real.

## 7. Retenção e eliminação

Dados identificáveis serão conservados pelo período necessário à finalidade.
Ao excluir a conta, dados operacionais entram em fila de eliminação; cópias
de segurança expiram pelo ciclo definido e não devem retornar ao ambiente
ativo. Alguns registros podem ser segregados e conservados para obrigação
legal, defesa de direitos ou prevenção de fraude.

Os prazos propostos constam na
[matriz de dados](../compliance/data-processing-matrix.pt-BR.md) e só entram em
vigor após aceite jurídico/contábil em `{{RETENTION_SIGNOFF_DATE}}`. Dados
anonimizados de forma efetiva podem ser mantidos para estatística e melhoria,
sem tentativa de reidentificação.

## 8. Segurança

O IA Aprova pretende aplicar controle de acesso, criptografia em trânsito e
repouso, segregação de ambientes, logs, revisão de dependências, backup e
resposta a incidentes. Nenhum sistema é infalível. Incidentes com risco ou
dano relevante serão avaliados e comunicados conforme a legislação e o
regulamento da ANPD aplicáveis.

## 9. Direitos da pessoa titular

A pessoa titular ou, quando aplicável, seu responsável pode solicitar:

- confirmação do tratamento e acesso;
- correção;
- informação sobre compartilhamento;
- anonimização, bloqueio ou eliminação nos casos cabíveis;
- portabilidade conforme regulamentação aplicável;
- revisão de decisões automatizadas nos casos previstos;
- revogação do consentimento e informação sobre suas consequências;
- oposição e peticionamento perante a ANPD ou órgãos de defesa.

Solicite pelo app, por `https://{{DOMAIN}}/account-deletion/` ou pelo e-mail
`{{PRIVACY_EMAIL}}`. Podemos pedir confirmação proporcional de identidade sem
coletar dados excessivos. A solicitação é gratuita, salvo hipótese legal.

## 10. Menores

Aplicamos minimização, configurações protetivas, linguagem apropriada e
controle do responsável. Não usamos dados de menores para publicidade
comportamental. Social e notificações ficam desligados por padrão. Mais
detalhes constam na política específica.

## 11. Decisões e adaptação

O app usa regras determinísticas para recomendação de estudo, detecção de
fraude e moderação. Não há IA externa no aplicativo ou backend de produção.
Uma decisão com efeito relevante sobre conta ou acesso deve permitir
contestação e revisão por canal de suporte.

## 12. Mudanças e contato

Mudanças materiais serão comunicadas previamente. Versões anteriores e a data
de vigência ficarão em `https://{{DOMAIN}}/privacy/`.

- Controlador: `{{LEGAL_NAME}}`, CNPJ `{{CNPJ}}`
- Encarregado/canal: `{{DPO_NAME}}`, `{{DPO_EMAIL}}`
- Suporte: `{{SUPPORT_EMAIL}}`

Fontes de referência: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
e [ANPD](https://www.gov.br/anpd/pt-br).
