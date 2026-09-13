# Runbook de incidente de segurança e ANPD

**Versão:** 0.1.0-draft  
**Incident commander:** `{{INCIDENT_COMMANDER}}`  
**Encarregado:** `{{DPO_NAME}}`, `{{DPO_EMAIL}}`  
**Assessoria jurídica:** `{{LEGAL_INCIDENT_CONTACT}}`

## Regra de acionamento

Qualquer suspeita de perda de confidencialidade, integridade ou disponibilidade
de dados pessoais abre incidente e preserva evidência. O time não espera certeza
total para conter. Produção nunca é usada para treino de pentest.

## Severidade

- **SEV-1:** exposição ativa, credencial privilegiada, grande volume, menores,
  pagamento, risco físico, discriminação ou fraude em curso.
- **SEV-2:** acesso indevido contido, volume limitado ou impacto relevante
  plausível.
- **SEV-3:** evento sem evidência de dado pessoal exposto, ainda sob apuração.

SEV-1 aciona imediatamente commander, segurança, encarregado, jurídico e
direção. O registro usa UTC e horário de Brasília.

## Primeiras 24 horas

1. Abrir `INC-ID`; registrar quem constatou, quando e como.
2. Preservar logs, imagens, hashes e cadeia de custódia; restringir acesso.
3. Conter com menor impacto: revogar chaves/sessões, isolar recurso, bloquear
   rota ou fornecedor. Não apagar evidência.
4. Identificar sistemas, categorias, titulares, volume, criptografia, cópia,
   exfiltração, permanência e possibilidade de uso indevido.
5. Acionar operador e exigir timeline/evidência pelo DPA.
6. Criar trilhas separadas: técnica, privacidade/jurídica, comunicação e
   continuidade.

## Avaliação de risco ou dano relevante

Documentar natureza/sensibilidade, menores ou vulneráveis, volume, facilidade
de identificação, consequências materiais/morais, proteções efetivas,
probabilidade de abuso e possibilidade de reversão. A conclusão é aprovada
pelo controlador com encarregado e jurídico; não é automatizada.

Se puder acarretar risco ou dano relevante, o controlador comunica ANPD e
titulares no prazo regulatório vigente. Na data desta minuta, a Resolução
CD/ANPD nº 15/2024 estabelece três dias úteis contados do conhecimento pelo
controlador, ressalvada lei específica. O marco inicial e o conteúdo devem ser
confirmados pelo jurídico no incidente. Se faltarem informações, enviar
comunicação preliminar e complementar conforme o procedimento vigente, sem
atrasar injustificadamente. A comunicação ao titular deve ser direta e
individualizada sempre que possível; eventual divulgação ampla por
impossibilidade deve ser documentada e validada pelo jurídico.

Mesmo quando não houver comunicação, registrar fatos, avaliação e decisão.

## Conteúdo da comunicação

- natureza e categorias de dados/titulares;
- data de conhecimento e resumo do ocorrido;
- medidas técnicas e administrativas existentes e adotadas;
- riscos e possíveis consequências;
- motivos de eventual atraso;
- medidas recomendadas ao titular;
- contato do encarregado/controlador;
- o que ainda está sob investigação e quando haverá atualização.

Escrever em linguagem simples, acessível e apropriada à idade. Não minimizar,
especular, culpar terceiros, prometer resultado ou divulgar detalhes que
aumentem o risco. Responsáveis recebem comunicação quando pertinente ao menor.

## Recuperação e encerramento

Validar correção, rotacionar credenciais, monitorar recorrência, restaurar em
etapas e comunicar mudanças. Em até 10 dias úteis após contenção, elaborar
post-mortem sem culpa com causa, impacto, timeline, decisões, lacunas, owners e
prazos. Registrar comunicações, evidências e aprovações pelo prazo da matriz.

Realizar tabletop semestral com vazamento Clerk, token RevenueCat, scraping de
questões, exposição de menor e restauração de backup.

Referência oficial: [Comunicação de Incidente de Segurança — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis).
