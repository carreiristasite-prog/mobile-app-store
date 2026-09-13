# Assets e screenshots das lojas

## Assets nativos já referenciados

- Ícone iOS/base: `artifacts/ia-aprova/assets/images/icon-v2.png`, quadrado,
  RGB opaco, 1254 × 1254. O Expo produzirá os tamanhos nativos; ainda exige
  inspeção do asset catalog gerado e aprovação visual.
- Foreground adaptativo: `adaptive-icon-safe.png`, RGBA, 1254 × 1254. Pixels
  com alpha >= 8 ficam dentro da região central segura de 66%.
- Monochrome Android: `adaptive-icon-monochrome-v2.png`, RGBA, arte preta em
  fundo transparente e dentro da região central de 66%.
- Splash: usa o foreground seguro, largura 180 e fundo branco. Validar em telas
  clara/escura, aparelhos pequenos/grandes e sem animação enganosa.

O ícone monocromático foi gerado em 23/08/2026 pela ferramenta integrada de
geração de imagens a partir do mark existente. Prompt final: “criar uma versão
monocromática do mark checklist/balão; arte preta plana, fundo transparente,
sem gradientes/sombras/texto, toda a forma dentro da safe zone central de 66%”.

## Assets candidatos do Google Play

- Store icon: `docs/store-release/assets/google-play-icon-v3.png`, PNG RGBA de
  32 bits com fundo totalmente opaco, 512 × 512, 409.868 bytes. Foi
  exportado sem alteração visual a
  partir do mark nativo `icon-v2.png` e ainda exige aprovação visual no
  Console.
- Feature graphic:
  `docs/store-release/assets/google-play-feature-graphic-v3.png`, PNG RGB
  opaco, 1024 × 500, 675.325 bytes. Usa apenas o nome IA APROVA e elementos
  abstratos de estudo, sem logos oficiais, afiliação ou garantia de aprovação.
  Texto alternativo: “IA Aprova ao lado de um cartão de questões, livros e
  indicadores de progresso em tons de roxo e verde.”
- Proveniência, prompt e hashes estão fixados em
  `docs/store-release/assets/manifest.json`.

Esses arquivos deixam de ser pendência de produção, mas não fecham as
aprovações visual, jurídica, de acessibilidade ou do fiscal de loja.
- Screenshots reais do build candidato continuam obrigatórias, sem
  transparência, molduras falsas,
  métricas inventadas, perguntas sem licença ou dados pessoais.

## Plano de screenshots pt-BR

Capturar somente depois de AAB/IPA candidate e seed sintético aprovado. Mesma
ordem e mensagem nas duas lojas, adaptando dimensões:

1. **Seu estudo começa com um plano claro** — tela Hoje com dados sintéticos.
2. **Pratique por matéria e assunto** — lista/sessão de questões licenciadas.
3. **Entenda cada resposta** — explicação real, sem expor gabarito antes da
   primeira resposta.
4. **Simule as regras da sua trilha** — simulado compatível com o catálogo.
5. **Acompanhe sua evolução** — progresso derivado de tentativas sintéticas.
6. **Revise o que precisa de atenção** — recomendação real do backend.
7. **Controle sua conta e seus dados** — configurações reais de privacidade,
   exportação e exclusão.
8. **Pro opcional, preço confirmado pela loja** — somente se o preço localizado
estiver visível e o sandbox aprovado.

Não capturar Arena, amizade, ranking ou duelo enquanto os fluxos completos e
as proteções de idade/moderação não estiverem aprovados por E2E.

Usar texto sobreposto apenas quando permanecer legível, não encobrir UI e não
parecer elemento interativo. Exportar sem alpha e conferir contraste/ortografia.

## Dimensões

### Apple

Fornecer de 1 a 10 screenshots. Como o app é iPhone retrato, produzir primeiro
o conjunto de maior resolução aceito para 6,9 polegadas. Tamanhos aceitos
incluem 1320 × 2868, 1290 × 2796 e 1260 × 2736. App Store Connect pode escalar
para displays menores; confirmar no Media Manager vigente. Não há screenshot
de iPad porque `supportsTablet` é false, mas o app precisa funcionar no modo de
compatibilidade no iPad.

### Google Play

Fornecer ao menos duas screenshots de telefone para elegibilidade de listagem,
preferindo 4 a 8 capturas retrato em 1080 × 1920 ou outra razão aceita pelo
Console vigente. Arquivos PNG/JPEG, sem alpha, lados dentro dos limites do
Google Play. Confirmar no Console imediatamente antes do upload.

## Evidência

Registrar em `release-evidence.json` os caminhos e hashes, marcar
`screenshotsMatchCandidateBuild` somente após comparar cada imagem com o build
hashado e obter aprovação de produto, conteúdo, privacidade e fiscal de loja.
