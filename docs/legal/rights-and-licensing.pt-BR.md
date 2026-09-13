# Política de direitos autorais e licenciamento

**Versão:** 0.1.0-draft  
**Responsável interno:** `{{RIGHTS_OWNER_NAME}}`  
**Canal:** `{{RIGHTS_EMAIL}}`

## Regra central

Nenhuma prova, questão, imagem, tabela, texto, marca ou ativo entra em
produção porque foi encontrado na internet. A publicação exige autoria do IA
Aprova ou permissão comercial compatível com a utilização concreta.

## Registro mínimo por fonte

- titular e cadeia de titularidade;
- URL/local da fonte, página e hash do arquivo;
- tipo de obra e elementos de terceiros incorporados;
- instrumento de licença/contrato e evidência de aceitação;
- território, prazo, plataformas, finalidade comercial e volume permitido;
- permissão ou vedação de adaptação, fragmentação e sublicença;
- atribuição, avisos, revogação e data de expiração;
- decisão do responsável e do fiscal independente.

Item sem campo obrigatório fica em quarentena. Expiração ou revogação
suspende automaticamente todas as publicações vinculadas.

A afirmação `cleared` dentro do registro da questão não é autoridade. Antes de
contar ou publicar, o pipeline confronta o identificador com um registro de
instrumentos separado, incluindo hash do contrato, tipo, titular, território,
plataformas, permissões, vigência e decisão independente. Instrumento ausente,
expirado, suspenso ou incompatível bloqueia a questão e todos os ativos
vinculados.

Para questão oficial licenciada, arquivo, página e SHA-256 precisam coincidir
com o inventário local verificado. Essa coincidência demonstra proveniência,
não autorização: a licença comercial continua obrigatória. Imagem, tabela ou
diagrama exige documento de direitos próprio, mesmo quando aparece dentro de
uma prova licenciada, salvo se o instrumento registrar expressamente que o
elemento e sua cadeia de titularidade estão abrangidos.

## Conteúdo autoral

Questão autoral deve ter histórico de criação e checagem de similaridade.
Trocar nomes, números, ordem ou sinônimos não transforma uma questão oficial
em obra original. Referências factuais e doutrinárias devem ser citadas sem
copiar expressão protegida além do autorizado.

Contribuição de empregado, prestador ou agente externo exige contrato que
defina direitos, confidencialidade, garantias e responsabilidade. Saída de
agente automatizado não deve ser tratada como prova autônoma de titularidade.

## Conteúdo oficial

Questões oficiais somente recebem status `official_licensed` após revisão do
instrumento. Licenças Creative Commons devem ser analisadas em sua versão,
atribuição e restrições. Licença com elemento `ND` não autoriza adaptação;
fragmentação e elementos de terceiros precisam de validação própria.

Marcas e nomes de concursos são usados apenas para identificar a trilha e não
devem sugerir afiliação, patrocínio ou origem oficial.

## Denúncia e retirada

Titulares podem escrever para `{{RIGHTS_EMAIL}}` informando identificação,
obra, local no app, fundamento e meio de contato. O IA Aprova:

1. acusa recebimento e preserva evidências;
2. suspende preventivamente quando o risco justificar;
3. confronta fonte, licença e versão;
4. decide manter, corrigir ou retirar;
5. registra decisão e propaga a retirada a cache/pacotes offline;
6. responde sem exigir dados excessivos.

Este procedimento não impede medidas legais nem representa admissão de
infração. Referência: [Lei nº 9.610/1998](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm).
