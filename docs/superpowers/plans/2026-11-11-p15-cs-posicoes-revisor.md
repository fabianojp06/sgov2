# P15 Cargo do C&S nas posições e regras de pessoal no revisor (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as duas histórias que o P12 e o P14 deixaram abertas por falta do cadastro de C&S:
- US-056 (#78): a posição de pessoal escolhe o **cargo do cadastro de C&S**, com o salário sugerido pela Fonte Ativa e editável com registro no Histórico (C24); o custo passa a usar os benefícios e o adicional do cargo;
- US-064 (#86): o revisor ganha as regras **R4, posição sem benefício**, e **R5, salário fora da faixa do cargo** (IA-03, §6.8).

**Architecture:**
- **Contrato da frente B:** o acréscimo de C&S ao C2 (#408, combinado na #138 em 11/11): `listarCargosExercicio(tx, { incluirInativos? })`, `beneficiosDoCargo(tx, ano, cargoId)`, o tipo `CargoExercicio` (com `ativo`), `cargosExemplo()` e `custoPessoalFalso(premissas, cargos)`. Nenhuma mudança no `cad`.
  - Pelo `@/modules/cad` (index, app), o `salarioFonteAtiva` sai **decifrado**: é o que a tela e a gravação usam.
  - Pelo `@/modules/cad/servidor` (worker), a Fonte Ativa cifrada sai com `salarioFonteAtiva: null`; a faixa, o adicional, o `ativo` e os benefícios saem normais. O revisor só precisa disso: a chave **não** vai para o worker.
- **Vínculo por id, sem FK** (§12.7, item 1: `cargo` é tabela da frente B): coluna `cargo_id uuid NULL` em `orc_posicao`. O texto `cargo` continua obrigatório: com cargo escolhido, guarda o nome do cargo no momento da gravação; sem cargo, é o texto livre da trilha 2027 (C34).
- **Uma migration**, só no PR da US-056. A US-064 não precisa de migration: os achados ficam no `jsonb` da `orc_revisao`.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, Prisma 7.10.1, PostgreSQL 16, Zod 4.6.7, pg-boss, Vitest 5.0.5 + Testcontainers, Playwright 1.64.0. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md`:
- §6.4 (motor único C33: base = Fonte Ativa + adicional; benefícios da Tabela Mestre);
- §6.6 (campos e validações da posição; cálculo mensal);
- §6.8 (princípio 1, número oficial nunca vem da IA; IA-03: "posição sem benefício, salário fora da faixa do cargo");
- §4.4 (minimização: o salário nunca vai à IA);
- C24 (cargo do cadastro; salário pela Fonte Ativa, editável com registro no Log Delta), C34 (texto livre na trilha 2027; tela de correspondência depois de 30/11), D10 e R24 (salário mascarado por perfil; ver salário sem máscara é `cad.salarios:consultar`, auditado com `CONSULTA`);
- §12.7 (uma migration por PR; relação entre frentes por id).
Planos de origem: P12 (D-P12-1 a D-P12-7) e P14 (D-P14-6 a D-P14-8). O UC04.17 não é EP (GAP-ORC-004): regras e mensagens novas são **[PROVISÓRIAS]**.

## Global Constraints

- Português do Brasil; marca neutra; dinheiro em `Dinheiro`/`NUMERIC(15,2)` com Half-Even, nunca `number`. Comparação de salário com a faixa só por `Dinheiro.comparar`.
- Toda Server Action e toda página passam pela guarda; escopo e cargo conferidos **no servidor** (R8).
- Toda escrita grava o Histórico na mesma transação, começa por `travarExercicio` e sobe a versão do exercício (regras do P11 e do P12, que continuam valendo).
- **Salário:** o da posição segue a D-P12-3; o da Fonte Ativa e a faixa de mercado seguem a R24 (D-P15-5). Nenhum dos dois vai à IA, a log, à `descricao` do Histórico nem ao texto de um achado.
- Testes usam `custoPessoalFalso(premissas, cargos)` e `cargosExemplo()` do `@/modules/cad` (C001 com faixa 7.500,00–9.800,00 e Fonte Ativa MÍNIMO; C002 com periculosidade; C003 sem Fonte Ativa; C004 inativo). O falso só aparece em arquivos de teste.
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez (D12). Só arquivos da frente A; nenhum toque no `worker/index.ts` (o registro do revisor já existe, #395).

## Decisões deste plano (recomendação; o PO valida no PR do plano)

- **D-P15-1 (vínculo e posições antigas):**
  - Coluna `cargo_id uuid NULL` em `orc_posicao`, sem FK (§12.7). GRANT de UPDATE da coluna ao `sgo_app`. Nenhum CHECK novo: uma posição IMPORTACAO alterada pela tela pode ganhar cargo e continua IMPORTACAO (D-P12-7).
  - **Inclusão pela tela:** o cargo do cadastro é **obrigatório** (C24) **[PROVISÓRIO]**. Sem cargo: "Escolha o cargo do cadastro." **[PROVISÓRIO]**. O texto `cargo` é gravado pelo servidor com o nome do cargo (o que o formulário mandar no campo de texto é ignorado).
  - **Posições antigas** (texto livre, importadas, copiadas ou da tela do P12): ficam com `cargo_id` nulo e continuam válidas, com o custo de hoje (padrão de benefícios, sem adicional). Na alteração, o seletor oferece "Manter o cargo em texto: <texto>" ou um cargo do cadastro. Depois de ligada a um cargo, a posição não volta a texto livre.
  - **Importação da planilha** continua em texto livre e grava `cargo_id` nulo (C34). A **cópia de exercício** copia o `cargo_id`.
  - **Tela de correspondência texto → cargo (C34): fica fora do P15** **[PROVISÓRIO]**. Ela depende dos textos reais da importação depois de 30/11 e não está nos critérios da #78. Até lá, a alteração pela tela liga uma posição por vez. A frente A propõe ao PO uma issue própria (só com a autorização dele, regra 5).
  - **Risco para o PO:** com o cadastro de cargos vazio em produção, o Gestor não inclui posição pela tela (a lista fica vazia, com o aviso "Nenhum cargo do cadastro disponível. Peça ao GRH para completar o cadastro." **[PROVISÓRIO]**). A importação continua.
- **D-P15-2 (salário ao escolher o cargo):**
  - **Sugerido, editável:** para quem pode ver (D-P15-5), escolher o cargo preenche o salário com a Fonte Ativa; a pessoa pode mudar. Trocar de cargo troca o salário só se o campo estiver vazio ou ainda igual à Fonte Ativa do cargo anterior.
  - **"Editável com log" (C24):** o `depois` do Histórico ganha `cargoId` e `salarioDaFonte: boolean` (o salário gravado é igual à Fonte Ativa decifrada na hora da gravação; `null` sem cargo). A `descricao` não muda e nunca leva valor.
  - **Cargo sem Fonte Ativa** (`salarioFonteAtiva` nulo pelo index): **fora da lista**, e o servidor recusa com "Este cargo está sem salário na Fonte Ativa. Escolha outro ou peça ao GRH para completar o cadastro." **[PROVISÓRIO]** (o contrato diz "a posição não usa esse cargo").
  - **Cargo inativo:** fora da lista para uma escolha nova; o servidor recusa com "Este cargo está inativo. Escolha outro." **[PROVISÓRIO]**. A posição que já aponta para ele mantém o cargo ao ser alterada, e a lista mostra o nome com "(inativo)".
  - **Cargo inexistente ou id fora do formato:** "Cargo não encontrado no cadastro." **[PROVISÓRIO]**.
  - **1º critério da #78:** cumprido para quem vê salário de cargo; para o Gestor de Diretoria, ver a D-P15-5.
- **D-P15-3 (motor de custo, sem contar duas vezes):**
  - O `calcularCustoPosicao` (C33) soma `premissas.beneficios`, que hoje são os "padrão da posição" da Tabela Mestre. O `beneficiosDoCargo` é a escolha do cargo **sobre a mesma** Tabela Mestre. Por isso, para posição com cargo, as premissas vão ao motor com `beneficios` **substituídos** por `beneficiosDoCargo(tx, ano, cargoId)`, nunca somados.
  - Posição com cargo leva também `adicional: cargo.adicional` (§6.4: base = Fonte Ativa + adicional). Sem cargo, o cálculo de hoje.
  - Vale em todo lugar que chama o motor: prévia, gravação e `recalcularExercicio` (importação, cópia, "Recalcular"). Uma leitura de cargos e um `beneficiosDoCargo` por cargo distinto, com cache por chamada.
  - A escolha de benefícios do cargo sobe a versão das premissas do ano (R10, `cad/application/beneficios-cargo.ts`), então a regra das premissas mudadas (D-P12-5) já cobre. A troca do **adicional** no cadastro não sobe a versão: as posições já gravadas só mudam no próximo recálculo do exercício. Risco aceito, registrado no PR.
  - Posição com `cargo_id` que não aparece em `listarCargosExercicio({ incluirInativos: true })` (cargo não se apaga no `cad`; não deve acontecer): `ErroRecalculo` "CC <cc>, cargo <cargo>: o cargo não está mais no cadastro." **[PROVISÓRIO]**.
- **D-P15-4 (regras novas do revisor, sem IA, com `Dinheiro`):**
  - **R4, posição sem benefício:** posição com `cargo_id` cujo `beneficiosDoCargo(ano, cargoId)` volta vazio. Um achado **por cargo**, com links para as posições dele em ordem de CC. Só roda se o ano tem premissas (`obterPremissasExercicio` não nulo); sem elas, aviso "O exercício <ano> não tem premissas; a regra de benefícios não rodou." **[PROVISÓRIO]** (senão toda posição viraria achado).
  - **R5, salário fora da faixa:** salário mensal da posição **menor** que `faixa.minimo` ou **maior** que `faixa.maximo` (igual ao limite está dentro). Um achado por posição. Cargo sem faixa, nenhum achado. Cargo inativo continua avaliado (`incluirInativos: true`). O salário comparado é o mensal gravado, sem reajuste.
  - **Posição sem `cargo_id`:** fora das duas, com o aviso "<n> posições sem cargo do cadastro ficaram fora das regras de benefício e de faixa salarial." **[PROVISÓRIO]** (só com n > 0).
  - **Textos sem valor** **[PROVISÓRIOS]**: R4 "Cargo <nome>: <n> posição(ões) sem benefício no exercício (o cargo não tem benefício ativo)."; R5 "CC <cc>, cargo <nome>: salário mensal abaixo do mínimo da faixa de mercado do cargo." ou "… acima do máximo …". Nunca o salário, a faixa ou a diferença.
  - **Máscara:** os links de R4 e R5 são do tipo `posicao`; os de R5 levam `salario: true`. O `filtrarAchados` passa a exigir `alcance.salario` (D-P12-3) para link com `salario: true`. O schema `ACHADO` de `ultimaRevisao` aceita `salario`; sem isso, o Zod descartaria a marca na leitura e o achado apareceria para quem não vê salário.
  - **IA:** o resumo das regras vai **sem valor e sem direção**: "Posições sem benefício: POS-1, POS-3" (com `orc.posicoes:consultar` de quem pediu) e "Posições com salário fora da faixa do cargo: POS-2" (com consultar **e** ver salário). As posições continuam indo sem salário; o nome do cargo do cadastro substitui o texto quando há `cargo_id`.
  - **Worker:** o revisor lê os cargos e os benefícios pelo `@/modules/cad/servidor` (sem a chave). O salário da posição é lido do `orc_posicao` numa leitura **só para as regras**, separada da que monta a mensagem da IA.
- **D-P15-5 (máscara na tela: D-P12-3 e R24 juntas):**
  - A Fonte Ativa e a faixa de mercado são dado do `cad.salarios` (R24: o `mascararHistoricoCad` já mascara `mercadoMinimo`). Por isso, o servidor só os manda a quem tem `orc.posicoes` com incluir ou alterar (D-P12-3) **e** `cad.salarios:consultar` (R24). Pelos perfis padrão, a GFIN.
  - Cada leitura com salário grava um `CONSULTA` na funcionalidade `cad.salarios`, com os códigos dos cargos e sem valores, como o `listarCargos` do `cad`.
  - **Sem `cad.salarios`** (o Gestor de Diretoria, pela matriz do P4): a lista de cargos vem só com código, nome e `ativo`, e a pessoa digita o salário. O formulário avisa "O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal." **[PROVISÓRIO]**. A R5 do revisor pega o salário fora da faixa. Se o PO quiser que o Gestor receba a sugestão, basta dar `cad.salarios:consultar` ao perfil pela tela de perfis (US-037), sem código novo.
  - **Quem só consulta** (DIREX, AUDITOR) não recebe lista de cargos com valor nenhum: a página só chama `cargosParaPosicao` quando mostra o formulário.
  - Risco residual, já aceito na D-P12-3: o Gestor vê o salário das posições do escopo, inclusive as que a GFIN lançou com a Fonte Ativa.
- **D-P15-6 (fechamento):** o PR da US-056 usa `Closes #78` (os três critérios ficam atendidos; a correspondência da C34 não é critério da #78). O PR da US-064 usa `Closes #86` (as cinco verificações da IA-03 ficam completas).
- **D-P15-7 (dependência):** a Task 1 só começa com o #408 na `main` (rebase antes). Se a assinatura mudar na revisão do #408, os Interfaces abaixo seguem o que entrar, e a frente A avisa na #138. A Task 2 depende da Task 1 (`cargo_id`).

## Review Focus

1. **Salário vazado:** a Fonte Ativa ou a faixa chegam a quem não tem `cad.salarios` (props de `cargosParaPosicao`, prévia, lista); o achado R5 aparece a quem não vê salário (inclusive pela marca `salario` perdida no Zod de `ultimaRevisao`); o salário, a faixa ou a direção vão na mensagem da IA. Teste em cada caminho.
2. **Cargo forjado:** `cargoId` inexistente, fora do formato, inativo numa escolha nova, sem Fonte Ativa, ou a troca de uma posição antiga para um cargo inativo. O servidor recusa com a mensagem da D-P15-2, sem gravar.
3. **Benefício contado duas vezes ou prévia ≠ gravado:** com cargo, os benefícios do cargo substituem os padrão; a prévia, a gravação da posição e o `recalcularExercicio` dão as mesmas linhas, com o adicional do cargo.
4. **Posição antiga em texto livre:** lista, alteração mantendo o texto, cópia de exercício, reimportação e revisor (fora de R4 e R5, com aviso) continuam funcionando.
5. **Limites da faixa e do ano:** salário igual ao mínimo ou ao máximo → sem achado; 0,01 abaixo ou acima → achado; cargo sem faixa → nenhum; ano sem premissas → R4 não roda e avisa, em vez de acusar todas as posições.

---

### Task 1: Cargo do cadastro na posição (US-056, #78)

**Files:**
- Migration: `prisma/migrations/<AAAAMMDDHHMM>_orc_posicao_cargo/migration.sql`, gerada depois do rebase:
  - `ALTER TABLE "orc_posicao" ADD COLUMN "cargo_id" UUID;`
  - `GRANT UPDATE ("cargo_id") ON "orc_posicao" TO sgo_app;` (soma ao GRANT por coluna da `202611101800_orc_posicao_tela`).
- Create:
  - `src/modules/orc/application/custo-posicao.ts`: o cache de cargos e o custo da posição com cargo (D-P15-3), usado por `posicoes.ts` e `calculo-linhas.ts`.
- Modify:
  - `prisma/schema/orc.prisma`: `cargoId String? @map("cargo_id") @db.Uuid` em `PosicaoOrcada`;
  - `src/modules/orc/application/deps.ts`: `listarCargosExercicio` e `beneficiosDoCargo` no grupo `custoPessoal`;
  - `src/modules/orc/application/calculo-linhas.ts`: `recalcularExercicio` pelo `custoDaPosicao`;
  - `src/modules/orc/application/posicoes.ts`: `cargoId` nas entradas, validação do cargo, `cargosParaPosicao`, `PosicaoTela` com o cargo, retrato com `cargoId` e `salarioDaFonte`;
  - `src/modules/orc/application/exercicios.ts`: a cópia leva `cargoId`;
  - `src/modules/orc/domain/mensagens.ts`: as mensagens das D-P15-1, 2, 3 e 5;
  - `src/modules/orc/ui/form-posicao.tsx`, `src/modules/orc/ui/tela-posicoes.tsx`, `src/app/(sistema)/orc/posicoes/page.tsx`;
  - `src/modules/orc/index.ts`.
- Test:
  - `src/modules/orc/application/posicoes.int.test.ts` (acréscimos);
  - `src/modules/orc/application/calculo-linhas.int.test.ts` (o recálculo com cargo);
  - `src/modules/orc/application/exercicios.int.test.ts` (a cópia);
  - `src/modules/orc/ui/paginas-posicoes.test.ts` e `bundle-cliente.test.ts`;
  - `e2e/orc/posicoes.spec.ts`.

**Interfaces:**
- Consumes (C2, #408): `listarCargosExercicio(tx, opcoes?: { incluirInativos?: boolean }): Promise<readonly CargoExercicio[]>` (default do `DepsOrc`: o do `@/modules/cad`, decifrado); `beneficiosDoCargo(tx, ano, cargoId): Promise<readonly BeneficioPremissa[]>`; `CargoExercicio`; `VALOR_MASCARADO`.
- Produces:
  - `DepsOrc['custoPessoal']` com `listarCargosExercicio: (tx: TxCliente, opcoes?: OpcoesCargosExercicio) => Promise<readonly CargoExercicio[]>` e `beneficiosDoCargo: typeof beneficiosDoCargo`. Os testes passam `custoPessoal: custoPessoalFalso(...)` como hoje.
  - `CacheCargos = { porId: ReadonlyMap<string, CargoExercicio>; beneficios: Map<string, readonly BeneficioPremissa[]> }`;
  - `carregarCargos(tx, deps): Promise<CacheCargos>` (com `incluirInativos: true`);
  - `custoDaPosicao(tx, deps, cache, premissas, p: { quantidade: number; salarioMensal: Dinheiro; mesInicio: number; mesSaida: number; cargoId: string | null }): Promise<Resultado<SerieMensalComponentes>>`. Com cargo: `{ ...premissas, beneficios: await beneficiosDoCargo(...) }` e `adicional: cargo.adicional ?? undefined`. Cargo fora do cache: `falha` com a mensagem da D-P15-3.
  - `OpcaoCargo = { id: string; codigo: string; nome: string; salarioFonteAtiva: string | null; faixa: { minimo: string; maximo: string } | null }` (texto canônico, nulos sem a permissão);
  - `cargosParaPosicao(ctx, deps?): Promise<{ cargos: readonly OpcaoCargo[]; comSalario: boolean }>`: só ativos com `salarioFonteAtiva` não nulo; exige `orc.posicoes` incluir ou alterar (senão `ErroPermissao`); com `comSalario`, um `CONSULTA` em `cad.salarios`;
  - `PosicaoTela` ganha `cargoId: string | null` e `cargoInativo: boolean`; `cargo` passa a ser o nome atual do cadastro quando há `cargoId`, e o texto gravado quando não há;
  - campo `cargoId` (string opcional, `''` = sem cargo) nos schemas `.strict()` de inclusão, alteração e prévia.

- [ ] **Step 1: testes de integração (falham)**, com `custoPessoal: custoPessoalFalso([premissasExemplo(ano)], cargosExemplo())`:
  - **inclusão com C001:** grava `cargo_id` = id do C001 e `cargo` = `'Analista de orçamento'` mesmo com outro texto no campo `cargo`; o `depois` do Histórico tem `cargoId` e `salarioDaFonte: true` com salário 7.500,00 e `false` com 8.000,00; a `descricao` não tem `7500` nem `8000`;
  - **inclusão sem cargo** → "Escolha o cargo do cadastro."; com o id do C003 → mensagem de sem Fonte Ativa; C004 → "Este cargo está inativo. Escolha outro."; `'00000000-0000-4000-8000-0000000000ff'` e `'abc'` → "Cargo não encontrado no cadastro."; nada gravado em nenhum dos casos;
  - **alteração:** posição IMPORTACAO sem cargo, alterada com `cargoId: ''` → mantém o texto e `cargo_id` nulo, e continua IMPORTACAO; ligada ao C001 → grava; depois disso, `cargoId: ''` → "Escolha o cargo do cadastro."; posição já em C004 alterada mantendo C004 → grava; trocar para C004 → recusa;
  - **motor (Review Focus 3):** com C002 (periculosidade), a série tem a linha `adicional` = 30 % do salário do mês; o total da linha `beneficio.*` de uma posição C001 é **igual** ao de uma posição sem cargo com os mesmos dados (substituição, não soma); com `beneficiosDoCargo: async () => []` no falso, a posição com cargo não tem linha `beneficio.*`; a prévia, a gravação e um `recalcularExercicio` depois dão as mesmas linhas para a mesma entrada;
  - **cópia de exercício:** a posição copiada mantém o `cargo_id`; **reimportação:** a posição TELA com cargo fica, e as importadas vêm com `cargo_id` nulo;
  - **`cargosParaPosicao` (Review Focus 1):** GFIN (com `cad.salarios`) recebe C001 e C002 com `salarioFonteAtiva` e `faixa`, sem C003 e C004, e grava um `CONSULTA` em `cad.salarios` com `depois.cargos = ['C001','C002']` e sem valores; Gestor (sem `cad.salarios`) recebe os mesmos ids com `salarioFonteAtiva: null` e `faixa: null`, sem `CONSULTA`; AUDITOR → `ErroPermissao`;
  - **lista:** a posição em C004 sai com `cargoInativo: true` e o nome do cadastro; a posição em texto livre sai com o texto; quem só consulta continua sem salário e sem anual (D-P12-3).
- [ ] **Step 2: rodar** `npm run test:int -- src/modules/orc/application/posicoes.int.test.ts` e conferir que falham pelos motivos esperados (coluna e campo inexistentes).
- [ ] **Step 3: implementar** a migration, o `custo-posicao.ts`, as mudanças em `deps.ts`, `calculo-linhas.ts`, `posicoes.ts` e `exercicios.ts`, e as mensagens. A validação do cargo roda dentro de `preparar` (gravação e prévia), com o cache de `carregarCargos` lido no mesmo `tx`.
- [ ] **Step 4: tela.**
  - A página chama `cargosParaPosicao` só quando mostra o formulário (incluir ou alterar, exercício editável) e passa `cargos` e `comSalario` ao `FormPosicao`.
  - O formulário troca o campo de texto do cargo por um seletor "Cargo do cadastro" (`name="cargoId"`, opções `<codigo> – <nome>`). Na alteração de posição sem cargo, a primeira opção é "Manter o cargo em texto: <texto>" (`value=""`) e o texto vai num `hidden` `cargo`; com cargo inativo, a opção dele aparece com "(inativo)".
  - Com `comSalario`, escolher o cargo preenche o salário pela regra da D-P15-2 e mostra "Fonte Ativa: R$ … · Faixa de mercado: R$ … a R$ …"; sem `comSalario`, o aviso da D-P15-5. O `cargoId` entra nos campos da prévia.
  - A lista mostra o nome e "(inativo)" quando for o caso.
  - O teste de bundle confere que o formulário não leva código de servidor.
- [ ] **Step 5: E2E** (`e2e/orc/posicoes.spec.ts`): o usuário GFIN do apoio do E2E escolhe um cargo e vê o salário preenchido e a faixa; `gestor.dep` escolhe um cargo, não vê a Fonte Ativa nem a faixa, digita o salário e grava; o banco fica como foi encontrado.
- [ ] **Step 6: verificações completas:** typecheck, lint, unidade, arquitetura, `test:int` de orc/aut/adm, build e E2E de `e2e/orc`, `e2e/adm`, `e2e/aut` e `e2e/seguranca`. Commit; PR `Closes #78`, labels `frente:A` e `migration`; revisão 12.12 por agente independente antes do merge.

### Task 2: R4 e R5 no revisor (US-064, #86)

**Files:**
- Modify:
  - `src/modules/orc/domain/revisor-regras.ts`: `TIPOS_REGRA`, `ROTULO_TIPO_ACHADO`, `AchadoRegra`, `LinkAchado`, `filtrarAchados` e as duas regras;
  - `src/modules/orc/application/revisor-processamento.ts`: `DepsRevisor.custoPessoal`, a leitura das posições para as regras, os achados, os avisos e o resumo para a IA;
  - `src/modules/orc/application/revisor.ts`: `salario` no schema `ACHADO`;
  - `src/modules/orc/domain/mensagens.ts`: os avisos da D-P15-4.
- Test:
  - `src/modules/orc/domain/revisor-regras.test.ts`;
  - `src/modules/orc/application/revisor.int.test.ts`;
  - o teste de bundle do worker (`worker/bundle.test.ts`, só rodar; o revisor não importa o index do `cad`).

**Interfaces:**
- Consumes: `cargo_id` de `orc_posicao` (Task 1); pelo `@/modules/cad/servidor`: `listarCargosExercicio`, `beneficiosDoCargo`, `obterPremissasExercicio`.
- Produces:
  - `TIPOS_REGRA` com `'POSICAO_SEM_BENEFICIO'` e `'SALARIO_FORA_DA_FAIXA'`; rótulos **[PROVISÓRIOS]** "Posições sem benefício" e "Salário fora da faixa do cargo";
  - `AchadoRegra` ganha `posicoes: readonly string[]` e `salario: boolean` (R1 a R3 com `[]` e `false`);
  - `LinkAchado` ganha `salario?: boolean`; `filtrarAchados` exige `alcance.salario` para link com `salario: true`;
  - `PosicaoRegra = { id: string; cc: string; cargoId: string; cargoNome: string; salarioMensal: Dinheiro }`;
  - `regraSemBeneficio(posicoes: readonly PosicaoRegra[], semBeneficio: ReadonlySet<string>): AchadoRegra[]` (o conjunto são os `cargoId` com `beneficiosDoCargo` vazio);
  - `regraForaDaFaixa(posicoes: readonly PosicaoRegra[], faixas: ReadonlyMap<string, { minimo: Dinheiro; maximo: Dinheiro } | null>): AchadoRegra[]`;
  - `DepsRevisor['custoPessoal'] = { listarCargosExercicio; beneficiosDoCargo; obterPremissasExercicio }` (os do `cad/servidor`; nos testes, `custoPessoalFalso(...)`).

- [ ] **Step 1: testes de unidade das regras (falham):**
  - **R5 nos limites** (C001, faixa 7.500,00–9.800,00): 7.500,00 e 9.800,00 → nenhum achado; 7.499,99 → um achado com "abaixo do mínimo"; 9.800,01 → "acima do máximo"; faixa nula → nenhum; o texto não contém `7.499,99`, `7.500,00` nem `9.800,00`; `salario: true`;
  - **R4:** duas posições do C001 e uma do C002, com `semBeneficio = {C001}` → um achado com as 2 posições do C001, em ordem de CC, `salario: false`; conjunto vazio → nenhum;
  - **`filtrarAchados`:** achado com link `{ tipo: 'posicao', salario: true }` some com `alcance.salario: false` e fica com `true`; achado R4 fica com `posicoes: true` e `salario: false`.
- [ ] **Step 2: testes de integração (falham)**, com `custoPessoal: custoPessoalFalso([premissasExemplo(ano)], cargosExemplo())` no `processarRevisao`:
  - uma posição C001 com 7.000,00 e uma C002 com 4.200,00 → um achado R5 só para a C001, com link `/orc/posicoes?ano=…&cc=…&editar=<id>` e `salario: true`;
  - com `{ ...custoPessoalFalso(...), beneficiosDoCargo: async (tx, ano, id) => (id === <id do C002> ? [] : falso.beneficiosDoCargo(tx, ano, id)) }` → um achado R4 só com a posição C002;
  - posição em C004 (inativo) fora da faixa → achado R5 (o cargo inativo continua avaliado);
  - duas posições sem `cargo_id` → nenhum achado R4/R5 para elas e o aviso com "2 posições";
  - ano sem premissas no falso (`custoPessoalFalso([])`) → nenhum achado R4 e o aviso da D-P15-4;
  - **IA (Review Focus 1):** com o caso ligado e o provedor falso, `provedor.chamadas[0]` contém "Posições com salário fora da faixa do cargo: POS-" e **não** contém `7.000,00`, `7000`, `7.500,00`, `9.800,00`, "abaixo" nem "acima"; sem `orc.posicoes:incluir`/`alterar` de quem pediu, a linha de R5 não vai; sem `orc.posicoes:consultar`, nem a de R4;
  - **tela (Review Focus 1):** `ultimaRevisao` para quem tem `orc.aprovacao:executar` e `orc.posicoes:consultar`, mas sem incluir nem alterar, não mostra o achado R5 e mostra o R4; com `orc.posicoes:alterar`, mostra os dois;
  - os testes do P14 (R1 a R3, erros de IA, revisão parada, minimização) continuam passando.
- [ ] **Step 3: rodar** `npm test -- src/modules/orc/domain/revisor-regras.test.ts` e `npm run test:int -- src/modules/orc/application/revisor.int.test.ts`; esperado: FAIL nos casos novos.
- [ ] **Step 4: implementar.**
  - Uma leitura `{ id, cc, cargoId, salarioMensal }` das posições com `cargo_id` só para as regras; a leitura que monta `posicoesIa` continua sem `salarioMensal`.
  - Os cargos vêm de um `listarCargosExercicio(c, { incluirInativos: true })`; os benefícios, de um `beneficiosDoCargo` por cargo distinto, depois de conferir as premissas do ano.
  - Os achados R4 e R5 entram em `parcial.achados` junto com R1 a R3, antes da IA, para não se perderem num erro posterior.
  - O resumo para a IA segue a D-P15-4, com os apelidos `POS-n`.
- [ ] **Step 5: rodar os testes do Step 3** (PASS) e as verificações completas: typecheck, lint, unidade, arquitetura (inclui a fronteira da IA), `test:int` de orc/aut/adm, o `worker/bundle.test.ts`, build e E2E de `e2e/orc` (o `revisor.spec.ts` do P14 continua passando). Commit; PR `Closes #86`, label `frente:A` (sem migration); revisão 12.12 por agente independente antes do merge.

### Ordem

- **#408 na `main` → Task 1 → Task 2**, uma branch e um PR por história:
  - `us-056-cargo-cs`;
  - `us-064-regras-pessoal`.
- O PR da Task 1 tem migration: entra sozinho na fila de migrations (§12.7, item 3).
- A frente A avisa na #138 quando cada PR abrir e quando entrar, e confirma que não há pedido novo ao `cad`.
