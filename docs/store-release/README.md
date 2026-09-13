# Pacote técnico de publicação — IA Aprova

Este diretório prepara a configuração e os textos de Apple App Store e Google
Play sem acessar contas, assinar binários, enviar builds ou publicar. Ele não é
uma declaração de que o aplicativo foi aceito ou está pronto.

## Conteúdo

- `store-package.json`: invariantes canônicos de IDs, URLs, assinatura e claims.
- `release-evidence.json`: evidências externas e técnicas; começa fail-closed.
- `metadata-pt-BR.md`: listagens candidatas pt-BR.
- `apple-review-package.pt-BR.md`: idade, IAP, notas e acesso Apple.
- `google-play-package.pt-BR.md`: IARC, Data Safety, IAP e acesso Google.
- `privacy-disclosures.pt-BR.md`: mapeamento conservador código → formulários.
- `assets-and-screenshots.pt-BR.md`: inventário, dimensões e roteiro visual.
- `official-requirements-2026-08-23.md`: fontes oficiais e validade da auditoria.
- `risks-and-handoff.pt-BR.md`: bloqueios e sequência de fechamento.
- `independent-review-handoff.pt-BR.md`: hashes, testes e escopo do fiscal.
- `scripts/store_release_check.py`: checker técnico fail-closed.

## Executar

Na raiz de `Mobile-App-Store`:

```powershell
python scripts/store_release_check.py
python -m unittest scripts.tests.test_store_release_check -v
```

O primeiro comando **deve falhar** neste momento. Ele somente retorna zero
quando configuração, assets, URLs, binário candidato, formulários, testes e
aprovações independentes estiverem presentes.

## Regras de preenchimento

- Não colocar senhas, chaves privadas, token EAS, credencial de serviço,
  app-specific password ou dados pessoais de revisor no Git.
- E-mails das contas de review podem constar como evidência apenas se forem
  contas sintéticas; senha deve ser uma referência ao cofre.
- Todo booleano deve refletir evidência anexada ao release, não intenção.
- Aprovações devem ser objetos com `reviewer`, `reviewedAt` RFC 3339 e
  `artifactSha256`; texto como `approved` não é evidência.
- Hashes de IPA, AAB, SBOM e artefato de aprovação usam SHA-256 hexadecimal.
  Referências de senha usam somente `secret://`, `gcp-sm://` ou `vault://`;
  nunca guardar a senha no JSON.
- Atualizar os formulários depois de qualquer mudança de SDK, permissão,
  endpoint, logging, fornecedor, billing ou tratamento de dados.
- Reexecutar fontes oficiais em até 90 dias da submissão.
