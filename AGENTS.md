# IA Aprova — regras de execução

Este repositório é um produto educacional mobile com conteúdo regulado por
direitos autorais, público 13+ e cobrança recorrente. Toda alteração deve
preservar as mudanças locais existentes e obedecer aos invariantes abaixo.

## Fluxo de trabalho

- Um agente implementa e outro agente independente fiscaliza. O autor não
  aprova a própria entrega.
- Cada entrega informa escopo, arquivos alterados, testes executados, riscos e
  pendências externas. Não esconda falhas de teste.
- Use alterações pequenas e reversíveis. Não sobrescreva trabalho alheio nem
  execute comandos destrutivos.
- Não faça commit, push, publicação, migração de produção ou chamada real de
  cobrança sem autorização específica.

## Invariantes do produto

- O servidor é autoridade para gabarito, acerto, score, XP, entitlement e
  resultado competitivo. O cliente nunca envia esses valores como verdade.
- Nenhuma questão sai da quarentena sem proveniência, direito de uso, solução,
  versão e revisão independente registradas.
- Conteúdo público não é automaticamente licenciado. Questões oficiais só
  podem ser publicadas com licença comercial registrada.
- Não alegue revisão por professores humanos, afiliação oficial, garantia de
  aprovação ou IA generativa em produção.
- Não mantenha funcionalidades fictícias, métricas inventadas ou bots não
  identificados em builds de produção.
- Para menores, perfil, social e notificações são privados/desligados por
  padrão e dependem do fluxo de responsável.
- Segredos não entram no repositório, logs ou payloads enviados ao cliente.

## Qualidade mínima

- Execute os testes/typecheck relevantes ao escopo e registre o comando.
- Mudanças de contrato atualizam OpenAPI, validação e consumidor mobile.
- Mudanças de banco usam migração expand/contract e não apagam dados.
- Fluxos interativos incluem loading, erro, vazio, offline e acessibilidade.
- APIs mutáveis e sincronização offline devem ser idempotentes.

