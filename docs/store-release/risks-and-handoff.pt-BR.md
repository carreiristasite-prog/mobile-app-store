# Riscos e handoff para publicação

## Bloqueios técnicos atuais

1. O smoke test agora usa `expo export --platform all`; ainda não houve
   execução aprovada no Node 22 e ele não valida manifests, assinatura, IAP ou
   binários. EAS Build e inspeção nativa continuam obrigatórios.
2. `expo-location` e `expo-image-picker` foram removidos do package/lock pela
   frente responsável, mas a ausência precisa ser comprovada no Info.plist,
   PrivacyInfo e Android merged manifest gerados.
3. `owner` e `extra.eas.projectId` ainda não existem no app config; contas da
   organização, Apple Team/App ID e package Google não foram comprovados.
4. Não há IPA/AAB candidato, hashes, SBOM, Expo Doctor, typecheck nem auditoria
   de manifests gerados no Node 22.
5. Store icon 512 × 512, feature graphic e screenshots reais ainda não foram
   produzidos a partir de build aprovado.
6. URLs canônicas existem somente como artefatos locais/draft; DNS, HTTPS,
   conteúdo final e canais não foram publicados/testados.
7. SKU/entitlement/offering não foram comprovados nas lojas/RevenueCat, nem
   compra, restore, reembolso e revogação em sandbox.
8. App Privacy, Data Safety, age rating/IARC, acesso do revisor e conteúdo de
   terceiros ainda não têm export/aceite nas contas.
9. Os bloqueios jurídico, privacidade, segurança, direitos e conteúdo em
   `docs/compliance/release-blockers.json` permanecem abertos.
10. O build 13+ ainda não ingere a faixa etária fornecida pelas lojas via
    Declared Age Range/Play Age Signals, exigência a ser avaliada e implementada
    para o ECA Digital no Brasil.
11. Arena, amizade, ranking e duelo ainda não têm fluxos completos no app/API.
    A listagem não os anuncia; o requisito de produto continua aberto.
12. O simulado respeita a distribuição de matérias, mas não aplica ainda
    duração e pontuação do edital de ponta a ponta. A listagem evita essa
    promessa até haver teste aprovado.

## Recomendação para o script `build`

O script atual `expo export --platform all --output-dir dist --clear` é
aceitável como checagem de bundle porque `app.json` restringe `platforms` a
iOS/Android. Se o diagnóstico por plataforma se tornar necessário, um script
Node portátil pode executar exports separados. Em ambos os casos, seguir com:

- `expo-doctor` e typecheck;
- `eas build --platform all --profile production` para o candidato real;
- inspeção de IPA/AAB, entitlements/privacy manifest/merged manifest e hashes.

Não usar `expo export` como sinônimo de build pronto para a loja.

## Ordem de fechamento

1. Encerrar e revisar mudanças concorrentes; instalar com Node 22 e lock
   congelado.
2. Executar o smoke de bundle, typecheck e Expo Doctor; inspecionar que os
   módulos removidos não aparecem nos manifests nativos.
3. Preencher owner/projectId e reservar IDs nas contas organizacionais.
4. Publicar e aprovar documentos/URLs/canais.
5. Criar e testar SKU nas duas lojas e RevenueCat.
6. Gerar AAB/IPA interno, SBOM e auditoria de manifests/tráfego.
7. Finalizar privacidade, idade/IARC, assets e acesso do revisor.
8. Integrar/testar sinais de idade das lojas e concluir Arena/moderação e as
   regras de tempo/pontuação dos simulados.
9. Rodar E2E/acessibilidade/security/content, preencher evidências e obter
   revisão independente.
10. Somente depois do checker verde, iniciar TestFlight/internal/closed testing;
   submissão pública continua sendo ação do responsável legal.
