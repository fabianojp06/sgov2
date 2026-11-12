# Carga inicial de produção

Roteiro da carga dos cadastros antes do go-live (US-115, #137; plano do P7, Task 5, Step 1; spec §6.1 e §6.1a). A carga de prod é feita **pelas telas**, e não por seed: a seed de dados de referência recusa produção (R15). O mesmo roteiro roda antes em hml, no **ensaio** (abaixo), com os arquivos reais.

## Antes de começar

| Pré-condição | Por quê | Quem |
| --- | --- | --- |
| Prod no ar, com o `app`, o `worker` e o `migracao` (`ambientes.md`) | as telas e o processamento das cargas (worker com `SYNC_DATABASE_URL`) | PO |
| **Backup ativo em prod e um full feito** (`backup.md`) | a carga é o primeiro dado oficial | PO |
| Snapshot da VPS | volta rápida se o ensaio falhar no meio | PO |
| `CHAVE_CIFRA_SALARIOS` no `app` de prod, com cópia no cofre | o salário real dos cargos entra cifrado (R7). Sem a chave, a importação dos cargos com salário falha | PO |
| SMTP de prod configurado | a senha inicial de cada usuário vai **só por e-mail** (RN0059) | PO |
| **Aprovação da DIREX** dos centros de custo (data e documento) | em prod, a carga de CC exige a aprovação (R16, GAP-CC-001). A carga provisória não existe em prod | GFIN e DIREX |
| Administrador inicial com a senha trocada (`deploy.md`) | quem cadastra os usuários | PO |
| `instituicao.nome_exibicao` | **lacuna:** hoje não há tela para definir o nome de exibição da instituição. Vazio, o sistema funciona e os e-mails saem só com "SGO". Falta uma tela, e a frente B a propôs ao PO | — |

## Ordem e passos

A ordem segue as dependências: o CC de escopo dos usuários depende dos CC, as contas dos parâmetros dependem do plano de contas, e as faixas da tabela salarial dependem dos cargos.

| # | Passo | Arquivo-fonte, quem fornece e layout | Tela e permissão | Como desfazer antes do go-live |
| --- | --- | --- | --- | --- |
| 1 | **Plano de contas** (5 níveis) | planilha `.xlsx` da GFIN, com as colunas `Nível`, `Classificação`, `Conta Superior`, `Descrição`, `Tipo` e `Conta Reduzida` | `/cad/plano-contas/importar` (GFIN, `cad.plano_contas:executar`) | importar de novo a planilha corrigida. A importação é idempotente e inativa o que saiu do arquivo |
| 2 | **Centros de custo** (5 níveis) | planilha `.xlsx` da GFIN, a versão **aprovada pela DIREX**, com as colunas `Classificação`, `Código reduzido`, `Descrição (original)`, `Descrição sugerida`, `Nível`, `Classificação pai`, `Tipo` e `Aceita lançamento`. Junto vão a data e o documento da aprovação | `/cad/centros-custo/importar` (GFIN, `cad.centros_custo:executar`) | importar de novo a planilha corrigida, com a mesma aprovação |
| 3 | **Parâmetros do exercício 2027**: reajuste, data-base, IPCA, encargos e contas de cada componente | valores da GFIN (GAP-ORC-003). O exercício 2027 já nasce com parâmetros provisórios pela seed do `cad` | `/cad/parametros` (GFIN, `cad.parametros:alterar`) | corrigir na mesma tela. O Histórico registra cada mudança |
| 4 | **Salário mínimo nacional** (SMN) | valor oficial do ano | `/cad/salario-minimo` (GFIN ou GRH, `cad.salario_minimo:alterar`) | corrigir na mesma tela |
| 5 | **Cargos** | exportação do Rubi pela GRH no layout `CAD-CARGOS v1.0`, com as colunas `Código do Cargo`, `Cargo`, `Cargo Mercado`, `Tabela Salarial (código)`, `Tabela Salarial (descrição)`, `Faixa (código)`, `Faixa (descrição)`, `Nível (código)`, `Nível (descrição)` e `Salário Real`. **O layout ainda não foi confirmado pela GRH** (pendência P3 do P4): confirmar no ensaio | `/cad/cargos/importar` (GRH, `cad.cargos:executar`) | importar de novo a planilha corrigida. O código do cargo nunca muda |
| 6 | **Tabela salarial de mercado** (faixas por cargo e senioridade) e campos manuais do cargo (Fonte Ativa, faixa, adicional) | pesquisa salarial da GRH | `/cad/tabela-salarial` e `/cad/cargos/<id>` (GRH, `cad.tabela_salarial` e `cad.cargos:alterar`) | corrigir na mesma tela |
| 7 | **Benefícios do exercício** (Tabela Mestre: valores, padrão da posição) e benefícios por cargo | valores da GRH ("antes de distribuir a planilha", memória §4) | `/cad/beneficios` e `/cad/cargos/<id>` (GRH, `cad.beneficios`) | corrigir na mesma tela |
| 8 | **Usuários** | lista dos usuários-chave, com o e-mail institucional, o perfil e, para o Gestor de Diretoria, o **CC de escopo** | `/adm/usuarios` (Administrador), um a um (D-P7-5) | inativar o usuário. Ele nunca é apagado (Histórico) |
| 9 | **Conferência** | contagens e totais do sistema contra as planilhas de origem | `/rel/conferencia-carga` (GFIN), exportada e **assinada pela GFIN** | se divergir, refazer o passo de origem e conferir de novo |

- **Cargas por planilha (passos 1, 2 e 5):** o lote fica `PENDENTE` até o `worker` aplicar, como `sgo_sync`. A tela mostra o resultado (`CONCLUIDA` ou `FALHOU`, com o erro por linha). Um arquivo com qualquer erro é reprovado inteiro, sem gravar nada.
- **Importe sempre o arquivo completo.** A importação inativa o que não está no arquivo, então uma planilha parcial inativaria o resto.
- **Depois do passo 9:** rode um backup full (`systemctl start sgo-backup-full@prod.service`) e registre no `restauracoes.md` a primeira restauração com dado real.

## Ensaio em hml (plano do P7, Task 5, Steps 2 e 3)

1. **Preparar o hml como prod (PO, no Easypanel):** recrie o banco de hml **vazio**, sem a `CARGA_DADOS_REFERENCIA` no `migracao` e sem a `CC_CARGA_PROVISORIA` no `app` (D-P7-7). Isso **apaga os dados de hml** (regra 3). Depois:
   1. rode o `01-papeis-ambiente.sql`;
   2. faça o *redeploy* do `migracao`, com o administrador inicial;
   3. faça o *redeploy* do `app` e do `worker`.

   Avise a frente A na #138 antes, porque o hml é compartilhado.
2. **Executar este roteiro com os arquivos reais (PO, GFIN e GRH).** Se a DIREX ainda não aprovou os CC, use um documento de aprovação **de ensaio**, marcado assim no campo do documento, e refaça com o real em prod.
3. **A frente B acompanha** e anota abaixo o tempo de cada passo e as divergências. Cada divergência vira uma issue ou uma correção deste roteiro.
4. **Ao fim do ensaio**, o hml fica sem a seed de referência. Para voltar ao hml de desenvolvimento, devolva as duas variáveis e faça o *redeploy* do `migracao`.

### Registro do ensaio

| Data | Passo | Tempo | Resultado | Divergências e correções |
| --- | --- | --- | --- | --- |
| — | — | — | pendente: depende do SMTP de hml, dos arquivos reais e da janela do PO | — |
