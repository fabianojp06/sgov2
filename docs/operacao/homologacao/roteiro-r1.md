# Roteiro de homologação — R1

Acesso, administração, cadastros e o orçamento 2027 da Administração Central (trilha, spec §3.3; plano do P7, Task 1). Como usar este roteiro, registrar defeitos e dar o aceite: `README.md` desta pasta.

## Antes de começar (PO)

- **Hml depois do ensaio da carga** (plano do P7, Task 5, D-P7-7): o banco de hml terá os arquivos reais da GFIN e da GRH, sem a minuta nem os cargos sintéticos da seed. Os centros de custo foram carregados com o documento de aprovação de ensaio (ou o real, se a DIREX já tiver aprovado).
- **E-mail:** o SMTP de hml configurado (`docs/operacao/deploy.md`). A senha inicial de cada usuário-chave é gerada pelo sistema e enviada **só por e-mail** (RN0059). O Administrador nunca a vê.
- **Usuários-chave** cadastrados pelo Administrador com o **e-mail institucional real** de cada um, para receber a senha. A senha temporária vale 24 horas.
- **Gestor de Diretoria:** o cadastro precisa ter o "Centro de custo de escopo" da diretoria dele. Sem isso, o passo D6 não funciona.
- **Um usuário de teste a mais**, só para o passo A3 (ele fica bloqueado).

## Como ler as tabelas

- **E2E:**
  - **"sim":** o teste automatizado do sistema já percorre o passo a cada mudança. O usuário-chave confere o resultado na tela e se as mensagens estão claras;
  - **"em parte":** o teste cobre só uma parte;
  - **"não":** só a homologação confere.
- **Ref.:** a regra da especificação, para quem for registrar um defeito.
- **Importações:** importe sempre o **arquivo completo** da carga, com no máximo uma linha alterada. A importação inativa o que não está no arquivo. Uma planilha de teste com poucas linhas inativaria a base de que os blocos seguintes dependem.

## A. Acesso (todos os perfis; spec §11.6)

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| A1 | Qualquer | Entrar pela primeira vez com a senha recebida por e-mail | Pede a troca de senha antes da tela principal; depois mostra o menu do perfil | §11.2 | sim |
| A2 | Qualquer (seu próprio usuário) | Errar a senha uma vez; depois tentar um login que não existe | A mesma mensagem genérica nos dois casos | RN0015 | sim |
| A3 | Usuário de teste | Errar a senha 5 vezes seguidas; depois tentar com a senha certa | No 4º erro, o aviso de que resta 1 tentativa; o 5º bloqueia; com a senha certa, a mensagem de usuário bloqueado | C29, RN0018 | sim |
| A4 | Administrador | Desbloquear o usuário do A3; o usuário entra de novo | Desbloqueio com confirmação Sim/Não; o usuário volta a entrar | RN0052 | em parte |
| A5 | Qualquer | Sair → Sim; depois usar o botão Voltar do navegador | Volta ao login; o Voltar não mostra dados do usuário | §11.2 | sim |
| A6 | Cada perfil | Conferir o menu | Só os itens do perfil; nenhum item leva a uma tela sem permissão | §11.3 | em parte |
| A7 | Qualquer | Ficar 30 minutos sem usar o sistema e clicar num item | Volta ao login sem mostrar dados (a sessão também acaba em 12 horas, mesmo com uso) | §11.2 | não |

> **Manutenção (lacuna):** a R1 não tem tela para ligar e desligar o modo de manutenção. O E2E testa o bloqueio dos outros perfis com a manutenção ligada direto no banco de teste. Fica como ressalva do aceite, até haver a tela.

## B. Administração (Administrador)

| # | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- |
| B1 | Listar usuários, cadastrar um novo, alterar e gerar nova senha | Cada passo com confirmação; o usuário novo recebe a senha por e-mail e precisa trocá-la no primeiro acesso | US-038 | em parte |
| B2 | Cadastrar com um campo inválido | O erro aparece no campo, sem perder o que foi digitado | US-022 | sim |
| B3 | Com um perfil sem permissão, abrir o endereço da tela de usuários | "Página não encontrada", sem mostrar que a tela existe | §11.3 | sim |

## C. Cadastros

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| C1 | GFIN | Plano de contas: consultar a árvore, expandir níveis, filtrar | Árvore com os níveis da §6.1; rolagem fluida | §6.1 | não |
| C2 | GFIN | Plano de contas: importar o arquivo completo com um erro numa linha; corrigir e importar de novo | Primeiro, o relatório de erros sem gravar nada; depois, o resumo com uma linha alterada e nenhuma inativada | §6.1, US-043 | não |
| C3 | GFIN | Centros de custo: consultar; importar o arquivo completo com uma descrição alterada, informando a data e o documento da aprovação | Árvore de 5 níveis; a carga pede a aprovação da DIREX e mostra o resumo | §6.1a | não |
| C4 | Analista GRH | Tabela salarial: incluir e alterar uma faixa | Valores com 2 casas; a alteração aparece na consulta | US-049 | não |
| C5 | Analista GRH | Cargos: importar o arquivo completo com um cargo alterado e abrir esse cargo | O cargo mostra a faixa, o nível e o custo calculado do ano | US-049, US-051 | não |
| C6 | Analista GRH | Benefícios: ativar, desativar e informar um valor manual num cargo | O custo do cargo muda conforme o benefício | US-050 | não |
| C7 | GFIN | Parâmetros do exercício 2027 (encargos, semáforo) e salário mínimo | Gravam e aparecem no exercício certo | US-053 | não |
| C8 | Orçamentista ou DIREX | Abrir um cargo | O cargo abre, mas o salário não aparece | §11.3 | não |

> **Histórico (lacuna):** cada cadastro grava o Histórico de Operações, mas a R1 não tem a tela de consulta. Fica como ressalva do aceite.

## D. Orçamento 2027 da Administração Central

Os passos seguem a ordem do fluxo; cada um parte do resultado do anterior.

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| D1 | GFIN | Criar o exercício 2027 em branco e avançar para Em Elaboração | Exercício criado com os parâmetros e benefícios de 2027 (os do C6 e do C7) | US-055 | sim |
| D2 | GFIN | Importar a planilha-modelo com um erro; corrigir e importar de novo | Relatório de erros linha a linha sem gravar nada; depois, o resumo por centro de custo | US-121 | sim |
| D3 | GFIN | Conferir o custo de pessoal de duas posições contra a planilha | O valor do sistema é o do cálculo oficial; as diferenças se explicam pelos parâmetros | §6.6 | não |
| D4 | GFIN | Digitar as receitas confirmada e prevista | A visão mostra o resultado e o teto | US-060 | sim |
| D5 | GFIN | Definir o teto acima da receita confirmada | Pede uma justificativa de pelo menos 15 caracteres; o semáforo muda conforme as faixas | US-059 | em parte |
| D6 | Gestor de Diretoria | Abrir a visão por centro de custo; tentar o endereço de outra diretoria | Só a parte da árvore da sua diretoria; outra diretoria dá "Página não encontrada" | C25, US-058 | sim |
| D7 | GFIN | Enviar para aprovação; tentar importar ou editar | O exercício fica Em Aprovação e não aceita mudança | US-061 | em parte |
| D8 | DIREX | Rejeitar com uma justificativa (pelo menos 15 caracteres) | Volta para Em Elaboração, com a justificativa visível nos trâmites | C36 | sim |
| D9 | GFIN e DIREX | Reenviar; DIREX aprova | Aparece "Oficializado em <data>"; a visão fica só de leitura e a importação deixa de ser oferecida | C36 | sim |
| D10 | GFIN | Depois do D9, tentar mudar um parâmetro de 2027 | O exercício congelado não aceita a mudança | US-053 | não |
| D11 | Orçamentista | Tentar abrir o orçamento da Adm. Central | Sem o menu, e "Página não encontrada" pelo endereço direto | §11.3 | sim |

## E. Exportações

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| E1 | GFIN | Exportar uma listagem em XLSX e abrir no Excel | Valores como número, datas como data, títulos em negrito | US-021 | não |
| E2 | GFIN | Exportar em CSV e abrir no Excel em português | Colunas separadas certo, acentos corretos, vírgula decimal | #233 | não |
| E3 | GFIN | Cadastrar um texto que começa com `=1+1` (por exemplo, na descrição de um cargo) e exportar | A célula mostra o texto `=1+1`, nunca o resultado 2 | #233 | não |

> **Situação em 04/11:** a exportação existe no sistema, mas nenhuma tela a oferece ainda. A primeira prevista é o relatório de conferência da carga (plano do P7, Task 2). Se a release homologada não tiver tela com exportação, o bloco E fica para a release seguinte, registrado como ressalva no aceite.

## F. Encerramento

| # | Quem | Ação |
| --- | --- | --- |
| F1 | Usuários-chave | Marcar os passos na issue da release e abrir os defeitos |
| F2 | PO | Conferir que não há defeito crítico ou alto aberto |
| F3 | PO | Registrar o aceite na issue, com as ressalvas (manutenção, Histórico e, se for o caso, exportações) |

## Glossário

- **Release:** a versão do sistema que está em homologação, identificada por um código curto (o SHA) que o PO anota na issue.
- **E2E:** o teste automatizado que percorre as telas como um usuário.
- **Página não encontrada:** a resposta do sistema para um endereço que o perfil não pode abrir. Ela não confirma que a tela existe.
