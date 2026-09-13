# Handoff para fiscal independente

## Objetivo e limite

Fiscalizar o pacote técnico Apple/Google preparado em 23/08/2026. O autor não
aprova a entrega. Não houve submissão, upload, deploy, commit, uso de
credenciais, cobrança ou edição de `package.json`/`pnpm-lock.yaml`.

O fiscal deve verificar configuração, consistência de declarações com o código,
requisitos oficiais, assets, falsos positivos/negativos do checker e se os
bloqueios impedem corretamente a liberação.

## Arquivos e SHA-256

```text
510493fe91e158a59d08f1d4e362426571889b903f63698548cfe6dd1a176455  artifacts/ia-aprova/app.json
bc2614b21fd5f56795b7ded233266b36b132fa3b0616f3bb965dcc7564e0061b  artifacts/ia-aprova/eas.json
84bad26e5ffe3b9aced0111ff3eab918030fe44162c8219f44c3ad38b0c485cc  artifacts/ia-aprova/constants/links.ts
bc4b45439e9cb2837fbde1271939b961ee2c5b260cae7c7a16def56d677e49d2  artifacts/ia-aprova/.env.example
523ae2e90139b7291eaabe682fa0f5f613436eddc3b1e44702ba7240eff00df0  artifacts/ia-aprova/RELEASE_CHECKLIST.md
6efb3f4c754984ca9580538d5413c936d0cc4aae6e5b3af96a8a6a58773cd94e  artifacts/ia-aprova/assets/images/adaptive-icon-monochrome-v2.png
771d2a6e681cc1af168d4b85801ed4f8992f93bfd097b3a844def104936f33db  docs/store-release/store-package.json
0a2779a638449c50cf1227263e1d6333cea3f8b6f5c3fab707357bb259f6f47a  docs/store-release/release-evidence.json
eae14da4a8388bd53036c3ec820ef3ab2c7b04e64edb71e83b187ba3f17eb725  docs/store-release/metadata-pt-BR.md
4b81230352245eec7bd2500b7be89f92f16b68284d4e78317bb0650b0d621c28  docs/store-release/apple-review-package.pt-BR.md
bd23ade2b795032c8b510e474ccbf1c71b561462e6d2a63a7b0ab970c551a659  docs/store-release/google-play-package.pt-BR.md
8195a67f44b010510edb7a1d7cec38ac491cb640cc6b7f2388e4170667698815  docs/store-release/privacy-disclosures.pt-BR.md
ee1563945fbf5ac6c9f4ad20bb12160d943655f8eb9f07f5b2d6cc25d53f6792  docs/store-release/assets-and-screenshots.pt-BR.md
8de064978769952f12c50d4d7318fcc5f17d02f99a9031736ae573f0fcfc5c48  docs/store-release/official-requirements-2026-08-23.md
55a3ed88d5b42b518f56fd6837aa636a9a6bec9fda6b4b6f8a727485a57d43d6  docs/store-release/README.md
2df156c3e4a50322be5fd39507fcfdd8fa5de75e727645b7d6199d2c3ca60ffa  docs/store-release/risks-and-handoff.pt-BR.md
548bd5d0dad900570ec89f5ff3ce6faa85945fdefc0a328ee25e0f9bc8fb7f09  scripts/store_release_check.py
1c988ec060a6661ca62098f36d356731f15be7fe66eda163353fc0ebba933d16  scripts/tests/test_store_release_check.py
```

Se qualquer hash divergir, revisar a versão alterada em vez de aceitar este
handoff como evidência.

## Testes do autor

- `python -m unittest scripts.tests.test_store_release_check -v`: 4/4 passam.
- `python scripts/store_release_check.py`: falha intencionalmente, com
  `releaseAllowed=false` e sete categorias de bloqueio no estado atual.
- `git diff --check`: passa.
- `expo config --type public`: não executado com sucesso na primeira tentativa;
  antes da correção concorrente do package/lock, o pnpm tentou o
  preinstall sob Node 24 e falhou porque o script raiz usa `sh`, ausente neste
  Windows. Validar no Node 22/ambiente suportado.

## Pontos obrigatórios da fiscalização

1. Conferir `app.json` e `eas.json` contra o schema Expo/EAS SDK 57.
2. Confirmar que permissões bloqueadas e `allowBackup=false` não quebram feature
   real; exigir merged manifest do AAB.
3. Confirmar required-reason APIs no IPA, não apenas a declaração CA92.1.
4. Revisar App Privacy/Data Safety com contratos e documentação das versões
   finais dos SDKs; manter respostas conservadoras onde houver dúvida.
5. Revisar idade 13+, UGC/interação, duelos/ranking, menor/responsável e o fato
   de o produto não pertencer à Kids/Designed for Families.
6. Confirmar SKU, base plan, entitlement, offering, renovação, preço
   localizado e comunicação de plano Free/Pro.
7. Testar que o checker não pode ficar verde com placeholder, URL quebrada,
   asset ausente, permissão inesperada, evidência vazia ou blocker aberto.
8. Reprovar qualquer listagem que anuncie recurso/concurso/conteúdo ausente ou
   sem direitos no build candidato.

## Parecer esperado

Entregar: aprovado/reprovado para **fundação do pacote**, achados P0–P3, diff
de correções se autorizado, testes executados e lista de dependências externas.
Mesmo uma fundação aprovada não autoriza submissão enquanto o checker estiver
vermelho.
