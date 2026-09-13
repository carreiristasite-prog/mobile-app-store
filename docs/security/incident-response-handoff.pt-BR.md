# Handoff de resposta a incidentes

Este documento conecta alertas técnicos ao runbook canônico de
[incidente/ANPD](../compliance/incident-response-anpd.pt-BR.md). Não altera o
prazo ou a decisão regulatória; jurídico e encarregado confirmam a regra vigente.

## 1. Contatos e acessos a preencher/testar

| Papel | Nome/canal | Backup | Evidência de teste |
|---|---|---|---|
| Incident commander | `{{INCIDENT_COMMANDER}}` | `{{IC_BACKUP}}` | `{{EVIDENCE}}` |
| Segurança/forense | `{{SECURITY_ONCALL}}` | `{{SECURITY_BACKUP}}` | `{{EVIDENCE}}` |
| Encarregado/privacidade | `{{DPO_CONTACT}}` | `{{PRIVACY_BACKUP}}` | `{{EVIDENCE}}` |
| Jurídico | `{{LEGAL_INCIDENT_CONTACT}}` | `{{LEGAL_BACKUP}}` | `{{EVIDENCE}}` |
| Engenharia/SRE | `{{SRE_ONCALL}}` | `{{ENGINEERING_BACKUP}}` | `{{EVIDENCE}}` |
| Comunicação/suporte | `{{COMMS_SUPPORT}}` | `{{COMMS_BACKUP}}` | `{{EVIDENCE}}` |
| Clerk/RevenueCat/GCP/lojas | `{{VENDOR_ESCALATION}}` | `{{PROCUREMENT}}` | `{{EVIDENCE}}` |

Placeholders tornam `INC-001`, `LEGAL-002` e `SEC-001` abertos.

## 2. Alertas que abrem triagem

- falhas/anomalia de auth, vínculo de conta, guardian ou consentimento;
- mudança de entitlement fora de webhook/reconciliação esperada;
- pico de scraping, respostas impossíveis, multiaccount ou ranking/duelo;
- dead-letter/retry elevado, DSR atrasado ou conclusão divergente;
- acesso/egress anormal em PG, Redis, Storage, Secret Manager, KMS ou admin;
- canário sensível em log, bucket/rota pública, segredo detectado;
- erro de backup/PITR/restore, indisponibilidade/custo fora do SLO;
- alerta de fornecedor ou relato no canal de vulnerabilidade.

Todo alerta recebe `INC-ID` ou registro de falso positivo com evidência. Não
incluir token, segredo, gabarito integral ou PII no título/chat.

## 3. Handoff inicial (primeiros minutos)

1. confirmar ambiente, relógio UTC/Brasília, origem e escopo sem ampliar teste;
2. preservar logs/audit records/snapshots/hashes e iniciar cadeia de custódia;
3. classificar SEV conforme runbook, considerando menor/pagamento como elevado;
4. conter com a menor mudança reversível: revogar sessão/segredo, bloquear
   rota/flag, isolar workload ou suspender publicação; não apagar evidência;
5. separar canais técnico, jurídico/privacidade e comunicação;
6. registrar decision log com autor, hora, motivo e resultado.

## 4. Playbooks de contenção

| Cenário | Contenção inicial | Preservar/validar |
|---|---|---|
| Clerk/token | revogar sessões/chave afetada, bloquear provisionamento se necessário | subject/UUID, audit logs, logins, troca de conta |
| RevenueCat/Pro | pausar webhook/restore por flag se seguro, rotacionar segredo, reconciliar server-side | inbox/event IDs/ordem, entitlements e sandbox/prod |
| Scraping/gabarito | limitar rota/conta/origem, suspender item/credential, preservar canários | exposures, taxa, questões atingidas e direitos |
| Menor/social | desligar social/notificação por flag, revogar tokens realtime | guardian/consent timeline, pseudônimo e contatos |
| DSR/export | revogar URL, suspender entrega/conclusão, isolar objeto | requester/reauth, objetos, operadores e download |
| Segredo/IAM | desabilitar/rotacionar, revogar grant/sessão CI | audit logs, uso desde exposição, imagens/state |
| Banco/Storage | isolar acesso, snapshot forense, impedir mutação indevida | query/data access logs, backup/PITR e CMEK |
| Supply chain | bloquear deploy/artefato, revogar provenance signer | lockfile, SBOM, digest, CI logs e ambientes |

## 5. Pacote para privacidade/jurídico

Entregar fatos, não conclusões automáticas: data de conhecimento pelo
controlador, natureza, sistemas, regiões, categorias de dados/titulares,
menores, volume estimado, criptografia, acesso/exfiltração, duração,
consequências, contenção, fornecedores e incertezas. Registrar quem decidiu
sobre ANPD/titulares, fundamento, versão da regra e horário.

O prazo descrito no runbook vigente é tratado como deadline máximo, não
motivo para esperar. Comunicação a menor/responsável usa linguagem acessível e
não revela detalhes que aumentem risco.

## 6. Recuperação e encerramento

- corrigir, revisar diff, testar em staging e obter fiscal independente;
- restaurar gradualmente com monitores e rollback; reconciliar billing,
  tentativas, ranking, guardian/consent e DSR;
- rotacionar credenciais relacionadas e procurar persistência/recorrência;
- comunicar atualizações aprovadas; atender titulares/lojas/fornecedores;
- post-mortem sem culpa com timeline, causa, impacto, controles, owners/prazos;
- transformar lacunas em testes regressivos e atualizar threat model/SBOM;
- preservar/destruir evidência conforme matriz legal aprovada.

Tabletops mínimos antes do release: vazamento Clerk, replay/fraude RevenueCat,
scraping de questões, exposição de menor, export DSR indevido e restore após
falha regional. Cada exercício precisa de ata, tempos, falhas e reteste.

