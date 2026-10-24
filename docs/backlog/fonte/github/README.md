# Sincronização do backlog com o GitHub

Scripts que publicaram o backlog no repositório `fabianojp06/sgov2` e no projeto "SGO 2.0 – Roadmap" (https://github.com/users/fabianojp06/projects/4).

| Arquivo | Função |
| --- | --- |
| `plano.json` | Plano vigente (histórias, frente, datas), gerado por `../cronograma.py` |
| `estado.json` | Mapa do que já existe no GitHub: número das issues, milestones, IDs dos itens e campos do projeto. **Não apagar**: é o que torna os scripts idempotentes |
| `publicar.py` | Cria labels, milestones, issues, sub-issues, dependências e links (só cria o que ainda não está em `estado.json`) |
| `projeto.py` | Cria o projeto, os campos e preenche os itens |
| `atualizar.py` | Reaplica um plano novo (frente, datas, ordem) em issues, milestones e campos |

## Reprogramar as datas (uso mais comum)

```bash
cd docs/backlog/fonte
python3 cronograma.py dados.py github/novo.json 8        # 8 h/dia por frente (40 h/semana)
cd github && python3 atualizar.py plano.json novo.json && mv novo.json plano.json
```

Depois, faça o commit de `plano.json` e `estado.json` num PR.

## Cuidados

- Os scripts escrevem no GitHub (ação externa). Rodar só com a liberação do PO.
- Histórias novas em `dados.py` exigem `publicar.py` (cria as issues) e depois `projeto.py` (adiciona ao projeto).
- As visões do projeto (Cronograma, Quadro, Backlog) são criadas à mão, porque a API do GitHub não cria visões.
