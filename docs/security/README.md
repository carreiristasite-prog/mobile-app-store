# Segurança do IA Aprova

**Status:** pacote de projeto, não homologado para produção  
**Versão:** 0.1.0-draft  
**Última revisão do pacote:** 2026-08-23

Este diretório transforma os requisitos de segurança do produto em ameaças,
controles verificáveis, regras de teste e gates de publicação. Ele não é um
laudo, não registra pentest executado e não fecha nenhum bloqueio de release.

## Documentos

- [Modelo de ameaças e fluxos de dados](./threat-model.pt-BR.md)
- [Matriz de riscos](./risk-register.pt-BR.md)
- [Plano de testes MASVS/ASVS](./security-test-plan.pt-BR.md)
- [Escopo autorizado de pentest e fraude](./pentest-fraud-scope.pt-BR.md)
- [Checklist de segurança pré-release](./pre-release-checklist.pt-BR.md)
- [Handoff de resposta a incidentes](./incident-response-handoff.pt-BR.md)
- [Mapa automatizável de gates](./release-security-gates.json)

O runbook regulatório canônico continua em
[incidentes/ANPD](../compliance/incident-response-anpd.pt-BR.md). O inventário
de bloqueios canônico continua em
[release-blockers.json](../compliance/release-blockers.json).

## Regra de evidência

Um controle pode estar em um destes estados:

- `designed`: documentado, ainda sem implementação comprovada;
- `implemented_unverified`: há artefato no repositório, mas falta validação no
  ambiente candidato;
- `verified_staging`: teste aprovado em staging autorizado e reproduzível;
- `verified_release`: evidência vinculada ao hash exato do build/imagem de
  release e aprovação independente;
- `blocked`: requisito ausente, falhou ou não possui evidência suficiente.

Somente `verified_release`, sem achado crítico/alto aberto e com parecer do
fiscal independente, pode satisfazer um gate de publicação. Ausência de
evidência equivale a falha. Exceções precisam de prazo, owner, compensação,
aceite de risco pela empresa e aprovação jurídica/privacidade quando aplicável;
exceção não é aceita para achado crítico.

## Validação local segura

O checker faz apenas leitura de arquivos locais. Ele verifica estrutura,
referências, IDs de risco e o mapeamento exato dos 19 bloqueios; não acessa
rede nem executa ataque:

```powershell
python scripts/security/check_security_docs.py
python -m unittest discover -s scripts/security/tests -p "test_*.py"
```

## Limites desta entrega

- nenhum pentest, DAST, fraude, restore, App Attest ou Play Integrity foi
  executado;
- nenhum ambiente, conta de loja, provedor ou dado real foi acessado;
- o material precisa de fiscal independente, responsável de segurança,
  privacidade e jurídico;
- todos os 19 itens de `docs/compliance/release-blockers.json` permanecem
  abertos.

