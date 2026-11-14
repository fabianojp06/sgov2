# Roteiro de homologação — R4

Propostas e Termos de Parceria (TP): a proposta e as versões, as metas, o pessoal, as viagens, os bens, o rateio e o ISS, os totalizadores, o cronograma de desembolso, a homologação do pessoal (WA05), a oficialização (WA01) e a validação das viagens (WA02) (histórias US-065 a US-081). Como usar este roteiro, registrar defeitos e dar o aceite: `README.md` desta pasta. A R1 (`roteiro-r1.md`) vem antes. Os usuários-chave, os cadastros e as alçadas dela são pré-condição daqui.

## Antes de começar (PO)

- **Usuários-chave novos:** um Orçamentista (lança as propostas), um Analista GRH (pessoal), um Operador de Viagens e um usuário da GFIN (aprova o WA01). Mesmas regras da R1: e-mail institucional real, senha só por e-mail.
- **Cadastros da R1 conferidos:**
  - centros de custo com a estrutura de TPs (C37), cada TP ativo com um CC analítico livre;
  - cargos com Fonte Ativa;
  - parâmetros e benefícios do exercício de cada ano da vigência das propostas de teste.
  
  Sem os parâmetros de um ano, o custo daquele ano sai com aviso, e é isso que o sistema deve fazer.
- **Impostos (C10 da R1):** cada imposto que incide no tipo de proposta precisa de alíquota vigente no mês de início da proposta. **A seed traz o ISS sem alíquota:** a GFIN cadastra antes, em Cadastros › Impostos. Sem ela, a oficialização (H3) é recusada com mensagem, o que também é um teste (H4).
- **Alçadas do WA05 (pessoal), WA01 (oficialização) e WA02 (viagens)** cadastradas pelo Administrador (B8 da R1), com titular e substituto que não sejam quem envia.
- **Natureza das contas (C11 da R1):** marque como CAPEX as contas do imobilizado. Sem nenhuma CAPEX, o seletor de bens mostra todas as analíticas com um aviso.

## Como ler as tabelas

As colunas são as mesmas da R1 (`roteiro-r1.md`, "Como ler as tabelas"). **TP de teste:** use números de TP fictícios combinados com o PO (por exemplo, `TP-HML-001`), nunca o de um termo real.

## P. Proposta e versões

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| P1 | Orçamentista | Cadastros › Propostas: criar a proposta do TP de teste, Consolidada, com vigência e um CC livre | Mensagem "criada em Rascunho"; na lista, Versão 1, Rascunho e valor global 0,00 | US-065 | sim |
| P2 | Orçamentista | Abrir a tela principal | O seletor de unidade passa a mostrar o TP criado | D-P17-3 | sim |
| P3 | Orçamentista | Criar uma nova versão da proposta (com confirmação) | Versão 2 em Rascunho; a anterior fica guardada | US-066 | sim |
| P4 | Orçamentista | Duplicar a proposta para outro número de TP e outro CC, na categoria Meta | Os campos vêm copiados (objeto com "Cópia de …"), o número fica em branco; a cópia nasce na Versão 1 | US-066 | sim |
| P5 | GFIN, Auditor ou DIREX | Abrir a lista de propostas | Só consulta, sem Criar, Nova versão nem Duplicar | §11.3 | não |
| P6 | Um usuário sem vínculo com o TP | Abrir a lista de propostas | O TP não aparece (isolamento por unidade) | §5, C31 | não |

## M. Metas (só na categoria Meta)

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| M1 | Orçamentista | Incluir uma meta com número, nome e valor; alterar o nome | O total das metas ativas soma o valor | US-067 | sim |
| M2 | Orçamentista | Criar nova versão da proposta | A meta é copiada para a versão nova | RN_DUP_003 | sim |
| M3 | Orçamentista | Excluir uma meta sem lançamento (com confirmação); tentar excluir uma meta com empregado ou viagem | A primeira sai; a segunda é recusada pelo vínculo | RN0136 | em parte |

## E. Pessoal

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| E1 | Analista GRH ou Orçamentista | Empregados: incluir uma vaga "A CONTRATAR" numa meta, com cargo e período | A grade mostra A CONTRATAR, o período e o total por categoria da meta; o custo vem do cálculo de pessoal (quem só consulta não vê custo) | US-070 | sim |
| E2 | Analista GRH | Incluir um empregado com nome e dependentes; conferir o Vínculo Funcional | O vínculo é o setor do cargo (C9 da R1); cargo sem vínculo mostra "—" | RN_EMP_008 | não |
| E3 | Analista GRH | Qtde. Empregados: incluir um período com o documento de respaldo | As quantidades por categoria são contadas dos empregados do período, sem digitação | US-070 | sim |
| E4 | Analista GRH | Finalizar os lançamentos de pessoal da proposta (a confirmação mostra o aprovador) | "Pessoal … finalizado e enviado para homologação"; não dá mais para incluir empregado nessa versão | US-080 | sim |
| E5 | GFIN | Central de Tarefas: abrir "Pessoal do TP … · Versão …", conferir o custo do pessoal no período e aprovar | "Solicitação … aprovada"; o pessoal passa a entrar no cronograma | US-080 | sim |

## V. Viagens

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| V1 | Orçamentista | Cadastrar os tetos das contas de passagens e de diárias | Os tetos aparecem no painel | US-071, C6 | sim |
| V2 | Operador de Viagens ou Orçamentista | Incluir uma viagem (pessoas, média de dias, passagem, diária, transporte) | Custo estimado = (pessoas × passagem) + (pessoas × dias × diária), sem o transporte; o transporte aparece como categoria própria no painel | RN_VIA_03, C19 | sim |
| V3 | Orçamentista | Copiar a viagem aumentando as pessoas até passar do teto | "Operação Rejeitada", com a conta sintética que estoura; nada gravado | RN_VIA_03 | sim |

## B. Bens, serviços e equipamentos

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| B1 | Orçamentista | Incluir um bem numa conta CAPEX | Subtotal da conta e total geral atualizados | US-072, RN0411 | sim |
| B2 | Orçamentista | Abrir o seletor de contas do bem | Só as contas CAPEX (ou todas, com aviso, se nenhuma estiver marcada) | RN0419 | não |

## R. Rateio, ISS, totalizadores e cronograma

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| R1 | Orçamentista ou GFIN | Rateio/ISS: incluir uma linha de rateio sobre uma conta | A linha aparece nos totalizadores; o valor monetário do ISS ainda é "a definir" | US-073 | sim |
| R2 | Qualquer perfil da proposta | Totalizadores | Somam pessoal, viagens, bens e rateio por conta, só para consulta | US-074 | sim |
| R3 | Qualquer perfil da proposta | Cronograma de Desembolso, antes do E5 e do W2 | A tela avisa que o pessoal ainda não foi homologado (WA05) e que há viagens não validadas (WA02) | US-075 | sim |
| R3b | Qualquer perfil da proposta | Cronograma de Desembolso, depois do E5 e do W2 | A última parcela acumula 100% do Valor Global | US-075 | sim |
| R4 | Orçamentista | Excluir uma proposta de teste (com confirmação) | O CC do TP volta a ficar livre no formulário de nova proposta | D-P17-10 | sim |

## H. Envio, aprovação e oficialização (WA01)

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| H1 | Orçamentista | Depois do E5, avançar a proposta para Em Elaboração (com confirmação) e enviar para aprovação | "Proposta do TP … enviada para oficialização"; a lista mostra Em Aprovação. Se faltar algo, o envio lista todas as falhas juntas (situação, alçada, contas analíticas ativas, células do rateio, pessoal homologado, impostos com alíquota) | US-079, RN_WA01_001, C1 | sim |
| H2 | GFIN (titular da alçada) | Central de Tarefas: abrir a pendência "TP … · Versão …"; rejeitar com a justificativa da recusa | "Solicitação … rejeitada"; a proposta volta para Em Elaboração | US-078 | sim |
| H3 | Orçamentista e GFIN | Reenviar; na Central, conferir o Valor Global e aprovar | "Solicitação … aprovada"; a proposta fica Oficializada, o botão de envio some, e as alíquotas dos impostos ficam congeladas no snapshot | US-079, RN_TAX_03 | sim |
| H4 | Orçamentista | Com um imposto sem alíquota no mês de início, enviar | Recusa com "Não há alíquota vigente no início da proposta para: …" | RN_TAX_01 | não |
| H5 | O próprio Orçamentista, se for o único aprovador da alçada | Enviar | Recusa: quem envia não aprova a própria proposta | RN_WA02_006 | não |

## W. Validação das viagens (WA02, com a versão oficializada)

| # | Perfil | Ação | Resultado esperado | Ref. | E2E |
| --- | --- | --- | --- | --- | --- |
| W1 | Operador de Viagens | Solicitar a validação das viagens da proposta oficializada (a confirmação mostra o aprovador) | "Validação das viagens … solicitada"; as viagens ficam Pendente de Validação | US-081 | sim |
| W2 | GFIN | Central de Tarefas: abrir "Viagens do TP … · Versão …", conferir o custo das viagens e aprovar | "Solicitação … aprovada"; as viagens passam a entrar no cronograma (R3b) | US-081 | sim |

**Ordem sugerida:** P, M, E1 a E3, V, B, R1 e R2, R3 (com os avisos), E4 e E5, H, W e, por fim, R3b e R4. A sequência completa, com os mesmos perfis, está nos passos 3g2, 3i, 3j e 3k de `e2e/orc/propostas.spec.ts`.

## F. Encerramento

Igual à R1 (`roteiro-r1.md`, bloco F). Ressalva prevista: o valor monetário dos impostos da proposta (UC3.01, outra história). Hoje o ISS do rateio segue "a definir".
