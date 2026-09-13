# Política editorial, qualidade e correções

**Versão:** 0.1.0-draft  
**Vigência:** `{{EFFECTIVE_DATE}}`

## Compromissos

O IA Aprova procura oferecer questões coerentes com edital, banca, cargo,
matéria e habilidade, sem prometer reprodução perfeita de prova futura. Não
afirma afiliação oficial nem garantia de aprovação.

Questões são classificadas como:

- `original_authoral`: criada para o IA Aprova, com evidência de autoria;
- `official_licensed`: reproduzida/adaptada somente dentro de licença
  comercial registrada.

Disponibilidade pública não equivale a autorização comercial.

## Fluxo obrigatório

`quarentena → direitos liberados → autoria/extração → QA determinístico →
solucionador cego → especialista da trilha → fiscal independente →
adjudicação → beta → publicação`

Nenhum item é publicado sem:

- proveniência e direito de uso verificável;
- enunciado, alternativas, gabarito e solução;
- justificativa dos distratores;
- concurso, cargo, banca, edital, matéria, tópico, habilidade e dificuldade;
- versão imutável e decisões de revisão registradas;
- checagem de duplicidade e compatibilidade do blueprint;
- acessibilidade de imagem/tabela quando houver.

As decisões de revisão registram a revisão e o fingerprint exatos do item.
Uma edição posterior invalida as decisões anteriores. O fiscal independente
também registra a checagem de duplicidade semântica contra um snapshot
integral do corpus; deduplicação exata ou por semelhança textual não substitui
esse parecer.

No runtime de simulados, registros legados não recebem elegibilidade por
inferência. São obrigatórios autor identificado, três revisores distintos do
autor, fingerprint vigente, instrumento ativo, permissões `commercial`,
`digital` e `reproduce` e, quando aplicável, `adapt` ou `fragment`. Enquanto a
cadeia de direitos e acessibilidade de ativos não estiver modelada no banco, o
aplicativo aceita somente `presentation_kind=text_only`; imagens, tabelas e
diagramas permanecem bloqueados.

O relatório de cobertura conta somente fingerprints semanticamente únicos em
`ready_for_beta` ou `published`, vinculados a um blueprint aprovado. Cada
blueprint identifica família, trilha, cargo, banca, edital, fase, modalidade,
matérias, tópicos e habilidades. Pastas, nomes de arquivos e quantidade de
marcadores em DOCX não definem matéria nem comprovam a meta de 1.000 itens.

Fontes em quarentena não são descobertas automaticamente pelo corpus
elegível. Um lote precisa ser registrado por caminho restrito e SHA-256; o
checker deve falhar quando faltarem blueprint, direitos, revisão, snapshot
semântico ou volume por matéria.

A revisão editorial é feita por agentes especializados com fiscal
independente. O IA Aprova não deve divulgar que houve revisão por professor
humano, especialista credenciado ou banca oficial.

## Correções e suspensão

Usuários podem denunciar erro dentro da questão. A denúncia recebe protocolo
e classificação: direito autoral, gabarito, ambiguidade, desatualização,
acessibilidade, preconceito ou outro.

O item deve ser suspenso preventivamente quando houver:

- risco de violação de direito;
- resposta impossível ou mais de um gabarito plausível;
- discriminação estatística negativa confirmada;
- tempo ou padrão de resposta incompatível com uso válido;
- volume/severidade de denúncias acima do limite aprovado.

Correção cria nova versão, preserva o histórico e reavalia respostas
afetadas. Quando um erro mudar resultado, o app deve recalcular progresso e
informar a pessoa afetada de forma clara. Rankings/duelos são corrigidos
quando tecnicamente possível; caso contrário, a limitação deve ser registrada.

## Fontes e atualizações

Editais, legislação e programas mudam. Cada trilha possui versão e data de
referência. A pessoa usuária deve consultar fontes oficiais. Solicitações
editoriais: `{{EDITORIAL_EMAIL}}`.
