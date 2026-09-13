# Compliance operacional do IA Aprova

**Versão do pacote:** 0.1.0-draft  
**Data:** 21/08/2026  
**Status:** não aprovado para produção

Este diretório converte as minutas legais em controles verificáveis:

- [matriz de tratamento, retenção, operadores e transferências](./data-processing-matrix.pt-BR.md);
- [runbook de direitos, exportação e exclusão](./data-subject-requests-runbook.pt-BR.md);
- [runbook de incidente e comunicação ANPD](./incident-response-anpd.pt-BR.md);
- [worksheet Apple App Privacy / Google Data Safety](./app-store-privacy-worksheet.pt-BR.md);
- [manifesto legível por máquina dos bloqueios](./release-blockers.json).
- [integração e gate de sinais etários das lojas](./platform-age-signals.pt-BR.md).

O conteúdo é uma minuta técnica, não aconselhamento jurídico. Prazos de
retenção marcados como propostos dependem de validação jurídica e contábil.

## Gate de release

O release jurídico/compliance somente passa quando:

1. `release-blockers.json` não tiver item aberto de severidade `release`;
2. inventário automatizado de SDKs, permissões, endpoints e tabelas coincidir
   com a matriz;
3. os fluxos de exportação/exclusão forem testados end-to-end, inclusive
   backup, Clerk, RevenueCat e cache;
4. as respostas das lojas forem preenchidas a partir do build candidato;
5. advogado brasileiro, encarregado/DPO, contabilidade, produto e segurança
   registrarem aprovação;
6. Termos e Privacidade públicos corresponderem integralmente às versões
   aprovadas, sem resumo apresentado como documento completo;
7. a lista pública de operadores/suboperadores prometida na Política existir e
   coincidir com a matriz aprovada;
8. o checker do site passar sem permissão de placeholders.

## Evidências mínimas por release

- hash do build e do repositório;
- SBOM e lista de SDKs;
- export das declarações Apple/Google;
- versão dos Termos e Privacidade;
- relatório de testes de exclusão, restore e incidente tabletop;
- lista de operadores/suboperadores e DPAs vigentes;
- aprovações com nome, papel, data e escopo.
