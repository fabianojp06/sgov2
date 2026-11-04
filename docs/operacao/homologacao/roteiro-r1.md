# Roteiro de homologação — R1

Acesso, administração, cadastros e o orçamento 2027 da Administração Central (trilha, spec §3.3; plano do P7, Task 1). Como usar este roteiro, registrar defeitos e dar o aceite: `README.md` desta pasta.

- **Ambiente:** hml, pela URL pública, cada usuário-chave com o próprio usuário.
- **Coluna "E2E":** "sim" quer dizer que o teste automatizado já percorre o fluxo a cada PR (`e2e/`). Nesses passos, o usuário-chave confere só o resultado na tela e a clareza das mensagens; não precisa repetir as variações.
- **Dados:** em hml estão o plano de contas oficial, a minuta de CC (provisória), os cargos sintéticos e os perfis padrão (seed). Não usar dado pessoal real nos testes; nomes e e-mails fictícios.

## A. Acesso (todos os perfis; spec §11.6)

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| A1 | Qualquer | Entrar pela primeira vez com a senha inicial | Pede a troca de senha antes da tela principal; depois mostra o menu do perfil | §11.2 | sim |
| A2 | Qualquer | Errar a senha e depois tentar um login que não existe | A mesma mensagem genérica nos dois casos | RN0015 | sim |
| A3 | Qualquer (usuário de teste) | Errar a senha 5 vezes seguidas | Aviso na última tentativa e depois a mensagem de bloqueio; o login fica bloqueado | C29, RN0018 | sim |
| A4 | Administrador | Desbloquear o usuário do A3 | Desbloqueio com confirmação Sim/Não; o usuário volta a entrar | RN0052 | sim |
| A5 | Administrador | Ligar a manutenção; outro perfil tenta entrar; desligar | Os outros perfis recebem o aviso de manutenção; o Administrador entra | §11.2 | sim |
| A6 | Qualquer | Sair → Sim; depois usar o botão Voltar do navegador | Volta ao login; o Voltar não mostra dados do usuário | §11.2 | sim |
| A7 | Cada perfil | Conferir o menu | Só os itens do perfil (§11.3); nenhum item que leve a uma tela sem permissão | §11.3, RN0027 | em parte |
| A8 | Qualquer | Ficar sem usar o sistema além do tempo de sessão e clicar num item | Pede login de novo, sem perder a segurança | §11.2 | não |

## B. Administração (Administrador)

| # | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- |
| B1 | Listar usuários, cadastrar um novo, alterar e gerar nova senha | Cada passo com confirmação; o novo usuário recebe a troca obrigatória | US-038 | sim |
| B2 | Cadastrar com um campo inválido | O erro aparece no campo, sem perder o que foi digitado | US-022 | sim |
| B3 | Um perfil sem permissão abre a URL de usuários direto | Página não encontrada (404), sem mostrar que a tela existe | RN0521 | sim |

## C. Cadastros

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| C1 | GFIN | Plano de contas: consultar a árvore, expandir níveis, filtrar | Árvore com os níveis da §6.1; rolagem fluida | §6.1 | em parte |
| C2 | GFIN | Plano de contas: importar uma planilha com um erro, corrigir e importar de novo | Primeiro, o relatório de erros sem gravar nada; depois, o resumo de incluídas, alteradas e inativadas | §6.1, US-043 | não |
| C3 | GFIN | Centros de custo: consultar e importar a planilha | Árvore de 5 níveis; em hml, a carga marcada como provisória (minuta) | §6.1a | não |
| C4 | GRH | Tabela salarial: incluir e alterar uma faixa e um nível | Valores com 2 casas; a alteração aparece na consulta | US-049 | não |
| C5 | GRH | Cargos: importar a planilha de cargos e abrir um cargo | O cargo mostra a faixa, o nível e o custo calculado do ano | US-049, US-051 | não |
| C6 | GRH | Benefícios: ativar, desativar e informar um valor manual num cargo | O custo do cargo muda conforme o benefício | US-050 | não |
| C7 | GFIN | Parâmetros do exercício (encargos, semáforo) e SMN | Gravam e aparecem no exercício certo; um exercício congelado não aceita mudança | US-053 | não |
| C8 | Perfil sem salário (ex.: Gestor de Diretoria) | Abrir um cargo | O salário não aparece | R24 | não |

## D. Orçamento 2027 da Administração Central

Os passos seguem a ordem do fluxo; cada um parte do resultado do anterior.

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| D1 | GFIN | Criar o exercício 2027 em branco e avançar para Em Elaboração | Exercício criado; os parâmetros e os benefícios do cargo de 2027 partem do ano anterior | US-055 | sim |
| D2 | GFIN | Importar a planilha-modelo com um erro; corrigir e importar de novo | Relatório de erros linha a linha sem gravar nada; depois, o resumo por CC | US-121 | sim |
| D3 | GFIN | Conferir o custo de pessoal de duas posições contra a planilha | O valor do sistema é o do motor oficial; diferenças explicadas pelos parâmetros | §6.6, C33 | não |
| D4 | GFIN | Digitar as receitas confirmada e prevista | A visão mostra o resultado e o teto | US-060, C35 | sim |
| D5 | GFIN | Definir o teto acima da receita confirmada | Pede justificativa; o semáforo muda conforme as faixas | US-059 | em parte |
| D6 | Gestor de Diretoria | Abrir a visão por CC | Só a subárvore da sua diretoria; outra diretoria dá 404 | C25, US-058 | sim |
| D7 | GFIN | Enviar para aprovação | O exercício fica Em Aprovação e não aceita edição | US-061 | sim |
| D8 | DIREX | Rejeitar com justificativa | Volta para Em Elaboração com a justificativa visível | C36 | sim |
| D9 | GFIN e DIREX | Reenviar; DIREX aprova | Oficializado; o snapshot fica disponível e nada mais muda | C36 | sim |
| D10 | Orçamentista | Tentar abrir o orçamento da Adm. Central | Sem menu e 404 na URL direta | §11.3 | sim |

## E. Exportações

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| E1 | GFIN | Exportar uma listagem em XLSX e abrir no Excel | Valores como número, datas como data, títulos em negrito | US-021 | não |
| E2 | GFIN | Exportar em CSV e abrir no Excel em pt-BR | Colunas separadas certo, acentos corretos, vírgula decimal | #233 | não |
| E3 | GFIN | Cadastrar um texto que começa com `=1+1` (ex.: na descrição de um cargo) e exportar | A célula mostra o texto `=1+1`, nunca o resultado 2 | #233, M2 | não |

> **Situação em 04/11:** a exportação existe no `ger` (C3), mas nenhuma tela a oferece ainda. A primeira prevista é o relatório de conferência da carga (plano do P7, Task 2). Se a release homologada não tiver tela com exportação, o bloco E fica para a release seguinte, registrado como ressalva no aceite.

## F. Encerramento

| # | Quem | Ação |
| --- | --- | --- |
| F1 | Usuários-chave | Marcar os passos na issue da release e abrir os defeitos |
| F2 | PO | Conferir que não há defeito crítico ou alto aberto |
| F3 | PO | Registrar o aceite na issue (README, "Aceite") |
