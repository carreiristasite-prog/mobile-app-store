# Entrega privada de export DSR

Este runbook descreve um gate de staging; ele não aprova retenção nem fecha
`DSR-001`. O download público continua bloqueado até o teste e a revisão
independente.

## Invariantes

- o bucket dedicado tem acesso uniforme, prevenção de acesso público, CMEK,
  versionamento e soft delete desligados e nenhum retention lock;
- somente o worker cria/apaga objetos e somente a API lê objetos; nenhum dos
  dois papéis pode listar o bucket;
- cada objeto usa `dsr/exports/<request UUID>/<sha256>.json`, geração numérica
  fixada, `customTime` igual à expiração e `private, no-store, max-age=0`;
- a API nunca recebe bucket/key do cliente, nunca segue redirect e nunca retorna
  chave interna ou URL pública;
- exclusão da conta nega o download imediatamente e o worker remove cada
  geração antes da eliminação interna;
- a tabela de acessos é append-only e não armazena IP, user-agent, e-mail ou
  token.

## Evidência obrigatória em staging

1. Aplicar migrations em banco descartável e comprovar replay idempotente.
2. Gerar export de uma conta sintética e confirmar no GCS: CMEK correta,
   `customTime`, cache privado, tamanho, checksum customizado, soft delete com
   duração zero e uma única geração live.
3. Com outra conta autenticada, pedir o mesmo UUID e confirmar `404`, sem
   diferença observável que revele ownership.
4. Na conta dona, testar arquivo completo, uma faixa menor que 8 MiB, faixa
   múltipla, suffix range, faixa fora do arquivo e mais de 8 MiB. Somente as
   duas primeiras devem funcionar; todas as respostas devem ser `no-store`.
5. Alterar em banco, apenas no ambiente descartável, key, generation, size,
   checksum e expiry; cada divergência deve falhar fechada antes de entregar
   bytes.
6. Iniciar exclusão e comprovar que downloads passam a `410` imediatamente.
   Depois, comprovar `404` da geração no GCS, ausência de objeto soft-deleted
   restaurável e as evidências append-only `revoked`/`export_objects_revoked`.
7. Criar export com `customTime` curto e comprovar exclusão pelo lifecycle.
   Registrar timestamps, regra do bucket e ausência de geração arquivada.
8. Remover em cópias de staging: IAM da API, IAM do worker, metadata server,
   CMEK ou regra de lifecycle. Startup/operação deve falhar; nenhum fallback
   público é permitido.

Guardar plano Terraform, IDs de request sintéticos, timestamps UTC, respostas
sem token, consultas de evidência e parecer do fiscal. Não guardar bearer
tokens, URLs internas completas ou conteúdo do export.

Somente após aprovação em quatro olhos definir
`confirm_privacy_export_delivery_staging=true`. Esse valor não substitui os
gates jurídico, DPO, restore/backups e operador real.
