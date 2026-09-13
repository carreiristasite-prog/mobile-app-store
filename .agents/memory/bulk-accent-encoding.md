---
name: Bulk accent/UTF-8 fixes
description: Pitfall when bulk-fixing Portuguese accents across many files; how to do it safely.
---

# Bulk accent / UTF-8 replacement pitfall

When fixing many Portuguese spelling/accent errors across the codebase (e.g. `Configuracoes` → `Configurações`), do NOT use `perl -CSD -i -pe 's/.../accented/g'`.

**Why:** `-CSD` makes perl treat file I/O as UTF-8 (decode in / encode out), but the literal multi-byte replacement strings in the `-e` script are NOT decoded unless the script also has `use utf8`. So each literal accented char (e.g. `ç` = bytes C3 A7) is read as two Latin-1 chars and re-encoded to UTF-8 → double-encoded mojibake (`Ã§`). Pre-existing correct accents round-trip fine, so the file ends up MIXED (only the new insertions are corrupted), which makes a blanket re-decode unsafe.

**How to apply:**
- Prefer a Python script: `open(f, encoding='utf-8')` → `str.replace(...)` → write back. Clean and unambiguous.
- If a double-encoding already happened, reverse ONLY the mojibake 2-char sequences whose first char is `Ã` (U+00C3): map `Ã§→ç, Ã£→ã, Ãµ→õ, Ã¡→á, Ã©→é, Ã­→í, Ã³→ó, Ãº→ú, Ãª→ê, Ã¢→â, Ã´→ô, Ã à`. Legit Portuguese text in this app never contains a lone U+00C3 except real words like `ANULAÇÃO:`/`REVOGAÇÃO:` (where `Ã` is followed by `O`), so excluding `ÃO` keeps those safe.
- Always use whole-word boundaries (`\b`) and exclude `constants/mockData.ts` MATERIA_ALIASES keys (lowercase `lingua`/`portugues` must stay unaccented for canonMateria matching).
