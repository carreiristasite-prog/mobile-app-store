# Gate editorial de cobertura — handoff operacional

## Decisão atual

`BLOCKED`. O checker não encontrou blueprint aprovado, instrumento de
direitos ativo ou lote elegível. Assim, o número elegível atual é zero para
todas as 19 trilhas default. O lote legado EEAR com 554 registros permanece em
quarentena e não altera essa decisão.

O resultado detalhado e reproduzível fica em
`content/reports/coverage-gaps.json`. A data de corte é 2026-08-23; qualquer
nova execução usada como evidência deve declarar sua própria data de corte.

## Pacote de entrada exigido por trilha

O responsável empresarial entrega a escolha final de família/trilha, cargo,
banca, edital, fase e modalidade. O responsável editorial entrega a taxonomia
aprovada de matérias, tópicos e habilidades, a meta por matéria e o hash da
fonte normativa. Um fiscal diferente do preparador aprova a versão.

O responsável por direitos registra cada licença comercial, contrato de
autoria e licença de ativo com hash do instrumento e escopo verificável. Um
fiscal de direitos independente aprova o registro. Referência pública ou
download do arquivo não substitui esse pacote.

Autores entregam lotes pequenos de questões no schema 2.0.0. Cada item contém
solução, racional de cada distrator, classificação, fonte, direitos, estímulos,
ativos e revisões vinculadas ao fingerprint. O fiscal semântico audita o
snapshot integral do corpus candidato. Por fim, o lote e o snapshot são
registrados por SHA-256 no manifesto elegível.

## Interpretação dos resultados

- `eligibleSemanticUniqueItems` é contagem por trilha/matéria após todos os
  gates; não é quantidade bruta de linhas.
- `gap` é a diferença para a meta aprovada, nunca inferior a 1.000.
- `blocked` prevalece mesmo com volume suficiente se um único gate crítico
  falhar.
- arquivos em quarentena, lotes não listados, versões antigas, duplicatas e
  questões suspensas contam como zero.
- reuso entre concursos só conta quando existe uma compatibilidade explícita
  em `blueprintAssignments` e o blueprint correspondente está aprovado.

## Comando de fiscalização

```powershell
python scripts/content_pipeline.py coverage --as-of 2026-08-23
```

Saída 0 significa que todos os gates passaram. Saída 1 significa bloqueio
editorial esperado e deixa um relatório. Saída 2 significa que a evidência de
entrada não pôde ser lida/validada. Nenhuma dessas falhas deve ser ignorada em
um gate de release.
