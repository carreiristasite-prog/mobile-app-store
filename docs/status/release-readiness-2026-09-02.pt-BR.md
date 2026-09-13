# IA Aprova — prontidão para submissão às lojas

**Data da medição:** 02/09/2026  
**Escopo:** plano aprovado de lançar as 19 famílias juntas, assinatura Pro,
social real e nenhum mock no build público.  
**Decisão:** **NÃO SUBMETER**.

## Resultado executivo

Estimativa ponderada de prontidão: **32/100**. Portanto, falta
aproximadamente **68% do caminho de release**. Como alguns gates são binários
(licenças, conteúdo, assinatura em sandbox, documentos legais e builds
assinados), 32% não significa que o aplicativo já possa ser publicado em modo
limitado.

| Frente | Peso | Pontos comprovados | Situação |
|---|---:|---:|---|
| Mobile, UX e fluxos centrais | 15 | 8 | Expo 57 e typecheck verdes; faltam build nativo, E2E e dispositivos |
| Backend, aprendizagem, simulados e DSR | 15 | 10 | API/worker e motores existem; homologação externa e escala faltam |
| Billing/IAP | 10 | 3 | Fundação existe, mas PostgreSQL falha e não houve sandbox/revisão final |
| Social e realtime | 10 | 2 | Motor isolado testado; banco/API/realtime/mobile não estão integrados |
| Conteúdo e direitos | 25 | 1 | Pipeline/quarentena existem; 0 questões elegíveis e 0 licenças ativas |
| Segurança, privacidade, jurídico e menores | 10 | 3 | Controles e minutas existem; pentest, sign-offs e homologação faltam |
| Pacote, builds e consoles das lojas | 10 | 3 | Configuração e assets candidatos existem; IPA/AAB/screenshots/consoles faltam |
| Operação, escala e suporte | 5 | 2 | Infra/observabilidade desenhadas; carga, restore e operação real faltam |
| **Total** | **100** | **32** | **68 pontos ainda não comprovados** |

Esta pontuação é um instrumento de priorização, não uma certificação.
Qualquer gate de release aberto mantém a decisão `NÃO SUBMETER`.

## Evidências executadas neste snapshot

- TypeScript global: aprovado.
- API: 101/101 testes aprovados.
- Worker: 47/47 testes aprovados.
- Núcleo social isolado: 18/18 testes aprovados, ainda sem fiscal independente.
- Biblioteca de integridade/idade: 5/5 testes aprovados, mas parecer independente
  continua reprovado por dois P1 operacionais.
- Mobile: checks estáticos de identidade, sinais etários e outbox aprovados;
  simulações 3/3.
- Contratos, conteúdo, release, store e segurança: 59 testes Python aprovados.
- PostgreSQL 16 real: **9/11 aprovados e 2/11 reprovados**:
  `privacy_revenuecat_customer_missing` na revogação DSR e violação
  `23502` por `entitlements.environment` nulo na reconciliação.
- Gate de release: 19 bloqueios de compliance abertos.
- Checker das lojas: 6 grupos de achados; 85 campos de evidência ainda
  ausentes, screenshots reais ausentes e pacote não aprovado.

## O maior bloqueio: catálogo publicável

- 19 famílias registradas, **0/19 trilhas prontas**.
- 156 arquivos-fonte inventariados: 102 PDF e 54 DOCX, todos em quarentena.
- 0 lote elegível, 0 questão elegível e 0 instrumento de direitos ativo.
- 27 bloqueios editoriais/de cobertura.
- O lote EEAR de 554 itens permanece em quarentena e não conta para a meta.
- A meta aprovada de pelo menos 1.000 questões elegíveis por matéria/trilha
  está, portanto, em **0% comprovado**.

Nenhuma prova publicamente acessível será tratada automaticamente como
licença comercial. Volume gerado sem proveniência, solução e revisão
independente também não será contado.

## Bloqueios internos prioritários

1. Corrigir as duas regressões PostgreSQL de billing e refiscalizar todos os
   P0/P1/P2 do parecer financeiro.
2. Corrigir replay global e lease preso da Fase A de App Integrity; adicionar
   limites temporais, breaker e vetores dourados; refiscalizar.
3. Fiscalizar o motor social e implementar persistência, APIs, realtime,
   mobile, moderação e reconexão.
4. Concluir billing nativo com identidade RevenueCat canônica, SKU Android com
   base plan, restore, webhooks, reconciliação diária e testes de ciclo de vida.
5. Produzir os blueprints aprovados e reconstruir o banco editorial com
   direitos e dupla auditoria item a item.
6. Gerar AAB/IPA candidatos, inspecionar manifests/tráfego, executar E2E,
   acessibilidade, carga, restore, pentest e fraude em staging.

## Dependências externas que engenharia não pode fabricar

- Razão social, CNPJ, endereço, domínio e canais corporativos.
- Contas organizacionais Apple/Google, projeto Expo/EAS e credenciais de
  Clerk, RevenueCat e GCP.
- SKUs e entitlement configurados nos consoles e compras sandbox em aparelhos.
- Licenças/contratos de conteúdo e de autores.
- Aprovação de advogado brasileiro, privacidade/DPO e contabilidade.
- Aprovação dos formulários App Privacy/Data Safety e dos textos públicos.
- Dispositivos físicos e ambiente autorizado para pentest/fraude.

## Compatibilidade atual das lojas

O projeto usa Expo SDK 57, que declara `targetSdkVersion`/`compileSdkVersion`
36, React Native 0.86, Node mínimo 22.13 e Xcode 26.4+. Isso está alinhado ao
requisito vigente do Google Play para novas submissões em API 36 desde
31/08/2026 e ao requisito Apple de build com Xcode 26/iOS 26 SDK desde
28/04/2026. A conformidade efetiva só poderá ser comprovada nos manifests do
AAB/IPA candidatos.

Fontes oficiais:

- <https://docs.expo.dev/versions/latest/>
- <https://developer.apple.com/app-store/submitting/>
- <https://support.google.com/googleplay/android-developer/answer/11926878>

## Critério de 100%

Somente declarar pronto quando: testes globais e PostgreSQL estiverem verdes;
0 blocker de release permanecer aberto; 19/19 trilhas passarem o gate de
conteúdo/direitos; billing e exclusão forem homologados nas duas lojas; builds
assinados, manifests, screenshots, acessibilidade, carga e pentest estiverem
aprovados; e o responsável legal tiver registrado os sign-offs externos.
