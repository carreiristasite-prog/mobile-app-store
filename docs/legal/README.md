# Pacote jurídico do IA Aprova

**Versão:** 0.1.0-draft  
**Data da minuta:** 21/08/2026  
**Status:** minuta operacional; bloqueada para publicação

Estas minutas foram preparadas para orientar produto, engenharia, operações e
revisão jurídica. Elas não são parecer jurídico, não substituem advogado,
encarregado/DPO, contador ou validação das lojas e não prometem imunidade a
reclamações, fiscalização ou processos.

## Documentos

- [Termos de Uso](./terms-of-use.pt-BR.md)
- [Política de Privacidade](./privacy-policy.pt-BR.md)
- [Assinatura, cancelamento e reembolso](./subscription-cancellation.pt-BR.md)
- [Responsáveis e menores](./minors-and-guardians.pt-BR.md)
- [Regras sociais](./social-rules.pt-BR.md)
- [Política editorial e correções](./editorial-policy.pt-BR.md)
- [Direitos autorais e licenciamento](./rights-and-licensing.pt-BR.md)

Os procedimentos internos e as declarações para Apple/Google estão em
[`../compliance`](../compliance/README.md).

## Placeholders obrigatórios

Nenhum texto pode ser publicado enquanto contiver `{{...}}`. Os placeholders
são deliberados: evitam inventar dados empresariais ou contatos.

| Placeholder | Decisão/dado exigido |
|---|---|
| `{{LEGAL_NAME}}` | razão social do controlador |
| `{{TRADE_NAME}}` | nome empresarial exibido ao consumidor |
| `{{CNPJ}}` | CNPJ do controlador |
| `{{LEGAL_ADDRESS}}` | endereço completo do controlador |
| `{{DOMAIN}}` | domínio público de produção |
| `{{SUPPORT_EMAIL}}` | canal de suporte |
| `{{PRIVACY_EMAIL}}` | canal para titulares |
| `{{DPO_NAME}}` / `{{DPO_EMAIL}}` | encarregado/canal ou decisão documentada de dispensa |
| `{{SECURITY_EMAIL}}` / `{{EDITORIAL_EMAIL}}` / `{{RIGHTS_EMAIL}}` | canais de segurança, editorial e direitos |
| `{{RIGHTS_OWNER_NAME}}` | responsável interno por direitos e licenciamento |
| `{{EFFECTIVE_DATE}}` | data de vigência aprovada |
| `{{RETENTION_SIGNOFF_DATE}}` | data do aceite da tabela de retenção |
| `{{REVENUECAT_LEGAL_NAME}}` / `{{CLERK_LEGAL_NAME}}` / `{{GCP_LEGAL_NAME}}` | entidades legais dos fornecedores efetivos |
| Demais placeholders em `../compliance` | owners, regiões, fornecedores, IDs de loja e evidências do build candidato |

A lista completa deve ser obtida por busca automatizada de `{{...}}` em
`docs/legal`, `docs/compliance` e `artifacts/legal-site`; esta tabela não
substitui esse gate.

## Processo de aprovação

1. Produto confirma que os textos descrevem o comportamento real do app.
2. Engenharia confronta inventário, SDKs, telemetria, exclusão e retenção.
3. Financeiro/contábil valida preço, tributos e retenções obrigatórias.
4. Responsável editorial valida direitos e a ausência de afirmações enganosas.
5. Advogado brasileiro e encarregado/DPO aprovam a versão final.
6. A mesma versão é publicada no site, no app e nos metadados das lojas.
7. O manifesto de bloqueios é zerado e o checker de release passa sem
   `-AllowPlaceholders`.

Toda mudança material gera nova versão, registro de aprovação e comunicação
compatível com seu impacto.
