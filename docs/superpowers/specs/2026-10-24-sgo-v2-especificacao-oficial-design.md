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
| Plano de contas, centros de custo e parte dos dados de RH virão por integração com o Senior; **neste sistema, as fontes são os arquivos .xlsx** de plano de contas e de centros de custo, ambos com 5 níveis | A carga por arquivo é a fonte oficial até a integração existir (D7); a integração entra depois, atrás da mesma porta, sem mudar o modelo |
| Login próprio agora; unificação com a intranet depois (como recomendado) | D2 mantido; GAP-AUT-001 sai do caminho do go-live |
| Uma única organização, **sem multi-tenant**; cada TP vê só o que lhe compete | Isolamento por **unidade** (TP) no lugar de `org_id` (5, C31); Adm. Central em menu próprio (6.7) |
| Sem tela pública: o sistema abre direto no login | C32 |
| Push e PR só quando tudo estiver fechado | Branch fica local até o aceite final da spec |
| Viagens segue a especificação; os perfis seguem a recomendação desta revisão | RN_VIA_03 sem alteração (C19); matriz 11.3 + Gestor de Diretoria aprovada pelo PO (C30) |
| A base é a pasta `especificacao`; o `sistemaSgo` é só referência; anotações pessoais não entram | Nenhum arquivo fora de `especificacao/` é fonte de regra de negócio. As notas pessoais versionadas no `sgov2` foram ignoradas |
| O sistema vai rodar na VPS Hostinger do PO | Hospedagem definida (seção 4.3); sai da lista de gaps a decisão “onde roda” |

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
| 11 | `Plano_de_Contas_5_Niveis_CTCEA.xlsx` | out/2026 | Lido e validado (6.1). **Define o plano de contas: 5 níveis.** Prevalece sobre os "7 níveis" citados nos outros documentos |
| 12 | `Plano de Centros de Custo - Minuta Rev23102026 - CCs de gestao.xlsx` | 23/10/2026 (minuta) | Lido e validado (6.1a). **Centro de custo com 5 níveis.** Minuta pendente de aprovação da DIREX |
| 13 | Protótipo "Orçamento 2027 – Lançamentos" (Adm. Central), artifact `claude.ai/artifact/A9SEjticw6ourPCtWP4gfP` | 23/10/2026 | Lido (tela, cálculos e validações). Fonte do **UC04.17** (6.6). Os valores do protótipo são fictícios |
| 14 | Protótipo "SGO 2.0 – Telas do Sistema", artifact `claude.ai/artifact/NrxtL5RZyRZRia9wGcemUg` | 15/10/2026 | Lido: tela inicial pública, login com estados, pós-login com menu completo (≈60 funcionalidades em 5 módulos), seletor de unidade e de perfil. Referência de **navegação e layout** (6.7); as regras continuam vindo dos EPs |
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
| ORC | Orçamentário | UC04.01–UC04.16 + Orçado×Realizado + **UC04.17 Orçamento da Adm. Central (novo)** | Catálogo §6 + OxR V2 + protótipo (fonte 13) |
| REL | Relatórios e Book | UC05.01–UC05.12 | Catálogo §7 |
| APR | Aprovações (workflows) | UC6.00–UC6.02 | Aprovações V2 |
| INT | Integrações | Senior, Rubi, RVS | Integração V4 + OxR V2 |

### 3.2 Fases de construção

Cada fase é um subprojeto com seu próprio ciclo de spec detalhada (quando necessário), plano e implementação. A ordem segue as dependências de dados: não há proposta sem plano de contas, não há aprovação sem proposta.

| Fase | Entrega | Depende de | Bloqueios abertos (seção 9) |
| --- | --- | --- | --- |
| **F0** | Fundação técnica: repositório, CI/CD para a VPS, ambientes, banco, backup, auditoria, isolamento por unidade, dinheiro, TotalizerService (núcleo), filas | — | Destino do backup externo (GAP-INF-001), não bloqueia o desenvolvimento |
| **F1** | GER + AUT + ADM (inclui Alçadas UC02.28 e perfis padrão) | F0 | GAP-ADM-001 (matriz de perfis), não bloqueia: vale a matriz provisória |
| **F2** | Cadastros-base: Plano Financeiro (Integração 1 + carga por arquivo), Centros de Custo (carga por arquivo), Agrupadores, Estrutura Funcional, Cargos e Salários, Tabela Salarial, Parâmetros (alíquotas, SMN, benefícios-mestre, semáforo) | F1 | GAP-INT-001 (contrato Senior), contornado pela carga por arquivo |
| **F3** | Proposta/TP: capa, versões, duplicação, metas, quantitativos, empregados e benefícios, viagens, bens CAPEX, impostos, rateio/ISS, totalizadores | F2 | GAP-CAD-001 (fórmula do ISS) bloqueia só o cálculo do ISS |
| **F3A** | Orçamento da Administração Central (UC04.17, 6.6) | F2 (pode correr em paralelo com F3) | GAP-ORC-003/004 só afetam os valores padrão |
| **F4** | Aprovações WA01/WA05/WA02 + Termo Aditivo + Termo de Ajuste + Remanejamento | F3 | Alçada de Aditivo, Ajuste e Remanejamento (GAP-APR-001) |
| **F5** | Execução orçamentária: Cronograma de Desembolso, Premissas/Reajustes, Recursos, Contratações Previstas, Orçado×Realizado (Integração 2), Provisões, Aplicações Financeiras | F4 | GAP-PGD-006/009 (payload do realizado), GAP-ORC-001 (RN0433/0434) |
| **F6** | Relatórios UC05.01–UC05.11, Book UC05.12 | F5 | GAP-REL-001 (Book e rateio da Adm. Central) |
| **F7** | Integração Rubi (sincronismo real) e RVS | F2/F3 | GAP-INT-005, GAP-INT-013 |

**Fora do escopo do SGO 2.0**, conforme as fontes: execução financeira (o SGO trata do *orçado*; o *realizado* vem do ERP), emissão/compra de passagens, app mobile.

---

## 4. Arquitetura

### 4.1 Visão geral

**Monólito modular** em Next.js: sem backend separado por enquanto, e com critérios de extração registrados em ADR. Cada módulo da seção 3.1 é um *bounded context* com fronteira explícita:

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
    unidade/             # contexto da unidade (TP) do usuário + RLS
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
| Empacotamento | Imagem Docker única (app + worker com entrypoints distintos) | Roda na VPS via Easypanel; portável para outra infra se preciso |
| Hospedagem | VPS Hostinger (Ubuntu, 2 vCPU, 8 GB RAM, 96 GB disco) com Easypanel + Traefik já instalados | Seção 4.3 |
| E-mail | SMTP externo autenticado (provedor transacional ou SMTP corporativo da CTCEA) | VPS não envia e-mail direto: IP de VPS cai em spam |

### 4.3 Ambientes e hospedagem (VPS Hostinger)

O sistema roda na **VPS Hostinger do PO** (srv2039095: 2 vCPU, 8 GB de RAM, 96 GB de disco). A VPS já tem **Docker** e **Easypanel**, com **Traefik** nas portas 80/443. O SGO usa essa base em vez de instalar outro proxy.

| Ambiente | Onde | Banco |
| --- | --- | --- |
| **dev** | Máquina do desenvolvedor, Docker Compose (PostgreSQL 16 + app + worker) | Local, descartável; dados sintéticos da seed |
| **hml** | VPS, projeto Easypanel `sgo-hml` (subdomínio próprio) | PostgreSQL 16 próprio do hml |
| **prod** | VPS, projeto Easypanel `sgo-prod` (domínio definitivo) | PostgreSQL 16 próprio do prod |

Serviços por ambiente no Easypanel: `app` (Next.js, `node server.js`, saída *standalone*), `worker` (mesma imagem, entrypoint `worker`) e `db` (PostgreSQL 16). Só o `app` é exposto, via Traefik com HTTPS (Let's Encrypt). O banco **não** publica porta na internet e só é acessível pela rede interna do Docker.

**Deploy:** um push na `main` dispara o GitHub Actions (lint, testes, build da imagem). A imagem vai para o GHCR (privado) e o Easypanel recebe um *webhook* de deploy. Antes de subir o app, o contêiner roda `prisma migrate deploy`. Se a migration falha, o app novo não sobe e o anterior continua no ar. O hml recebe tudo; o prod só recebe *tags* de release.

**Orçamento de memória (estimado):** prod com app ~600 MB, worker ~300 MB e PostgreSQL ~1,5 GB (`shared_buffers` 512 MB); hml com cerca de metade. São ~3,5 GB ao todo, cabendo nos 8 GB com folga para o Easypanel. Se a VPS ficar apertada, a primeira medida é subir o plano ou tirar o hml da VPS.

**Banco de produção — proteção de dados (inegociável, lição de 14/08/2026):**
- **PITR**: WAL contínuo com `pgBackRest` (ou WAL-G) para um *storage* S3 compatível **fora da VPS** (ex.: Backblaze B2 ou Cloudflare R2), com retenção de 30 dias.
- **Dump lógico diário** (`pg_dump -Fc`), também enviado para fora da VPS, com retenção de 90 dias.
- **Backup/snapshot da Hostinger** antes de todo deploy com migration. Não substitui os dois itens acima, porque fica na mesma conta.
- **Teste de restauração mensal** em banco descartável, com registro do resultado. Backup que nunca foi restaurado não conta como backup.
- Credenciais de produção existem só nas variáveis do Easypanel; nunca em `.env` de desenvolvedor.

**Segurança da VPS** (pré-requisito do go-live): SSH só por chave, sem senha para root; firewall liberando apenas 22/80/443; fail2ban; atualizações automáticas de segurança. O painel do Easypanel (hoje exposto na porta 3000) passa para trás de HTTPS em subdomínio próprio, ou fica restrito por firewall.

O worker é um processo de longa duração; por isso o desenho não depende de plataforma *serverless*.

---

## 5. Diretrizes transversais → mecanismo técnico

| Diretriz (fonte) | Mecanismo no SGO 2.0 |
| --- | --- |
| **[TRAVA O ERRO]** — validação síncrona; em erro, rollback e formulário preservado | Zod no cliente (feedback imediato) + Zod e regras de domínio no servidor. A Server Action devolve `Resultado` tipado (`ok` ou `erros[]` por campo) e nunca lança erro para a UI. O formulário mantém o estado local e só fecha em `ok`. Estado de formulário nunca vai para `localStorage` (RNF0002 do EP084) |
| **[ORIGEM BLINDADA]** — campos do ERP e calculados são somente leitura | (1) Esses campos não existem nos schemas de entrada (Zod); (2) o repositório de escrita os ignora; (3) para tabelas espelho do ERP, só o papel de sincronismo tem `UPDATE` no banco. Uma tentativa de escrita vira erro de domínio `ViolacaoGovernanca` (auditado) |
| **[SOFT DELETE]** — sem DELETE físico em dado financeiro ou histórico | Colunas `ativo boolean` + `inativado_em`/`inativado_por`. Exclusão física só em rascunho sem histórico (RN_EXC_001). A permissão de `DELETE` é revogada no banco para as tabelas financeiras |
| **[SINCRONISMO ATÔMICO]** — lote tudo ou nada | Toda operação em lote dentro de uma única `prisma.$transaction`. Cargas de ERP gravam primeiro em tabela de *staging*, validam e depois fazem merge numa transação |
| **[CARGA VIVA]** — registro com dependência não pode ser excluído nem inativado | Cada agregado expõe `verificarDependencias()` no domínio, consultado antes da exclusão. A UI lista os impeditivos (RF_EXC_003). Foreign keys `ON DELETE RESTRICT` como rede de segurança |
| **Log Delta compulsório** — auditoria na mesma transação; falha desfaz | `HistoricoOperacao` gravado pelo mesmo `tx` da operação via `auditar(tx, evento)`. Tabela append-only: `UPDATE`/`DELETE` revogados e *trigger* que rejeita. Campos: `unidade_id` (nulo em operações globais), usuário (ou "Sistema"), sessão UID, IP, funcionalidade, tipo de operação (RN0103), descrição padronizada (RN0089–RN0094), `antes`/`depois`/`delta` em JSONB, `TIMESTAMPTZ` do servidor |
| **Nível de log Simples/Avançado** por funcionalidade (RN0104/RN0105) | `Funcionalidade.nivelLog`. Consultas e exportações só geram registro quando o nível é Avançado; login, logoff e escritas sempre geram (RN_LOG_EXP: exportação sempre registra) |
| **Precisão monetária** | `NUMERIC(15,2)` para valores, `NUMERIC(9,4)` para percentuais e índices (RNF_PR_004). Value object `Dinheiro` com arredondamento **Half-Even** em 2 casas. Na API, valores trafegam como *string* decimal |
| **Isolamento por unidade** (substitui o multi-tenant do Catálogo, C31) | Uma só organização. Toda tabela de dado de TP tem `unidade_id NOT NULL` (Proposta e tudo abaixo dela, execução, realizado). Cadastros globais (plano de contas, CC, cargos, parâmetros) não têm unidade. O usuário tem a lista de unidades permitidas (`UsuarioUnidade`). Defesa em duas camadas: a guarda `shared/authz` filtra pela unidade ativa **e** o banco aplica RLS com `current_setting('app.unidades')` (lista das unidades do usuário), definido por `SET LOCAL` em cada transação pelo `shared/unidade`. A aplicação conecta com um papel **sem** `BYPASSRLS`. A Adm. Central não é uma unidade de TP: o acesso a ela é uma permissão própria (6.7) |
| **Concorrência otimista** (`@Version`) | Coluna `versao int`. O update usa `WHERE id = ? AND versao = ?`; zero linhas afetadas vira erro `ConflitoConcorrencia`, com mensagem inline (RNF_CON_002) |
| **Concorrência pessimista** (sincronismo, remanejamento, contador de login) | `pg_advisory_xact_lock` por chave (ex.: `sync-plano:<org>`, `remanejamento:<conta>`). `SELECT … FOR UPDATE` na linha do usuário no login (RNF0011) |
| **RBAC revalidado no backend** em todo endpoint | `authz.exigir(funcionalidade, acao)` obrigatório em toda Server Action/Route Handler (lint proíbe Action sem guarda). A UI só oculta botões; a autoridade é o servidor |
| **TotalizerService** — motor único de agregação | Função pura em `shared/totalizer`: recebe valores das contas **analíticas** e a árvore, devolve sintéticas, totais e percentuais. Sintéticas **nunca** são persistidas como dado vivo (OxR V2 §7), só dentro de *snapshots* de oficialização |
| **Tempos de resposta** (1,5 s / 2 s / 800 ms / 400 ms) | Viram metas de teste de desempenho (seção 10), medidas em hml com volumetria de referência |
| **Criptografia de salários em repouso** (RNF_WA05_004, AES-256) | Criptografia do volume/banco gerenciado + mascaramento por perfil na leitura. Criptografia por coluna é **[PROVISÓRIA]** (ver D10) |

---

## 6. Modelo de domínio consolidado

### 6.1 Hierarquia de contas (Plano Financeiro)

- O SGO orça sobre o **Plano Financeiro** recebido do Senior (Integração 1 do OxR V2). A estrutura está **definida em 5 níveis** pela planilha `especificacao/Plano_de_Contas_5_Niveis_CTCEA.xlsx`.
- **Conteúdo da planilha** (validado): 174 contas, todas no grupo 4 – Despesas; 12 sintéticas (S) nos níveis 1–4 e 162 analíticas (A), todas no nível 5. Sem pai ausente, sem código duplicado, sem divergência entre tipo e nível.

| Nível | Máscara | Exemplo | Tipo |
| --- | --- | --- | --- |
| 1 | `9` | 4 DESPESAS | Sintética |
| 2 | `9.9` | 4.1 DESPESAS OPERACIONAIS | Sintética |
| 3 | `9.9.9` | 4.1.1 DESPESAS DE SERVIÇOS | Sintética |
| 4 | `9.9.9.9` | 4.1.1.1 DESPESAS DE PESSOAL … 4.1.1.9 PROJETOS (9 grupos) | Sintética |
| 5 | `9.9.9.9.999` | 4.1.1.1.001 Salários (reduzida 900) | **Analítica** |

- Colunas da planilha → modelo: `Nível` → `nivel`; `Classificação` → `classificacao` (única); `Conta Superior` → `conta_pai_id`; `Descrição` → `descricao`; `Tipo` S/A → `tipo`; `Conta Reduzida` → `codigo_reduzido`. O código reduzido é **obrigatório e único nas analíticas** e é a chave de casamento com o Senior nas Integrações 1 e 2.
- **Regras de integridade** (validadas na carga e no banco): nível ∈ 1..5; nº de segmentos da classificação = nível; o pai tem nível − 1; analítica ⇔ nível 5; sintética tem pelo menos um filho; analítica não tem filhos.
- Onde os documentos dizem "Nível 7 / Nó Folha / N7", leia-se **conta analítica de nível 5**. O código identifica a analítica pelo `tipo`, e o limite de 5 níveis fica num parâmetro validado, não espalhado pelo código.
- A planilha é a **fonte do plano de contas** neste sistema em todos os ambientes (seed de dev/hml e carga de prod), pelo *Bulk Loader* de D7. A origem definitiva é o Senior (Integração 1), que entra depois atrás da mesma porta.
- Somente contas **analíticas ativas** recebem valor (orçado, realizado, FKs de Cargos/Viagens/Bens/Rateios).
- **Agrupadores de Contas** são entidades exclusivas do SGO (N:N com analíticas), usadas apenas em relatórios (RN_PLA_007–011). Não são contas sintéticas.
- A entidade legada **SubConta não existe** no SGO 2.0.

### 6.1a Centros de Custo

- Estrutura em **5 níveis** (decisão do PO), definida pela planilha `especificacao/Plano de Centros de Custo - Minuta Rev23102026 - CCs de gestao.xlsx`. A minuta preenche hoje os níveis 1 a 4; o nível 5 é válido e aceito na carga. A origem definitiva é o **Senior**, por integração futura; até lá, a planilha é a fonte (D7).
- **Conteúdo da minuta** (validado): 35 centros de custo, sendo 8 sintéticos (agrupadores) e 27 analíticos. Não há pai ausente nem reduzido duplicado. Toda sintética tem filho, e nenhuma analítica tem filho.

| Nível | Exemplo | Observação |
| --- | --- | --- |
| 1 | 4 DIREX (14.180) | Raiz, sintético |
| 2 | 4.1 Diretoria de Estudos e Projetos – DEP; 4.4 Suporte Administrativo | Diretorias (sintéticas); 4.4 é analítico |
| 3 | 4.1.0 Gabinete da DEP; 4.1.1 Setor de TI; 4.1.2 Gerência de Implantação… | Gabinetes, setores e gerências |
| 4 | 4.1.2.10 Gestão da Gerência…; 4.1.2.11 Área de Gerenciamento de Programa e Projetos | Setores das gerências |
| 5 | — | Reservado |

- **Diferença em relação ao plano de contas:** no CC, a conta **analítica pode estar em qualquer nível** de 2 a 5 (ex.: 4.4 no nível 2, 4.1.1 no nível 3). Somente CC **analítico** (coluna "Aceita lançamento" = S) recebe orçamento ou lançamento.
- Colunas da planilha → modelo: `Classificação` → `classificacao` (única); `Código reduzido` → `codigo_reduzido` (único; chave com o Sapiens/Senior); `Descrição sugerida` → `descricao` (a original fica em `descricao_original` até a decisão de grafia da DIREX/GFIN); `Nível` → `nivel`; `Classificação pai` → `cc_pai_id`; `Tipo` → `tipo`; `Aceita lançamento` → `aceita_lancamento` (precisa ser igual a `tipo = ANALITICO`). A coluna "Observação" não é importada.
- **Regras de integridade** (validadas na carga e no banco): nível ∈ 1..5; nº de segmentos = nível; pai com nível − 1; sintético tem filho; analítico não tem filho; `aceita_lancamento ⇔ analítico`. A máscara **não** fixa a quantidade de dígitos por segmento, porque a minuta usa 1 dígito no nível 3 e 2 no nível 4 (GAP-CC-002).
- **Regra R3 da minuta (CC de gestão):** toda diretoria e toda gerência sintética tem **exatamente um** CC analítico de gestão (sufixo `.0` no nível 3 e `.10` no nível 4). Ele recebe o custo do titular, da assessoria direta, das viagens e diárias da chefia e da capacitação da equipe de gestão. Custos compartilhados da sede vão para 4.4 Suporte Administrativo. O SGO marca o CC de gestão com o atributo `de_gestao` e valida a regra na carga, com **aviso** (não bloqueia enquanto a minuta não for aprovada).
- **Classificação ≠ conta:** a classificação do CC começa em "4", assim como o plano de contas, mas são entidades distintas e sem chave em comum. Nas telas, o CC é sempre mostrado com o reduzido para não confundir.
- **Uso no orçamento:** a Proposta/TP exige um Centro de Custo (RF_TP_001), único entre os projetos ativos (RN_TP_001). Os filtros e consolidações por CC (RF_EO_003, RF_DA_003, RN_DA_003) usam a árvore, e o CC sintético soma os filhos pelo TotalizerService.
- **Carga:** em dev e hml, a minuta entra na seed. Em **prod**, a carga só acontece depois da aprovação da DIREX (GAP-CC-001), pelo mesmo *Bulk Loader* de D7.

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

### 6.6 Orçamento da Administração Central (UC04.17 — novo)

Os EPs não tratam do orçamento anual interno da Adm. Central: o Catálogo só cita o **rateio** dela (RN0270, ainda sem regra). A fonte deste UC é o protótipo de 23/10/2026 (fonte 13). Tudo aqui está marcado **[PROVISÓRIA]** até virar EP.

**Objeto.** Um `OrcamentoExercicio` por ano (ex.: 2027), com o ciclo de vida da 6.2 (Rascunho → Em Elaboração → Em Aprovação → Oficializado). A oficialização gera snapshot. O orçamento é montado por duas fontes de lançamento, sempre em **CC analítico**:

| Aba | Entidade | Campos | Validações (do protótipo) |
| --- | --- | --- | --- |
| Lançamento de pessoal (*driver*) | `PosicaoPessoal` | CC analítico, cargo, quantidade, salário mensal, mês de início, mês de saída | CC obrigatório e dentro do escopo do usuário; cargo obrigatório; quantidade inteira ≥ 1; salário > 0; início ≤ saída |
| Lançamento base zero | `PacoteBaseZero` | CC analítico, conta analítica, atividade/justificativa, prioridade (Essencial · Importante · Desejável), quantidade, valor unitário (preço do ano anterior), corrigir pelo IPCA (sim/não), distribuição (Mensal em 12 parcelas · Pontual em um mês), mês de ocorrência | CC no escopo; conta obrigatória; justificativa ≥ 10 caracteres; quantidade ≥ 1; valor unitário > 0. Contas de pessoal e encargos (4.1.1.1 e 4.1.1.2) **não** aparecem aqui, porque vêm do quadro de pessoal |
| Visão por centro de custo | — (só leitura, RN_TOT_01) | Árvore de CC com Pessoal + encargos, Base zero, Total e % do escopo; detalhe do CC com série mês a mês e linhas CC × conta com a origem (Pessoal / Base zero) | Sintéticos somados pelo TotalizerService |

**Cálculo mensal de uma posição** (função pura `MotorCustoPosicao`, com `Dinheiro` e Half-Even; o protótipo usa `number` e arredonda só na exibição):
- massa(m) = qtd × salário × (1 + reajuste, se m ≥ mês da data-base), nos meses entre início e saída;
- férias + 1/3 = massa × 4/3 ÷ 12; 13º = massa ÷ 12;
- encargos = **Encargo Social do C&S V4** (RN_CAR_17, 51%) sobre massa + férias + 13º. O protótipo usa outro conjunto (INSS 20% + RAT 2% + terceiros 5,8% + FGTS 8% + PIS 1%), e o C&S V4 prevalece (C23);
- benefícios = qtd ativa × valores da **Tabela Mestre de Benefícios** (seguro saúde, vale-refeição, seguro de vida…), não constantes no código;
- valor anual de um pacote = qtd × valor unitário × (1 + IPCA, se marcado), distribuído em 12 parcelas iguais ou num único mês. A diferença de arredondamento das 12 parcelas vai para dezembro, para que a soma feche com o anual.
- Reajuste (5%), mês da data-base (maio) e IPCA projetado (4%) são **parâmetros do exercício** (Premissas/Reajustes), com esses valores como padrão provisório (GAP-ORC-003).

**Lançamento em contas analíticas.** O protótipo grava o pessoal nos grupos sintéticos 1.9.11/1.9.12, o que viola a regra de que só analítica recebe valor (6.1). No SGO, cada componente vai para a sua conta analítica do plano de 5 níveis **[PROVISÓRIA]**: massa → 4.1.1.1.001 Salários; férias → 4.1.1.1.003; 13º → 4.1.1.1.005; seguro saúde → 4.1.1.1.008; vale-refeição → 4.1.1.1.009; seguro de vida → 4.1.1.1.007; encargos → 4.1.1.2.001 INSS, 4.1.1.2.005 FGTS e 4.1.1.2.008 PIS/PASEP, mais Obrigações/Riscos (GAP-CAR-005). A tabela componente → conta é um parâmetro, não código.

**Escopo e perfis.**
- **Gestor de diretoria:** vê e lança só nos CCs analíticos sob a sua diretoria (subárvore de CC). Exige o novo vínculo usuário → CC raiz de escopo no cadastro de usuário (UC02, C25). A regra vale no **servidor** (RBAC + filtro por subárvore), não só na tela.
- **GFIN:** vê toda a Adm. Central (CC raiz 4), consolida e define o **teto** do exercício. O painel mostra orçado × teto, a % e o saldo com as faixas do semáforo (C7/RN_PLA_006).
- Indicadores do topo: orçamento do ano, pessoal + encargos (% do total), base zero (nº de pacotes), empregados em dezembro (nº de posições), mais o resumo por prioridade.

**Interação:** incluir, editar (a linha em edição fica destacada) e excluir com confirmação na própria linha. Cada operação recalcula e avisa ("O orçamento foi recalculado."). Na tela, a prévia do cálculo aparece enquanto se digita (massa, férias + 13º, encargos, benefícios, custo anual). Os erros aparecem em lista acima do botão, e o formulário mantém o que foi digitado ([TRAVA O ERRO]).

**Exercícios (orçamento por ano).** A Adm. Central tem um orçamento por ano, e vários anos convivem: no fim de 2026, o 2026 está em execução e o **2027 é elaborado**. Ação **Novo exercício** (só GFIN): informa o ano (único; o padrão é o ano seguinte ao último) e a forma de início: **em branco** ou **copiando o exercício anterior** (posições de pessoal e pacotes base zero, já com as premissas do novo ano; nada é oficializado na cópia) **[PROVISÓRIA]**. O seletor de exercício fica no topo da tela.

**Receitas: rateio dos TPs** (decisão do PO, 24/10/2026; base, percentual, distribuição e previstos decididos pelo PO, ISS pendente em GAP-ORC-007). Quando um TP é assinado, um percentual dele vai para a Adm. Central. No TP, isso é a linha automática da Taxa de Administração Central (RN0270, UC04.11), lançada nas analíticas pela grade de Rateio/ISS (UC03.03). Na Adm. Central, o mesmo valor é **receita**. A tela ganha uma aba **Receitas – Rateio dos TPs**, só leitura (ORIGEM BLINDADA: o valor nasce no TP, nunca é digitado aqui):

| Coluna | Origem |
| --- | --- |
| TP / versão | TP oficializado (snapshot) ou proposta em aprovação |
| Base do rateio | **Subtotal de despesas** do TP (RN0270), via conta sintética mandante (REQ_RAT_004) |
| % do rateio | Definido **em cada TP** (negociado no contrato), na grade de Rateio |
| Rateio do mês (jan–dez do exercício) | **Mês a mês, junto com as despesas do TP**; só os meses do ano do exercício |
| ISS sobre o rateio | Grade de ISS do TP (RN_RAT_02, fórmula pendente: GAP-CAD-001) |
| Rateio líquido | Rateio − ISS |

- **Confirmado × previsto:** o rateio de TP **oficializado** é receita confirmada. O de proposta **em aprovação** aparece numa coluna separada, como receita prevista, para ajudar a planejar o ano seguinte, mas não entra no saldo nem no teto (decisão do PO).
- **Aditivo e Termo de Ajuste:** a oficialização de um aditivo recalcula o rateio dos meses afetados no exercício aberto. Exercício oficializado não muda; a diferença aparece como ajuste.
- **Resultado do exercício:** Rateio líquido confirmado − (Pessoal + encargos + Base zero) = superávit ou déficit, mês a mês e no ano.
- **Teto:** o padrão é o **rateio líquido confirmado** do exercício. O GFIN pode fixar um teto menor, nunca maior sem justificativa registrada. O semáforo (70/85/95) compara o orçado com esse teto (decisão do PO).
- Dependência: a aba de receitas só tem dados quando a F3 (Proposta, Rateio/ISS) existe. Até lá, a F3A funciona só com despesas e teto manual.

**Atributo novo no CC:** natureza (Finalístico · Apoio · Administrativo · Gestão), usada para ordenar e agrupar. A minuta de CC não tem essa coluna (GAP-CC-006).

**Relação com o rateio:** o total oficializado da Adm. Central é a base natural do rateio entre os TPs (RN0270), mas a regra continua indefinida (GAP-REL-001).

### 6.7 Navegação e telas (protótipo, fonte 14)

O protótipo é a referência de **estrutura de navegação e padrão visual** da F1 em diante: azul institucional `#1F3864`/`#2E75B6`, cabeçalho com unidade e perfil, menu lateral por módulo → grupo → funcionalidade, busca de funcionalidade, telas CRUD com grade, formulário, confirmação e aviso. O que ele define e o que é corrigido:

**Marca neutra (decisão do PO, 24/10/2026):** o nome "CTCEA" não aparece em lugar nenhum do sistema: telas, e-mails, relatórios, PDFs, mensagens, seed, código e nomes de banco. O sistema se apresenta como **SGO 2.0 – Sistema de Gestão Orçamentária**. Nome da instituição e logotipo, quando um relatório oficial exigir, vêm de **parâmetro do sistema** (`instituicao.nome_exibicao`, `instituicao.logotipo`), vazios por padrão. Esta especificação pode citar a CTCEA. Teste automatizado no CI: busca case-insensitive por "ctcea" em `src/`, `prisma/`, `worker/` e nas seeds falha o build.
- Dado de origem: a conta 4.1.1.8.005 do plano oficial se chama "Provisão p/plano de invest. e desenv. CTCEA". A carga grava a descrição **sem a sigla** **[PROVISÓRIA]**; confirmar com a GFIN se a conta será renomeada na origem (GAP-CAD-005).

**Mantido como padrão**
- **Contexto de unidade** no cabeçalho: cada Termo de Parceria é uma unidade, e **cada TP vê só o que lhe compete** (decisão do PO). O seletor lista só os TPs a que o usuário tem acesso e some quando há apenas um. Trocar de TP recarrega a tela com o filtro dessa unidade no servidor.
- **Administração Central em menu próprio** (decisão do PO, 24/10/2026; o protótipo já foi ajustado). Ela não entra no seletor de TP, porque não é um TP: não tem Proposta, Cronograma nem Termo de Parceria, e o orçamento dela é por centro de custo. O menu **Administração Central** aparece para quem tem a permissão e reúne:
  - **Orçamento da Adm. Central** (UC04.17): lançamentos de pessoal e base zero, visão por CC, teto;
  - **Consolidado dos TPs** (somente leitura): painel e relatórios que somam todos os TPs, inclusive os que o usuário não opera no dia a dia. É o único lugar onde dados de vários TPs aparecem juntos;
  - **Rateio da Adm. Central** (RN0270), reservado até a regra existir (GAP-REL-001).
  Vantagens: o usuário de TP nunca vê a Adm. Central por engano, as telas de TP não precisam tratar um "TP consolidado" que não existe, e o acesso ao consolidado vira uma permissão auditável, separada do acesso a cada TP.
- **Menu por permissão** (RN0027/RN0030): o menu só mostra módulos e funcionalidades ativos e permitidos, e a busca respeita o mesmo filtro.
- **Agrupamento do menu**: Administração (Operadores e Permissões · Parâmetros · Histórico); Cadastros (Plano de Contas · Central de Cálculos · Propostas · Pessoal · Viagens e Bens); Orçamentário (Novo TP/Aditivo · Execução Orçamentária); Relatórios (Financeiros · Viagens e Bens · Pessoal · Execução Física · Prestação de Contas); Aprovações (Workflows).
- Padrões de interação já alinhados aos EPs: confirmação com texto da regra, Histórico de Operações sem Novo/Alterar/Excluir, proposta em Oficializado/Em Aprovação somente leitura, justificativa de rejeição com ≥ 15 caracteres, semáforo 70/85/95.

**Itens que o menu do protótipo não tem e entram na spec**
- Cadastros › Plano de Contas: **Centros de Custo** (6.1a).
- Menu **Administração Central** (acima): Orçamento da Adm. Central (UC04.17, 6.6), Consolidado dos TPs e Rateio (reservado).
- Administração › Parâmetros: **Alçadas de Aprovação** (UC02.28). O item "Notificações e Aprovações" (UC02.20) fica só com as notificações, e quem aprova passa para as alçadas (C5).
- Cadastros › Viagens: o **painel analítico** do Viagens V3.

**Correções em relação ao protótipo** (ver C26–C30): níveis do plano de contas, plano de contas sem CRUD, fórmula de viagens (igual à RN_VIA_03), mensagens de login e conjunto de perfis.

## 7. Decisões de arquitetura (ADRs resumidos)

| ID | Decisão | Alternativas descartadas | Motivo |
| --- | --- | --- | --- |
| D1 | Monólito modular Next.js com módulos isolados por fronteira lint | Backend separado (NestJS) | Um time pequeno ganha velocidade; um único deploy na VPS; a extração fica possível pelos `index.ts` |
| D2 | **Autenticação própria** (Argon2id + sessão em banco), atrás de uma porta `ProvedorIdentidade` | Clerk (usado no `sistemaSgo`); NextAuth | O EP084 V5 exige comportamento que conflita com um IdP terceiro: contador e bloqueio próprios antes de verificar a senha (RN0018), modo manutenção (RN0023), senha gerada pelo sistema e enviada por e-mail (UC02.18), troca obrigatória (REQ0039), sessão única com aviso à estação anterior (RN0519), desconexão forçada com contagem (REQ0087) e hash fictício contra *timing* (RNF0005). O híbrido Clerk + banco próprio dividia a fonte da verdade. A porta permite plugar o login da intranet (GAP-AUT-001) sem reescrever |
| D3 | Sessão por **token opaco** (cookie `httpOnly`, `Secure`, `SameSite=Lax`) com registro em `SessaoUsuario` | JWT sem estado (citado no glossário do EP085) | Invalidação imediata é requisito (logoff ≤400 ms, sessão única, desconexão forçada, desativação de módulo desconecta usuários); JWT sem estado não revoga. O UID da sessão segue a RN0062 para auditoria |
| D4 | Hierarquia de contas em **5 níveis**, conforme a planilha oficial (6.1); a analítica é identificada pelo `tipo` | Fixar 7 níveis como nos EPs | A planilha `Plano_de_Contas_5_Niveis_CTCEA.xlsx` define a estrutura; os "7 níveis" dos EPs ficaram desatualizados |
| D5 | `NUMERIC(15,2)` para dinheiro; `NUMERIC(9,4)` para taxas | `numeric(18,2)` (glossário de Cadastros) | Diretriz canônica, confirmada no OxR V2. 15,2 comporta até R$ 9,9 trilhões |
| D6 | Filas e jobs no PostgreSQL (`pg-boss`) + padrão *outbox* para e-mail e notificação | Redis/BullMQ; serviço externo | Sem infraestrutura nova. O *outbox* garante que a notificação só sai se a transação comitou (RNF0012, RNF_EML_001) |
| D7 | **Arquivos .xlsx são a fonte** do plano de contas e dos centros de custo (ambos com 5 níveis) neste sistema, atrás da porta `FonteEstruturaFinanceira`. O adaptador Senior (Integração 1, e os dados de RH do Rubi/Senior) entra depois, sem mudar o modelo | Esperar o contrato do Senior | Decisão do PO. O GAP-INT-001 não tem prazo. O *Bulk Loader* já é requisito (RNF_DES_003: 10.000 linhas em menos de 30 s). Recarga do mesmo arquivo é idempotente: casa por `codigo_reduzido`, atualiza descrição/status e nunca apaga conta ou CC com valor (inativa, soft delete) |
| D8 | Imagem Docker na VPS Hostinger via Easypanel; PostgreSQL 16 próprio com PITR para storage externo | Vercel/serverless; Supabase/Neon gerenciado | Definido pelo PO: o sistema roda na VPS. O worker é de longa duração. Banco na mesma VPS elimina latência e custo, e a proteção vem do PITR externo (4.3) |
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
| C11 | EPs, Integração V4 e Catálogo falam em 7 níveis × planilha oficial com 5 níveis | **5 níveis** (planilha). "N7" nos docs = analítica de nível 5 (D4) | Atualizar os EPs na próxima revisão |
| C12 | Seis perfis padrão citados sem lista (UC02.27, Cat. #15) | Seed provisório com os seis atores dos documentos: **Administrador, Orçamentista, Gestor Financeiro (GFIN), Analista GRH, Operador de Viagens (SCOR/GAD), Auditor**. Matriz mínima em §11.3 | [PROVISÓRIA] GAP-ADM-001, Adriana |
| C13 | Critérios de senha não descritos (RN0039, Cat. #16) | Política **parametrizada**, com padrão mínimo de 12 caracteres, maiúscula, minúscula e dígito; bloqueio das últimas 5 senhas; senha diferente do login | [PROVISÓRIA] TI/Segurança CTCEA |
| C14 | UC02.02/UC02.04 inexistentes; UC02.03 vazio (Cat. #17) | Módulos e funcionalidades só por **seed** (RN_SEED_001). UC02.03 removido. Referências a UC02.04 apontam para UC02.05 | Fechado |
| C15 | UC04.05 (Viagens) copiado de Contratações (Cat. #18) e Viagens sem código (Cat. #30) | O planejamento de viagens é uma **aba da Proposta**: Viagens V3 substitui UC03.29–UC03.33. UC04.05 removido. A validação é feita pelo WA02 | Fechado |
| C16 | UC03.09 "Criar Nova Versão" descreve a validação RH/GAD (Cat. #27) | O versionamento passa a ser UC03.09 (nova revisão da mesma Proposta). A validação RH vira WA05 e a de viagens vira WA02 (Aprovações V2) | Fechado. Redação do UC03.09 a corrigir |
| C17 | Códigos repetidos com textos diferentes (Cat. #22–#24) | Convenção nova `<MOD>-<TIPO>-<NNN>` (ex.: `AUT-RN-015`), atribuída quando o módulo entra em fase. A tabela de correspondência com o código antigo fica em `docs/rastreabilidade/`. Os testes citam os dois códigos | Fechado |
| C18 | Glossário do EP085 define o RUBI como sistema de viagens | Errado: Rubi = RH/Folha (Integração V4) | Corrigir o EP085 |
| C19 | Viagens V3: campo "Custo Unitário de Transporte" existe, mas a fórmula RN_VIA_03 não o inclui | **Segue a especificação** (decisão do PO): custo estimado = (pessoas × passagem) + (pessoas × média de dias × diária), exatamente a RN_VIA_03. O transporte é registrado e exibido como categoria própria no painel (REQ_VIA_005), sem entrar no custo estimado da linha | Fechado |
| C20 | C&S V4: campo "Salário Definido" não aparece entre as opções de Fonte Ativa (Mín/Máx/Total/Real) | Incluir "Salário Definido" como 5ª opção de Fonte Ativa **[PROVISÓRIA]** | GRH |
| C22 | O protótipo do UC04.17 usa o "Plano Financeiro grupo 1.9" (ex.: 1.9.11.001 Salários, reduzida 1.712) × plano oficial de 5 níveis (4.1.1.1.001 Salários, reduzida 900) | **Plano oficial de 5 níveis.** Comparação: 142 de 161 contas do protótipo batem por grupo e sequência (1.9.11→4.1.1.1 … 1.9.16→4.1.1.6); 4 têm descrição diferente; 15 não existem no plano oficial (GAP-CAD-004) | Fechado |
| C23 | Encargos do protótipo (36,8% + incidência sobre férias/13º) × C&S V4 (51%, RN_CAR_17) | **C&S V4**, como parâmetro único usado tanto na proposta quanto no orçamento da Adm. Central | Fechado (protótipo tem valores fictícios) |
| C24 | Protótipo: cargo em texto livre e benefícios fixos × Cargos e Salários e Tabela Mestre de Benefícios (F2) | Cargo escolhido do cadastro de C&S; o salário vem preenchido pela Fonte Ativa e pode ser editado com registro no Log Delta; benefícios da Tabela Mestre **[PROVISÓRIA]** | GRH/GFIN |
| C25 | Protótipo: o perfil "Gestor de diretoria" lança só na sua diretoria, mas os EPs de Administração não têm vínculo de usuário com CC | Novo campo "CC de escopo" no cadastro de usuário (UC02) e novo perfil padrão "Gestor de Diretoria" na matriz 11.3 **[PROVISÓRIA]** | PO |
| C26 | Protótipo de telas: plano de contas "até 7 níveis / analítica nível 7", campos "Subconta (N7)" em Viagens e Bens; exemplos da planilha ACAP DECEA II | **5 níveis**, analítica no nível 5 (D4); o termo "Subconta" sai das telas (6.1: SubConta não existe); exemplos vêm do plano oficial | Fechado |
| C27 | Protótipo: Plano de Contas com Novo/Alterar/Excluir × ORIGEM BLINDADA (RN_PLA_001: estrutura só muda no Senior) | Tela de plano de contas **sem** inclusão, edição de estrutura ou exclusão: só consulta em árvore, **Sincronizar** (Integração 1), **Importar arquivo** (D7) e parametrização local (natureza OPEX/CAPEX, faixas do semáforo, RF_PLA_REQ_003). Vale o mesmo para Centros de Custo | Fechado |
| C28 | Protótipo: custo da viagem = (pessoas × passagem) + (pessoas × dias × diária) | Igual à RN_VIA_03; mantido (C19). O teto vem do Total da Conta e a rejeição acima do teto é mantida | Fechado |
| C29 | Protótipo de login: "Usuário ou senha inválidos. Tentativa 1 de 3"; mensagem própria de bloqueio após 3 erros; senha nova com ≥ 6 caracteres | EP084 prevalece: mensagem **genérica** "Login ou senha inválidos", sem contagem (RN0015), com aviso **só na última tentativa** (UC01.02 A5); limite de tentativas e regras de senha são **parâmetros** (RN0024, GAP-AUT-002), sem valor fixo na tela; o rótulo do campo é "Login" | Fechado |
| C30 | Protótipo: 5 perfis (Administrador, Gestor, Analista orçamentário, Aprovador GFIN, Consulta), e "Gestor" com acesso a quase tudo × matriz provisória de 6 perfis (11.3) | Vale a 11.3 mais o perfil **Gestor de Diretoria** (C25). "Consulta" corresponde a Auditor. O seletor de perfil do protótipo é ferramenta de demonstração e **não existe** no sistema: o perfil vem do usuário logado | Fechado (aprovado pelo PO) |
| C31 | Catálogo: diretriz multi-tenant por `org_id` + RLS × PO: uma só organização | **Sem multi-tenant.** O isolamento passa a ser por **unidade (TP)**, com a mesma técnica (guarda + RLS) | Fechado |
| C32 | Protótipo: tela inicial pública que lista módulos e unidades × nenhum EP prevê página pública | **Sem página pública**: a raiz do sistema abre direto o login (UC01.01) | Fechado |
| C21 | Esqueci minha senha / Gerar senha enviam a senha em texto no e-mail (REQ0077, RN0517) | Mantido (é requisito), com mitigação: senha **temporária de uso único**, troca obrigatória no 1º acesso (REQ0039) e **expiração em 24 h** (parametrizável) **[PROVISÓRIA]** | TI/Segurança |

---

## 9. Registro de gaps abertos

Somente o que ainda está **aberto** depois desta revisão. Os gaps já tratados na seção 8 não se repetem.

| ID | Módulo | Gap | Bloqueia | Responsável |
| --- | --- | --- | --- | --- |
| GAP-INF-001 | Infra | Hospedagem definida (VPS Hostinger). Falta: domínio/subdomínios, provedor do storage externo de backup e provedor SMTP | Go-live de F1 (não o desenvolvimento) | PO |
| GAP-AUT-001 | AUT | "Login unificado com a intranet NodeJS" (EP084 V5, objetivo): protocolo (OIDC/SAML/cookie compartilhado), quem é dono da senha, como ficam bloqueio e manutenção | Só o adaptador de SSO; F1 entrega login próprio | TI CTCEA |
| GAP-AUT-002 | AUT | Seções 3.6 (Pendências P01–P14) e 3.7 (correspondência de IDs) estão no sumário do EP084 V5, mas não no conteúdo. P02, P05, P07, P09, P10, P11 e P14 são citadas nos fluxos | Não bloqueia; valores ficam parametrizáveis | PO |
| GAP-ADM-001 | ADM | Conjunto de perfis aprovado pelo PO (§11.3: 6 perfis + Gestor de Diretoria). Falta só o ajuste fino das permissões por funcionalidade, que será validado em hml | Não bloqueia | Adriana (DAF) |
| GAP-ADM-002 | ADM | UC02.28 Gestão de Alçadas a redigir no EP085 (C5) | Não bloqueia F1; conteúdo mínimo em §11.4 | PO |
| GAP-APR-001 | APR | Alçadas de Aditivo, Termo de Ajuste e Remanejamento (C3) | **F4** | Adriana (DAF) |
| GAP-INT-001 | INT | Contrato da API Senior (Plano Financeiro) | Não bloqueia F2 (D7) | TI Senior |
| GAP-INT-005 | INT | Contrato da API Rubi/Senior para os dados de RH (cargos, salários, estrutura funcional) | F7; até lá, carga por arquivo, como em D7 | TI Senior/Rubi |
| GAP-INT-014 | INT | Integração dos **Centros de Custo** com o Senior não aparece na Integração V4 (só plano de contas, Rubi e RVS) | Não bloqueia (planilha é a fonte, D7) | TI Senior |
| GAP-INT-013 | INT | RVS no MVP ou na v1.1 | F7; fallback = preenchimento manual | Giovanne |
| GAP-PGD-006/009 | ORC | Payload e granularidade do realizado por conta/período | **F5 (Integração 2)** | André / Wellington / TI Senior |
| GAP-PGD-013 | ORC | Orçado zero com realizado (OxR RN_OXR_012) | Não bloqueia; exibe "Sem orçamento" | Wellington |
| GAP-CAD-001 | CAD | Fórmula do ISS (RN_RAT_02 termina em "conforme a expressão matemática:") | **Cálculo de ISS em F3** | Wellington |
| GAP-CAD-002 | CAD | RN0457 truncada ("homologada via."); RN_VIA_05 valida um período que não tem campo | F3 (pontual) | André |
| GAP-CAR-005 | CAD | Contas para Obrigações e Riscos Trabalhistas do Encargo Social. Candidatas no plano: 4.1.1.8.003 Provisão para Passivo de Obrigações Trabalhistas (2011) e 4.1.1.8.004 Provisão para Passivo de Riscos Trabalhistas (2012) **[PROVISÓRIA]** | Não bloqueia | Wellington |
| GAP-CC-001 | CAD | Aprovação final do plano de CC pela DIREX | Carga em **prod** (não o desenvolvimento) | DIREX |
| GAP-CC-002 | CAD | Máscara do CC: nível 3 com 1 dígito e nível 4 com 2 dígitos (ex.: 4.1.2.11) | Não bloqueia (máscara não fixa dígitos) | DIREX/GFIN |
| GAP-CC-003 | CAD | Reduzido 14.300 ausente; 14.460 fora de sequência; reduzidos 14.470–14.530 ainda são sugestão (a GFIN confirma no Sapiens) | Carga em prod | GFIN |
| GAP-CC-004 | CAD | A minuta cobre só a estrutura 4 (áreas internas). TPs/projetos terão CC próprio? Isso afeta RF_TP_001/RN_TP_001, que exigem CC único por TP ativo | **F3** | DIREX/GFIN |
| GAP-CC-005 | CAD | A DIREX (nível 1) terá CC de gestão próprio (ex.: 4.0 Gabinete da DIREX) ou seus custos ficam em 4.4? | Não bloqueia | DIREX |
| GAP-CAD-004 | CAD | 15 contas do protótipo não existem no plano oficial de 5 níveis: despesas financeiras (tarifas, IOF, comissões, câmbio, pregão, variação cambial), juros e multas, perda na baixa de imobilizado, doações e **Rateio da Adm. Central** (1.9.23.001). Também 4 descrições diferentes (ex.: 1.9.18.002 "Impostos a Recolher – ISS" × 4.1.1.8.002 Provisão para Contingências de Passivo Tributário) | F3A (base zero só oferece contas oficiais) | Wellington |
| GAP-CC-006 | CAD | Natureza do CC (Finalístico/Apoio/Administrativo/Gestão) usada no protótipo não está na minuta de CC | Não bloqueia (campo opcional) | DIREX/GFIN |
| GAP-ORC-007 | ORC | ISS do rateio: base (o valor do rateio?), alíquota (município do TP?) e quem arca (despesa a mais no TP ou dedução do que a Adm. Central recebe) | F3A e F3 (junto com GAP-CAD-001) | Wellington |
| GAP-ORC-003 | ORC | Premissas do exercício: % de reajuste, mês da data-base, IPCA projetado; provisão de férias com 1/3 e 13º em 1/12 avos | F3A (valores padrão provisórios) | GFIN/GRH |
| GAP-ORC-004 | ORC | UC04.17 precisa virar EP formal: alçada de aprovação do orçamento da Adm. Central, quem define o teto, se o teto é por diretoria | F3A (aprovação) | PO/Wellington |
| GAP-CAD-005 | CAD | Descrição da conta 4.1.1.8.005 contém a sigla CTCEA, vedada nas telas (6.7) | Não bloqueia (carga remove a sigla) | Wellington |
| GAP-CAD-003 | CAD | O plano de contas não tem conta de **ISS** nem de impostos sobre a proposta; não se sabe se o imposto da proposta é lançado em conta | F3 (junto com GAP-CAD-001) | Wellington |
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
2. Usuário sem acesso a um TP não lê nem escreve dados dele, mesmo chamando a API direto (guarda + RLS por `unidade_id`).
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
2a. Infra da VPS: projetos `sgo-hml` e `sgo-prod` no Easypanel, PostgreSQL 16 por ambiente sem porta pública, HTTPS via Traefik, pipeline GitHub Actions → GHCR → webhook do Easypanel, pgBackRest com storage externo e o primeiro teste de restauração registrado.
3. Prisma com migrations; papéis de banco (`sgo_app` sem BYPASSRLS, `sgo_sync`, `sgo_migrator`); RLS por `unidade_id`.
4. `shared/kernel`: `Dinheiro` (Half-Even), `Percentual`, `Competencia` (Mmm/AA, RN0302), `Resultado`, erros de domínio.
5. `shared/audit`: `HistoricoOperacao` append-only (trigger + privilégios) e `auditar(tx, …)`.
6. `shared/unidade` e `shared/authz` (guarda obrigatória, com unidade ativa).
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

### 11.3 Matriz dos perfis padrão (seed — C12, C30; aprovada pelo PO em 24/10/2026)

| Perfil | Acesso mínimo |
| --- | --- |
| Gestor de Diretoria (C25) | UC04.17: lança pessoal e base zero só nos CCs da sua diretoria; leitura dos relatórios da Adm. Central da sua diretoria |
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

1. Nenhuma máquina de desenvolvimento tem credencial do banco de produção. O banco de prod não tem porta pública na VPS.
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
