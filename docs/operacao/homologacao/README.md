# Homologação

Como os usuários-chave aprovam o que vai para produção (US-117, plano do P7, Task 1, D-P7-4).

## Release

- **Hml recebe cada commit da `main`**, e prod só recebe uma tag `v*` que o PO faz (`docs/operacao/deploy.md`).
- Uma **release** é o commit da `main` que está em hml no início da homologação. Ele é identificado pelo SHA curto do último run com sucesso do `imagem.yml` na `main`, o que fez o deploy de hml. A tela ainda não mostra a versão.
- **Durante a homologação, hml pode mudar** com um merge novo. Se mudar:
  - o PO anota o SHA novo na issue;
  - os blocos do roteiro afetados pelos PRs que entraram são refeitos.
  
  Para evitar isso, a janela de homologação deve ser curta, e os merges, combinados com o PO.
- **Prod recebe exatamente o commit homologado:** o PO faz a tag `v*` nesse SHA, que pode ser um ancestral da `main` (`deploy.md`), e nunca num commit mais novo.
- A R1 é a primeira: acesso, cadastros e o orçamento 2027 da Administração Central (trilha, spec §3.3).

## Quem homologa

| Perfil | Usuário-chave | Blocos do roteiro |
| --- | --- | --- |
| Administrador | indicado pelo PO | Acesso, Administração |
| Gestor Financeiro (GFIN) | indicado pela GFIN | Cadastros (leitura e parâmetros), Orçamento, Exportações |
| Analista GRH | indicado pela GRH | Cadastros de pessoal (tabela salarial, cargos, benefícios, SMN) |
| Gestor de Diretoria | um gestor de cada diretoria piloto | Orçamento (escopo da diretoria) |
| Diretoria Executiva (DIREX) | indicado pela DIREX | Orçamento (aprovação e rejeição) |

Cada usuário-chave recebe em hml um usuário com o perfil dele, criado pelo Administrador pela tela de usuários. A senha inicial vai por canal combinado com o PO, nunca por issue, e é trocada no primeiro acesso.

## A issue de homologação

O PO abre uma issue por release, com a label `homologacao` e o título `Homologação R1 — <tag>`. O corpo segue o modelo abaixo, e o roteiro da release entra como checklist.

```markdown
**Release:** <tag> · **Ambiente:** hml · **Período:** <de> a <até>

**Roteiro:** docs/operacao/homologacao/roteiro-r1.md (um item por passo; marque ao concluir)

**Usuários-chave:** <perfil: nome>

**Defeitos encontrados:** <links das issues>

**Aceite:** comentário do PO no fim, com "Aceito" ou "Aceito com ressalvas: …"
```

## Defeitos

- Cada defeito vira uma issue com a label da frente dona (`frente:A` ou `frente:B`), o passo do roteiro, o perfil, o que se esperava e o que aconteceu. Não pode levar print com dado pessoal nem senha.
- **Gravidade:**
  - **crítica:** perda ou alteração indevida de dado, acesso fora da permissão, valor errado no orçamento;
  - **alta:** fluxo principal não conclui;
  - **média:** fluxo conclui com contorno;
  - **baixa:** texto, layout.
- **Defeito crítico ou alto bloqueia o aceite.** A correção gera uma tag nova, e o roteiro é refeito só nos blocos afetados, registrados na mesma issue.

## Aceite

- O PO registra o aceite como comentário na issue da release, com a data, e fecha a issue.
- "Aceito com ressalvas" lista as ressalvas, e cada uma tem uma issue de gravidade média ou baixa.
- O aceite é pré-requisito do go/no-go (plano do P7, Task 7).
