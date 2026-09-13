# Checklist de publicação mobile

Fonte operacional: `docs/store-release/`. O checker fail-closed é
`scripts/store_release_check.py`; ele deve retornar código zero antes do início
de uma submissão pública.

## Fundação concluída neste repositório

- [x] Expo SDK 57 / React Native 0.86 e EAS em Node 22.23.1/image `sdk-57`.
- [x] Bundle/package canônico `br.com.iaaprova.app` e versão inicial 1.0.0 (1).
- [x] Ícone opaco, adaptive foreground dentro da safe zone, monochrome Android
  e splash referenciados no app config.
- [x] Apple Sign-In nativo/plugin e capability declarada.
- [x] RevenueCat na fronteira nativa, SKU `iaaprova.pro.monthly`, entitlement
  `pro`, preço localizado, compra e restore; o backend continua autoridade.
- [x] Faixa etária, aceites separados, responsável e defaults protetivos.
- [x] URLs mobile canônicas alinhadas aos artefatos legais locais.
- [x] Sem permissões Android autorizadas; localização/câmera/áudio/mídia
  bloqueados e backup Android desabilitado.

## Bloqueios de build e configuração

- [x] `expo-location` e `expo-image-picker` removidos do package/lock pela frente
  responsável; confirmar a ausência no merged manifest do próximo AAB/IPA.
- [x] `build` trocado por `expo export --platform all --output-dir dist --clear`
  como smoke test de bundle. Isso não substitui EAS Build nem auditoria nativa.
- [ ] Instalar com Node 22 e lock congelado; executar typecheck e Expo Doctor.
- [ ] Configurar `owner` e `extra.eas.projectId` da organização.
- [ ] Reservar Bundle ID/App ID/Team Apple e package Google nas contas
  organizacionais; configurar credenciais fora do repositório.
- [ ] Gerar AAB/IPA internos, SBOM e hashes; auditar entitlements,
  PrivacyInfo.xcprivacy e Android merged manifest.
- [ ] Testar redirects Clerk/Apple/Google em dispositivos e configurar Private
  Email Relay da Apple.

## Lojas, billing e documentos

- [ ] Publicar e aprovar Termos, Privacidade, Suporte, Exclusão e Operadores nas
  URLs canônicas, com HTTPS e zero placeholder.
- [ ] Criar produto mensal nas lojas, base plan Google e offering/entitlement no
  RevenueCat; executar compra, restore, expiração, grace, reembolso/revogação
  e troca de aparelho nas duas sandboxes.
- [ ] Finalizar App Privacy, Data Safety, idade Apple, IARC e target audience a
  partir do binário/tráfego final; anexar os exports ao release.
- [ ] Integrar Declared Age Range e Play Age Signals; testar faixas, supervisão,
  indisponibilidade, erro e revogação sem fallback inseguro para adulto.
- [ ] Criar store icon 512px, feature graphic e screenshots reais pt-BR do
  build candidato, sem dados pessoais ou conteúdo sem direitos.
- [ ] Preencher acesso do revisor com contas sintéticas e senhas somente no
  Console/cofre.
- [ ] Fechar todos os itens de `docs/compliance/release-blockers.json` e obter
  parecer do fiscal independente.

## Qualidade final

- [ ] E2E iOS/Android: cadastro, SSO, menor/responsável, estudo, offline,
  simulado, social, compra/restore, exportação e exclusão.
- [ ] VoiceOver, TalkBack, texto 200%, contraste, Reduce Motion, iPhone pequeno e
  grande, Androids representativos e modo compatível no iPad.
- [ ] Carga, segurança, fraude, backup/restore e incident response aprovados.
- [ ] Catálogo publicado com direitos, proveniência e QA; nenhuma alegação de
  revisão humana, afiliação, aprovação garantida ou recurso ausente.
- [ ] Arena completa (amizade, ranking, matchmaking, duelo, denúncia, bloqueio
  e moderação) e regras de tempo/pontuação dos simulados aprovadas em E2E.
- [ ] `python scripts/store_release_check.py` retorna `releaseAllowed: true`.

Nenhum item deste arquivo autoriza build, deploy, cobrança, upload ou
submissão. Essas ações exigem o responsável legal e credenciais externas.
