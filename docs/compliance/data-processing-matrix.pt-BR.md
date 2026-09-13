# Matriz de tratamento, bases, retenção e fornecedores

**Versão:** 0.1.0-draft  
**Aprovação de retenção:** `{{RETENTION_SIGNOFF_DATE}}`  
**Controlador:** `{{LEGAL_NAME}}`, CNPJ `{{CNPJ}}`  
**Região primária pretendida:** GCP São Paulo (`southamerica-east1`), sujeita
a validação da arquitetura efetivamente contratada

> Os prazos abaixo são defaults de produto, não conclusões legais. Jurídico,
> contabilidade, segurança e engenharia devem aprovar ou substituir cada prazo
> antes da produção.

## Registro de tratamentos

| ID | Dados / titulares | Finalidade | Base proposta | Fonte | Destinatários/operadores | Retenção proposta | Destino |
|---|---|---|---|---|---|---|---|
| ID-01 | ID interno, e-mail, provedor de login; usuário/responsável | criar, autenticar e recuperar conta | contrato; segurança por legítimo interesse documentado | titular, Clerk/Apple/Google login | Clerk; GCP | conta ativa + 30 dias após exclusão; backup até 90 dias | apagar; manter somente registro segregado quando exigido |
| ID-02 | faixa etária, status e ID do responsável; menor/responsável | aplicar proteções e autorizações | **bloqueada até RIPD e análise por finalidade**: consentimento específico/destacado quando exigido; contrato ou obrigação legal somente quando aplicáveis. Melhor interesse é princípio, não base isolada | titular e responsável | GCP; provedor de verificação `{{AGE_PROVIDER_OR_NONE}}` | conta ativa + 30 dias; prova de autorização por 5 anos após fim do vínculo | apagar ou segregar prova mínima |
| ID-03 | faixa normalizada, plataforma, fonte, status de compartilhamento, trust e timestamps; usuário | aplicar proteções etárias exigidas pela loja sem coletar nascimento exato | **bloqueada até RIPD e parecer jurídico**; obrigação legal quando confirmada por jurisdição | Apple Declared Age Range / Google Play Age Signals via dispositivo | Apple/Google; GCP | conta ativa + 30 dias; sem installId, data de nascimento, controles parentais brutos ou método de documento | apagar com a conta; auditoria mínima conforme AUD-01 |
| EDU-01 | concurso, metas, preferências | configurar trilha | contrato | titular | GCP | conta ativa + 30 dias | apagar |
| EDU-02 | exposição, resposta, tempo, simulado e progresso | corrigir, adaptar estudo e exibir histórico | contrato | uso do app | GCP/Redis | conta ativa + 30 dias; agregados anonimizados sem prazo predefinido | apagar identificadores; anonimizar agregado |
| EDU-03 | respostas válidas e sinais de qualidade | calibrar itens e detectar erro | legítimo interesse com LIA; contrato | uso do app | GCP | identificável pelo prazo EDU-02; estatística efetivamente anônima sem prazo | anonimizar |
| SOC-01 | pseudônimo, avatar, amizade, ranking e duelo | operar social | contrato/consentimento quando opcional | titular e eventos de uso | GCP/Redis | conta ativa + 30 dias; temporada publicada por 90 dias | apagar ou anonimizar resultado |
| SOC-02 | bloqueios, denúncias, evidências e decisões | segurança e moderação | legítimo interesse; exercício de direitos | usuários e sistema | GCP; suporte aprovado | 2 anos após encerramento do caso, sujeito a legal hold | apagar ou segregar |
| PAY-01 | produto, loja, ID transacional pseudonimizado, estado e entitlement | liberar/restaurar Pro e reconciliar | contrato | Apple/Google/RevenueCat | RevenueCat; GCP | vínculo ativo + 5 anos após último evento, sujeito a validação fiscal | segregar/apagar conforme obrigação |
| PAY-02 | recibo/token e sinais de fraude | validar compra e impedir abuso | contrato; legítimo interesse; exercício de direitos | lojas/RevenueCat/app | RevenueCat; GCP | token ativo + 180 dias; evidência de disputa pelo prazo PAY-01 | apagar/segregar |
| SEC-01 | IP, user-agent, dispositivo, sessão, falha e sinal de integridade | autenticação, rate limit e incidente | legítimo interesse com LIA | dispositivo/infra | Clerk; GCP; Redis | rate limit até 30 dias; logs de segurança 180 dias; incidente conforme SEC-02 | apagar/rotacionar |
| SEC-02 | evidências, eventos, afetados e decisões de incidente | responder, comunicar e defender direitos | obrigação legal; exercício de direitos | sistemas, titular, fornecedor | GCP; peritos/autoridades quando cabível | 5 anos após encerramento, sujeito a legal hold | apagar/segregar |
| SUP-01 | mensagem, protocolo, anexos voluntários | suporte | contrato; exercício de direitos | titular | `{{SUPPORT_PROVIDER_OR_GCP}}` | 2 anos após fechamento | apagar, salvo legal hold |
| DSR-01 | pedido, verificação, resposta e comprovante | atender direitos LGPD | obrigação legal; exercício de direitos | titular/responsável | GCP; encarregado | 5 anos após fechamento, sujeito a validação | segregar e apagar ao fim |
| AUD-01 | ator interno, ação, objeto, data e motivo | auditoria e responsabilização | obrigação; legítimo interesse; exercício de direitos | sistemas/admin | GCP | 5 anos; eventos de baixo risco 1 ano se aprovado | apagar/arquivar segregado |
| COM-01 | e-mail/push token e preferências | mensagens transacionais e lembretes opcionais | contrato para transacional; consentimento para opcional | titular/dispositivo | `{{EMAIL_PUSH_PROVIDERS}}` | enquanto habilitado + 30 dias | revogar token/apagar |

## Operadores e transferências

| Fornecedor | Papel a confirmar | Dados | Finalidade | Local/transferência | Documento obrigatório | Status |
|---|---|---|---|---|---|---|
| Apple Distribution International/entidade contratual | controlador independente/fornecedor de loja, conforme contrato | compra, conta da loja, dispositivo | distribuição, billing, integridade | países do contrato Apple | contrato e privacy terms | `OPEN` |
| Google/entidade contratual | controlador independente/fornecedor de loja, conforme contrato | compra, conta da loja, dispositivo | distribuição, billing, integridade | países do contrato Google | DDA e termos de dados | `OPEN` |
| `{{REVENUECAT_LEGAL_NAME}}` | operador/suboperador a confirmar | ID de app user, transação, entitlement | assinatura | `{{REVENUECAT_REGIONS}}` | DPA, suboperadores, retenção | `BLOCKED` |
| `{{CLERK_LEGAL_NAME}}` | operador a confirmar | login, e-mail, sessão | autenticação | `{{CLERK_REGIONS}}` | DPA, suboperadores, exclusão | `BLOCKED` |
| `{{GCP_LEGAL_NAME}}` | operador | dados do serviço | infraestrutura | Brasil + suporte/subprocessamento `{{GCP_SUPPORT_REGIONS}}` | DPA, SCCs/garantias, região | `BLOCKED` |
| `{{SUPPORT_PROVIDER_OR_GCP}}` | operador | tickets e anexos | atendimento | `{{SUPPORT_REGIONS}}` | DPA, retenção, acesso | `BLOCKED` |
| `{{EMAIL_PUSH_PROVIDERS}}` | operador/fornecedor de plataforma | e-mail/token e mensagem | comunicação | `{{MESSAGING_REGIONS}}` | DPA e opt-out | `BLOCKED` |

Não liberar fornecedor antes de registrar entidade legal, papel, fluxo,
países, suboperadores, DPA, mecanismo de transferência, exclusão, suporte e
resposta a incidente.

## Controles transversais

- IDs externos devem ser pseudonimizados e separados do perfil de estudo.
- Nenhum cartão completo, senha ou segredo entra no banco/log.
- Produção, staging e desenvolvimento são segregados; staging usa sintéticos.
- Backups possuem expiração, teste de restore e procedimento para não
  reativar dados excluídos.
- Legal hold é excepcional, documentado, restrito e revisado periodicamente.
- Novos SDKs, dados ou finalidades exigem atualização desta matriz, LIA/RIPD
  quando cabível e revisão das declarações das lojas.
