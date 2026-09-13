# Fundação editorial do IA Aprova

Este diretório guarda contratos, registros, manifestos e relatórios
editoriais. Os PDFs e DOCX em `../Provas Anteriores` permanecem fora do
produto e são sempre tratados como fonte em quarentena. Inventariar um arquivo
não libera seus direitos nem torna suas questões elegíveis.

## Situação atual: bloqueada

O relatório determinístico em `reports/coverage-gaps.json`, com data de corte
2026-08-23, registra:

- 19 famílias e 19 trilhas default bloqueadas;
- zero blueprint de matérias aprovado e, por isso, zero matéria inferida;
- zero instrumento de licença/autoria aprovado;
- zero lote elegível e zero questão contada;
- 156 fontes em quarentena: 102 PDF e 54 DOCX, todos com SHA-256 único;
- três pastas sem decisão de mapeamento (`EAM`, `EFOMM`, `ESFECEX`);
- nove famílias do catálogo sem pasta local correspondente.

Esses números descrevem o acervo local; não são promessa de cobertura,
qualidade, direito de uso ou publicação.

## Estados e regra de publicação

O fluxo canônico é:

`quarantine → rights_cleared → draft → in_review → ready_for_beta → published`

`suspended` pode ser aplicado a um item anteriormente elegível. Apenas
`ready_for_beta` e `published` podem contar para cobertura, e somente quando
todos os gates do checker passam. O arquivo
`quarantine/eear-554.manifest.json` referencia um lote legado por SHA-256; seus
554 registros continuam fora de qualquer lote elegível.

Não existe descoberta automática de questões. O checker lê exclusivamente os
arquivos listados, por caminho relativo e hash, em
`eligible/batches.manifest.json`. Esse caminho fica preso a
`content/eligible/batches`, impedindo que `quarantine`, `Provas Anteriores` ou
outro diretório seja incluído por travessia de caminho.

## O que falta para criar um blueprint

Nenhuma matéria será deduzida de nomes de arquivo. Para cada trilha, o
responsável empresarial/editorial precisa fornecer e aprovar:

- família e trilha pública exatas;
- cargo, banca, edital, fase e modalidade;
- URL e SHA-256 do edital/programa de referência;
- matérias, tópicos e habilidades, sem lacunas e sem aliases ambíguos;
- meta de pelo menos 1.000 itens elegíveis por matéria;
- identidade do preparador e decisão de fiscal independente;
- regra de atualização, aposentadoria e suspensão do blueprint.

O registro deve seguir `schemas/blueprints.schema.json`. Enquanto
`catalog/blueprints.json` permanecer vazio, cobertura por matéria é
matematicamente desconhecida e o gate falha.

## Gates de uma questão

O contrato `schemas/question.schema.json` e as regras cruzadas da CLI exigem:

- autoria e revisão imutáveis por `revision` e fingerprint;
- compatibilidade explícita com blueprint, versão, família, trilha, matéria,
  tópico e habilidade;
- solução e justificativa de exatamente todos os distratores;
- fonte e documento de direitos compatíveis;
- página/arquivo/hash inventariado para questão oficial licenciada;
- estímulos e ativos com hash, direitos e acessibilidade;
- solucionador cego, especialista e fiscal independentes do autor;
- adjudicação independente quando houver divergência;
- deduplicação exata e quase duplicata no corpus completo;
- parecer semântico do fiscal, ligado ao fingerprint, revisão, método e hash do
  snapshot integral do corpus.

O SHA-256 normalizado `sha256-normalized-v3` cobre classificação pedagógica,
enunciado, alternativas, gabarito, solução, estímulos, ativos, fonte e snapshot
de direitos. Alterar qualquer desses dados invalida as revisões vinculadas.

## Direitos e lotes elegíveis

`rights/registry.json` começa vazio. Um registro ativo precisa de instrumento
por hash, titular, tipo, Brasil, iOS/Android, uso comercial/digital,
reprodução quando aplicável, vigência e aprovação independente. A declaração
`rights.status = cleared` dentro da questão nunca basta: o checker confronta o
documento com o registro externo e a data de corte.

`eligible/batches.manifest.json` também começa vazio. Além de listar cada lote
por SHA-256, deve registrar método semântico aprovado e o hash do corpus
integral auditado. Qualquer alteração de corpus exige um novo snapshot e nova
aprovação semântica.

## Comandos determinísticos

Execute a partir da raiz `Mobile-App-Store`:

```powershell
python scripts/content_pipeline.py inventory
python scripts/content_pipeline.py quarantine-eear
python scripts/content_pipeline.py validate --input caminho/do/lote.json
python scripts/content_pipeline.py fingerprint --input caminho/do/lote.json
python scripts/content_pipeline.py coverage --as-of 2026-08-23
pnpm run test:content-schemas
python -m unittest discover -s scripts/tests -p "test_content_*.py"
```

`coverage` exige `--as-of` para que vigências sejam avaliadas de forma
reproduzível. Ele grava o relatório mesmo quando bloqueado e retorna código 1
se qualquer gate estiver aberto. Código 2 significa entrada ausente, inválida
ou ilegível. Um release gate não deve converter esses códigos em sucesso.

`test:content-schemas` compila os quatro contratos em modo AJV estrito e
valida os registros versionados de blueprints, direitos e lotes. O CI executa
esse gate antes de qualquer candidato de release.

## Contratos versionados

- `catalog/exam-families.json`: 19 famílias e trilhas default, ainda bloqueadas;
- `catalog/blueprints.json`: blueprints aprovados; atualmente vazio;
- `rights/registry.json`: instrumentos de direitos; atualmente vazio;
- `eligible/batches.manifest.json`: corpus explicitamente elegível;
- `schemas/*.schema.json`: contratos JSON Schema 2020-12;
- `reports/source-inventory.json`: inventário reprodutível do acervo local;
- `reports/coverage-gaps.json`: decisão fail-closed por trilha e matéria;
- `quarantine/*.manifest.json`: referências descritivas, nunca banco de produto.
