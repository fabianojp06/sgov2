# Roteiro de homologação — R1

Acesso, administração, cadastros e o orçamento 2027 da Administração Central (trilha, spec §3.3; plano do P7, Task 1). Como usar este roteiro, registrar defeitos e dar o aceite: `README.md` desta pasta.

**Atualizado em 14/11/2026** com as telas que entraram depois de 04/11: as últimas linhas dos blocos A a E e o bloco G, novo. As ressalvas de 04/11 (manutenção, Histórico e exportações) deixaram de existir. As propostas de TP (R4) terão roteiro próprio quando o envio para aprovação (US-079) estiver na `main`.

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
| A8 | Qualquer | Na tela de login, "Esqueci minha senha", primeiro com um login que não existe e depois com o seu | A mesma resposta nos dois casos; só o seu recebe o e-mail com a senha temporária, e a senha antiga continua valendo até a troca | US-029 | sim |
| A9 | Qualquer | Entrar em outro navegador ou computador com o mesmo usuário | A estação anterior volta ao login com o aviso de que a sessão foi aberta em outro lugar | US-028, RN0519 | sim |

## B. Administração (Administrador)

| # | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- |
| B1 | Listar usuários, cadastrar um novo, alterar e gerar nova senha | Cada passo com confirmação; o usuário novo recebe a senha por e-mail e precisa trocá-la no primeiro acesso | US-038 | em parte |
| B2 | Cadastrar com um campo inválido | O erro aparece no campo, sem perder o que foi digitado | US-022 | sim |
| B3 | Com um perfil sem permissão, abrir o endereço da tela de usuários | "Página não encontrada", sem mostrar que a tela existe | §11.3 | sim |
| B4 | Perfis de Usuário: cadastrar um perfil pela grade, associar um usuário e tentar excluir o perfil | Nome único e pelo menos uma funcionalidade; a exclusão só é aceita depois de desassociar o usuário | US-037 | sim |
| B5 | Usuários: retirar de um usuário uma funcionalidade do perfil dele (exceção) e devolver | O usuário perde e recupera o item de menu, sem mudar o perfil dos outros | US-039 | sim |
| B6 | Módulos e Funcionalidades: desativar o módulo da Adm. Central e reativar | Os usuários da GFIN perdem o menu do módulo. Ao reativar, as funcionalidades não voltam sozinhas: cada uma é reativada na tela | US-035 | sim |
| B7 | Ativar/Desativar Sistema: desativar com motivo e com espera; depois ativar | Os outros veem o aviso com a contagem e caem com "Sistema está em manutenção"; o Administrador continua só com a Administração e reativa | US-036, US-033 | sim |
| B8 | Alçadas de Aprovação: cadastrar a alçada de um fluxo, trocar o titular e excluir | Cada passo com confirmação; a grade mostra o titular e o substituto | US-042 | sim |
| B9 | Notificações de Desempenho: incluir um destinatário, tentar incluir o mesmo de novo e excluir | O repetido é recusado com mensagem | US-041 | sim |
| B10 | Histórico de Operações (também o Auditor): filtrar pelo próprio login e exportar | Aparece o login de hoje e as operações dos blocos anteriores; a exportação traz o mesmo filtro | US-040 | sim |

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
| C9 | Analista GRH | Estrutura funcional: incluir uma diretoria, uma gerência abaixo dela e um setor; ligar um cargo ao setor | A árvore só aceita a hierarquia da regra; o cargo mostra o vínculo com o setor | US-048 | não |
| C10 | GFIN | Impostos e alíquotas: incluir uma alíquota nova com vigência a partir do mês seguinte; depois tentar uma com competência passada | A anterior continua valendo até a nova começar; a competência passada é recusada ("não pode ser retroativa") | US-052 | não |
| C11 | GFIN | Plano de contas › Parâmetros locais: definir a natureza (OPEX ou CAPEX) e faixas próprias do semáforo de uma conta analítica | Grava; sem faixas próprias, valem as do exercício. Com alguma conta CAPEX, o seletor de bens das propostas passa a mostrar só as CAPEX | US-045 | não |
| C12 | GFIN | Plano de contas › Agrupadores: criar um agrupador e associar contas analíticas | Uma conta pode estar em mais de um agrupador, e o plano de contas não muda | US-047 | não |
| C13 | GFIN | Cadastros › Instituição: alterar o nome de exibição | O novo nome aparece nas telas e no cabeçalho dos e-mails; em branco, o sistema mostra só "SGO" | §6.7 | não |

Cada cadastro grava o Histórico de Operações, conferido no B10.

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
| D12 | GFIN | Num exercício Em Elaboração (pode ser outro que não o 2027 do D9), Posições de pessoal: incluir uma posição escolhendo o cargo | O salário vem da Fonte Ativa do cargo, com a faixa; a prévia mostra o custo anual antes de gravar | US-056 | sim |
| D13 | Gestor de Diretoria | Posições de pessoal: incluir uma posição em texto livre, alterar e excluir | Só os CCs da sua diretoria aparecem; com o cargo do cadastro, a Fonte Ativa e a faixa não aparecem para ele | US-056, C25 | sim |
| D14 | DIREX | Abrir as posições | Vê as posições com salário e valor anual mascarados, sem ações | §11.3 | sim |
| D15 | GFIN | Ligar uma posição em texto livre ao cargo do cadastro pela tela de correspondência | A posição passa a usar o cargo e o custo dele | P16 | sim |
| D16 | Gestor de Diretoria | Pacotes base zero: incluir um pacote mensal com prévia, alterar para pontual e excluir | Só os CCs da sua diretoria; a prévia mostra a distribuição antes de gravar | US-057 | sim |
| D17 | GFIN | Pedir a revisão de consistência antes de enviar | Aparece "Revisão em andamento…" e depois os achados, cada um com o link para a linha. Exige o caso do revisor ligado (bloco G) | US-064 | em parte |

## E. Exportações

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| E1 | GFIN | Exportar uma listagem em XLSX e abrir no Excel | Valores como número, datas como data, títulos em negrito | US-021 | não |
| E2 | GFIN | Exportar em CSV e abrir no Excel em português | Colunas separadas certo, acentos corretos, vírgula decimal | #233 | não |
| E3 | GFIN | Cadastrar um texto que começa com `=1+1` (por exemplo, na descrição de um cargo) e exportar | A célula mostra o texto `=1+1`, nunca o resultado 2 | #233 | não |
| E4 | GFIN | Relatórios › Conferência da carga: exportar em PDF | O PDF tem as mesmas linhas da tela, com os números alinhados e legíveis | US-024 | não |
| E5 | Administrador | Exportar o Histórico (B10) sem filtro, com mais de 5.000 linhas | A exportação passa para segundo plano e aparece em Relatórios › Minhas exportações; o arquivo fica disponível por 7 dias | US-022, US-023 | não |

Telas com exportação: o plano de contas, a conferência da carga e o Histórico. A exportação grande só aparece se a base de hml tiver linhas suficientes.

## G. Ajuda e inteligência artificial

**Antes (PO):** a chave da IA configurada no hml. Sem ela, os passos G3 a G5 ficam como ressalva do aceite.

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| G1 | Cada perfil | Clicar em "Manual" na barra de status | O manual mostra só as telas do perfil, na ordem do menu, com as ações permitidas e o roteiro de treinamento | US-118 | sim |
| G2 | Administrador | Cadastros › Inteligência artificial: ligar o caso "Ajuda como faço… com base no manual" com um teto mensal | O caso fica ligado com o teto; desligado, o campo de pergunta do G3 some | US-019 | não |
| G3 | Qualquer | No manual, perguntar "como faço para…" sobre uma tela do perfil e depois sobre uma que o perfil não tem | A resposta cita os trechos do manual com o link da tela e o selo "Gerado com IA – revisar"; para a tela que o perfil não tem, diz que o manual não responde | US-108 | não |
| G4 | Analista GRH ou GFIN | Ligar o caso "Análise do quadro de pessoal" (G2) e abrir Relatórios › Análise do quadro de pessoal | Os agregados aparecem sem nomes e sem custo por cargo; a análise traz o selo e os agregados enviados | US-107 | não |
| G5 | Gestor de Diretoria | Num pacote base zero, pedir a sugestão de conta e de justificativa | A sugestão aparece para revisar; nada é gravado até o gestor salvar | US-062, US-063 | não |
| G6 | DIREX ou GFIN | Administração Central › Comparativo entre TPs; ligar o caso "Comentários do comparativo" (G2) e pedir os comentários | A tabela mostra os pesos só das versões oficiais, com o motivo quando omitidos, e marca "acima/abaixo da curva" em texto; os comentários trazem o selo | US-106 | não |
| G7 | GFIN | Relatórios › Relatório executivo mensal: gerar o rascunho do mês, revisar os textos, salvar e aprovar; baixar o PDF antes e depois | O rascunho sai marcado "RASCUNHO - não distribuir" (também no PDF); "Aprovar" só aparece com os textos salvos; depois de aprovado, nada muda e a DIREX passa a ver e baixar | US-103 | não |
| G8 | GFIN | Relatórios › Apresentação para reunião de diretoria: escrever um tema, montar o roteiro e baixar os slides | Slides em PDF 16:9 com gráficos do sistema e o rodapé "Roteiro com apoio de IA, de responsabilidade de <usuário> - revisar" | US-105 | não |
| G9 | DIREX, GFIN e Gestor de Diretoria | Relatórios › Pergunte ao SGO: "qual o orçamento da Administração Central?", "quanto orçou o CC 4.3.2?", "qual o Valor Global do TP-3?" e uma pergunta sobre o salário de alguém | Cada número vem com a fonte e o link da tela; o Gestor recebe "(do seu escopo)" e não recebe teto; a pergunta sobre salário recebe "ainda não sei responder" | US-104 | não |

## F. Encerramento

| # | Quem | Ação |
| --- | --- | --- |
| F1 | Usuários-chave | Marcar os passos na issue da release e abrir os defeitos |
| F2 | PO | Conferir que não há defeito crítico ou alto aberto |
| F3 | PO | Registrar o aceite na issue, com as ressalvas (por exemplo, o bloco G sem a chave da IA) |

## Glossário

- **Release:** a versão do sistema que está em homologação, identificada por um código curto (o SHA) que o PO anota na issue.
- **E2E:** o teste automatizado que percorre as telas como um usuário.
- **Página não encontrada:** a resposta do sistema para um endereço que o perfil não pode abrir. Ela não confirma que a tela existe.
