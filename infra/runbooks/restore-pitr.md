# Runbook — restore e point-in-time recovery do PostgreSQL

Metas iniciais a validar em exercício: RPO de até 5 minutos dentro da janela PITR de 7 dias e RTO de até 60 minutos para restaurar, validar e redirecionar. Backups diários retêm 14 cópias. Essas metas não estão comprovadas antes do primeiro game day.

## Escolha do ponto

1. Declare incidente e suspenda escritas se houver corrupção ativa.
2. Preserve o instance ID, horário UTC do primeiro evento ruim, logs de auditoria e revisões ativas.
3. Escolha um timestamp UTC imediatamente anterior à corrupção e confirme que está na janela PITR.
4. Use o restore de backup quando o ponto necessário coincide com um backup; use PITR quando a precisão entre backups é necessária.

## Restaurar sem sobrescrever a origem

Nunca teste restore sobre a instância primária. Crie uma nova instância com sufixo de incidente, na mesma região e VPC privada. Exemplo operacional, a ser confirmado com a versão instalada do Google Cloud CLI:

```powershell
gcloud sql instances clone SOURCE_INSTANCE RESTORE_INSTANCE `
  --project=PROJECT_ID `
  --point-in-time='YYYY-MM-DDTHH:MM:SSZ'
```

Não adicione credenciais à linha de comando. Restrinja rede/IAM da instância restaurada antes de conectar.

## Validar e promover

1. Use uma identidade read-only temporária e conte registros/constraints críticos definidos pelo dono do banco.
2. Verifique migrations aplicadas, integridade referencial, timestamps, outbox não processada e eventos de billing/entitlement sem executar side effects.
3. Registre evidência e obtenha aprovação do incident commander e dono do banco.
4. Crie uma nova versão de `DATABASE_URL` apontando ao socket da instância restaurada. Nunca edite o valor do segredo via Terraform; registre apenas o novo número em `secret_versions`.
5. Implante nova revisão API/worker fixada na nova versão numérica; primeiro API com worker parado se replay puder produzir efeitos externos.
6. Libere worker somente depois de classificar/reconciliar outbox. Replay deve ser idempotente.
7. Monitore 5xx, latência, conexões, lag, dead letters e invariantes de produto.

## Depois

- mantenha origem e restore isolados até concluir comparação e retenção forense;
- importe/reconcilie a instância promovida no Terraform antes do próximo apply; não permita que um plano tente recriar/substituir o banco;
- revogue identidades temporárias e documente perda real de dados/RTO;
- execute restore de teste trimestral em ambiente isolado, sem dados pessoais quando possível.
