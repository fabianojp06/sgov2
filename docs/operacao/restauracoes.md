# Registro das restaurações

Cada teste de restauração, mensal e automático, ou manual, com a linha de `/var/lib/sgo/restauracoes.log` transcrita pelo PO (US-015; `docs/operacao/backup.md`). O critério de aceite da US-015 pede a primeira restauração registrada de hml e de prod.

| Data (UTC) | Ambiente | Resultado | Tempo | Detalhe | Quem transcreveu |
| --- | --- | --- | --- | --- | --- |
| 12/11/2026 | CI (repositório local) | OK | 6 s | prova do backup full e diferencial e da restauração pelos scripts (`docker/testes/testar-backup.sh`), no dev da frente B; o registro gravado depois do full voltou | frente B |
