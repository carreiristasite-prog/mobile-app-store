# Checklist de segurança pré-release

Preencher com `PASS`, `FAIL`, `N/A aprovado` ou `NOT RUN`. Campo vazio é
`FAIL`. Todo `PASS` inclui URL da evidência, hash candidato, data, executor e
fiscal. `NOT RUN` e `FAIL` bloqueiam; `N/A` exige justificativa e aceite.

## Artefato e cadeia de fornecimento

- [ ] IPA/AAB, imagens API/worker, OpenAPI, migrations e Terraform aplicado
  possuem hashes imutáveis no manifest.
- [ ] build reproduzível com lockfile congelado e Node/Expo suportados.
- [ ] SAST, SCA, secret scan e SBOM executados; zero crítico/alto aberto.
- [ ] imagem roda como não-root, por digest, com proveniência/assinatura.
- [ ] permissões, deep links, SDKs e tráfego coincidem com data map/lojas.

## Mobile e identidade

- [ ] token e dados sensíveis não ficam em log, clipboard, screenshot ou
  backup; outbox possui allowlist, TTL, limite e proteção adequada.
- [ ] login/logout/troca/reinstalação/deleção testados em iOS e Android.
- [ ] token expirado/forjado/audience errada e deep link malicioso falham.
- [ ] máximo de cinco dispositivos e duas sessões implementado/testado.
- [ ] App Attest/Play Integrity em monitoramento, com fallback e privacidade.

## API, dados e plataforma

- [ ] matriz de autorização cobre toda rota/UUID; suite IDOR/BOLA aprovada.
- [ ] idempotência/primeira resposta/webhook/outbox testados com concorrência
  em PostgreSQL real.
- [ ] rate limits por IP+conta+rota e quotas validados; Armor saiu de preview
  somente após tuning; alertas funcionam.
- [ ] nenhum gabarito/solução sai antes da resposta; logs passam no canário.
- [ ] Cloud SQL HA/PITR, Redis TLS/auth e buckets privados/CMEK confirmados.
- [ ] restore completo alcança RPO/RTO e ledger de exclusão é aplicado.
- [ ] IAM/Secret Manager/KMS/WIF revisados; rotação de segredo exercitada.

## Billing, worker, DSR, social e admin

- [ ] Apple/Google/RevenueCat sandbox cobre purchase/restore/grace/refund/
  cancelamento/evento atrasado/duplicado/fora de ordem/troca de aparelho.
- [ ] reconciliação server-side diária e alertas de divergência aprovados.
- [ ] worker possui dead-letter/requeue auditado e testes de lease/fencing.
- [ ] export/exclusão reais cobrem Clerk, RevenueCat, PG, Redis, fila, social,
  Storage e backup; nenhuma conclusão parcial.
- [ ] realtime, ranking e duelo são server-authoritative e passaram anti-replay;
  se ausentes, não aparecem no build público.
- [ ] admin possui MFA/RBAC/quatro-olhos/upload em quarentena; se ausente,
  nenhuma rota/painel está exposta.

## Menores, privacidade e abuso

- [ ] age bands, menor de 13, guardian, revogação, 18+ e defaults protetivos
  passaram E2E; sem DOB.
- [ ] Termos e aviso de privacidade têm ações separadas/versionadas; social,
  notificação e marketing são opcionais e revogáveis.
- [ ] scraping, bot, multiaccount, collusion e denúncia abusiva foram testados
  com dados sintéticos e revisão/recurso.
- [ ] DPA/suboperadores/regiões/retencão e declarações das lojas estão
  aprovados pelo jurídico/privacidade.

## Operação e decisão

- [ ] pentest autorizado no hash candidato; zero crítico/alto aberto.
- [ ] incident commander, segurança, DPO, jurídico e contatos de fornecedores
  estão nomeados/testados; tabletop tem ata/correções.
- [ ] canal de vulnerabilidade e SLA de triagem funcionam.
- [ ] carga/chaos/observabilidade/SLO/rollback aprovados.
- [ ] `scripts/security/check_security_docs.py` passa.
- [ ] os 19 blockers canônicos estão fechados por seus owners, com evidência e
  fiscal independente. A equipe de segurança não fecha blockers de legal,
  pagamento, direitos ou loja por inferência.

Decisão final: `GO` somente com todos os gates; caso contrário `NO-GO`.

