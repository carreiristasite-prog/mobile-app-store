# Site legal estático

Microsite sem framework, JavaScript, cookies, trackers ou dependências. Pode
ser servido por qualquer host estático com HTTPS.

## Páginas

- `/` central;
- `/privacy/` política pública;
- `/terms/` termos públicos;
- `/account-deletion/` instrução exigida pela loja;
- `/support/` canais de atendimento.
- `/subprocessors/` lista fail-closed de fornecedores e transferências;
- `/full/*.txt` cópias integrais, byte a byte, dos documentos canônicos.

As páginas HTML de Termos e Privacidade são resumos claramente rotulados.
Cada uma liga para o texto integral. Execute `sync-legal-docs.ps1` sempre que
os documentos em `docs/legal` mudarem; o checker compara os hashes da fonte,
da cópia publicada e do manifesto.

## Validar

Durante a preparação, para confirmar HTML e links mesmo com placeholders:

```powershell
./check.ps1 -AllowPlaceholders
```

No gate final:

```powershell
./check.ps1
```

O modo permissivo converte placeholders, `draft`/`minuta` e bloqueios externos
em avisos, mas nunca ignora HTML, links ou divergência de hash. O gate final
reprova placeholders, rascunhos, `releaseAllowed=false`, bloqueios
`release/open` e cópia integral divergente. Não publique enquanto ele falhar.
