# P15 Cargo do C&S nas posições e regras de pessoal no revisor (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avançar as duas histórias que o P12 e o P14 deixaram abertas por falta do cadastro de C&S:
- US-056 (#78): a posição de pessoal pode escolher o **cargo do cadastro de C&S**, com o salário sugerido pela Fonte Ativa e editável (C24); o custo passa a usar os benefícios e o adicional do cargo. Na trilha 2027, o texto livre continua aceito (C34);
- US-064 (#86): o revisor ganha as regras **R4, posição sem benefício**, e **R5, salário fora da faixa do cargo** (IA-03, §6.8).

**Architecture:**
- **Contrato da frente B:** o acréscimo de C&S ao C2 (#408, head `34ee18d`, combinado na #138 em 11/11). Nenhuma mudança no `cad`.
  - `@/modules/cad/servidor` (e o index): `listarCargosSemSalarioCifrado(tx, { incluirInativos? })`. A Fonte Ativa cifrada (REAL, DEFINIDO, TOTAL) sai com `salarioFonteAtiva: null`; nome, `ativo`, faixa, adicional e as fontes de mercado saem normais. **Não depende da chave.**
  - `@/modules/cad` (só o index, app): `listarCargosExercicio(tx, { incluirInativos? })`, com o salário **decifrado**. Precisa da chave; sem ela, `ErroDominio('cad.cifra_indisponivel')`.
  - `beneficiosDoCargo(tx, ano, cargoId): Promise<BeneficiosCargo>`, com `BeneficiosCargo = { beneficios: readonly BeneficioPremissa[]; avisos: readonly string[] }`; ano sem parâmetros → `{ beneficios: [], avisos: [] }`.
  - Falsos: `cargosExemplo()` e `custoPessoalFalso(premissas, cargos)`, com os três métodos.
- **Cifra só onde o salário é mostrado ou comparado:** o motor, os nomes, o `ativo`, a lista e o revisor usam `listarCargosSemSalarioCifrado`. A versão decifrada entra só em `cargosParaPosicao` e na recusa "sem Fonte Ativa", importada com `await import('@/modules/cad')` dentro da função. Assim o `orc` continua sem a cifra no caminho da seed, da importação e do worker.
- **Vínculo por id, sem FK** (§12.7, item 1: `cargo` é tabela da frente B): coluna `cargo_id uuid NULL` em `orc_posicao`. O texto `cargo` continua obrigatório: com cargo, guarda o nome do cadastro cortado em 120 caracteres; sem cargo, é o texto livre (C34).
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

- Português do Brasil; marca neutra; dinheiro em `Dinheiro`/`NUMERIC(15,2)` com Half-Even, nunca `number`. A comparação com a faixa usa só `Dinheiro.comparar`.
- Toda Server Action e toda página passam pela guarda; escopo e cargo conferidos **no servidor** (R8).
- Toda escrita grava o Histórico na mesma transação, começa por `travarExercicio` e sobe a versão do exercício (regras do P11 e do P12, que continuam valendo).
- **Salário:** o da posição segue a D-P12-3; o da Fonte Ativa e a faixa de mercado seguem a R24 (D-P15-5). Nenhum dos dois vai à IA, a log, à `descricao` ou ao `depois` do Histórico, nem ao texto de um achado.
- Os testes usam `custoPessoalFalso(premissas, cargos)` e `cargosExemplo()` do `@/modules/cad`: C001 com faixa 7.500,00–9.800,00 e Fonte Ativa MÍNIMO; C002 com periculosidade; C003 sem Fonte Ativa; C004 inativo. Os stubs de `beneficiosDoCargo` devolvem `{ beneficios, avisos }`. O falso só aparece em arquivos de teste.
- **Nada grava direto nas tabelas da frente B**, nem no E2E.
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez (D12). Só arquivos da frente A; nenhum toque no `worker/index.ts` (o registro do revisor já existe, #395).
- **Banco (regra 3):** a seed no dev local **escreve** no `127.0.0.1:55432`. Antes, conferir a `DATABASE_URL` e a `SHADOW_DATABASE_URL`.

## Decisões deste plano (recomendação; o PO autorizou seguir as recomendações; a C34 não muda)

- **D-P15-1 (vínculo e trilha 2027):**
  - Coluna `cargo_id uuid NULL` em `orc_posicao`, sem FK (§12.7), com GRANT de UPDATE da coluna ao `sgo_app`. Nenhum CHECK novo: uma posição IMPORTACAO alterada pela tela pode ganhar cargo e continua IMPORTACAO (D-P12-7).
  - **Inclusão pela tela, durante a trilha 2027:** aceita **cargo do cadastro ou texto livre** (C34). O seletor "Cargo do cadastro" vem primeiro, e a opção "Outro cargo (texto livre)" abre o campo de texto. Sem nenhum cargo utilizável, só o texto livre aparece, com o aviso "Não há cargo do cadastro disponível; informe o cargo em texto." **[PROVISÓRIO]**.
  - **Com cargo:** o servidor grava em `cargo` o nome do cadastro cortado em 120 caracteres, **antes** de `validarDados`, e ignora o texto que vier do formulário.
  - **Posições antigas** (texto livre, importadas, copiadas ou da tela do P12): `cargo_id` nulo, continuam válidas, com o custo de hoje (padrão de benefícios, sem adicional). Na alteração, a opção "Manter o cargo em texto: <`p.cargo` gravado>" preserva o texto; escolher um cargo liga a posição.
  - **Importação** continua em texto livre e grava `cargo_id` nulo (C34). A **cópia de exercício** copia o `cargo_id`.
  - **Pendência:** a exigência do cargo do cadastro na tela fica para depois da tela de correspondência texto → cargo da C34. A tela vira issue própria, que a frente A cria com o ok do PO (regra 5).
- **D-P15-2 (salário ao escolher o cargo):**
  - **Sugerido, editável:** para quem pode ver (D-P15-5), escolher o cargo preenche o salário com a Fonte Ativa, e a pessoa pode mudar. Trocar de cargo troca o salário só se o campo estiver vazio ou ainda igual à Fonte Ativa do cargo anterior.
  - **Registro (C24):** o `depois` do Histórico ganha só o `cargoId`. O salário gravado já está no `antes`/`depois` (D-P12-4, mascarado na consulta); nenhum campo diz se ele é igual à Fonte Ativa, porque isso revelaria a Fonte Ativa a quem só vê o salário da posição.
  - **Recusas só quando o `cargoId` muda** (inclusão, ou alteração para um `cargoId` diferente do gravado):
    - cargo inativo → "Este cargo está inativo. Escolha outro." **[PROVISÓRIO]**;
    - cargo sem Fonte Ativa (`salarioFonteAtiva` nulo pela versão decifrada) → "Este cargo está sem salário na Fonte Ativa. Escolha outro ou peça ao GRH para completar o cadastro." **[PROVISÓRIO]**;
    - id inexistente ou fora do formato → "Cargo não encontrado no cadastro." **[PROVISÓRIO]** (vale sempre).
    O mesmo `cargoId` já gravado passa, mesmo inativo ou sem Fonte Ativa. A prévia recebe o `id` opcional da posição para aplicar a mesma regra.
  - **Sem a chave** (`cad.cifra_indisponivel` na versão decifrada): a tela continua funcionando, com a lista sem sugestão e o aviso "O salário da Fonte Ativa está indisponível no momento. Informe o salário mensal." **[PROVISÓRIO]**. A recusa "sem Fonte Ativa" passa a olhar só `fonteAtiva !== null`.
  - **Cargo inativo na lista:** fica fora da escolha nova. A posição que já aponta para ele mostra o nome com "(inativo)".
- **D-P15-3 (motor de custo, sem contar duas vezes):**
  - O `calcularCustoPosicao` (C33) soma `premissas.beneficios`, que hoje são os "padrão da posição" da Tabela Mestre. O `beneficiosDoCargo` é a escolha do cargo **sobre a mesma** Tabela Mestre. Por isso, com cargo, o motor recebe `{ ...premissas, beneficios: r.beneficios, avisos: [...premissas.avisos, ...r.avisos] }`: os benefícios são **substituídos**, nunca somados.
  - Com cargo, entra também `adicional: cargo.adicional` (§6.4). Sem cargo, o cálculo de hoje.
  - Os avisos do cargo entram no `ResumoRecalculo.avisos`, sem repetir.
  - Vale em todo lugar que chama o motor: prévia, gravação e `recalcularExercicio` (importação, cópia, "Recalcular"). O cálculo faz uma leitura de cargos e um `beneficiosDoCargo` por cargo distinto, com cache por chamada.
  - A escolha de benefícios do cargo sobe a versão das premissas do ano (R10), então a D-P12-5 já cobre. A troca do **adicional** no cadastro não sobe a versão, e as posições gravadas só mudam no próximo recálculo do exercício. Risco aceito, registrado no PR.
  - `cargo_id` ausente de `listarCargosSemSalarioCifrado({ incluirInativos: true })` (o `cad` não apaga cargo): `ErroRecalculo` "CC <cc>, cargo <cargo>: o cargo não está mais no cadastro." **[PROVISÓRIO]**.
- **D-P15-4 (regras novas do revisor, sem IA, com `Dinheiro`):**
  - **R4, posição sem benefício:** posição com `cargo_id` cujo `beneficiosDoCargo(ano, cargoId).beneficios.length === 0`. Gera um achado **por cargo**, com links para as posições dele em ordem de CC. Só roda se o ano tem premissas; sem elas, aviso "O exercício <ano> não tem premissas; a regra de benefícios não rodou." **[PROVISÓRIO]**.
  - **R5, salário fora da faixa:** salário mensal da posição **menor** que `faixa.minimo` ou **maior** que `faixa.maximo`; o valor igual ao limite está dentro. Um achado por posição. Cargo sem faixa não gera achado. Cargo inativo continua avaliado (`incluirInativos: true`). O salário comparado é o mensal gravado, sem reajuste.
  - **Posição sem `cargo_id`:** fica fora das duas. O aviso "<n> posições sem cargo do cadastro ficaram fora das regras de benefício e de faixa salarial." **[PROVISÓRIO]** é gravado com a marca de que exige `orc.posicoes:consultar` e só aparece a quem a tem (B3).
  - **Textos sem valor** **[PROVISÓRIOS]**: R4 "Cargo <nome>: <n> posição(ões) sem benefício no exercício (o cargo não tem benefício ativo)."; R5 "CC <cc>, cargo <nome>: salário mensal abaixo do mínimo da faixa de mercado do cargo." ou "… acima do máximo …". Nunca o salário, a faixa nem a diferença.
  - **Máscara na tela:** os links de R4 e R5 são do tipo `posicao`. Os de R5 levam `salario: true`, e o `filtrarAchados` exige para eles `alcance.salario` (D-P12-3) **e** `alcance.salariosCargo` (`cad.salarios:consultar`, R24). O schema `ACHADO` de `ultimaRevisao` aceita `salario`; sem isso, o Zod descartaria a marca na leitura.
  - **IA:**
    - a linha da R5 **não vai** à IA;
    - a R4 vai como "Posições sem benefício: POS-1, POS-3", só se quem pediu tem `orc.posicoes:consultar`;
    - todo link de achado da IA que cita uma posição do conjunto da R5 recebe `salario: true`, para o mesmo filtro;
    - as posições continuam indo sem salário, e o nome do cargo do cadastro substitui o texto quando há `cargo_id`.
  - **Worker:** o revisor usa `listarCargosSemSalarioCifrado` e `beneficiosDoCargo` do `@/modules/cad/servidor` (sem a chave). O salário da posição é lido do `orc_posicao` numa leitura **só para as regras**, separada da que monta a mensagem da IA.
- **D-P15-5 (máscara na tela: D-P12-3 e R24 juntas):**
  - A Fonte Ativa e a faixa de mercado são dado de `cad.salarios` (R24; o `mascararHistoricoCad` já mascara `mercadoMinimo`). O servidor só os manda a quem tem `orc.posicoes` com incluir ou alterar (D-P12-3) **e** `cad.salarios:consultar` (R24). Pelos perfis padrão, é a GFIN.
  - Cada leitura com salário grava um `CONSULTA` na funcionalidade `cad.salarios`, com os códigos dos cargos e sem valores, como o `listarCargos` do `cad`.
  - **Sem `cad.salarios`:** a lista vem só com código, nome e `ativo`, e a pessoa digita o salário, com o aviso "O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal." **[PROVISÓRIO]**. A R5 do revisor pega o salário fora da faixa.
  - **Quem só consulta** (DIREX, AUDITOR) não recebe lista de cargos: a página só chama `cargosParaPosicao` quando mostra o formulário.
  - Risco residual, já aceito na D-P12-3: o Gestor vê o salário das posições do escopo, inclusive as que a GFIN lançou com a Fonte Ativa.
- **D-P15-6 (para o PO):**
  - **O Gestor de Diretoria não recebe a sugestão da Fonte Ativa.** Dar `cad.salarios:consultar` a ele, pela tela de perfis, resolveria, mas **abre todos os salários do cadastro** de cargos, não só os do escopo. O plano não recomenda.
  - **Reimportação:** uma posição IMPORTACAO ligada a um cargo pela tela é substituída numa nova importação do CC (D-P12-7) e perde o vínculo. A importação avisa "<n> posições ligadas a cargo do cadastro serão substituídas por esta importação." **[PROVISÓRIO]**, no relatório e no Histórico dela. Risco registrado.
  - A exigência do cargo do cadastro na tela espera a tela de correspondência (D-P15-1).
- **D-P15-7 (fechamento):**
  - o PR da US-056 usa `Refs #78`: o texto livre continua aceito na trilha, e o critério da Fonte Ativa fica atendido só para quem tem `cad.salarios:consultar`;
  - o PR da US-064 usa `Closes #86`: as cinco verificações da IA-03 ficam completas.
- **D-P15-8 (dependência):** a Task 1 só começa com o #408 na `main` (rebase antes). Se a assinatura mudar de novo, os Interfaces abaixo seguem o que entrar, e a frente A avisa na #138. A Task 2 depende da Task 1 (`cargo_id`).

## Review Focus

1. **Salário vazado:**
   - a Fonte Ativa ou a faixa chegam a quem não tem `cad.salarios` (props de `cargosParaPosicao`, prévia, lista, `depois` do Histórico);
   - o achado R5, ou um achado de IA sobre posição da R5, aparece a quem não vê salário ou não tem `cad.salarios` (inclusive pela marca `salario` perdida no Zod de `ultimaRevisao`);
   - o salário, a faixa, a direção ou a linha da R5 vão na mensagem da IA.
   Teste em cada caminho.
2. **Cargo forjado ou trocado:** `cargoId` inexistente ou fora do formato; troca para cargo inativo ou sem Fonte Ativa. O servidor recusa sem gravar, e o mesmo `cargoId` já gravado continua passando.
3. **Benefício contado duas vezes ou prévia ≠ gravado:** com cargo, os benefícios do cargo substituem os padrão. A prévia, a gravação e o `recalcularExercicio` dão as mesmas linhas, com o adicional do cargo, e os avisos do cargo chegam ao resumo.
4. **Sem chave ou sem cargo:** sem a chave da cifra, a tela, a seed, a importação e o worker continuam funcionando. Posições em texto livre passam por lista, alteração, cópia, reimportação e revisor (fora de R4 e R5, com aviso).
5. **Limites da faixa e do ano:** salário igual ao mínimo ou ao máximo → sem achado; 0,01 abaixo ou acima → achado; cargo sem faixa → nenhum; ano sem premissas → R4 não roda e avisa, em vez de acusar todas as posições.

---

### Task 1: Cargo do cadastro na posição (US-056, #78)

**Files:**
- Migration: `prisma/migrations/<AAAAMMDDHHMM>_orc_posicao_cargo/migration.sql`, gerada depois do rebase:
  - `ALTER TABLE "orc_posicao" ADD COLUMN "cargo_id" UUID;`
  - `GRANT UPDATE ("cargo_id") ON "orc_posicao" TO sgo_app;`, que soma ao GRANT por coluna da `202611101800_orc_posicao_tela`.
- Create:
  - `src/modules/orc/application/custo-posicao.ts`: o cache de cargos e o custo da posição com cargo (D-P15-3), usado por `posicoes.ts` e `calculo-linhas.ts`.
- Modify:
  - `prisma/schema/orc.prisma`: `cargoId String? @map("cargo_id") @db.Uuid` em `PosicaoOrcada`;
  - `src/modules/orc/application/deps.ts`: no grupo `custoPessoal`, `listarCargosSemSalarioCifrado` e `beneficiosDoCargo`, com padrão do `@/modules/cad/servidor`;
  - `src/modules/orc/application/calculo-linhas.ts`: `recalcularExercicio` pelo `custoDaPosicao`, com os avisos do cargo;
  - `src/modules/orc/application/posicoes.ts`: `cargoId` nas entradas, nome do cadastro antes de `validarDados`, validação do cargo (D-P15-2), `cargosParaPosicao`, `PosicaoTela` com o cargo e retrato com `cargoId`;
  - `src/modules/orc/application/importacao.ts`: o aviso das posições ligadas a cargo (D-P15-6);
  - `src/modules/orc/application/exercicios.ts`: a cópia leva `cargoId`;
  - `src/modules/orc/domain/mensagens.ts`: as mensagens das D-P15-1, 2, 3, 5 e 6;
  - `src/modules/orc/ui/form-posicao.tsx`, `src/modules/orc/ui/tela-posicoes.tsx`, `src/app/(sistema)/orc/posicoes/page.tsx`;
  - `src/modules/orc/index.ts`;
  - `e2e/aut/apoio.ts`: o usuário `grh.orc` (ANALISTA_GRH) do E2E.
- Test:
  - `src/modules/orc/application/posicoes.int.test.ts` (acréscimos);
  - `src/modules/orc/application/calculo-linhas.int.test.ts` (o recálculo com cargo);
  - `src/modules/orc/application/exercicios.int.test.ts` (a cópia) e `importacao.int.test.ts` (o aviso);
  - `src/modules/orc/infrastructure/privilegios.int.test.ts` (UPDATE de `cargo_id` pelo `sgo_app`; `origem` continua negado);
  - `src/modules/orc/ui/paginas-posicoes.test.ts` e `bundle-cliente.test.ts`;
  - `e2e/orc/posicoes.spec.ts`.

**Interfaces:**
- Consumes (C2, #408):
  - `listarCargosSemSalarioCifrado(tx, opcoes?: OpcoesCargosExercicio): Promise<readonly CargoExercicio[]>`, de `@/modules/cad/servidor`;
  - `listarCargosExercicio`, do mesmo formato, só de `@/modules/cad`, por `await import`;
  - `beneficiosDoCargo(tx, ano, cargoId): Promise<BeneficiosCargo>`;
  - `CargoExercicio`, `BeneficiosCargo`.
- Produces:
  - `DepsOrc['custoPessoal']` com `listarCargosSemSalarioCifrado` e `beneficiosDoCargo`. Os testes passam `custoPessoal: custoPessoalFalso(...)` como hoje.
  - `DepsOrc.cargosDecifrados?: (tx, opcoes?) => Promise<readonly CargoExercicio[]>`. É opcional: sem ele, `cargosParaPosicao` e a validação fazem `(await import('@/modules/cad')).listarCargosExercicio`. Os testes injetam `custoPessoalFalso().listarCargosExercicio`, ou um que lança `ErroDominio('cad.cifra_indisponivel', …)`.
  - `CacheCargos = { porId: ReadonlyMap<string, CargoExercicio>; beneficios: Map<string, BeneficiosCargo> }`.
  - `carregarCargos(tx, deps): Promise<CacheCargos>`, com `incluirInativos: true` e sem a cifra.
  - `custoDaPosicao(tx, deps, cache, premissas, p: { quantidade: number; salarioMensal: Dinheiro; mesInicio: number; mesSaida: number; cargoId: string | null }): Promise<Resultado<SerieMensalComponentes>>`. Cargo fora do cache → `falha` com a mensagem da D-P15-3.
  - `OpcaoCargo = { id: string; codigo: string; nome: string; salarioFonteAtiva: string | null; faixa: { minimo: string; maximo: string } | null }`, em texto canônico, com nulos sem a permissão ou sem a chave.
  - `cargosParaPosicao(ctx, deps?): Promise<{ cargos: readonly OpcaoCargo[]; comSalario: boolean; aviso: string | null }>`:
    - lista os ativos com `fonteAtiva` não nula;
    - exige `orc.posicoes` incluir ou alterar, senão `ErroPermissao`;
    - com `comSalario`, grava um `CONSULTA` em `cad.salarios`;
    - sem a chave, sai com `comSalario: false` e o aviso da D-P15-2.
  - `PosicaoTela` ganha `cargoId: string | null` e `cargoInativo: boolean`. O `cargo` passa a ser o nome atual do cadastro quando há `cargoId`, e o texto gravado quando não há.
  - O campo `cargoId` (string opcional; `''` = texto livre) entra nos schemas `.strict()` de inclusão, alteração e prévia; a prévia ganha `id` opcional.

- [ ] **Step 1: testes de integração (falham)**, com `custoPessoal: custoPessoalFalso([premissasExemplo(ano)], cargosExemplo())`:
  - **inclusão com C001:** grava `cargo_id` = id do C001 e `cargo` = `'Analista de orçamento'`, mesmo com outro texto no campo `cargo`. O `depois` do Histórico tem `cargoId` e nenhuma chave além das do retrato (sem `salarioDaFonte`). A `descricao` não tem o salário.
  - **nome longo (M8):** com um cargo de nome com 130 caracteres no falso, a inclusão grava os 120 primeiros, sem erro de validação do cargo.
  - **inclusão em texto livre:** `cargoId: ''` e `cargo: 'Analista temporário'` → grava com `cargo_id` nulo (C34).
  - **recusas na inclusão:** C003 → mensagem de sem Fonte Ativa; C004 → "Este cargo está inativo. Escolha outro."; `'00000000-0000-4000-8000-0000000000ff'` e `'abc'` → "Cargo não encontrado no cadastro.". Nada gravado em nenhum caso.
  - **alteração (M3):**
    - posição IMPORTACAO em texto livre, alterada com `cargoId: ''` → mantém o texto e continua IMPORTACAO;
    - ligada ao C001 → grava;
    - posição já em C004 (inativo), alterada mantendo C004 → grava;
    - posição já em C003 (sem Fonte Ativa), mantendo C003 → grava;
    - troca para C004 ou C003 → recusa;
    - a prévia com o `id` da posição em C004 calcula, e sem o `id` recusa.
  - **sem a chave:** com `cargosDecifrados` que lança `cad.cifra_indisponivel`, `cargosParaPosicao` devolve a lista com `comSalario: false` e o aviso; a inclusão com C001 grava; a com C003 recusa (`fonteAtiva` nula).
  - **motor (Review Focus 3):**
    - com C002 (periculosidade), a série tem a linha `adicional` = 30 % do salário do mês;
    - a linha `beneficio.*` de uma posição C001 é **igual** à de uma posição sem cargo com os mesmos dados (substituição, não soma);
    - com `beneficiosDoCargo: async () => ({ beneficios: [], avisos: ['aviso do cargo'] })`, a posição com cargo não tem linha `beneficio.*`, e `recalcularExercicio` devolve `'aviso do cargo'` em `avisos`, uma vez;
    - a prévia, a gravação e um `recalcularExercicio` depois dão as mesmas linhas para a mesma entrada.
  - **cópia e importação:**
    - a cópia de exercício mantém o `cargo_id`;
    - a reimportação mantém a posição TELA com cargo, e as importadas vêm com `cargo_id` nulo;
    - uma posição IMPORTACAO ligada a C001, reimportada, gera o aviso da D-P15-6 com "1 posição" no relatório e no Histórico (M4).
  - **`cargosParaPosicao` (Review Focus 1):**
    - a GFIN (com `cad.salarios`) recebe C001 e C002 com `salarioFonteAtiva` e `faixa`, sem C003 e C004, e grava um `CONSULTA` em `cad.salarios` com `depois.cargos = ['C001','C002']` e sem valores;
    - o Gestor (sem `cad.salarios`) recebe os mesmos ids com `salarioFonteAtiva: null` e `faixa: null`, sem `CONSULTA`;
    - o AUDITOR recebe `ErroPermissao`.
  - **lista:** a posição em C004 sai com `cargoInativo: true` e o nome do cadastro; a posição em texto livre sai com o texto; quem só consulta continua sem salário e sem anual (D-P12-3).
  - **privilégios:** o `sgo_app` faz UPDATE de `cargo_id` e continua sem UPDATE de `origem`.
- [ ] **Step 2: rodar** `npm run test:int -- src/modules/orc/application/posicoes.int.test.ts`. Esperado: FAIL pelos motivos previstos (coluna e campo inexistentes).
- [ ] **Step 3: implementar** a migration, o `custo-posicao.ts` e as mudanças em `deps.ts`, `calculo-linhas.ts`, `posicoes.ts`, `importacao.ts` e `exercicios.ts`, além das mensagens.
  - A troca do nome pelo do cadastro e a validação do cargo rodam em `preparar` (gravação e prévia), **antes** de `validarDados`, com o cache de `carregarCargos` lido no mesmo `tx`.
  - A versão decifrada só é chamada quando o `cargoId` muda e quando a página pede `cargosParaPosicao`.
- [ ] **Step 4: tela.**
  - A página chama `cargosParaPosicao` só quando mostra o formulário (incluir ou alterar, com o exercício editável) e passa `cargos`, `comSalario` e `aviso` ao `FormPosicao`.
  - **Seletor "Cargo do cadastro"** (`name="cargoId"`, opções `<codigo> – <nome>`):
    - a opção "Outro cargo (texto livre)" (`value=""`) mostra o campo `cargo`;
    - na alteração de posição sem cargo, essa opção vem marcada e o campo traz o `p.cargo` gravado (B2), com o rótulo "Manter o cargo em texto";
    - o cargo inativo da posição aparece com "(inativo)".
  - **Salário:**
    - com `comSalario`, escolher o cargo preenche o salário pela regra da D-P15-2 e mostra "Fonte Ativa: R$ … · Faixa de mercado: R$ … a R$ …";
    - sem `comSalario`, aparece o aviso da D-P15-5 ou o da chave.
  - O `cargoId` e o `id` entram nos campos da prévia.
  - A lista mostra o nome e "(inativo)" quando for o caso.
  - O teste de bundle confere que o formulário não leva código de servidor.
- [ ] **Step 5: E2E** (`e2e/orc/posicoes.spec.ts`; M7). O cargo utilizável é feito **pela tela do `cad`**:
  - o usuário novo `grh.orc` (perfil ANALISTA_GRH, que tem `cad.cargos:alterar` e `cad.salarios`) abre `/cad/cargos`, escolhe um cargo da seed e cadastra o mínimo e o máximo de mercado e a Fonte Ativa MÍNIMO;
  - `gfin.orc` escolhe esse cargo na posição e vê o salário preenchido e a faixa;
  - `gestor.dep` escolhe o mesmo cargo, não vê a Fonte Ativa nem a faixa, digita o salário e grava;
  - `gestor.dep` também inclui uma posição em texto livre;
  - no fim, o `grh.orc` desfaz o cadastro pela mesma tela, as posições são excluídas pela tela, e o banco fica como foi encontrado.
- [ ] **Step 6: verificações completas:**
  - typecheck, lint, unidade, arquitetura;
  - `test:int` de orc/aut/adm, mais `src/modules/rel/infrastructure/orcamento-sintetico.int.test.ts` (a importação real sem a chave) e `worker/bundle.test.ts`;
  - a seed no dev local (**escreve** no `127.0.0.1:55432`; conferir antes a `DATABASE_URL` e a `SHADOW_DATABASE_URL`);
  - build e E2E de `e2e/orc`, `e2e/adm`, `e2e/aut` e `e2e/seguranca`.
  Depois, commit e PR `Refs #78`, labels `frente:A` e `migration`, com revisão 12.12 por agente independente antes do merge.

### Task 2: R4 e R5 no revisor (US-064, #86)

**Files:**
- Modify:
  - `src/modules/orc/domain/revisor-regras.ts`: `TIPOS_REGRA`, `ROTULO_TIPO_ACHADO`, `AchadoRegra`, `LinkAchado`, `AlcanceRevisao`, `filtrarAchados` e as duas regras;
  - `src/modules/orc/application/revisor-processamento.ts`: `DepsRevisor.custoPessoal`, a leitura das posições para as regras, os achados, os avisos, o resumo para a IA e a marca `salario` nos links da IA;
  - `src/modules/orc/application/revisor.ts`: `salario` no schema `ACHADO`, `salariosCargo` no `alcance`, e o filtro dos avisos (B3);
  - `src/modules/orc/domain/mensagens.ts`: os avisos da D-P15-4.
- Test:
  - `src/modules/orc/domain/revisor-regras.test.ts`;
  - `src/modules/orc/application/revisor.int.test.ts`;
  - `worker/bundle.test.ts` (só rodar; o revisor não importa o index do `cad`).

**Interfaces:**
- Consumes: `cargo_id` de `orc_posicao` (Task 1). Do `@/modules/cad/servidor`: `listarCargosSemSalarioCifrado`, `beneficiosDoCargo` e `obterPremissasExercicio`.
- Produces:
  - `TIPOS_REGRA` com `'POSICAO_SEM_BENEFICIO'` e `'SALARIO_FORA_DA_FAIXA'`, e os rótulos **[PROVISÓRIOS]** "Posições sem benefício" e "Salário fora da faixa do cargo";
  - `AchadoRegra` ganha `posicoes: readonly string[]` e `salario: boolean` (R1 a R3 com `[]` e `false`);
  - `LinkAchado` ganha `salario?: boolean`;
  - `AlcanceRevisao` ganha `salariosCargo: boolean` (`cad.salarios:consultar`). O `filtrarAchados` exige `salario && salariosCargo` para link com `salario: true`;
  - a coluna `avisos` continua `text[]` (**sem migration**). O aviso que exige `orc.posicoes:consultar` é gravado com o prefixo fixo `AVISO_SO_POSICOES = '[posicoes] '`. O `ultimaRevisao` o remove na leitura e descarta o aviso para quem não tem a permissão. As revisões antigas não têm o prefixo e saem como estão;
  - `PosicaoRegra = { id: string; cc: string; cargoId: string; cargoNome: string; salarioMensal: Dinheiro }`;
  - `regraSemBeneficio(posicoes: readonly PosicaoRegra[], semBeneficio: ReadonlySet<string>): AchadoRegra[]`, em que o conjunto são os `cargoId` com `beneficios.length === 0`;
  - `regraForaDaFaixa(posicoes: readonly PosicaoRegra[], faixas: ReadonlyMap<string, { minimo: Dinheiro; maximo: Dinheiro } | null>): AchadoRegra[]`;
  - `DepsRevisor['custoPessoal'] = { listarCargosSemSalarioCifrado; beneficiosDoCargo; obterPremissasExercicio }`: os do `cad/servidor`; nos testes, `custoPessoalFalso(...)`.

- [ ] **Step 1: testes de unidade das regras (falham):**
  - **R5 nos limites** (C001, faixa 7.500,00–9.800,00):
    - 7.500,00 e 9.800,00 → nenhum achado;
    - 7.499,99 → um achado com "abaixo do mínimo";
    - 9.800,01 → um achado com "acima do máximo";
    - faixa nula → nenhum;
    - o texto não contém `7.499,99`, `7.500,00` nem `9.800,00`, e o achado tem `salario: true`.
  - **R4:** duas posições do C001 e uma do C002, com `semBeneficio = {C001}` → um achado com as 2 posições do C001, em ordem de CC, e `salario: false`. Conjunto vazio → nenhum achado.
  - **`filtrarAchados`:** achado com link `{ tipo: 'posicao', salario: true }` só fica com `salario` **e** `salariosCargo`; some com só um dos dois. Achado R4 fica com `posicoes: true` e os dois falsos.
- [ ] **Step 2: testes de integração (falham)**, com `custoPessoal: custoPessoalFalso([premissasExemplo(ano)], cargosExemplo())` no `processarRevisao`:
  - uma posição C001 com 7.000,00 e uma C002 com 4.200,00 → um achado R5 só para a C001, com link `/orc/posicoes?ano=…&cc=…&editar=<id>` e `salario: true`;
  - com `{ ...falso, beneficiosDoCargo: async (tx, ano, id) => (id === <id do C002> ? { beneficios: [], avisos: [] } : falso.beneficiosDoCargo(tx, ano, id)) }` → um achado R4 só com a posição C002;
  - posição em C004 (inativo) fora da faixa → achado R5;
  - duas posições sem `cargo_id` → nenhum achado R4 ou R5 para elas, e o aviso com "2 posições";
  - `custoPessoalFalso([])` (ano sem premissas) → nenhum achado R4, com o aviso da D-P15-4;
  - **IA (Review Focus 1; M6):**
    - com o caso ligado e o provedor falso, `provedor.chamadas[0]` contém "Posições sem benefício: POS-";
    - a mesma chamada **não** contém "faixa", `7.000,00`, `7000`, `7.500,00`, `9.800,00`, "abaixo" nem "acima";
    - sem `orc.posicoes:consultar` de quem pediu, a linha da R4 também não vai;
    - o roteiro devolve um achado de IA que cita o apelido da posição R5 e outro que cita uma posição fora da R5: o primeiro tem o link com `salario: true`, e o segundo não;
  - **tela (Review Focus 1; B3, B4):** com `orc.aprovacao:executar` e `orc.posicoes:consultar`, `ultimaRevisao`:
    - sem incluir nem alterar → não mostra o achado R5 nem o achado de IA da posição R5, e mostra o R4 e o aviso das posições sem cargo;
    - com `orc.posicoes:alterar` mas sem `cad.salarios` → também não mostra o R5;
    - com os dois → mostra o R5;
    - sem `orc.posicoes:consultar` → não mostra o aviso das posições sem cargo;
  - os testes do P14 (R1 a R3, erros de IA, revisão parada, minimização) continuam passando.
- [ ] **Step 3: rodar** `npm test -- src/modules/orc/domain/revisor-regras.test.ts` e `npm run test:int -- src/modules/orc/application/revisor.int.test.ts`. Esperado: FAIL nos casos novos.
- [ ] **Step 4: implementar.**
  - **Leituras:**
    - uma leitura `{ id, cc, cargoId, salarioMensal }` das posições com `cargo_id`, só para as regras; a que monta `posicoesIa` continua sem `salarioMensal`;
    - os cargos vêm de `listarCargosSemSalarioCifrado(c, { incluirInativos: true })`, e os benefícios de um `beneficiosDoCargo` por cargo distinto, depois de conferir as premissas do ano.
  - **Achados:** R4 e R5 entram em `parcial.achados` junto com R1 a R3, antes da IA, para não se perderem num erro posterior.
  - **IA:** o resumo segue a D-P15-4, com os apelidos `POS-n`, sem a R5. Na conferência da resposta, o link de posição do conjunto da R5 recebe `salario: true`.
- [ ] **Step 5: verificar e entregar.**
  - Rodar os testes do Step 3 (PASS).
  - Verificações completas: typecheck, lint, unidade, arquitetura (inclui a fronteira da IA), `test:int` de orc/aut/adm, `worker/bundle.test.ts`, build e E2E de `e2e/orc` (o `revisor.spec.ts` do P14 continua passando).
  - Commit e PR `Closes #86`, label `frente:A` (sem migration), com revisão 12.12 por agente independente antes do merge.

### Ordem

- **#408 na `main` → Task 1 → Task 2**, uma branch e um PR por história:
  - `us-056-cargo-cs`;
  - `us-064-regras-pessoal`.
- O PR da Task 1 tem migration e entra sozinho na fila de migrations (§12.7, item 3).
- A frente A avisa na #138 quando cada PR abrir e quando entrar, e confirma que não há pedido novo ao `cad`.
- **Pendências registradas:**
  - issue da tela de correspondência texto → cargo (C34), a criar com o ok do PO; depois dela, a exigência do cargo na tela e o `Closes #78`;
  - os riscos da D-P15-6 no PR da Task 1.
