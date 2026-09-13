# Runbook de direitos, exportação e exclusão

**Versão:** 0.1.0-draft  
**Owner operacional:** `{{PRIVACY_OPERATIONS_OWNER}}`  
**Escalonamento:** `{{DPO_NAME}}`, `{{DPO_EMAIL}}`

## Canais e tipos

Aceitar solicitação pelo app, `{{PRIVACY_EMAIL}}`, suporte e página
`https://{{DOMAIN}}/account-deletion/`. Nunca exigir que a pessoa cite a LGPD.

Tipos: confirmação/acesso, correção, portabilidade, informação de
compartilhamento, revogação, oposição, revisão automatizada, bloqueio,
anonimização e exclusão.

## Metas internas

As metas abaixo são operacionais e não substituem prazos legais:

- protocolo automático/imediato;
- triagem e confirmação do canal em até 2 dias úteis;
- confirmação de existência/acesso em formato simplificado imediatamente,
  quando essa modalidade for solicitada e a identidade estiver verificada;
- correção simples em até 5 dias úteis;
- declaração completa de acesso em até 15 dias corridos, alinhada ao art. 19
  da LGPD, salvo mudança normativa aplicável;
- exclusão operacional em até 30 dias corridos e expiração de backups em até
  90 dias, conforme arquitetura aprovada;
- atualização a cada 10 dias se a solicitação depender de terceiro.

## 1. Receber e registrar

Gerar `DSR-ID`, data/hora, canal, tipo, versão da política, solicitante,
conta afetada, status, prazo, owner e evidência. Não copiar o conteúdo do
pedido para canais informais.

## 2. Verificar identidade proporcionalmente

- Usuário autenticado: reautenticar e confirmar fator existente.
- E-mail: enviar desafio apenas ao e-mail já verificado.
- Responsável: verificar vínculo registrado e escopo de representação.
- Conta inacessível: combinar sinais de baixo risco; documento somente após
  aprovação do encarregado e com canal/retenção específicos.

Não revelar se um e-mail possui conta antes da verificação. Se houver risco
de tomada de conta, pausar e escalar para segurança.

## 3. Localizar dados

Consultar pelo UUID interno, nunca apenas por texto livre:

- identidade/Clerk;
- perfil, faixa etária, responsável e consentimentos;
- estudo, tentativas, progresso, simulados e offline sincronizado;
- social, denúncias, bloqueios, ranking e duelos;
- RevenueCat/entitlements e referências de loja;
- suporte, logs, auditoria, incidente e legal holds;
- cache, objeto, fila/outbox e backups.

Registrar sistemas consultados, contagem e resultado. Dados de terceiros devem
ser redigidos ou separados.

## 4. Exportar

Gerar arquivo ZIP criptografado com:

- `profile.json`, `consents.json`, `subscriptions.json`, `social.json`;
- `attempts.csv`, `progress.csv`, `simulations.csv`;
- `README.txt` com campos, datas UTC, limitações e contato.

Não incluir gabaritos sigilosos, segredos, controles antifraude detalhados,
dados de outras pessoas ou informação protegida por direito de terceiros.
Entregar por link de uso único, autenticado, com expiração de 7 dias. Senha,
se usada, vai por canal separado. Registrar hash, criação, download e expiração.

**Estado técnico atual:** a fundação entrega JSON canônico por proxy
autenticado, com geração fixada, expiração, faixas limitadas e auditoria de
acesso. Ela ainda não implementa o pacote ZIP/CSV descrito acima nem um token
de link de uso único. Portanto, esta camada reduz exposição, mas não fecha o
gate `DSR-001` nem autoriza publicação.

## 5. Excluir

Antes da confirmação:

- explicar que a exclusão é permanente;
- oferecer exportação sem torná-la obrigatória;
- mostrar que excluir não cancela a assinatura da Apple/Google;
- fornecer link de gerenciamento da loja;
- permitir iniciar e confirmar imediatamente o pedido mesmo com assinatura
  ativa, informando o prazo de conclusão no ambiente ativo e em backups.

Orquestração idempotente:

1. reautenticar e criar `deletion_request_id`;
2. revogar sessões/tokens e impedir novos eventos;
3. remover perfil social, amizades e matchmaking;
4. tombstonar UUID e desvincular identidade do estudo;
5. apagar/anonimizar tabelas conforme matriz;
6. apagar identidade no Clerk e alias no RevenueCat sem apagar evidência
   mínima de transação legalmente conservada;
7. invalidar caches, objetos, exports, push tokens, filas e pacotes offline;
8. registrar itens preservados, base, prazo e acesso restrito;
9. adicionar UUID ao ledger de supressão de restore de backup;
10. emitir confirmação sem expor dados e encerrar o protocolo.

Backups expiram no ciclo de até 90 dias. Restore deve reaplicar o ledger antes
de liberar o banco restaurado.

## 6. Negar ou limitar

Qualquer limitação exige fundamento registrado, aprovação do encarregado e
resposta clara sobre razões e meios de contestação, sem revelar segredo que
comprometa segurança ou direitos de terceiros. Nunca rejeitar automaticamente
por volume sem avaliar abuso real.

## 7. QA e evidência

Executar mensalmente em staging: conta adulta, menor/responsável, Pro ativo,
compra reembolsada, conta com denúncia, export expirado e restore de backup.
Trimestralmente, sortear casos encerrados e conferir completude, prazo,
minimização e eliminação nos operadores.

Referências: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm),
[Apple](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
e [Google Play](https://support.google.com/googleplay/android-developer/answer/13327111).
