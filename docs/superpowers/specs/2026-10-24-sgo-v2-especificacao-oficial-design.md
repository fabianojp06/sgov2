# SGO 2.0 — Especificação Oficial de Desenvolvimento

| Campo | Valor |
| --- | --- |
| Documento | Especificação Oficial de Desenvolvimento (design spec) |
| Versão | 1.0 — 24/10/2026 |
| Status | Vigente para desenvolvimento. Decisões marcadas **[PROVISÓRIA]** valem até validação do SME indicado |
| Elaboração | Revisão técnica conduzida com Claude a pedido de Fabiano Garcia (BA/PO — CTCEA/GIA) |
| Repositório | `fabianojp06/sgov2` |
| Base revisada | `especificacao/OneDrive_1_24-10-2026.zip` (10 documentos) + referência do código anterior `fabianojp06/sistemaSgo` |

---

## 1. Propósito deste documento

O SGO 2.0 (Sistema de Gestão Orçamentária da CTCEA) será **refeito do zero** no repositório `sgov2`. O motivo é que a documentação de requisitos mudou muito desde a primeira implementação (`sistemaSgo`).

Este documento:

1. registra a **revisão completa** da especificação vigente (conflitos, lacunas e inconsistências);
2. **decide** como cada conflito será tratado no desenvolvimento;
3. define a **arquitetura** e as **diretrizes técnicas** que valem para todos os módulos;
4. divide o sistema em **fases (subprojetos)**, cada uma com seu próprio ciclo de plano e implementação;
5. detalha a **Fase 0 (Fundação técnica)** e a **Fase 1 (Geral, Autenticação e Administração)**, que formam o primeiro plano de implementação.

Este documento **não substitui** os EPs nem repete os 1.103 itens do Catálogo. Os documentos-fonte continuam sendo a referência de regra de negócio. Aqui ficam a arquitetura, as decisões que se sobrepõem às fontes e a ordem de construção.

### 1.1 Entendimento (o que foi dito × o que foi assumido)

| Dito pelo PO | Assumido nesta revisão |
| --- | --- |
| Refazer o SGO do zero no `sgov2`, usando o `sistemaSgo` só como referência | Nenhum código do `sistemaSgo` é migrado; padrões e lições podem ser reaproveitados |
| A pasta `especificacao` tem o documento de elicitação mais atual, com todas as regras e requisitos | O ZIP é a fonte primária. Onde ele não tem um módulo (Orçamentário, Relatórios), vale o Catálogo Consolidado de 08/10/2026 |
| Revisar toda a especificação e seguir com as recomendações sem esperar aprovação intermediária | Conflitos foram decididos aqui. As decisões de negócio ficam marcadas [PROVISÓRIA] com o SME responsável |
| — | As anotações do PO no próprio `sgov2` (`projects/CTCEA - SGO/`) valem como decisões mais recentes que os documentos (ex.: plano de contas em 6 níveis) |

### 1.2 Critérios de sucesso

- O time consegue começar a Fase 0/1 sem precisar de nova rodada de esclarecimento.
- Toda regra implementada tem rastreio até o documento-fonte (código RN/REQ original).
- Nenhuma regra é inventada: o que falta vira GAP com responsável e indicação de bloqueio.
- As lições do `sistemaSgo` não se repetem, sobretudo a perda de dados de produção de 14/08/2026.

---

## 2. Fontes e precedência

### 2.1 Documentos revisados

| # | Documento | Versão/data | Situação na revisão |
| --- | --- | --- | --- |
| 1 | EP083/24 — Módulo Geral | V3 (Rev.01 01/06/2026) | Lido. Mesmo conteúdo do catálogo. UC0.06 passou a ser "Enviar E-mail" |
| 2 | EP084/24 — Autenticação e Tela Principal | V5 (Rev.02 23/09/2026) | Lido integralmente. Muitas mudanças: RN0515–RN0524, REQ0367 |
| 3 | EP085/24 — Administração | V3 (Rev.01 14/08/2026) | Diff contra V2: só acrescentou glossário |
| 4 | EP118/24 — Cadastros (Minuta) | V5 | Idêntico ao usado no catálogo |
| 5 | UC03.19 — Cargos e Salários | V4 (01/09/2026) | Lido. **Resolve o GAP-CAR-004** (Encargo Social 51%) |
| 6 | Viagens — Especificação | V3 (ago/2026) | Lido. Novo painel analítico e 3 contas por viagem |
| 7 | Aprovações (EP??/26) | V2 (Rev.01 14/09/2026) | Lido integralmente. Roteamento automático por alçadas, novo WA02 |
| 8 | Orçado × Realizado | V2 (out/2026) | Lido. Integrações 1 e 2 do Plano Financeiro |
| 9 | Integração SGO × Senior/Rubi/RVS | V4 (out/2026) | Lido. Contratos de API apenas propostos |
| 10 | Catálogo Consolidado de RF/RNF/RN | 08/10/2026 | Lido integralmente (1.103 itens, 31 inconsistências) |
| — | Módulo Orçamentário (EP48/26) e Relatórios | Fora do ZIP | Valem as seções 6 e 7 do Catálogo (fonte: Minuta Orçamentário V2) |

### 2.2 Regra de precedência

Quando duas fontes divergem, vale a primeira regra aplicável abaixo:

1. Decisão registrada **neste documento** (seções 7 e 8).
2. Documento **mais recente** e **mais específico** sobre o assunto. Exemplo: o C&S V4 (01/09) prevalece sobre a Minuta de Cadastros V5 no tema cargos; o Aprovações V2 (14/09) prevalece sobre o UC03.09/UC03.12 no tema roteamento de aprovação.
3. Catálogo Consolidado.
4. Documentos de origem mais antigos.

Termos de tecnologia Java citados nas fontes (`@Version`, `@Transactional`, `@PreAuthorize`, `BigDecimal`, JPA) descrevem **comportamento**, não stack. A tradução para a stack adotada está na seção 5.

---

## 3. Escopo e decomposição

### 3.1 Módulos do sistema

| Código | Módulo | UCs | Fonte |
| --- | --- | --- | --- |
| GER | Geral (arcabouço de telas) | UC0–UC0.06 | EP083 V3 |
| AUT | Autenticação e Tela Principal | UC01.01–UC01.05 | EP084 V5 |
| ADM | Administração | UC02.01–UC02.27 + **UC02.28 (novo)** | EP085 V3 + Aprovações V2 §7 |
| CAD | Cadastros | UC03.00–UC03.38 | EP118 V5 + C&S V4 + Viagens V3 |
| ORC | Orçamentário | UC04.01–UC04.16 + Orçado×Realizado | Catálogo §6 + OxR V2 |
| REL | Relatórios e Book | UC05.01–UC05.12 | Catálogo §7 |
| APR | Aprovações (workflows) | UC6.00–UC6.02 | Aprovações V2 |
| INT | Integrações | Senior, Rubi, RVS | Integração V4 + OxR V2 |

### 3.2 Fases de construção

Cada fase é um subprojeto com seu próprio ciclo de spec detalhada (quando necessário), plano e implementação. A ordem segue as dependências de dados: não há proposta sem plano de contas, não há aprovação sem proposta.

| Fase | Entrega | Depende de | Bloqueios abertos (seção 9) |
| --- | --- | --- | --- |
| **F0** | Fundação técnica: repositório, CI, ambientes, banco, auditoria, multi-tenant, dinheiro, TotalizerService (núcleo), filas | — | Hospedagem de produção (GAP-INF-001), não bloqueia o desenvolvimento |
| **F1** | GER + AUT + ADM (inclui Alçadas UC02.28 e perfis padrão) | F0 | GAP-ADM-001 (matriz de perfis), não bloqueia: vale a matriz provisória |
| **F2** | Cadastros-base: Plano Financeiro (Integração 1 + carga por arquivo), Agrupadores, Estrutura Funcional, Cargos e Salários, Tabela Salarial, Parâmetros (alíquotas, SMN, benefícios-mestre, semáforo) | F1 | GAP-INT-001 (contrato Senior), contornado pela carga por arquivo |
| **F3** | Proposta/TP: capa, versões, duplicação, metas, quantitativos, empregados e benefícios, viagens, bens CAPEX, impostos, rateio/ISS, totalizadores | F2 | GAP-CAD-001 (fórmula do ISS) bloqueia só o cálculo do ISS |
| **F4** | Aprovações WA01/WA05/WA02 + Termo Aditivo + Termo de Ajuste + Remanejamento | F3 | Alçada de Aditivo, Ajuste e Remanejamento (GAP-APR-001) |
| **F5** | Execução orçamentária: Cronograma de Desembolso, Premissas/Reajustes, Recursos, Contratações Previstas, Orçado×Realizado (Integração 2), Provisões, Aplicações Financeiras | F4 | GAP-PGD-006/009 (payload do realizado), GAP-ORC-001 (RN0433/0434) |
| **F6** | Relatórios UC05.01–UC05.11, Book UC05.12, Anexo 6 | F5 | GAP-REL-001 (Book e rateio da Adm. Central) |
| **F7** | Integração Rubi (sincronismo real) e RVS | F2/F3 | GAP-INT-005, GAP-INT-013 |

**Fora do escopo do SGO 2.0**, conforme as fontes: execução financeira (o SGO trata do *orçado*; o *realizado* vem do ERP), emissão/compra de passagens, app mobile.

---

## 4. Arquitetura

### 4.1 Visão geral

**Monólito modular** em Next.js, como já tinha sido decidido em 26/09/2026: sem backend separado por enquanto, e com critérios de extração registrados em ADR. Cada módulo da seção 3.1 é um *bounded context* com fronteira explícita:

```
src/
  modules/
    <modulo>/            # ger, aut, adm, cad, orc, rel, apr, int
      domain/            # entidades, value objects, regras puras (sem I/O)
      application/       # casos de uso; dependem de portas (interfaces)
      infrastructure/    # Prisma, gateways externos, filas
      ui/                # componentes React do módulo
      index.ts           # API pública do módulo (único ponto de import externo)
  shared/
    kernel/              # Dinheiro, Competencia, Resultado, erros de domínio
    audit/               # HistoricoOperacao (porta + adaptador)
    tenancy/             # contexto de org_id + RLS
    totalizer/           # TotalizerService (motor puro de agregação)
    authz/               # guarda RBAC usada por toda Server Action/Route Handler
  app/                   # rotas Next.js (App Router), finas: só chamam casos de uso
worker/                  # processo separado: filas, jobs agendados, e-mail, exportações grandes
```

Regras de fronteira (checadas por lint, com `eslint-plugin-boundaries` ou equivalente):
- `domain/` não importa nada de fora do próprio módulo, exceto `shared/kernel`.
- Um módulo só importa outro pelo `index.ts` do outro.
- `app/` não acessa Prisma diretamente.

### 4.2 Stack

| Camada | Escolha | Observação |
| --- | --- | --- |
| Linguagem | TypeScript (strict) | — |
| Web | Next.js (App Router) + React | Server Actions/Route Handlers como borda HTTP |
| UI | Tailwind CSS + shadcn/ui; TanStack Table + virtualização para as Tree Grids | Tree Grid sem paginação e 60 FPS (RNF_DES_002) exige virtualização |
| Validação | Zod nas bordas (form e servidor) | Mesmo schema no cliente e no servidor ([TRAVA O ERRO]) |
| Banco | PostgreSQL 16 | Fixado pelo EP085 (RNF0007) |
| ORM | Prisma | `$transaction` com isolamento explícito; SQL bruto onde Prisma não alcança (RLS, `FOR UPDATE`, advisory locks) |
| Decimal | `decimal.js` (via `Prisma.Decimal`) | `number` do JS é **proibido** para dinheiro |
| Fila e jobs | `pg-boss` (fila sobre o próprio PostgreSQL) | Sem Redis; e-mail, notificações, exportações >5.000 linhas, jobs agendados |
| Senha | Argon2id (`@node-rs/argon2`) | RNF0004 |
| Exportação | ExcelJS (XLSX), gerador PDF server-side | PDF conforme ISO 32000-1 (RNF_IMP_001) |
| Testes | Vitest (domínio e integração), Testcontainers/PostgreSQL real, Playwright (E2E) | Seção 10 |
| Empacotamento | Imagem Docker única (app + worker com entrypoints distintos) | Portável: VPS, nuvem ou infra da CTCEA |

### 4.3 Ambientes e hospedagem

Três ambientes isolados, cada um com banco próprio: **dev** (local, Docker Compose), **hml** (homologação com usuários-chave) e **prod**.

- Banco de **produção** obrigatoriamente com backup diário **e** recuperação ponto-a-ponto (PITR) testada. Recomendação: PostgreSQL gerenciado com PITR (ex.: Supabase Pro, Neon ou equivalente). O plano gratuito, sem PITR, **não** é aceitável para produção (lição do incidente de 14/08/2026).
- Onde rodam app e worker em produção é o GAP-INF-001 (infra da CTCEA × nuvem × VPS). A imagem Docker torna essa decisão reversível.
- O worker é um processo de longa duração. Por isso o desenho não depende de plataforma *serverless*.

---

## 5. Diretrizes transversais → mecanismo técnico

| Diretriz (fonte) | Mecanismo no SGO 2.0 |
| --- | --- |
| **[TRAVA O ERRO]** — validação síncrona; em erro, rollback e formulário preservado | Zod no cliente (feedback imediato) + Zod e regras de domínio no servidor. A Server Action devolve `Resultado` tipado (`ok` ou `erros[]` por campo) e nunca lança erro para a UI. O formulário mantém o estado local e só fecha em `ok`. Estado de formulário nunca vai para `localStorage` (RNF0002 do EP084) |
| **[ORIGEM BLINDADA]** — campos do ERP e calculados são somente leitura | (1) Esses campos não existem nos schemas de entrada (Zod); (2) o repositório de escrita os ignora; (3) para tabelas espelho do ERP, só o papel de sincronismo tem `UPDATE` no banco. Uma tentativa de escrita vira erro de domínio `ViolacaoGovernanca` (auditado) |
| **[SOFT DELETE]** — sem DELETE físico em dado financeiro ou histórico | Colunas `ativo boolean` + `inativado_em`/`inativado_por`. Exclusão física só em rascunho sem histórico (RN_EXC_001). A permissão de `DELETE` é revogada no banco para as tabelas financeiras |
| **[SINCRONISMO ATÔMICO]** — lote tudo ou nada | Toda operação em lote dentro de uma única `prisma.$transaction`. Cargas de ERP gravam primeiro em tabela de *staging*, validam e depois fazem merge numa transação |
| **[CARGA VIVA]** — registro com dependência não pode ser excluído nem inativado | Cada agregado expõe `verificarDependencias()` no domínio, consultado antes da exclusão. A UI lista os impeditivos (RF_EXC_003). Foreign keys `ON DELETE RESTRICT` como rede de segurança |
| **Log Delta compulsório** — auditoria na mesma transação; falha desfaz | `HistoricoOperacao` gravado pelo mesmo `tx` da operação via `auditar(tx, evento)`. Tabela append-only: `UPDATE`/`DELETE` revogados e *trigger* que rejeita. Campos: `org_id`, usuário (ou "Sistema"), sessão UID, IP, funcionalidade, tipo de operação (RN0103), descrição padronizada (RN0089–RN0094), `antes`/`depois`/`delta` em JSONB, `TIMESTAMPTZ` do servidor |
| **Nível de log Simples/Avançado** por funcionalidade (RN0104/RN0105) | `Funcionalidade.nivelLog`. Consultas e exportações só geram registro quando o nível é Avançado; login, logoff e escritas sempre geram (RN_LOG_EXP: exportação sempre registra) |
| **Precisão monetária** | `NUMERIC(15,2)` para valores, `NUMERIC(9,4)` para percentuais e índices (RNF_PR_004). Value object `Dinheiro` com arredondamento **Half-Even** em 2 casas. Na API, valores trafegam como *string* decimal |
| **Multi-tenant** por `org_id` + RLS | `org_id uuid NOT NULL` em toda tabela de negócio. Políticas RLS com `current_setting('app.org_id')`, definido por `SET LOCAL` no início de cada transação pelo `shared/tenancy`. A aplicação conecta com um papel **sem** `BYPASSRLS` |
| **Concorrência otimista** (`@Version`) | Coluna `versao int`. O update usa `WHERE id = ? AND versao = ?`; zero linhas afetadas vira erro `ConflitoConcorrencia`, com mensagem inline (RNF_CON_002) |
| **Concorrência pessimista** (sincronismo, remanejamento, contador de login) | `pg_advisory_xact_lock` por chave (ex.: `sync-plano:<org>`, `remanejamento:<conta>`). `SELECT … FOR UPDATE` na linha do usuário no login (RNF0011) |
| **RBAC revalidado no backend** em todo endpoint | `authz.exigir(funcionalidade, acao)` obrigatório em toda Server Action/Route Handler (lint proíbe Action sem guarda). A UI só oculta botões; a autoridade é o servidor |
| **TotalizerService** — motor único de agregação | Função pura em `shared/totalizer`: recebe valores das contas **analíticas** e a árvore, devolve sintéticas, totais e percentuais. Sintéticas **nunca** são persistidas como dado vivo (OxR V2 §7), só dentro de *snapshots* de oficialização |
| **Tempos de resposta** (1,5 s / 2 s / 800 ms / 400 ms) | Viram metas de teste de desempenho (seção 10), medidas em hml com volumetria de referência |
| **Criptografia de salários em repouso** (RNF_WA05_004, AES-256) | Criptografia do volume/banco gerenciado + mascaramento por perfil na leitura. Criptografia por coluna é **[PROVISÓRIA]** (ver D10) |

---

## 6. Modelo de domínio consolidado

### 6.1 Hierarquia de contas (Plano Financeiro)

- O SGO orça sobre o **Plano Financeiro CTCEA** (modelo 0303 do Sapiens, despesas no grupo 1.9), e não sobre o plano contábil. Essa decisão é do PO, registrada nas notas do projeto. **[PROVISÓRIA]**: formalizar nos EPs.
- **Profundidade genérica**: a árvore é uma lista de adjacência (`conta_pai_id`) com `nivel` e `tipo ∈ {SINTETICA, ANALITICA}` vindos do ERP. Quando os documentos dizem "Nível 7 / Nó Folha", leia-se **conta analítica**, não o número 7. Isso resolve a divergência 6 × 7 níveis (seção 8, C11) sem mudar código.
- Somente contas **analíticas ativas** recebem valor (orçado, realizado, FKs de Cargos/Viagens/Bens/Rateios).
- **Agrupadores de Contas** são entidades exclusivas do SGO (N:N com analíticas), usadas apenas em relatórios (RN_PLA_007–011). Não são contas sintéticas.
- A entidade legada **SubConta não existe** no SGO 2.0.

### 6.2 Proposta, Termo de Parceria e versões

Vocabulário fixado:
- **Proposta / Termo de Parceria (TP)**: a capa (tipo, objeto, vigência, categoria). O Valor Global é **sempre calculado** (ORIGEM BLINDADA).
- **VersaoProposta**: revisão dentro da mesma Proposta. **Versionar ≠ Duplicar**: duplicar cria uma Proposta nova e independente (RN_DUP_001–008); versionar cria uma nova revisão da mesma Proposta.
- **Termo Aditivo**: altera um TP oficializado (prazo, valor ou misto) e, depois de aprovado, vira o documento vigente (RN0429).
- **Termo de Ajuste**: move saldo entre contas sem alterar o Valor Global, com número Transferegov.br (UC03.13).
- **Remanejamento**: move saldo entre contas similares, sem Transferegov (UC04.09).

Ciclo de vida da versão (Aprovações V2, RF_APR_REQ_005, + Cadastros):

```
Rascunho ──(avançar, UC03.10)──▶ Em Elaboração ──(Enviar p/ Aprovação, WA01)──▶ Em Aprovação
   ▲                                   ▲                                          │
   │                                   └──────────(Rejeitar, justificativa ≥15)───┤
   │                                                                              ▼
(Duplicar gera nova Proposta em Rascunho)                         Oficializado ──(data fim)──▶ Encerrado
                                                                       │
                                                       (Aditivo / Termo de Ajuste / Remanejamento)
```

- A oficialização gera **Snapshot imutável**: grades, sintéticas calculadas, alíquotas congeladas (RN_TAX_03), DNA dos cargos (REQ_CAR_004).
- Edição só em Rascunho/Em Elaboração (RN_ALT_002). Em Aprovação, a tela fica somente leitura (RF_APR_REQ_004).

### 6.3 Orçado × Realizado

Conforme o OxR V2: `OrcadoContaMes` (digitado no SGO, por versão), `RealizadoContaMes` (Integração 2), `AjusteRealizado` (diferença em mês fechado, lançada no mês aberto seguinte) e `PendenciaIntegracao` (conta desconhecida). O modelo é híbrido: competência aberta é substituída a cada carga; competência fechada é imutável.

### 6.4 Pessoal

- `Cargo` (espelho do Rubi, ORIGEM BLINDADA) com **vínculo 1:1** a um nó analítico da Estrutura Funcional (RN_CAR_08).
- O custo unitário do cargo é calculado pelo `MotorCalculoCustoPessoal`: Fonte Ativa + adicional (Periculosidade 30% sobre a Fonte Ativa, **ou** Insalubridade de 10/20/40% sobre o SMN) + Encargo Social 51% sobre (Fonte Ativa + adicional) (RN_CAR_17) + benefícios.
- O percentual de encargo é **parametrizado e versionado** (REQ_CAR_006), nunca fixo no código, com os componentes 38/8/1/3,8/0,2.
- Headcount (`EmpregadoHeadcount`) por Proposta/Versão/Meta, com vaga "A CONTRATAR" quando não há colaborador (RN0249).

### 6.5 Workflow e alçadas

`AlcadaAprovacao` (fluxo, titular, substituto, ativo) → `SolicitacaoAprovacao` (fluxo, alvo, status `EM_APROVACAO|APROVADO|REJEITADO`, solicitante, aprovador efetivo, justificativa, `versao`). O roteamento é automático: titular se ativo, senão substituto (RN_ALC_005). Não existe seleção manual de aprovador.

---

## 7. Decisões de arquitetura (ADRs resumidos)

| ID | Decisão | Alternativas descartadas | Motivo |
| --- | --- | --- | --- |
| D1 | Monólito modular Next.js com módulos isolados por fronteira lint | Backend separado (NestJS) | Decisão de 26/09/2026; um time pequeno ganha velocidade; a extração fica possível pelos `index.ts` |
| D2 | **Autenticação própria** (Argon2id + sessão em banco), atrás de uma porta `ProvedorIdentidade` | Clerk (usado no `sistemaSgo`); NextAuth | O EP084 V5 exige comportamento que conflita com um IdP terceiro: contador e bloqueio próprios antes de verificar a senha (RN0018), modo manutenção (RN0023), senha gerada pelo sistema e enviada por e-mail (UC02.18), troca obrigatória (REQ0039), sessão única com aviso à estação anterior (RN0519), desconexão forçada com contagem (REQ0087) e hash fictício contra *timing* (RNF0005). O híbrido Clerk + banco próprio dividia a fonte da verdade. A porta permite plugar o login da intranet (GAP-AUT-001) sem reescrever |
| D3 | Sessão por **token opaco** (cookie `httpOnly`, `Secure`, `SameSite=Lax`) com registro em `SessaoUsuario` | JWT sem estado (citado no glossário do EP085) | Invalidação imediata é requisito (logoff ≤400 ms, sessão única, desconexão forçada, desativação de módulo desconecta usuários); JWT sem estado não revoga. O UID da sessão segue a RN0062 para auditoria |
| D4 | Hierarquia de contas com profundidade genérica (6.1) | Fixar 7 níveis | Docs dizem 7 e o PO decidiu 6 em out/2026; o ERP é a fonte do tipo da conta |
| D5 | `NUMERIC(15,2)` para dinheiro; `NUMERIC(9,4)` para taxas | `numeric(18,2)` (glossário de Cadastros) | Diretriz canônica, confirmada no OxR V2. 15,2 comporta até R$ 9,9 trilhões |
| D6 | Filas e jobs no PostgreSQL (`pg-boss`) + padrão *outbox* para e-mail e notificação | Redis/BullMQ; serviço externo | Sem infraestrutura nova. O *outbox* garante que a notificação só sai se a transação comitou (RNF0012, RNF_EML_001) |
| D7 | Carga do Plano Financeiro por **arquivo (CSV/XLSX)** atrás da mesma porta da Integração 1 | Esperar o contrato do Senior | O GAP-INT-001 não tem prazo. O *Bulk Loader* já é requisito (RNF_DES_003: 10.000 linhas em menos de 30 s). Quando a API sair, troca-se só o adaptador |
| D8 | Imagem Docker portátil; hospedagem de produção é decisão separada | Prender à Vercel/serverless | O worker é de longa duração; a infra da CTCEA é desconhecida (GAP-INF-001) |
| D9 | Somente leitura de dados do ERP **imposta no banco** (privilégios por papel), não só na UI | Só validação de aplicação | Diretrizes ORIGEM BLINDADA e TRAVA O ERRO pedem bloqueio "a nível de banco e de endpoint" (Integração V4 §3.8) |
| D10 | Salários: criptografia em repouso pelo armazenamento + mascaramento por perfil. **[PROVISÓRIA]** criptografia AES-256 por coluna só se a auditoria exigir | Criptografia por coluna desde o início | Por coluna impede agregação e ordenação no banco (o TotalizerService soma salários). Validar com a Auditoria/DAF se o requisito é por coluna |

---

## 8. Resolução dos conflitos da especificação

Numeração `C#`. "Fonte" indica o item do Catálogo §10 quando houver.

| C# | Conflito | Decisão adotada | Status / validar com |
| --- | --- | --- | --- |
| C1 | RN_TAX_04 rejeita grade com meses vazios × Fluxo B/RN_RAT_03 replicam o último valor (Cat. #1) | Rascunho pode ser salvo com células vazias. **Submissão** exige 100% das células (RN_WA01_002). "Replicar último valor" é uma ação explícita do usuário (Autofill, REQ_RAT_003), nunca implícita | [PROVISÓRIA] André (SCOR) |
| C2 | Rateio de cargo que soma 100% (RN_EST_03, E4 do UC03.18) × vínculo 1:1 (C&S V4 RN_CAR_08) (Cat. #2) | **Setor: 1:1** (C&S V4, mais recente; RN_EST_03 revogada). A "regra dos 100%" do WA01/WA05 passa a ser lida como a **dedicação do headcount entre metas** (RN_WA05_002), que é outro conceito | [PROVISÓRIA] André / GRH: confirmar que existe fração de dedicação por meta |
| C3 | Aprovação de Aditivo: GFIN (WA01) × Gestores Master (UC03.12); Termo de Ajuste (Direção + Gestor Master) ausente no Aprovações (Cat. #3) | Oficialização de TP e de Aditivo = **WA01 (GFIN)**, conforme o Aprovações V2, mais recente. Termo de Ajuste = novo fluxo **WA03** em 2 níveis (Direção → Gestor Master, REQ_TA_005). Remanejamento = novo fluxo **WA04** (aprovadores do REQ0096). Os códigos WA03/WA04 estão livres na numeração do Aprovações | **Bloqueante para F4.** Adriana (DAF) |
| C4 | Aprovador de pessoal escolhido pelo GRH × validador fixo (Cat. #4) | **Resolvido pelo Aprovações V2**: roteamento automático por alçada (RN_WA05_001 corrigida) | Fechado |
| C5 | Aprovador fixo × alçadas configuráveis do UC02.20 (Cat. #5) | **Resolvido pelo Aprovações V2**: alçadas cadastradas (titular + substituto). O UC que as cadastra não existe no EP085: criar o **UC02.28 — Gestão de Alçadas de Aprovação** (o Aprovações chama de "UC02.25", mas o UC02.25 é "Cadastrar Perfil"). Conteúdo mínimo em §11.4 | UC02.28 a redigir no EP085 |
| C6 | Viagens: "Total da Conta" = teto (REQ_VIA_002) × somatório das viagens (RN_VIA_01) (Cat. #6) | Dois campos: **Teto da Conta** (orçado da sintética mandante, somente leitura) e **Total Consumido** (soma das viagens). A RN_VIA_03 valida Consumido ≤ Teto; na submissão, o Teto vira trava rígida | [PROVISÓRIA] André |
| C7 | Faixas do semáforo divergentes (Cat. #7) | Faixas **parametrizáveis** em `ParametroSistema`, com padrão Verde ≤70%, Amarelo >70–85%, Laranja >85–95%, Vermelho >95% ou estouro (RN_PLA_006, com fronteiras sem sobreposição) | [PROVISÓRIA] Wellington |
| C8 | Benefícios: V5 só alerta × C&S V4 sobrescreve (Cat. #8) | **C&S V4**: a Tabela Mestre sobrescreve com auditoria e origem registrada (RN_CAR_06/07); nunca altera snapshots oficializados | Fechado |
| C9 | Precisão 18,2 × 15,2 (Cat. #10) | `NUMERIC(15,2)` (D5) | Fechado |
| C10 | Encargo Social sem fórmula (Cat. #13, GAP-CAR-004) | **Resolvido pelo C&S V4**: 51% (RN_CAR_17), parametrizado e versionado | Fechado. Conferência: confirmar com o Wellington se o "INSS Patronal 38%" já inclui RAT e terceiros |
| C11 | Plano de contas com 7 níveis (todos os docs) × 6 níveis (decisão do PO, out/2026) | Profundidade genérica (D4); "N7" = analítica | Atualizar os EPs na próxima revisão |
| C12 | Seis perfis padrão citados sem lista (UC02.27, Cat. #15) | Seed provisório com os seis atores dos documentos: **Administrador, Orçamentista, Gestor Financeiro (GFIN), Analista GRH, Operador de Viagens (SCOR/GAD), Auditor**. Matriz mínima em §11.3 | [PROVISÓRIA] GAP-ADM-001, Adriana |
| C13 | Critérios de senha não descritos (RN0039, Cat. #16) | Política **parametrizada**, com padrão mínimo de 12 caracteres, maiúscula, minúscula e dígito; bloqueio das últimas 5 senhas; senha diferente do login | [PROVISÓRIA] TI/Segurança CTCEA |
| C14 | UC02.02/UC02.04 inexistentes; UC02.03 vazio (Cat. #17) | Módulos e funcionalidades só por **seed** (RN_SEED_001). UC02.03 removido. Referências a UC02.04 apontam para UC02.05 | Fechado |
| C15 | UC04.05 (Viagens) copiado de Contratações (Cat. #18) e Viagens sem código (Cat. #30) | O planejamento de viagens é uma **aba da Proposta**: Viagens V3 substitui UC03.29–UC03.33. UC04.05 removido. A validação é feita pelo WA02 | Fechado |
| C16 | UC03.09 "Criar Nova Versão" descreve a validação RH/GAD (Cat. #27) | O versionamento passa a ser UC03.09 (nova revisão da mesma Proposta). A validação RH vira WA05 e a de viagens vira WA02 (Aprovações V2) | Fechado. Redação do UC03.09 a corrigir |
| C17 | Códigos repetidos com textos diferentes (Cat. #22–#24) | Convenção nova `<MOD>-<TIPO>-<NNN>` (ex.: `AUT-RN-015`), atribuída quando o módulo entra em fase. A tabela de correspondência com o código antigo fica em `docs/rastreabilidade/`. Os testes citam os dois códigos | Fechado |
| C18 | Glossário do EP085 define o RUBI como sistema de viagens | Errado: Rubi = RH/Folha (Integração V4) | Corrigir o EP085 |
| C19 | Viagens V3: campo "Custo Unitário de Transporte" existe, mas a fórmula RN_VIA_03 não o inclui | Custo estimado = passagem + diárias + **(Qtd pessoas × transporte)** **[PROVISÓRIA]**; o painel já mostra o Transporte como componente (REQ_VIA_005) | André |
| C20 | C&S V4: campo "Salário Definido" não aparece entre as opções de Fonte Ativa (Mín/Máx/Total/Real) | Incluir "Salário Definido" como 5ª opção de Fonte Ativa **[PROVISÓRIA]** | GRH |
| C21 | Esqueci minha senha / Gerar senha enviam a senha em texto no e-mail (REQ0077, RN0517) | Mantido (é requisito), com mitigação: senha **temporária de uso único**, troca obrigatória no 1º acesso (REQ0039) e **expiração em 24 h** (parametrizável) **[PROVISÓRIA]** | TI/Segurança |

---

## 9. Registro de gaps abertos

Somente o que ainda está **aberto** depois desta revisão. Os gaps já tratados na seção 8 não se repetem.

| ID | Módulo | Gap | Bloqueia | Responsável |
| --- | --- | --- | --- | --- |
| GAP-INF-001 | Infra | Onde rodam app e worker em produção (infra CTCEA × nuvem × VPS) e provedor de banco com PITR | Go-live de F1 (não o desenvolvimento) | TI CTCEA / PO |
| GAP-AUT-001 | AUT | "Login unificado com a intranet NodeJS" (EP084 V5, objetivo): protocolo (OIDC/SAML/cookie compartilhado), quem é dono da senha, como ficam bloqueio e manutenção | Só o adaptador de SSO; F1 entrega login próprio | TI CTCEA |
| GAP-AUT-002 | AUT | Seções 3.6 (Pendências P01–P14) e 3.7 (correspondência de IDs) estão no sumário do EP084 V5, mas não no conteúdo. P02, P05, P07, P09, P10, P11 e P14 são citadas nos fluxos | Não bloqueia; valores ficam parametrizáveis | PO |
| GAP-ADM-001 | ADM | Matriz de permissões dos 6 perfis padrão (C12) | Não bloqueia; vale a matriz provisória §11.3 | Adriana (DAF) |
| GAP-ADM-002 | ADM | UC02.28 Gestão de Alçadas a redigir no EP085 (C5) | Não bloqueia F1; conteúdo mínimo em §11.4 | PO |
| GAP-APR-001 | APR | Alçadas de Aditivo, Termo de Ajuste e Remanejamento (C3) | **F4** | Adriana (DAF) |
| GAP-INT-001 | INT | Contrato da API Senior (Plano Financeiro) | Não bloqueia F2 (D7) | TI Senior |
| GAP-INT-005 | INT | Contrato da API Rubi (cargos/salários) | F7; até lá, carga por arquivo, como em D7 | TI Senior/Rubi |
| GAP-INT-013 | INT | RVS no MVP ou na v1.1 | F7; fallback = preenchimento manual | Giovanne |
| GAP-PGD-006/009 | ORC | Payload e granularidade do realizado por conta/período | **F5 (Integração 2)** | André / Wellington / TI Senior |
| GAP-PGD-013 | ORC | Orçado zero com realizado (OxR RN_OXR_012) | Não bloqueia; exibe "Sem orçamento" | Wellington |
| GAP-CAD-001 | CAD | Fórmula do ISS (RN_RAT_02 termina em "conforme a expressão matemática:") | **Cálculo de ISS em F3** | Wellington |
| GAP-CAD-002 | CAD | RN0457 truncada ("homologada via."); RN_VIA_05 valida um período que não tem campo | F3 (pontual) | André |
| GAP-CAR-005 | CAD | Contas do Senior para Obrigações e Riscos Trabalhistas | Não bloqueia | Wellington |
| GAP-ORC-001 | ORC | RN0433 × RN0434 (Transferência para Provisões) e fórmulas de Saldo Final/Parcial do UC04.12 (Cat. #9) | **UC04.12 em F5** | Wellington |
| GAP-ORC-002 | ORC | 22 regras citadas e não definidas (RN0225, RN0262, RN0291, RN0430…) (Cat. #19) | Os UCs afetados em F5 | PO |
| GAP-REL-001 | REL | Book (UC05.12) sem requisitos; regra de rateio da Adm. Central (RN0270) é só um lembrete (Cat. #14) | **F6** | PO / Wellington |
| GAP-REL-002 | REL | Nenhum RNF em Relatórios, Viagens e Cadastros parte 2 (Cat. #21) | Não bloqueia; valem os RNFs gerais da seção 10.3 | PO |
| GAP-VIA-001/002/003 | CAD | Pendências do Viagens V3 (campos ausentes no protótipo, contas por categoria, cópia) | F3 | André |

---

## 10. Qualidade e testes

### 10.1 Estratégia

- **TDD no domínio**: TotalizerService, `Dinheiro`, MotorCalculoCustoPessoal, regras de ciclo de vida e de alçada são funções puras com testes primeiro.
- **Critérios de aceite das fontes viram testes executáveis.** Exemplo: os AC01–AC08 do OxR V2 com os valores reais (546.195,02; 80,79%; 131,91%; −37.109,70). O nome do teste carrega o código da regra (ex.: `RN_OXR_010 % de uso do mês`).
- **Integração com PostgreSQL real** (Testcontainers): RLS, append-only da auditoria, rollback quando o log falha, `FOR UPDATE` no contador, conflito de versão.
- **E2E (Playwright)** nos fluxos críticos: login/bloqueio/manutenção, permissões de menu, e depois oficialização.

### 10.2 Testes obrigatórios das diretrizes (valem para todo módulo)

1. Escrita com falha na auditoria → nada persiste.
2. Usuário de outra `org_id` não lê nem escreve (RLS).
3. Action sem permissão → 403 auditado, mesmo chamada direto.
4. Dois saves concorrentes → o segundo recebe `ConflitoConcorrencia`.
5. Campo ORIGEM BLINDADA enviado no payload → ignorado ou rejeitado, nunca gravado.
6. Soma de dinheiro sem drift: casos com dízimas e Half-Even.

### 10.3 RNFs gerais (preenchem os módulos sem RNF)

Escrita simples ≤ 1,5 s; recálculo do TotalizerService ≤ 2 s para 1.000 linhas analíticas; Tree Grid de 5.000 linhas com rolagem virtual; exportação síncrona até 5.000 linhas e assíncrona acima disso (RF_IMP_003). Medido em hml com uma base de referência (4 TPs + Adm. Central, 60 meses).

### 10.4 CI

Lint (incluindo fronteiras de módulo e guarda RBAC obrigatória), `tsc`, testes unitários e de integração, build, `prisma migrate diff` **contra um banco efêmero do CI**. Branch protection na `main`: merge só com CI verde.

---

## 11. Fase 0 + Fase 1 — detalhamento para o primeiro plano

### 11.1 F0 — Fundação técnica (entregáveis)

1. Repositório Next.js + TypeScript strict + estrutura de módulos (4.1) + lint de fronteiras.
2. Docker Compose de dev (PostgreSQL 16 + app + worker) e imagem Docker única.
3. Prisma com migrations; papéis de banco (`sgo_app` sem BYPASSRLS, `sgo_sync`, `sgo_migrator`); RLS por `org_id`.
4. `shared/kernel`: `Dinheiro` (Half-Even), `Percentual`, `Competencia` (Mmm/AA, RN0302), `Resultado`, erros de domínio.
5. `shared/audit`: `HistoricoOperacao` append-only (trigger + privilégios) e `auditar(tx, …)`.
6. `shared/tenancy` e `shared/authz` (guarda obrigatória).
7. `shared/totalizer`: núcleo puro (árvore + valores analíticos → sintéticos e totais), com testes dos AC do OxR.
8. Worker com `pg-boss` + *outbox* de e-mail (adaptador SMTP; em dev, Mailpit).
9. CI (10.4) e **política de banco de produção** (11.5).

### 11.2 F1 — Geral, Autenticação e Administração

**GER (EP083 V3):** componentes-base reutilizáveis que implementam UC0–UC0.06 para todos os módulos:
- Listagem/Tree Grid virtualizada, com filtros retidos na sessão (RNF0005).
- Formulário [TRAVA O ERRO].
- Modal de impacto e exclusão com lista de impeditivos.
- Exportação XLSX/PDF/CSV com cabeçalho de filtros (RN0011 UC0.01), marca d'água com operador + Traceability ID (RN_WATERMARK) e auditoria.
- E-mail por modelo padrão via fila.

**AUT (EP084 V5):** UC01.01–UC01.05 integralmente, incluindo:
- Login *case-insensitive* (RN0518).
- Mensagem genérica (RN0015) e hash fictício para login inexistente (RNF0005).
- Ordem de verificação: manutenção → existência → status → bloqueio → senha (fluxo do UC01.02).
- Contador global com `FOR UPDATE` e bloqueio na mesma transação (RNF0011).
- Limiar de alerta e limite de bloqueio como parâmetros (RN0520, RN0024).
- Aviso de última tentativa (A5).
- Sessão única com aviso à estação anterior (RN0519).
- Esqueci minha senha com resposta uniforme (RN0516) e senha temporária (C21).
- Troca obrigatória (REQ0039).
- Tela principal com menu por permissão (RN0027/0030/0031) e menu vazio sem redirecionar (RN0521).
- Ajuda contextual (RN0032).
- Logoff com confirmação e limpeza do cliente (RNF0010).

**ADM (EP085 V3):**
- UC02.01 Ativar/Desativar sistema (manutenção, desconexão com contagem, histórico).
- UC02.05/06 Módulos e Funcionalidades (só ativação, cadastro via seed).
- UC02.07–UC02.10 e UC02.25/26 Perfis e Permissões, tratados como **um** caso de uso: as duplicatas foram unificadas e prevalece a variante mais restritiva (nome único *case-insensitive*, sem espaços, ≥1 funcionalidade).
- UC02.11–UC02.14 Usuários: login imutável, senha nunca digitada pelo admin, exceções por usuário, desbloqueio zera o contador.
- UC02.15/16/17 Desconexão, notificação e sessão.
- UC02.18/19 Gerar e alterar senha.
- UC02.20 Configurações de notificações e aprovações.
- UC02.21–UC02.24 Exceções e histórico (com níveis Simples/Avançado).
- UC02.27 Seed idempotente.
- **UC02.28 Alçadas** (§11.4).

### 11.3 Matriz provisória dos perfis padrão (seed — C12)

| Perfil | Acesso mínimo |
| --- | --- |
| Administrador | Módulo de Administração inteiro (exclusivo, RN_SEED_003); leitura do histórico completo |
| Orçamentista | Cadastros e Orçamentário: escrita nas propostas em Rascunho/Em Elaboração; submeter WA01; relatórios |
| Gestor Financeiro (GFIN) | Leitura de Cadastros e Orçamentário; Central de Tarefas (aprovar/rejeitar WA01, WA05, WA02 quando titular); Parâmetros financeiros (alíquotas, encargo, semáforo); atualizar Realizado |
| Analista GRH | Estrutura Funcional, Cargos e Salários, Tabela Salarial, Benefícios, Empregados; finalizar WA05; SMN |
| Operador de Viagens (SCOR/GAD) | Aba Viagens das propostas; solicitar validação WA02 |
| Auditor | Somente leitura em todos os módulos de negócio + Histórico de Operações + versões congeladas |

### 11.4 UC02.28 — Gestão de Alçadas de Aprovação (conteúdo mínimo, a partir do Aprovações V2 §7)

- Cadastro por fluxo (WA01, WA02, WA05; WA03/WA04 reservados para C3) com **Titular** e **Substituto**, ambos obrigatórios e usuários ativos diferentes entre si.
- O substituto é usado automaticamente quando o titular está inativo no momento do roteamento (RN_ALC_005).
- Alçada sem aprovador ativo desabilita o botão de submissão do fluxo (E5 do UC6.00, E1 do UC6.01, E2 do UC6.02).
- Soft delete preserva quem aprovava em cada período. Toda mudança é auditada.
- O titular não pode homologar um lote que ele mesmo submeteu (RN_WA02_006, aplicado a todos os fluxos).
- Exclusivo do perfil Administrador.

### 11.5 Política de banco de produção (lição de 14/08/2026)

1. Nenhuma máquina de desenvolvimento tem credencial do banco de produção.
2. Migrations em produção só pelo pipeline de deploy (`prisma migrate deploy`), nunca `migrate dev`, `reset`, `db push` ou `migrate diff` com shadow apontando para prod.
3. `shadowDatabaseUrl` só aponta para um banco efêmero.
4. Backup diário + PITR verificados por um **teste de restauração mensal** registrado.
5. Comandos ad hoc em produção: só leitura, com papel de leitura, e anunciados antes de rodar.

### 11.6 Critério de pronto da F1

Todos os UCs listados em 11.2 com os fluxos principal, alternativos e de exceção cobertos por teste, os testes de diretriz (10.2) verdes, a seed idempotente executável duas vezes sem diferença, e o deploy em hml com os usuários-chave validando login/bloqueio/manutenção/permissões.

---

## 12. Próximos passos

1. PO revisa este documento. Ajustes são feitos aqui mesmo, em nova versão.
2. Plano de implementação da **F0 + F1** (`docs/superpowers/plans/`).
3. Em paralelo, a pauta de refinamento com os SMEs usa a seção 9 e os itens [PROVISÓRIA] da seção 8 como agenda, com prioridade para GAP-APR-001, GAP-CAD-001, GAP-PGD-006/009 e GAP-INF-001.
4. Cada fase seguinte (F2…F7) começa por uma spec curta da fase, baseada nos EPs e nas decisões aqui registradas.
