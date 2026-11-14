# Inteligência artificial: operação

Como ligar, limitar, acompanhar e desligar as funções de IA (US-019; spec §4.4 e §6.8). A IA **sugere, não grava**: nenhuma resposta altera dado oficial sozinha, e toda tela de IA mostra o selo "Gerado com IA – revisar".

## Camadas de controle

Uma chamada só acontece com **todas** as camadas liberadas. Basta uma desligada para nada sair.

| Camada | Onde | Quem |
| --- | --- | --- |
| Chave do provedor | Variável `ANTHROPIC_API_KEY`, **só no serviço `app`** do Easypanel. Nunca no repositório, no `.env` de dev nem no `worker` | PO |
| Chave geral, teto global e limite por minuto | Cadastros › Inteligência artificial (`/int/ia`), bloco do topo | Administrador |
| Caso de uso ligado, com teto mensal maior que zero | `/int/ia`, uma linha por caso | Administrador |
| Permissão `executar` da funcionalidade do caso | Perfis (seed) e exceções por usuário | Administrador |

- Sem a `ANTHROPIC_API_KEY`, o sistema usa o provedor desabilitado, e as telas dizem "A IA não está configurada neste ambiente".
- **Todo caso nasce desligado e com teto zero** (seed). Ligar é sempre um ato do Administrador, que fica no Histórico.
- Teto atingido (do caso ou global) bloqueia novas chamadas até o mês seguinte ou até o teto subir. A tela mostra o consumo do mês.

## Os casos de uso

O que cada caso envia ao provedor. Nenhum envia nome, login, e-mail ou salário individual.

| Caso (código) | Tela | O que vai ao provedor | Perfis com `executar` |
| --- | --- | --- | --- |
| `orc.ia_justificativa` | Pacotes base zero | O pacote (conta, descrição, valores) e o rascunho da justificativa | Gestor de Diretoria, GFIN |
| `orc.ia_sugestao_conta` | Pacotes base zero | A descrição do gasto e as contas e CCs permitidos | Gestor de Diretoria, GFIN, Administrador |
| `orc.ia_revisor` | Orçamento da Adm. Central (no worker) | Os lançamentos do exercício (contas, justificativas, valores), sem salário individual | GFIN |
| `orc.ia_recusa` | Central de Tarefas (recusa do WA01) | O resumo da proposta (valores, contas, o que mudou) e o rascunho do aprovador | GFIN, DIREX |
| `rel.ia_ajuda_manual` | Manual (`/rel/manual`) | O manual do perfil e a pergunta | Todos |
| `rel.ia_quadro_pessoal` | Análise do quadro de pessoal | Agregados: postos e custo total por proposta (≥ 3 postos, custos diferentes); Adm. Central por diretoria | Analista GRH, DIREX, GFIN |
| `rel.ia_comparativo_tps` | Comparativo entre TPs | Pesos e execução por TP (só versão oficial, regras da US-107) e as marcas de fora da curva | DIREX, GFIN |
| `rel.ia_relatorio_executivo` | Relatório executivo mensal | Agregados da Adm. Central (escopo total) e Valor Global e execução por TP | GFIN |
| `rel.ia_apresentacao` | Apresentação para reunião de diretoria | O tema e os mesmos agregados do relatório executivo | GFIN |
| `rel.ia_pergunte_sgo` | Pergunte ao SGO | **Só a pergunta** e o catálogo de consultas. O número vem do sistema | DIREX, GFIN, Gestor de Diretoria |

A lista viva está em `/int/ia`. Os textos digitados pelo usuário vão entre as marcas `<<< >>>`, com a instrução de tratá-los só como dado.

## Ligar num ambiente

1. **PO:** cadastra a `ANTHROPIC_API_KEY` no serviço `app` (Easypanel) e faz o deploy do serviço.
2. **Administrador**, em `/int/ia`:
   1. liga a chave geral e define o teto global do mês (em dólares) e o limite por minuto por usuário;
   2. liga **um caso por vez**, com um teto mensal pequeno no começo (por exemplo, US$ 5);
   3. confere o consumo no dia seguinte e ajusta.
3. Pede a um usuário do perfil que faça uma chamada e confere a linha em `/int/ia` (chamadas e erros do mês).

## Desligar rápido (incidente, custo, resposta ruim)

- **Tudo:** desligar a chave geral em `/int/ia`. Vale na hora para todos os casos.
- **Um caso:** desligar a linha dele. As telas escondem o campo ou mostram "A IA está desligada para esta função".
- **Sem acesso à tela:** o PO tira a `ANTHROPIC_API_KEY` do `app` e faz o deploy.

Nada se perde ao desligar: o que a IA sugeriu e o usuário salvou continua salvo; o rascunho do relatório executivo continua editável.

## Acompanhar

- **Consumo e erros do mês**, por caso e global: `/int/ia`.
- **Qualidade:** "Avaliar a qualidade" em `/int/ia` (fila `ia.avaliar` no worker), com os casos de teste de cada função.
- **Rastro:** cada chamada fica em `ia_chamada` (quem, caso, modelo, tokens, custo, latência e erro; o texto só nos casos marcados para guardar). As gravações que vêm de sugestão aceita vão ao Histórico com a origem `SUGESTAO_IA`.

## Incidentes conhecidos

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "A IA não está configurada neste ambiente" | Sem `ANTHROPIC_API_KEY` no `app` | PO cadastra e faz o deploy |
| "A IA está desligada para esta função" | Chave geral, caso desligado ou teto zero | Administrador liga em `/int/ia` |
| "Muitos pedidos à IA em pouco tempo" | Limite por minuto do usuário | Aguardar um minuto; ajustar o limite se for o uso normal |
| "A IA demorou demais para responder" | Tempo limite do caso (30 s a 90 s) | Tentar de novo; se repetir, conferir a latência em `/int/ia` |
| "A credencial da IA é inválida" | Chave revogada ou errada | PO troca a chave no `app` |
