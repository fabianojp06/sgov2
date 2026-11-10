# P13 Perfis e permissões pela tela (frente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Administrador lista, cadastra, altera, inativa e exclui **perfis de usuário** e define as permissões de cada um numa grade módulo → funcionalidade → ações (US-037, #59). Critérios da issue: nome único sem diferenciar maiúsculas; marcar o módulo marca todas as funcionalidades e ações (A2); perfil com usuários não pode ser excluído (RN0072).

**Architecture:**
- **Tudo no `adm`, sem mudança na frente B.** As permissões continuam em `perfil_permissao` e são lidas por requisição em `carregarPermissoes` (`src/modules/adm/application/login.ts`), que já alimenta o menu, a guarda e o Histórico (RN0099). Nada muda em `carregarPermissoes`.
- **Uma migration** (spec §12.7): `versao` no `perfil`, índice único em `lower(nome)`, CHECKs de nome, descrição e código, e os GRANTs de `versao` e de DELETE.
- Perfis padrão (código fixo do `CODIGOS_PERFIL`, instalados pela seed, UC02.27) e perfis criados pela tela (código gerado) convivem na mesma tabela. A regra da RN_SEED_003 (Administração só para o Administrador) passa a morar num lugar só, usado pela seed **e** pela tela.
- Funcionalidade nova `adm.perfis`, no molde de `adm.usuarios` e `adm.alcadas`.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, Prisma 7.10.1, PostgreSQL 16, Zod 4.6.7, Vitest 5.0.5 + Testcontainers, Playwright 1.64.0. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` §11.2 (UC02.07–10 e UC02.25/26 tratados como **um** caso de uso, com a variante mais restritiva: nome único *case-insensitive*, nunca em branco ou só espaços, ≥ 1 funcionalidade; UC02.27 seed idempotente), §11.3 (matriz dos perfis padrão), C12, C25, C30, C36 e GAP-ADM-001 (ajuste fino das permissões por funcionalidade, validado em hml; não bloqueia). EP085 V3: UC02.07 (REQ0069, RN0072), UC02.08/UC02.25 (A1–A3, E1, E2; RN0046, RN0058, RN0068, RN0069, RN0070, RN0078, RN0082, RN0084; RNF0002), UC02.09/UC02.26 (E3; RN0072, RN0080, RN0081), UC02.10 (RN0080, RN0081), UC02.14 (RN0040), UC02.27 (RN_SEED_001–005).

## Global Constraints

- Português do Brasil em todo texto; marca neutra.
- Toda Server Action e toda página passam pela guarda (`definirAcao`/`exigirPagina`); o servidor revalida tudo o que a grade restringe (RNF0003): uma requisição forjada não pode conceder Administração nem tirar a do Administrador.
- Perfil, permissões e Histórico na mesma transação (RNF0002); conflito de versão pelo núcleo (`MENSAGEM_CONFLITO`, `exigirUmaLinha`, US-011).
- Textos sem fonte na especificação vão marcados **[PROVISÓRIO]** e listados para o PO.
- Testes pesados com `npm run test:int`/`test:e2e` (com `flock`), um por vez (D12). Só arquivos da frente A.
- Mensagens fixadas pelo EP085:
  - UC02.25: "Perfil cadastrado com sucesso."
  - UC02.26: "Perfil alterado com sucesso."
  - E2 (UC02.25/26): "O perfil deve possuir ao menos uma funcionalidade associada."
  - E3 (UC02.26): "Este perfil possui usuários ativos associados. Ao inativá-lo, esses usuários perderão o acesso às funcionalidades deste perfil. Deseja continuar?"

## Decisões deste plano (recomendação; o PO valida no PR do plano)

- **D-P13-1 (escopo e funcionalidade):** entra o caso de uso unificado (listar, cadastrar, alterar, inativar, excluir e definir permissões). Funcionalidade nova `adm.perfis`: módulo Administração, grupo "Operadores e Permissões", nome "Perfis de Usuário" (REQ0048), rota `/adm/perfis`, ações `consultar`, `incluir`, `alterar`, `excluir`, só ADMINISTRADOR (RN_SEED_003). A seed concede o padrão ao Administrador (R12). A lista mostra Nome, Descrição e Status (REQ0069) e, a mais, a quantidade de usuários **[PROVISÓRIO]**, para explicar por que Excluir não aparece.
- **D-P13-2 (código do perfil criado pela tela):** o código é a chave da seed, do break-glass e do C25, e o `sgo_app` não pode alterá-lo (migration `202610260300_adm_acesso`). Perfil criado pela tela recebe um código gerado, imutável e invisível na tela: `P_` + 12 hexadecimais maiúsculos de `randomUUID()` (colisão vira nova tentativa, até 3). CHECK `codigo ~ '^[A-Z][A-Z0-9_]{1,39}$'`. `CodigoPerfil` continua sendo o tipo **dos padrões** (seed e `perfisPadrao` do catálogo); a entrada do usuário (`src/modules/adm/domain/usuario.ts`, `perfis` e `excecoes[].perfil`) troca `z.enum(CODIGOS_PERFIL)` por `z.string().regex(FORMATO_CODIGO_PERFIL)`: a existência já é conferida em `resolverVinculos` (`usuarios.ts`), que recusa código desconhecido e perfil inativo não associado. `contarUsuariosPorPerfil` (contrato com a frente B, #137) **não muda**: segue só com os padrões; a frente B é avisada no PR.
- **D-P13-3 (padrão × criado pela tela):** perfil padrão pode ter nome, descrição, status e permissões alterados (RN_SEED_004 e RN_SEED_005), mas **não pode ser excluído**: a seed o reinstalaria pelo código na próxima execução (RN_SEED_002), e o Gestor de Diretoria e o Administrador têm regras ligadas ao código (C25, break-glass). Mensagem **[PROVISÓRIO]** "Os perfis padrão do sistema não podem ser excluídos. Inative o perfil se ele não for usado." Perfil criado pela tela pode tudo, com a exclusão sujeita à RN0072. Renomear um padrão não muda nada na seed (a idempotência é pelo código, não pelo nome como diz o UC02.27; já é assim desde o P5).
- **D-P13-4 (Administrador e RN_SEED_003, mesmo cuidado do P10):**
  - no perfil ADMINISTRADOR, as permissões das funcionalidades do módulo Administração (`adm.*`) são **fixas**: a grade as mostra marcadas e desabilitadas, e o servidor recusa qualquer diferença nelas **[PROVISÓRIO]** "As permissões da Administração não podem ser retiradas do perfil Administrador." O perfil ADMINISTRADOR também não pode ser inativado nem excluído **[PROVISÓRIO]** "O perfil Administrador não pode ser inativado." Assim nenhuma mudança de perfil tira o acesso do último Administrador (a trava `adm:administradores` e o `perdeUltimoAdministrador` continuam valendo só no cadastro de usuários) e o break-glass continua achando o perfil pelo código;
  - fora do ADMINISTRADOR, nenhuma funcionalidade `adm.*` pode ser concedida, salvo `adm.historico` ao AUDITOR (D-P8-8). A regra sai de `validarDeclaracoes` (`catalogo.ts`) para uma função de domínio, `podeReceberFuncionalidade(perfilCodigo, funcionalidadeCodigo, moduloCodigo)` em `src/modules/adm/domain/perfis.ts`, usada pela seed e pela tela. Na grade, o módulo Administração nem aparece para os outros perfis (para o AUDITOR, só o Histórico);
  - o Administrador pode acrescentar ou retirar funcionalidades de outros módulos no próprio perfil (RN_SEED_005). Durante o sistema inativo ele só enxerga a Administração (RN0060), como hoje.
- **D-P13-5 (validação):**
  - nome: `trim`, obrigatório, nunca só espaços (RN0069), até 100 caracteres (UC02.25), único sem diferenciar maiúsculas, excluindo o próprio registro (RN0068). Confere com `lower(nome)` no banco e, na corrida, o índice único `perfil_nome_ci_key` (P2002) devolve a mesma mensagem. **[PROVISÓRIO]** "O nome do perfil é obrigatório." e "Já existe um perfil com este nome.";
  - descrição: opcional, até 500 caracteres **[PROVISÓRIO]** (o modelo já guarda texto vazio);
  - status: Ativo/Inativo, padrão Ativo no cadastro (UC02.25);
  - permissões: lista `{ funcionalidade, acoes[] }`, sem repetição (RN0084); só funcionalidades ativas de módulos ativos (RN0078) e só ações declaradas na funcionalidade (RN0046); pelo menos uma funcionalidade com ação (RN0082, mensagem E2 do EP). Funcionalidade com ação e sem `consultar`, quando ela declara `consultar`, é recusada **[PROVISÓRIO]** "Marque Consultar para dar outras ações em [funcionalidade]." (a página exige `consultar`; sem isso a ação ficaria inalcançável). Funcionalidade sem ação declarada não aparece na grade (não há como guardá-la em `perfil_permissao`).
- **D-P13-6 (funcionalidades inativas, como a D-P10-4):** a grade mostra só funcionalidades ativas de módulos ativos; o formulário manda também a lista das funcionalidades exibidas, e o diff só mexe nelas. Permissões em funcionalidades inativas ficam como estão (voltam a valer se a funcionalidade for reativada) e entram no `antes`/`depois` do Histórico. A RN0082 conta só as funcionalidades exibidas (as inativas não dão acesso).
- **D-P13-7 (sessões, RN0040):** mudar as permissões ou o status de um perfil incrementa o `acesso_versao` de **todos os usuários vinculados a ele, menos quem executou** (o mesmo `updateMany` da D-P9-8, sem mexer na `versao` do usuário, para não gerar conflito falso na tela de usuários). Mudar só nome ou descrição não derruba ninguém. `carregarPermissoes` já relê as permissões a cada requisição; a queda garante que tela aberta e menu montado com o acesso velho não fiquem valendo e repete a regra que o P10 aplicou às exceções. Exceções por usuário (`adm_usuario_excecao`) de uma funcionalidade retirada do perfil ficam, inofensivas (como a D-P10-4b para a seed).
- **D-P13-8 (concorrência e Histórico):**
  - alterar e excluir começam pelo `updateMany`/`deleteMany` com `where: { id, versao }` (`exigirUmaLinha`). Na alteração, a linha do perfil fica presa até o fim da transação, e só depois as permissões são lidas, comparadas e regravadas: dois salvamentos com a mesma versão → um grava, o outro recebe `MENSAGEM_CONFLITO`;
  - Histórico (`funcionalidade: 'adm.perfis'`, `registroId` = id do perfil, sem unidade): uma entrada principal por operação (`INSERCAO`, `ALTERACAO`, `EXCLUSAO`) com `antes`/`depois` = `{ nome, descricao, ativo, permissoes: { [funcionalidade]: acoes[] } }`; mais uma entrada por associação criada ou retirada (RN0081) e uma por funcionalidade que continua com as ações mudadas (RN0080). Textos **[PROVISÓRIOS]**: "Perfil [nome] cadastrado", "Perfil [nome] alterado", "Perfil [nome] inativado", "Perfil [nome] excluído", "Funcionalidade [funcionalidade] associada ao perfil [nome]", "Funcionalidade [funcionalidade] retirada do perfil [nome]", "Ações da funcionalidade [funcionalidade] no perfil [nome] alteradas". Salvar sem mudança não grava nada (como `alterarUsuario`).
- **D-P13-9 (migration única, `202611102000_adm_perfil_tela`):**
  - `ALTER TABLE perfil ADD COLUMN versao int NOT NULL DEFAULT 0`, com `CHECK (versao >= 0)`;
  - `CHECK (nome = btrim(nome) AND char_length(nome) BETWEEN 1 AND 100)`, `CHECK (char_length(descricao) <= 500)`, `CHECK (codigo ~ '^[A-Z][A-Z0-9_]{1,39}$')`;
  - `CREATE UNIQUE INDEX perfil_nome_ci_key ON perfil (lower(nome))`;
  - `GRANT UPDATE ("versao") ON perfil TO sgo_app` e `GRANT DELETE ON perfil TO sgo_app` (o caso de uso só apaga perfil criado pela tela e sem usuários; `perfil_permissao` já tem DELETE). O `codigo` continua sem UPDATE; o `sgo_sync` continua sem acesso;
  - antes do deploy em hml/prod, conferir com o papel de leitura que não há nome repetido sem diferenciar maiúsculas nem fora dos CHECKs (os padrões são distintos; perfis de teste só existem nos bancos efêmeros). Se houver, a migration falha inteira e nada muda.
- **D-P13-10 (exclusão e inativação):**
  - excluir: só perfil criado pela tela (D-P13-3), sem **nenhum** usuário associado, ativo ou inativo (RN0072) **[PROVISÓRIO]** "Este perfil possui usuários associados e não pode ser excluído."; na transação: trava a linha do perfil (`SELECT … FOR UPDATE`) e confere a versão, conta `usuario_perfil`, apaga `perfil_permissao` e o perfil, grava o Histórico com o `antes` completo. Uma associação feita ao mesmo tempo espera a trava (a FK do `usuario_perfil` pede `FOR KEY SHARE`) e falha na FK depois do commit; se a exclusão perder a corrida, a FK do `usuario_perfil` recusa o DELETE (P2003), tratado com a mesma mensagem. Sucesso **[PROVISÓRIO]** "Perfil excluído com sucesso.";
  - inativar: permitido (exceto ADMINISTRADOR); com usuários **ativos** associados, exige a confirmação do E3 (a entrada traz `confirmarInativacao: true`; sem ela, o servidor devolve o pedido de confirmação e não grava). Perfil inativo não dá permissão (`carregarPermissoes` já filtra `pe.ativo`), não aparece para novos vínculos e segue nos vínculos existentes (já é assim em `resolverVinculos`). Reativar não pede confirmação.
- **D-P13-11 (seed e nomes):** com o índice único, um perfil padrão novo (seed futura) cujo nome já foi usado por um perfil da tela faria a seed falhar. A seed passa a instalar o padrão com o nome seguido de " (padrão)" quando o nome já existe, e registra isso no Histórico da seed. Os padrões já instalados não são tocados (RN_SEED_002).
- **D-P13-12 (tela):**
  - `/adm/perfis`: lista (Nome, Descrição, Status, Usuários), botão Novo (com `incluir`), nome como link para Alterar (no lugar do duplo clique do UC02.07, por acessibilidade, como nas outras telas do `adm`), Excluir com `AcaoConfirmada` só em perfil da tela sem usuários (com `excluir`); aviso de sucesso pela `?aviso=` da lista, como em `/adm/usuarios`;
  - `/adm/perfis/novo` e `/adm/perfis/[id]`: Nome, Descrição, Status e a seção "Definição de Permissões de Acesso": um `fieldset` por módulo ativo com a caixa do módulo (marcada, desmarcada ou indeterminada), e dentro uma tabela funcionalidade × ações (colunas na ordem do C5; célula vazia se a funcionalidade não declara a ação). Cadastro começa sem nada marcado (RN0058);
  - interação (funções puras em `src/modules/adm/ui/grade-permissoes.ts`, testadas): marcar o módulo marca todas as funcionalidades ativas e todas as ações dele (A2); desmarcar desmarca tudo (A3); marcar uma ação marca Consultar; desmarcar Consultar desmarca a funcionalidade inteira; as `adm.*` do Administrador ficam fixas (D-P13-4);
  - Salvar e Cancelar (A1, volta à lista sem gravar); erros em lista acima do botão, formulário mantém o digitado (E1, E2); inativar com usuários ativos abre a confirmação do E3 antes de enviar.

## Review Focus

1. **Trancar a Administração:** requisição forjada que retira `adm.*` do ADMINISTRADOR, inativa ou exclui o ADMINISTRADOR, ou concede `adm.*` (ou `adm.historico` fora do AUDITOR) a outro perfil → recusada no servidor; a seed e a tela usam a mesma regra (`podeReceberFuncionalidade`).
2. **Nome repetido:** "Auditor", "auditor" e " AUDITOR " colidem (inclusive com um padrão renomeado); dois cadastros simultâneos com o mesmo nome → um grava, o outro recebe a mensagem de nome repetido (índice `lower(nome)`), nunca erro genérico.
3. **Exclusão com usuário:** perfil com usuário inativo também não sai (RN0072); padrão nunca sai; exclusão e associação de usuário ao mesmo tempo → um dos dois falha com mensagem, e o banco nunca fica com vínculo para perfil apagado.
4. **Sessões e acesso efetivo:** mudar permissões ou status derruba as sessões dos usuários do perfil e não a de quem salvou; só nome/descrição não derruba; `carregarPermissoes` reflete a mudança (inclusive a permissão em funcionalidade inativa preservada, que volta ao reativar).
5. **Concorrência e Histórico atômico:** dois salvamentos com a mesma versão → `MENSAGEM_CONFLITO`; uma falha no meio desfaz perfil, permissões e Histórico juntos (RNF0002); uma entrada por associação criada/retirada e por mudança de ações (RN0080/RN0081).

---

### Task 1: Domínio, migration, casos de uso e seed (US-037, parte 1)

**Files:**
- Migration: `prisma/migrations/202611102000_adm_perfil_tela/migration.sql` (D-P13-9)
- Modify: `prisma/schema/adm.prisma` (`versao` no `Perfil`; comentário do índice que o Prisma não declara), `src/modules/adm/domain/perfis.ts` (`FORMATO_CODIGO_PERFIL`, `ehPerfilPadrao`, `podeReceberFuncionalidade`, `gerarCodigoPerfil`), `src/modules/adm/application/catalogo.ts` (`validarDeclaracoes` usa `podeReceberFuncionalidade`), `src/modules/adm/domain/usuario.ts` (D-P13-2), `src/modules/adm/infrastructure/seed.ts` (`adm.perfis`; D-P13-11), `src/modules/adm/index.ts`
- Create: `src/modules/adm/domain/perfil.ts` (esquema Zod `validarPerfil`, `MENSAGENS_PERFIL`, `diferencaPermissoes`, descrições do Histórico), `src/modules/adm/application/perfis.ts`, `src/modules/adm/application/acoes-perfis.ts` (`'use server'`)
- Test: `src/modules/adm/domain/perfil.test.ts`, `src/modules/adm/application/perfis.int.test.ts`, `src/modules/adm/application/catalogo.test.ts`, `src/modules/adm/application/usuarios.int.test.ts`, `src/modules/adm/infrastructure/privilegios.int.test.ts`, `src/modules/adm/infrastructure/seed.int.test.ts`, `src/modules/aut/application/tela-principal.int.test.ts` (item novo no menu do Administrador)

**Interfaces:**
```ts
type PermissaoEntrada = { funcionalidade: string; acoes: Acao[] };
type EntradaPerfil = {
  nome: string; descricao: string; ativo: boolean;
  permissoes: PermissaoEntrada[];
  exibidas: string[];            // funcionalidades que a grade mostrou (D-P13-6)
  confirmarInativacao?: boolean; // E3 (D-P13-10)
};
listarPerfis(ctx): Promise<{ id; codigo; nome; descricao; ativo; padrao: boolean; usuarios: number; usuariosAtivos: number; versao: number }[]>;
obterPerfil(ctx, id): Promise<(EntradaPerfil & { id; codigo; padrao; usuariosAtivos; versao }) | null>;
gradePermissoes(ctx, perfilCodigo: string | null): Promise<{ modulo; nome; funcionalidades: { codigo; nome; grupo; acoes: Acao[]; fixas: Acao[] }[] }[]>;
incluirPerfil(ctx, e: EntradaPerfil): Promise<Resultado<{ id: string }>>;
alterarPerfil(ctx, id: string, versao: number, e: EntradaPerfil): Promise<Resultado<void | { confirmar: string }>>;
excluirPerfil(ctx, id: string, versao: number): Promise<Resultado<void>>;
```

- [ ] **Step 1:** testes de unidade (`perfil.test.ts`): nome em branco, só espaços, 101 caracteres; descrição de 501; permissão repetida (RN0084); ação não declarada; ação sem Consultar; nenhuma funcionalidade (mensagem E2 do EP); `diferencaPermissoes` (associadas, retiradas, ações mudadas, só sobre as exibidas); `podeReceberFuncionalidade` (ADMINISTRADOR, AUDITOR com `adm.historico`, perfil da tela com `adm.*`).
- [ ] **Step 2:** testes de integração (`perfis.int.test.ts`):
  - cadastro grava perfil, permissões e Histórico (uma principal + uma por associação); `carregarPermissoes` de um usuário associado ao perfil novo traz as permissões;
  - nome repetido por caixa e espaços; corrida de dois cadastros com o mesmo nome (Review Focus 2);
  - itens 1, 3, 4 e 5 do Review Focus, cada um com o seu teste;
  - funcionalidade inativa preservada e fora da RN0082 (D-P13-6);
  - inativar com usuários ativos sem `confirmarInativacao` → pedido de confirmação e nada gravado; com ela → grava, derruba as sessões; perfil inativo some de `carregarPermissoes`;
  - usuário associado a perfil criado pela tela pelo cadastro de usuários, inclusive com exceção (D-P13-2), em `usuarios.int.test.ts`;
  - privilégios: `sgo_app` atualiza `versao` e apaga perfil, continua sem alterar `codigo`; `sgo_sync` sem acesso;
  - seed: duas execuções sem diferença; `adm.perfis` concedida ao Administrador; padrão novo com nome já usado entra com " (padrão)".
- [ ] **Step 3:** implementar migration, schema, domínio, casos de uso, ações e seed. Ajustar o teste do menu; a matriz de autorização entra sozinha.
- [ ] **Step 4:** typecheck, lint, unidade, arquitetura, `test:int` de adm e aut; commit.

### Task 2: Telas de perfis com a grade de permissões (US-037, parte 2)

**Files:**
- Create: `src/modules/adm/ui/grade-permissoes.ts` (funções puras: `estadoInicial`, `alternarModulo`, `alternarFuncionalidade`, `alternarAcao`, `estadoModulo` → `'marcado' | 'desmarcado' | 'indeterminado'`, `paraEntrada`), `src/modules/adm/ui/lista-perfis.tsx`, `src/modules/adm/ui/form-perfil.tsx`, `src/app/(sistema)/adm/perfis/page.tsx`, `src/app/(sistema)/adm/perfis/novo/page.tsx`, `src/app/(sistema)/adm/perfis/[id]/page.tsx`
- Modify: `src/modules/adm/index.ts`, `src/modules/adm/ui/bundle-cliente.test.ts` (inclui `form-perfil.tsx` e `lista-perfis.tsx`)
- Test: `src/modules/adm/ui/grade-permissoes.test.ts`, `src/modules/adm/ui/paginas-perfis.test.ts`, `e2e/adm/perfis.spec.ts`

- [ ] **Step 1:** testes de unidade da grade: A2 (marcar módulo marca todas as funcionalidades e ações), A3, módulo indeterminado, ação marca Consultar, desmarcar Consultar desmarca a funcionalidade, `adm.*` fixas no Administrador não mudam, cadastro começa vazio (RN0058).
- [ ] **Step 2:** páginas com `exigirPagina('adm.perfis', 'consultar' | 'incluir' | 'alterar')`, no molde de `/adm/usuarios`; `notFound()` para id inexistente; botões conforme as permissões; caixa do módulo com `aria-checked="mixed"` no indeterminado; `fieldset`/`legend` por módulo, cabeçalhos de tabela com `scope`, navegável por teclado; confirmação do E3 antes de enviar.
- [ ] **Step 3:** E2E: o Administrador cria o perfil "Consulta Orçamento" marcando o módulo Orçamentário (todas as ações marcadas), tira uma ação, salva e vê "Perfil cadastrado com sucesso."; tenta criar "consulta orçamento" e recebe o erro de nome; associa um usuário ao perfil, entra com ele e vê o menu; tenta excluir o perfil e não consegue; desassocia o usuário e exclui. Deixar o banco como encontrou.
- [ ] **Step 4:** verificações completas (typecheck, lint, unidade, arquitetura, `test:int` de adm/aut, build, E2E de `e2e/adm`, `e2e/aut`, `e2e/seguranca`, um por vez); commit; PR `Closes #59`, labels `frente:A` e `migration`; avisar a frente B sobre a D-P13-2 (`contarUsuariosPorPerfil` não muda; códigos `P_…` aparecem em `usuario_perfil`).

---

## Ajustes da revisão 12.12 do plano (prevalecem sobre o texto acima)

- **A1 (D-P13-6):** o servidor monta, dentro da transação, o conjunto de funcionalidades ativas de módulos ativos e usa só ele no diff; se a lista `exibidas` enviada pela tela for diferente, devolve `MENSAGEM_CONFLITO` (tela desatualizada). Teste com requisição forjada (omitindo e incluindo funcionalidade).
- **A2 (D-P13-4):** as `adm.*` do ADMINISTRADOR ficam **fora do diff** (o banco não é tocado nelas), em vez de recusar diferenças; a concessão de `adm.*` a qualquer outro perfil (menos `adm.historico` ao AUDITOR) é recusada.
- **A3 (C25):** perfil criado pela tela não tem CC de escopo (o escopo por CC depende do código GESTOR_DIRETORIA): quem o recebe com permissões de `orc.pacotes`/`orc.posicoes` lança em toda a Adm. Central. A grade avisa **[PROVISÓRIO]** "Usuários deste perfil não têm CC de escopo: lançam em toda a Administração Central. Para limitar a uma diretoria, use o perfil Gestor de Diretoria." quando o perfil não padrão recebe incluir/alterar/excluir dessas funcionalidades; teste do comportamento.
- **A4 (contrato com a frente B, #137):** `contarUsuariosPorPerfil` mantém a interface; corrigir o comentário ("perfis de teste" passa a ser "perfis criados pela tela, não contados") e avisar a frente B na #137 (opções: item "outros perfis" ou `codigo: string`).
- **A5 (defesa no banco):** trigger `BEFORE DELETE` em `perfil` que recusa apagar perfil cujo código não comece com `P_`; o prefixo `P_` fica reservado aos perfis da tela (teste de catálogo: nenhum código padrão começa com `P_`).
- **A6:** `usuarios.ts` trata o P2003 (perfil excluído durante a associação) com mensagem própria, coberto pelo teste do Review Focus 3.
- **A7 (RN0082):** a regra de "ao menos uma funcionalidade" só se aplica quando as permissões mudam (renomear um perfil cujas funcionalidades estão em módulo inativo continua possível).
- **A8 (D-P13-11):** a seed usa sufixo numérico (" (padrão)", " (padrão 2)", …) até achar nome livre, dentro dos 100 caracteres.
- **A9:** registrado: a associação simultânea à inativação de um perfil é inofensiva (perfil inativo não dá permissão).
- **A10:** "sem espaços" lido como "não pode ser vazio nem só espaços, com `trim`" (os nomes padrão têm espaço interno); o PO confirma.
- **A11:** a caixa do módulo usa a propriedade `indeterminate` do checkbox nativo, não `aria-checked="mixed"`.
- **A12:** tipos `Excecao<CodigoPerfil>` e comentários sobre a ordem do catálogo em `usuarios.ts` acompanham a D-P13-2.
