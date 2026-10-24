# SGO 2.0 — Backlog do Produto

| Campo | Valor |
| --- | --- |
| Versão | 1.0 — 24/10/2026 |
| Fonte | `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (spec oficial) |
| Product Owner | Fabiano Garcia (BA/PO) |
| Arquivo para importação | `docs/backlog/backlog-sgo-v2.csv` (Jira, Azure DevOps, planilha) |

## 1. Como ler este backlog

- **Ordem**: a coluna *Ordem* é a prioridade global (1 = primeiro). Ela segue as releases, depois MoSCoW, depois as dependências.
- **Prioridade (MoSCoW)**: *Must* = sem isso a release não vai para produção; *Should* = importante, entra se houver capacidade; *Could* = desejável.
- **Tamanho e horas**: XS = 2 h · P = 4 h · M = 8 h · G = 16 h · GG = 24 h. As horas são o esforço de desenvolvimento com Claude Code (código, testes automatizados e revisão), não o tempo de relógio de uma pessoa digitando.
- **Modo de execução**: *Sessão* = núcleo crítico, desenvolvido numa sessão com TDD guiado e revisão a cada tarefa. *Ultracode* = lote paralelizável sobre um padrão já pronto (cadastros, relatórios, testes), executado por vários agentes em paralelo (seção 4).
- **GAP**: pendência da spec (seção 9 dela) que bloqueia toda a história ou parte dela. História com GAP aberto só entra em sprint com o GAP resolvido ou com a parte bloqueada isolada.

## 2. Resumo por release

| Release | Escopo | Fase da spec | Histórias | Horas (histórias) | Horas *Must* | Horas em Ultracode | Horas com contingência (+20%) | Horas do PO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R0 | Fundação técnica | F0 | 20 | 152 | 146 | 0 | 183 | 39 |
| R1 | Geral, Autenticação e Administração | F1 | 22 | 186 | 174 | 0 | 224 | 44 |
| R2 | Cadastros-base | F2 | 12 | 112 | 92 | 56 | 135 | 33 |
| R3 | Orçamento da Administração Central + IA onda 1 (parte) | F3A | 9 | 84 | 64 | 0 | 101 | 29 |
| R4 | Propostas / Termos de Parceria | F3 | 14 | 176 | 136 | 64 | 212 | 43 |
| R5 | Aprovações + IA-13 | F4 | 7 | 88 | 72 | 8 | 106 | 30 |
| R6 | Execução orçamentária e Orçado × Realizado + IA onda 2 | F5 | 11 | 132 | 72 | 24 | 159 | 36 |
| R7 | Relatórios, Book, Consolidado + IA onda 3 | F6 | 13 | 192 | 88 | 56 | 231 | 45 |
| R8 | Integrações Senior/Rubi/RVS | F7 | 6 | 88 | 0 | 0 | 106 | 30 |
| R9 | Go-live e operação | — | 5 | 64 | 48 | 32 | 77 | 26 |
| **Total** | | | **119** | **1274** | **892** | **240** | **1534** | **355** |

*Horas do PO* = 15% das horas de desenvolvimento (aprovar planos, tirar dúvidas, revisar entregas) + 16 h de homologação com usuários-chave por release.

## 3. Prazo estimado

O ritmo depende de quanto tempo por semana há para conduzir as sessões, revisar e homologar. Os cenários abaixo usam o total com contingência, com margem de ±30%.

| Cenário | Ritmo (horas de desenvolvimento por semana) | Sistema completo (R0–R9) | MVP Adm. Central (seção 3.1) |
| --- | --- | --- | --- |
| Conservador: só sessões, PO em meio período | 25 h | 62 semanas (~15 meses) | 26 semanas (~7 meses) |
| Recomendado: sessões no núcleo + Ultracode nos lotes | 40 h | 39 semanas (~10 meses) | 16 semanas (~4 meses) |
| Intensivo: Ultracode amplo, PO dedicado | 60 h | 26 semanas (~7 meses) | 11 semanas (~3 meses) |

### 3.1 Alerta: orçamento de 2027

Hoje é 24/10/2026. Para elaborar o orçamento 2027 da Administração Central **dentro do SGO**, é preciso o MVP: as histórias *Must* de R0 a R3, mais a carga de produção, os testes de segurança, a homologação e o runbook (57 histórias, 524 h, 629 h com contingência). No cenário recomendado, isso leva cerca de 16 semanas a partir de agora, ou seja, o MVP ficaria pronto por volta de meados de fevereiro de 2027 (início de janeiro no cenário intensivo).

Opções para decidir:
1. **Orçamento 2027 fora do SGO** (planilha ou protótipo) e importado depois para o exercício 2027. O SGO entra para valer na execução de 2027 e na elaboração de 2028. *(Recomendado: menor risco.)*
2. **MVP enxuto para 2027**: só login básico, perfis, importação das planilhas e UC04.17, adiando partes da Administração (exceções, notificações) e da Geral (exportação PDF). Corta cerca de 30% do MVP, mas deixa partes para completar depois do orçamento.
3. **Cenário intensivo** até o MVP, com PO dedicado.

## 4. Estratégia de execução e economia de tokens

**Sobre o Ultracode.** O Ultracode orquestra vários agentes em paralelo, com etapas de verificação. Ele **acelera** o trabalho e **aumenta a qualidade** em lotes grandes, mas **gasta mais tokens** por tarefa do que uma sessão única, porque cada agente lê o contexto de novo. Para economizar, o certo é usá-lo onde o paralelismo compensa, e não em tudo:

| Usar | Onde | Por quê |
| --- | --- | --- |
| **Sessão única** (superpowers: plano → TDD por tarefa → revisão) | Núcleo crítico: fundação, dinheiro, auditoria, isolamento por TP, login, motores de cálculo, workflows, IA (1034 h) | Exige raciocínio encadeado e contexto contínuo. Dividir entre agentes gera retrabalho, e retrabalho é o maior desperdício de tokens |
| **Ultracode** | Lotes sobre um padrão já pronto: cadastros, relatórios UC05.x, demonstrativos, testes de segurança, manual (240 h) | Muitas peças independentes e parecidas. O paralelismo reduz o prazo, e a verificação cruzada pega erro de padrão cedo |

**Regras para economizar tokens em qualquer modo**
1. **Primeiro o padrão, depois o lote.** O primeiro cadastro e o primeiro relatório são feitos em sessão e viram o modelo; só então o Ultracode replica o padrão.
2. **Plano com tarefas exatas** (writing-plans) antes de cada release: arquivos, testes e critérios definidos. A IA não "descobre" o projeto a cada tarefa.
3. **`CLAUDE.md` enxuto e estável** (US-002), com comandos e regras. Isso evita reexplicar o projeto e aproveita o cache.
4. **Componentes genéricos da R1** (grade, formulário, exportação): cada cadastro novo vira configuração, não código novo.
5. **Lotes de 3 a 5 histórias por execução de Ultracode**, sempre com critérios de aceite fechados. Lote grande demais aumenta o custo de correção.
6. **GAP resolvido antes de começar.** História bloqueada que começa e para é o pior caso de custo.

## 5. Definition of Ready e Definition of Done

**Pronta para desenvolver (DoR):** história com critérios de aceite claros; dependências entregues; GAPs que a afetam resolvidos ou isolados; regra de negócio rastreável até o documento-fonte.

**Pronta (DoD):**
- Critérios de aceite cobertos por testes automatizados (domínio com TDD; integração com PostgreSQL real; E2E nos fluxos principais).
- Testes de diretriz da spec 10.2 verdes (auditoria, isolamento por TP, Half-Even, versão otimista, ORIGEM BLINDADA).
- Revisão de código e de segurança feitas; lint, tipos e build verdes; sem "CTCEA" no código.
- Implantada em hml e aceita pelo usuário-chave da release.

## 6. Backlog priorizado

### R0 — Fundação técnica (20 histórias, 152 h)

#### EP00 — Fundação técnica (94 h)

**US-001** · Ordem 1 · Must · M (8 h) · Sessão

Como time, quero o repositório Next.js + TypeScript strict com a estrutura de módulos e lint de fronteiras, para que cada módulo só se comunique pela API pública do outro.

Critérios de aceite:
- `src/modules/<mod>/{domain,application,infrastructure,ui}` e `shared/*` criados
- Lint falha se `domain/` importar fora do módulo ou se `app/` acessar Prisma
- `npm run lint`, `typecheck`, `test` e `build` verdes

<sub>Referências: spec 4.1 · Depende de: —</sub>

**US-002** · Ordem 2 · Must · P (4 h) · Sessão

Como time, quero o `CLAUDE.md` do projeto e os bloqueios automáticos (hooks), para que nenhum comando destrutivo atinja o banco de produção.

Critérios de aceite:
- Hook recusa `prisma migrate reset`, `db push` e `migrate diff` fora do banco de dev
- Hook avisa se surgir "CTCEA" no código
- `CLAUDE.md` com stack, comandos, regras de banco, marca neutra e "IA sugere, não grava"

<sub>Referências: spec 11.5 · Depende de: US-001</sub>

**US-003** · Ordem 3 · Must · P (4 h) · Sessão

Como desenvolvedor, quero um Docker Compose de dev (PostgreSQL 16 + app + worker), para subir o ambiente com um comando.

Critérios de aceite:
- `docker compose up` sobe banco, app e worker
- Seed de dev roda sem erro e é idempotente
- Nenhuma credencial de prod no repositório

<sub>Referências: spec 4.3 · Depende de: US-001</sub>

**US-004** · Ordem 4 · Must · M (8 h) · Sessão

Como time, quero Prisma com migrations e papéis de banco separados (`sgo_app` sem BYPASSRLS, `sgo_sync`, `sgo_migrator`), para que a aplicação nunca tenha mais poder do que precisa.

Critérios de aceite:
- Migrations versionadas e aplicadas só por `migrate deploy`
- App conecta com `sgo_app`; migration com `sgo_migrator`
- `shadowDatabaseUrl` aponta só para banco efêmero

<sub>Referências: spec 5, 11.1 · Depende de: US-003</sub>

**US-005** · Ordem 5 · Must · M (8 h) · Sessão

Como gestor financeiro, quero que todo valor em dinheiro use decimal com Half-Even e NUMERIC(15,2), para que não haja erro de centavos.

Critérios de aceite:
- `Dinheiro`, `Percentual` e `Competencia` no `shared/kernel` com testes de propriedade
- Uso de `number` para dinheiro barrado por lint
- Soma de 12 parcelas fecha com o anual (diferença vai para dezembro)

<sub>Referências: spec 5; Catálogo diretriz · Depende de: US-001</sub>

**US-006** · Ordem 6 · Must · M (8 h) · Sessão

Como auditor, quero o Histórico de Operações append-only gravado na mesma transação da operação, para que nenhuma alteração fique sem rastro.

Critérios de aceite:
- `auditar(tx, evento)` grava antes/depois/delta em JSONB
- UPDATE/DELETE no histórico são recusados pelo banco
- Falha ao auditar desfaz a operação inteira

<sub>Referências: Log Delta; RN0089–RN0103 · Depende de: US-004</sub>

**US-007** · Ordem 7 · Must · G (16 h) · Sessão

Como usuário de um TP, quero ver só os dados dos TPs a que tenho acesso, mesmo que alguém chame a API direto, para que o isolamento seja garantido.

Critérios de aceite:
- `unidade_id` em toda tabela de dado de TP
- Guarda `shared/authz` filtra pela unidade ativa
- RLS com `app.unidades` bloqueia leitura e escrita fora da lista; teste de invasão via API

<sub>Referências: spec 5 (C31) · Depende de: US-004</sub>

**US-008** · Ordem 8 · Must · M (8 h) · Sessão

Como time, quero a guarda RBAC obrigatória em toda Server Action e Route Handler, para que nenhuma tela ou API fique sem checagem de permissão.

Critérios de aceite:
- Ação sem guarda falha no teste de arquitetura
- Permissão negada retorna erro padronizado e é auditada

<sub>Referências: RBAC; RNF_SEG_001 · Depende de: US-007</sub>

**US-009** · Ordem 9 · Must · G (16 h) · Sessão

Como gestor financeiro, quero o núcleo do TotalizerService, para que todos os totais e sintéticas venham de um único motor de cálculo.

Critérios de aceite:
- Função pura: árvore + valores analíticos → sintéticos, totais e %
- Testes com os critérios de aceite numéricos do OxR V2
- Sintéticas nunca persistidas como dado vivo

<sub>Referências: OxR V2 §7; RN_TOT · Depende de: US-005</sub>

**US-010** · Ordem 10 · Must · M (8 h) · Sessão

Como time, quero filas e jobs agendados com pg-boss no worker, para que e-mails, exportações grandes e cargas não travem as telas.

Critérios de aceite:
- Worker com entrypoint próprio e reprocessamento com espera
- Job com falha fica visível e reprocessável
- Teste de integração com PostgreSQL real

<sub>Referências: spec 4.2 · Depende de: US-004</sub>

**US-011** · Ordem 11 · Must · P (4 h) · Sessão

Como time, quero controle de concorrência otimista (versão) e advisory locks, para que dois usuários não sobrescrevam o trabalho um do outro.

Critérios de aceite:
- Gravação com versão desatualizada é recusada com mensagem clara
- Lock por recurso nas operações de sincronismo

<sub>Referências: Catálogo diretriz; RNF0011 · Depende de: US-004</sub>

**US-012** · Ordem 12 · Must · XS (2 h) · Sessão

Como time, quero o teste automático de marca neutra, para que o nome "CTCEA" nunca apareça no sistema.

Critérios de aceite:
- Busca por "ctcea" em `src/`, `prisma/`, `worker/` e seeds falha o build

<sub>Referências: spec 6.7 · Depende de: US-001</sub>

#### EP01 — Infraestrutura VPS, CI/CD e proteção de dados (40 h)

**US-013** · Ordem 13 · Must · M (8 h) · Sessão

Como time, quero o pipeline GitHub Actions (lint, testes, build da imagem, GHCR, webhook do Easypanel), para que todo deploy seja automático e reproduzível.

Critérios de aceite:
- Push na `main` publica imagem e faz deploy em hml
- Tag de release faz deploy em prod
- Migration com falha impede a subida da versão nova

<sub>Referências: spec 4.3 · Depende de: US-003</sub>

**US-014** · Ordem 14 · Must · M (8 h) · Sessão

Como PO, quero os ambientes `sgo-hml` e `sgo-prod` no Easypanel com HTTPS e banco sem porta pública, para homologar e operar com segurança.

Critérios de aceite:
- App acessível só por HTTPS via Traefik
- PostgreSQL de cada ambiente só na rede interna do Docker
- Variáveis de prod só no Easypanel

<sub>Referências: spec 4.3 · Depende de: US-013 · **GAP:** GAP-INF-001 (domínio)</sub>

**US-015** · Ordem 15 · Must · G (16 h) · Sessão

Como PO, quero backup com recuperação ponto a ponto para um storage fora da VPS, dump diário e teste de restauração mensal, para nunca mais perder dados.

Critérios de aceite:
- pgBackRest com WAL contínuo para B2/R2, retenção 30 dias
- Dump diário com retenção 90 dias
- Primeira restauração em banco descartável registrada

<sub>Referências: spec 4.3, 11.5 · Depende de: US-014 · **GAP:** GAP-INF-001 (storage)</sub>

**US-016** · Ordem 16 · Must · P (4 h) · Sessão

Como PO, quero a VPS endurecida (SSH só por chave, firewall 22/80/443, fail2ban, atualizações, Easypanel atrás de HTTPS), para reduzir o risco de invasão.

Critérios de aceite:
- Porta 3000 fechada ou atrás de HTTPS
- Login por senha no SSH desabilitado
- Snapshot da Hostinger antes de cada deploy com migration

<sub>Referências: spec 4.3 · Depende de: —</sub>

**US-017** · Ordem 19 · Should · P (4 h) · Sessão

Como time, quero logs estruturados, healthcheck e alerta de indisponibilidade, para saber quando o sistema cai antes do usuário.

Critérios de aceite:
- Endpoint de saúde verificando banco e worker
- Alerta por e-mail quando o healthcheck falha

<sub>Referências: — · Depende de: US-014</sub>

#### EP02 — Infraestrutura de IA (18 h)

**US-018** · Ordem 17 · Must · M (8 h) · Sessão

Como time, quero a porta `ProvedorIA` com os adaptadores Anthropic e falso, para que qualquer funcionalidade de IA use um ponto único e testável.

Critérios de aceite:
- `gerarTexto`, `gerarEstruturado(schemaZod)` e `gerarStream`
- Adaptador Anthropic com SDK oficial, `claude-opus-5-5`, tratamento de `refusal`/`max_tokens` e novas tentativas
- Testes de contrato com o adaptador falso, sem rede

<sub>Referências: spec 4.4 · Depende de: US-001</sub>

**US-019** · Ordem 18 · Must · M (8 h) · Sessão

Como PO, quero o cadastro de casos de uso de IA, o registro de chamadas, os tetos de custo e as chaves liga/desliga, para controlar uso, custo e risco da IA.

Critérios de aceite:
- Tabelas `ia_caso_uso` e `ia_chamada` (append-only)
- Teto mensal desliga só a IA, com aviso
- Tudo desligado por padrão; permissão RBAC por caso de uso

<sub>Referências: spec 4.4 · Depende de: US-018</sub>

**US-020** · Ordem 20 · Could · XS (2 h) · Sessão

Como time, quero a extensão pgvector instalada e a porta `ProvedorEmbeddings` definida, para a busca semântica futura.

Critérios de aceite:
- Extensão criada por migration
- Porta sem implementação real

<sub>Referências: spec 4.4 · Depende de: US-004 · **GAP:** GAP-IA-002</sub>

### R1 — Geral, Autenticação e Administração (22 histórias, 186 h)

#### EP03 — Módulo Geral (componentes-base) (40 h)

**US-021** · Ordem 21 · Must · G (16 h) · Sessão

Como usuário, quero listagens e Tree Grids virtualizadas com filtros retidos na sessão, para trabalhar com milhares de linhas sem travar.

Critérios de aceite:
- 5.000 linhas com rolagem fluida
- Filtros mantidos ao voltar para a tela (RNF0005)
- Componente único reutilizado por todos os módulos

<sub>Referências: UC0–UC0.06; RNF_DES_002 · Depende de: US-001</sub>

**US-022** · Ordem 22 · Must · M (8 h) · Sessão

Como usuário, quero formulários que não percam o que digitei quando há erro, para não refazer o trabalho.

Critérios de aceite:
- Erros por campo vindos do servidor
- Formulário só fecha em sucesso
- Estado nunca salvo em localStorage (RNF0002)

<sub>Referências: [TRAVA O ERRO] · Depende de: US-021</sub>

**US-023** · Ordem 23 · Must · P (4 h) · Sessão

Como usuário, quero um modal de exclusão que mostre os impeditivos, para entender por que algo não pode ser excluído.

Critérios de aceite:
- Lista de vínculos que impedem a exclusão
- Exclusão lógica (soft delete) com auditoria

<sub>Referências: EP083 · Depende de: US-022</sub>

**US-024** · Ordem 24 · Must · M (8 h) · Sessão

Como usuário, quero exportar listagens em XLSX, PDF e CSV com cabeçalho de filtros e marca d'água, para ter documentos rastreáveis.

Critérios de aceite:
- Até 5.000 linhas na hora; acima disso, por job e aviso
- Marca d'água com operador e Traceability ID
- Exportação registrada no Histórico

<sub>Referências: RN0011; RN_WATERMARK; RNF_IMP_001 · Depende de: US-010, US-021</sub>

**US-025** · Ordem 25 · Must · P (4 h) · Sessão

Como sistema, quero enviar e-mails por modelo padrão via fila e SMTP externo, para que senhas e avisos cheguem com segurança.

Critérios de aceite:
- Envio pelo worker com nova tentativa
- Modelos versionados, sem o nome da instituição fixo

<sub>Referências: UC0.06 · Depende de: US-010 · **GAP:** GAP-INF-001 (SMTP)</sub>

#### EP04 — Autenticação e Tela Principal (66 h)

**US-026** · Ordem 26 · Must · G (16 h) · Sessão

Como usuário, quero entrar com login e senha, com mensagem genérica em caso de erro, para acessar o sistema com segurança.

Critérios de aceite:
- Login sem diferenciar maiúsculas/minúsculas
- Ordem: manutenção → existência → status → bloqueio → senha
- Hash fictício para login inexistente (sem diferença de tempo)
- Argon2id

<sub>Referências: UC01.01–UC01.02; RN0015–RN0018; RN0518 · Depende de: US-006, US-008</sub>

**US-027** · Ordem 27 · Must · M (8 h) · Sessão

Como administrador, quero que a conta seja bloqueada após o limite de tentativas, com aviso na última, para proteger contra ataques de senha.

Critérios de aceite:
- Contador global por usuário com `FOR UPDATE`
- Limite e limiar de alerta são parâmetros
- Bloqueio na mesma transação do incremento; administrador é notificado

<sub>Referências: UC01.03; RN0017; RN0024; RN0520 · Depende de: US-026 · **GAP:** GAP-AUT-002 (valores)</sub>

**US-028** · Ordem 28 · Must · M (8 h) · Sessão

Como usuário, quero sessão única, com aviso na estação anterior quando entro em outra, para evitar uso indevido da minha conta.

Critérios de aceite:
- Nova sessão encerra a anterior com aviso
- Sessão em banco com expiração (token opaco)

<sub>Referências: RN0519; SessaoUsuario · Depende de: US-026</sub>

**US-029** · Ordem 29 · Must · M (8 h) · Sessão

Como usuário, quero recuperar a senha por e-mail com resposta uniforme e senha temporária, para voltar a acessar sem revelar se o login existe.

Critérios de aceite:
- Mesma resposta para login existente e inexistente
- Senha temporária de uso único, expira em 24 h
- Troca obrigatória no primeiro acesso

<sub>Referências: RN0516–RN0517; C21 · Depende de: US-025, US-026</sub>

**US-030** · Ordem 30 · Must · P (4 h) · Sessão

Como usuário, quero trocar minha senha (obrigatoriamente no primeiro acesso), para manter minha conta segura.

Critérios de aceite:
- Regras de complexidade vindas dos parâmetros
- Troca registrada no Histórico

<sub>Referências: REQ0039; UC02.19 · Depende de: US-026 · **GAP:** GAP-AUT-002</sub>

**US-031** · Ordem 31 · Must · G (16 h) · Sessão

Como usuário, quero a tela principal com menu só do que tenho permissão, seletor de TP e ajuda contextual, para encontrar o que preciso.

Critérios de aceite:
- Menu por módulo → grupo → funcionalidade, filtrado por permissão
- Seletor lista só os TPs do usuário e some quando há um só
- Menu da Administração Central só para quem tem a permissão
- Busca de funcionalidade respeita o filtro

<sub>Referências: UC01.04; RN0027/0030/0031/0032; RN0521; spec 6.7 · Depende de: US-021, US-026</sub>

**US-032** · Ordem 32 · Must · XS (2 h) · Sessão

Como usuário, quero sair do sistema com confirmação e limpeza dos dados no navegador, para não deixar sessão aberta.

Critérios de aceite:
- Sessão invalidada no servidor
- Dados locais apagados

<sub>Referências: RNF0010 · Depende de: US-028</sub>

**US-033** · Ordem 33 · Must · P (4 h) · Sessão

Como administrador, quero que, em modo manutenção, só administradores entrem, para fazer manutenção sem usuários conectados.

Critérios de aceite:
- Login de não administrador recusado com aviso de manutenção

<sub>Referências: RN0023 · Depende de: US-026, US-036</sub>

#### EP05 — Administração (80 h)

**US-034** · Ordem 34 · Must · M (8 h) · Sessão

Como sistema, quero a seed idempotente com módulos, funcionalidades, perfis padrão e administrador inicial, para instalar o sistema do zero.

Critérios de aceite:
- 7 perfis padrão aprovados (11.3)
- Rodar duas vezes não muda nada

<sub>Referências: UC02.27; RN_SEED; spec 11.3 · Depende de: US-004</sub>

**US-035** · Ordem 35 · Must · P (4 h) · Sessão

Como administrador, quero ativar e desativar módulos e funcionalidades, para controlar o que está disponível.

Critérios de aceite:
- Desativar módulo desativa as funcionalidades e desconecta usuários
- Ativar módulo não ativa funcionalidades automaticamente

<sub>Referências: UC02.05/06; RN0033/0034/0043 · Depende de: US-034</sub>

**US-036** · Ordem 36 · Must · M (8 h) · Sessão

Como administrador, quero ativar e desativar o sistema com motivo, desconectando os usuários com contagem, para fazer manutenção programada.

Critérios de aceite:
- Motivo obrigatório
- Usuários conectados avisados e desconectados com contagem
- Histórico de ativações

<sub>Referências: UC02.01; UC02.15–UC02.17; REQ0087 · Depende de: US-028</sub>

**US-037** · Ordem 37 · Must · G (16 h) · Sessão

Como administrador, quero cadastrar perfis e permissões (com nome único e ao menos uma funcionalidade), para definir o que cada grupo pode fazer.

Critérios de aceite:
- Nome único sem diferenciar maiúsculas
- Marcar módulo marca todas as ações (A2)
- Perfil com usuários não pode ser excluído

<sub>Referências: UC02.07–UC02.10; UC02.25/26; RN0068; RN0072 · Depende de: US-034 · **GAP:** GAP-ADM-001 (ajuste fino)</sub>

**US-038** · Ordem 38 · Must · G (16 h) · Sessão

Como administrador, quero cadastrar usuários com login imutável, senha gerada pelo sistema e acesso por TP, para dar acesso só ao necessário.

Critérios de aceite:
- Login único e imutável
- Senha gerada e enviada por e-mail; o administrador nunca digita senha
- Lista de TPs permitidos e CC de escopo (Gestor de Diretoria)
- Desbloquear zera o contador

<sub>Referências: UC02.11–UC02.14; UC02.18; RN0059/0065/0066/0071/0079; C25 · Depende de: US-025, US-037</sub>

**US-040** · Ordem 39 · Must · M (8 h) · Sessão

Como auditor, quero consultar o Histórico de Operações nos níveis Simples e Avançado, só com imprimir e exportar, para auditar o sistema.

Critérios de aceite:
- Filtros por usuário, funcionalidade, período e tipo
- Sem incluir, alterar ou excluir

<sub>Referências: UC02.21–UC02.24; REQ00103 · Depende de: US-006, US-024</sub>

**US-042** · Ordem 40 · Must · M (8 h) · Sessão

Como administrador, quero cadastrar as alçadas de aprovação (titular e substituto por fluxo e escopo), para que as aprovações sejam roteadas automaticamente.

Critérios de aceite:
- Titular e substituto obrigatórios e diferentes
- Substituto assume quando o titular está inativo
- Soft delete preserva o histórico

<sub>Referências: UC02.28 (spec 11.4); RN_ALC_005 · Depende de: US-038 · **GAP:** GAP-APR-001 (aditivo/ajuste/remanejamento)</sub>

**US-039** · Ordem 41 · Should · M (8 h) · Sessão

Como administrador, quero exceções de permissão por usuário, para tratar casos especiais sem criar um perfil novo.

Critérios de aceite:
- Concessão ou retirada de funcionalidade por usuário
- Exceção registrada no Histórico

<sub>Referências: UC02.21–UC02.24 · Depende de: US-038</sub>

**US-041** · Ordem 42 · Should · P (4 h) · Sessão

Como administrador, quero configurar as notificações de desempenho das contas, para que os gestores sejam avisados dos limites.

Critérios de aceite:
- Destinatário por conta, limite (%) e frequência
- Envio pelo worker

<sub>Referências: UC02.20 · Depende de: US-025</sub>

### R2 — Cadastros-base (12 histórias, 112 h)

#### EP06 — Estrutura financeira (plano de contas e centros de custo) (40 h)

**US-043** · Ordem 43 · Must · G (16 h) · Sessão

Como GFIN, quero importar o plano de contas de 5 níveis por planilha .xlsx com validação, para ter a estrutura oficial no sistema.

Critérios de aceite:
- Valida 5 níveis, pai existente, analítica só no nível 5, reduzido único
- Recarga idempotente por código reduzido; nunca apaga conta com valor
- 10.000 linhas em menos de 30 s (RNF_DES_003)
- Descrição da 4.1.1.8.005 gravada sem a sigla (GAP-CAD-005)

<sub>Referências: UC03.00; D7; spec 6.1 · Depende de: US-009, US-021</sub>

**US-044** · Ordem 44 · Must · P (4 h) · Sessão

Como usuário, quero consultar o plano de contas em árvore, só leitura, para encontrar contas rapidamente.

Critérios de aceite:
- Sem incluir, alterar estrutura ou excluir
- Busca por código, reduzido e descrição

<sub>Referências: UC03.00; RN_PLA_001; C27 · Depende de: US-043</sub>

**US-046** · Ordem 45 · Must · M (8 h) · Ultracode

Como GFIN, quero importar e consultar os centros de custo de 5 níveis por planilha, para orçar por área.

Critérios de aceite:
- Valida níveis, pai, sintético com filho e reduzido único
- Avisa se faltar CC de gestão (regra R3)
- Carga em prod só após aprovação da DIREX

<sub>Referências: spec 6.1a · Depende de: US-043 · **GAP:** GAP-CC-001/002/003</sub>

**US-045** · Ordem 52 · Should · P (4 h) · Sessão

Como GFIN, quero parametrizar a natureza (OPEX/CAPEX) e as faixas do semáforo por conta analítica, para orientar os relatórios.

Critérios de aceite:
- Só parâmetros locais; a estrutura não muda
- Faixas padrão 70/85/95

<sub>Referências: RF_PLA_REQ_003; RN_PLA_006; C7 · Depende de: US-044</sub>

**US-047** · Ordem 53 · Should · M (8 h) · Ultracode

Como GFIN, quero cadastrar agrupadores de contas (N:N com analíticas) para relatórios, para agrupar contas sem mexer no plano.

Critérios de aceite:
- Agrupador não é conta sintética
- Usado só nos relatórios

<sub>Referências: RN_PLA_007–011 · Depende de: US-044</sub>

#### EP07 — Pessoal-base (estrutura funcional, cargos, benefícios) (48 h)

**US-048** · Ordem 46 · Must · M (8 h) · Ultracode

Como analista GRH, quero manter a estrutura funcional em árvore, para refletir a organização dos setores.

Critérios de aceite:
- Árvore com setor superior
- Vínculo de cargo 1:1 por setor (C&S V4)

<sub>Referências: UC03.18; C2 · Depende de: US-021</sub>

**US-049** · Ordem 47 · Must · G (16 h) · Sessão

Como analista GRH, quero manter cargos e salários (faixa, nível, Fonte Ativa, adicionais) e a tabela salarial, para calcular o custo de pessoal.

Critérios de aceite:
- Fonte Ativa: Mínimo, Máximo, Total, Salário Real ou Salário Definido
- Periculosidade 30% ou insalubridade 10/20/40% sobre o SMN
- Salários criptografados e mascarados por perfil (D10)

<sub>Referências: UC03.19 V4; RN_CAR_*; C20 · Depende de: US-048</sub>

**US-050** · Ordem 48 · Must · M (8 h) · Ultracode

Como analista GRH, quero a Tabela Mestre de Benefícios, para que propostas e o orçamento da Adm. Central usem os mesmos valores.

Critérios de aceite:
- Sobrescrita com auditoria e origem registrada
- Nunca altera snapshot oficializado

<sub>Referências: UC03.28; RN_CAR_06/07; C8 · Depende de: US-049</sub>

**US-051** · Ordem 49 · Must · G (16 h) · Sessão

Como sistema, quero o MotorCustoPosicao (massa, férias + 1/3, 13º, encargo 51%, benefícios), para que o custo de pessoal seja calculado num só lugar.

Critérios de aceite:
- Encargo 51% = INSS 38 + FGTS 8 + PIS 1 + 3,8 + 0,2, parametrizado
- Componentes lançados nas contas analíticas (tabela componente → conta)
- Testes com valores conferidos à mão

<sub>Referências: RN_CAR_17; spec 6.4, 6.6 · Depende de: US-005, US-049, US-050 · **GAP:** GAP-CAR-005 (contas)</sub>

#### EP08 — Parâmetros e Central de Cálculos (24 h)

**US-052** · Ordem 50 · Must · M (8 h) · Ultracode

Como GFIN, quero cadastrar impostos e alíquotas com vigência, para que propostas e relatórios usem a alíquota certa.

Critérios de aceite:
- Vigência por competência
- Alíquota congelada no snapshot

<sub>Referências: UC03.01; RN_TAX_03 · Depende de: US-021</sub>

**US-053** · Ordem 51 · Must · M (8 h) · Ultracode

Como GFIN, quero manter parâmetros gerais (SMN, premissas de reajuste, data-base, IPCA, semáforo, encargos), para ajustar o sistema sem programar.

Critérios de aceite:
- Parâmetros por exercício
- Alteração auditada

<sub>Referências: spec 6.6; GAP-ORC-003 · Depende de: US-021 · **GAP:** GAP-ORC-003 (valores)</sub>

**US-054** · Ordem 54 · Could · M (8 h) · Ultracode

Como GFIN, quero cadastrar as regras de totalização parametrizadas, para definir totais especiais dos relatórios.

Critérios de aceite:
- Regra usa o TotalizerService
- Somente leitura nos totalizadores da proposta (RN_TOT_01)

<sub>Referências: UC03.02 · Depende de: US-009</sub>

### R3 — Orçamento da Administração Central + IA onda 1 (parte) (9 histórias, 84 h)

#### EP09 — Orçamento da Administração Central (64 h)

**US-055** · Ordem 55 · Must · M (8 h) · Sessão

Como GFIN, quero criar o exercício do ano seguinte (em branco ou copiando o anterior), para elaborar o orçamento de 2027 enquanto 2026 está em execução.

Critérios de aceite:
- Um exercício por ano; vários convivem
- Cópia traz posições e pacotes com as premissas do novo ano
- Seletor de exercício no topo

<sub>Referências: UC04.17; spec 6.6 · Depende de: US-053</sub>

**US-056** · Ordem 56 · Must · G (16 h) · Sessão

Como gestor de diretoria, quero lançar posições de pessoal nos CCs da minha diretoria, com prévia do custo, para orçar minha equipe.

Critérios de aceite:
- Cargo do cadastro de C&S, salário pela Fonte Ativa (editável com log)
- Prévia: massa, férias + 13º, encargos, benefícios, anual
- Validação no servidor do escopo da diretoria

<sub>Referências: UC04.17; spec 6.6 · Depende de: US-051, US-055</sub>

**US-057** · Ordem 57 · Must · G (16 h) · Sessão

Como gestor de diretoria, quero lançar pacotes base zero (conta, justificativa, prioridade, distribuição), para orçar as demais despesas.

Critérios de aceite:
- Justificativa ≥ 10 caracteres; contas de pessoal fora da lista
- Mensal (12 parcelas que fecham o anual) ou pontual
- Correção opcional pelo IPCA do exercício

<sub>Referências: UC04.17 · Depende de: US-055, US-046</sub>

**US-058** · Ordem 58 · Must · M (8 h) · Sessão

Como GFIN, quero a visão por centro de custo com árvore, série mês a mês e linhas CC × conta, para consolidar o orçamento.

Critérios de aceite:
- Sintéticos somados pelo TotalizerService
- Origem de cada linha (pessoal / base zero)

<sub>Referências: UC04.17; RN_TOT_01 · Depende de: US-056, US-057</sub>

**US-059** · Ordem 59 · Must · M (8 h) · Sessão

Como GFIN, quero o teto do exercício com semáforo e o resultado (receita − despesas), para fechar o orçamento dentro da receita.

Critérios de aceite:
- Teto padrão = rateio líquido confirmado (teto manual antes da F3)
- Teto maior que a receita exige justificativa
- Faixas 70/85/95

<sub>Referências: spec 6.6 · Depende de: US-058</sub>

**US-061** · Ordem 60 · Must · M (8 h) · Sessão

Como GFIN, quero enviar o orçamento da Adm. Central para aprovação e oficializá-lo com snapshot, para formalizar o orçamento do ano.

Critérios de aceite:
- Ciclo Rascunho → Em Elaboração → Em Aprovação → Oficializado
- Snapshot imutável na oficialização

<sub>Referências: UC04.17; spec 6.2 · Depende de: US-059, US-042 · **GAP:** GAP-ORC-004 (alçada)</sub>

#### EP10 — IA onda 1 (20 h)

**US-062** · Ordem 61 · Should · M (8 h) · Sessão

Como usuário, quero que o sistema sugira a conta e o CC pela descrição do gasto, para lançar na conta certa.

Critérios de aceite:
- 3 sugestões com motivo; a pessoa escolhe
- Avaliação em hml com acerto mínimo antes de ligar

<sub>Referências: IA-01 · Depende de: US-019, US-057 · **GAP:** GAP-IA-001 (priorização)</sub>

**US-063** · Ordem 62 · Should · P (4 h) · Sessão

Como gestor, quero ajuda para redigir a justificativa do pacote base zero e sugerir a prioridade, para defender melhor o orçamento.

Critérios de aceite:
- Texto sugerido editável; nada gravado sem aceite
- Selo "Gerado com IA – revisar"

<sub>Referências: IA-02 · Depende de: US-019, US-057 · **GAP:** GAP-IA-001</sub>

**US-064** · Ordem 63 · Should · M (8 h) · Sessão

Como GFIN, quero um revisor de consistência antes de enviar o orçamento, para reduzir idas e voltas na aprovação.

Critérios de aceite:
- Lista de achados com link para a linha
- Usa ferramentas somente leitura com RBAC

<sub>Referências: IA-03 · Depende de: US-019, US-061 · **GAP:** GAP-IA-001</sub>

### R4 — Propostas / Termos de Parceria (14 histórias, 176 h)

#### EP11 — Proposta, versões e capa do TP (48 h)

**US-065** · Ordem 65 · Must · G (16 h) · Sessão

Como orçamentista, quero criar a proposta de TP (capa, categoria, vigência, CC), para iniciar o orçamento de um novo Termo de Parceria.

Critérios de aceite:
- Valor global sempre calculado (ORIGEM BLINDADA)
- CC único entre projetos ativos

<sub>Referências: UC03.04–UC03.07; RF_TP_001; RN_TP_001 · Depende de: US-046, US-031 · **GAP:** GAP-CC-004 (CC por TP)</sub>

**US-066** · Ordem 66 · Must · M (8 h) · Sessão

Como orçamentista, quero versionar e duplicar propostas, para revisar sem perder o histórico e reaproveitar propostas.

Critérios de aceite:
- Versionar = nova revisão da mesma proposta; duplicar = proposta nova em Rascunho
- Oficializado/Em Aprovação só leitura

<sub>Referências: UC03.08–UC03.09; RN_DUP_001–008 · Depende de: US-065</sub>

**US-067** · Ordem 67 · Must · M (8 h) · Ultracode

Como orçamentista, quero cadastrar as metas da proposta, para vincular despesas às entregas.

Critérios de aceite:
- Toda despesa logística exige meta (RN_VIA_04)

<sub>Referências: UC03.14–UC03.17 · Depende de: US-065</sub>

**US-068** · Ordem 74 · Should · M (8 h) · Ultracode

Como orçamentista, quero a pré-visualização da proposta, para revisar tudo antes de enviar.

Critérios de aceite:
- Documento com todas as seções e totais
- Disponível em Rascunho

<sub>Referências: UC03.38 · Depende de: US-071</sub>

**US-069** · Ordem 77 · Could · M (8 h) · Sessão

Como orçamentista, quero que o sistema leia o PDF do contrato e pré-preencha a capa, para digitar menos.

Critérios de aceite:
- Campos sugeridos para confirmação
- Nada gravado sem aceite

<sub>Referências: IA-06 · Depende de: US-019, US-065 · **GAP:** GAP-IA-001</sub>

#### EP12 — Pessoal, viagens e bens na proposta (48 h)

**US-070** · Ordem 68 · Must · GG (24 h) · Sessão

Como orçamentista, quero lançar quantidade de empregados por cargo, meta e competência, e os empregados (inclusive "A CONTRATAR"), para orçar o pessoal do TP.

Critérios de aceite:
- Custo pelo MotorCustoPosicao
- Finalizar lançamentos envia o lote ao WA05

<sub>Referências: UC03.20–UC03.27; RN0243; RN_WA05 · Depende de: US-051, US-065</sub>

**US-071** · Ordem 69 · Must · G (16 h) · Ultracode

Como orçamentista, quero cadastrar viagens (pessoas, dias, passagem, diária, transporte) com teto da conta e painel por categoria, para orçar deslocamentos.

Critérios de aceite:
- Custo = RN_VIA_03 (sem transporte); transporte exibido no painel
- Rejeição acima do teto da conta
- Editar, copiar e excluir

<sub>Referências: UC03.29–UC03.33; Viagens V3; RN_VIA_01–05; C6; C19 · Depende de: US-067 · **GAP:** GAP-VIA-001/002/003</sub>

**US-072** · Ordem 70 · Must · M (8 h) · Ultracode

Como orçamentista, quero cadastrar bens, serviços e equipamentos (CAPEX) em contas analíticas do nível 5, para orçar investimentos.

Critérios de aceite:
- Valor total = quantidade × unitário (RN0157)
- Soft delete quando há snapshot

<sub>Referências: UC03.34–UC03.36 (≡ UC04.13–16) · Depende de: US-065</sub>

#### EP13 — Totalizadores, rateio/ISS e cronograma (80 h)

**US-060** · Ordem 64 · Must · G (16 h) · Sessão

Como GFIN, quero a aba de receitas com o rateio de cada TP no exercício (confirmado e previsto) e o ISS, para saber quanto a Adm. Central vai receber.

Critérios de aceite:
- Base = subtotal de despesas, % por TP, mês a mês
- Previsto separado, fora do saldo e do teto
- ISS mostra "a definir" até o GAP-ORC-007

<sub>Referências: RN0270; UC03.03; spec 6.6 · Depende de: US-055, US-073 · **GAP:** GAP-ORC-007 (ISS)</sub>

**US-073** · Ordem 71 · Must · G (16 h) · Sessão

Como orçamentista, quero a grade de rateio e ISS (taxa da Adm. Central) por competência, para calcular o que vai para a Adm. Central.

Critérios de aceite:
- Base = conta sintética mandante (subtotal de despesas)
- Replicar é ação explícita (C1)
- Congela na oficialização

<sub>Referências: UC03.03; RN_RAT_01–07; RN0270 · Depende de: US-065 · **GAP:** GAP-CAD-001 / GAP-ORC-007 (ISS)</sub>

**US-074** · Ordem 72 · Must · M (8 h) · Sessão

Como orçamentista, quero os totalizadores da proposta (somente leitura, com semáforo por linha), para ver os totais por conta.

Critérios de aceite:
- Sem botão de edição
- Recalculado pelo TotalizerService

<sub>Referências: UC03.02; RN_TOT_01–04 · Depende de: US-009, US-070</sub>

**US-075** · Ordem 73 · Must · G (16 h) · Sessão

Como orçamentista, quero o cronograma de desembolso e a previsão de despesas, para planejar os repasses.

Critérios de aceite:
- Recalculado ao salvar as abas que o afetam
- Descrições geradas pelo servidor

<sub>Referências: UC04.01; UC04.06; RN_RAT_05 · Depende de: US-074</sub>

**US-076** · Ordem 75 · Should · M (8 h) · Ultracode

Como orçamentista, quero premissas e aplicações de reajuste por conta e ano, para projetar a vigência.

Critérios de aceite:
- Dois blocos de premissas
- Reflete no cronograma

<sub>Referências: UC04.02 · Depende de: US-075</sub>

**US-077** · Ordem 76 · Should · G (16 h) · Ultracode

Como orçamentista, quero os demonstrativos de recursos, contratações previstas e estimativa de viagens, para montar o programa de trabalho.

Critérios de aceite:
- Recursos só para TP oficializado (RN_RE_005)
- Filtros obrigatórios por TP

<sub>Referências: UC04.03–UC04.05 · Depende de: US-075</sub>

### R5 — Aprovações + IA-13 (7 histórias, 88 h)

#### EP14 — Workflows de aprovação (88 h)

**US-078** · Ordem 78 · Must · G (16 h) · Sessão

Como aprovador, quero uma caixa de entrada com as pendências roteadas pela alçada, para aprovar ou rejeitar com justificativa.

Critérios de aceite:
- Rejeição exige ≥ 15 caracteres
- Titular não homologa o que submeteu (RN_WA02_006)
- Badges por situação

<sub>Referências: UC6.00–UC6.02; RF_APR_REQ_005 · Depende de: US-042</sub>

**US-079** · Ordem 79 · Must · G (16 h) · Sessão

Como orçamentista, quero enviar a proposta para oficialização (WA01), com validação das matrizes, para formalizar o TP.

Critérios de aceite:
- Submissão exige 100% das células
- Aprovar gera snapshot; rejeitar volta para Em Elaboração

<sub>Referências: UC6.00; RN_WA01_* · Depende de: US-078, US-075</sub>

**US-080** · Ordem 80 · Must · M (8 h) · Sessão

Como analista GRH, quero enviar o lote de pessoal para homologação (WA05), para validar o dimensionamento.

Critérios de aceite:
- Telas de pessoal só leitura durante a homologação
- Homologar propaga a folha ao cronograma

<sub>Referências: UC6.01; RN_WA05_* · Depende de: US-078, US-070</sub>

**US-081** · Ordem 81 · Must · M (8 h) · Sessão

Como operador de viagens, quero solicitar a validação das viagens (WA02), para formalizar a estimativa.

Critérios de aceite:
- Segregação de funções
- Bloqueio se conta pendente de sincronismo

<sub>Referências: UC6.02; RN_WA02_* · Depende de: US-078, US-071</sub>

**US-082** · Ordem 82 · Must · GG (24 h) · Sessão

Como orçamentista, quero elaborar termo aditivo e termo de ajuste com seus fluxos de aprovação, para alterar TPs oficializados.

Critérios de aceite:
- Rascunho retido se o usuário sair (RN0378)
- Oficializar recalcula o rateio na Adm. Central

<sub>Referências: UC04.10; UC03.13; C3 (WA03) · Depende de: US-079 · **GAP:** GAP-APR-001</sub>

**US-083** · Ordem 83 · Should · M (8 h) · Ultracode

Como orçamentista, quero solicitar remanejamento entre contas com aprovação, para ajustar o orçamento sem novo aditivo.

Critérios de aceite:
- Aprovadores pela alçada
- Histórico do remanejamento

<sub>Referências: UC04.09 · Depende de: US-078 · **GAP:** GAP-APR-001</sub>

**US-084** · Ordem 84 · Should · M (8 h) · Sessão

Como aprovador, quero um resumo com o que mudou desde a última versão e o impacto no total, no teto e no rateio, para decidir mais rápido.

Critérios de aceite:
- Diferença entre snapshots calculada pelo sistema
- Ajuda opcional para redigir a recusa

<sub>Referências: IA-13 · Depende de: US-019, US-078 · **GAP:** GAP-IA-001</sub>

### R6 — Execução orçamentária e Orçado × Realizado + IA onda 2 (11 histórias, 132 h)

#### EP15 — Execução orçamentária e realizado (72 h)

**US-085** · Ordem 85 · Must · GG (24 h) · Sessão

Como GFIN, quero carregar o realizado por TP × conta × competência (arquivo ou integração), para comparar com o orçado.

Critérios de aceite:
- Mês aberto: a carga substitui
- Mês fechado: imutável; diferença vira ajuste no mês aberto seguinte
- Conta desconhecida vira pendência

<sub>Referências: OxR V2 Integração 2; RN_OXR_001–013 · Depende de: US-043, US-079 · **GAP:** GAP-PGD-006/009 (formato)</sub>

**US-086** · Ordem 86 · Must · G (16 h) · Sessão

Como gestor, quero o demonstrativo de execução orçamentária com desvio e % de realização, para acompanhar o TP.

Critérios de aceite:
- Acima de 100% em vermelho e negrito
- Remanejamento a partir da tela

<sub>Referências: UC04.07; RN0314 · Depende de: US-085</sub>

**US-087** · Ordem 87 · Must · M (8 h) · Ultracode

Como gestor, quero o demonstrativo orçamentário analítico com filtros combinados, para analisar por conta, CC e natureza.

Critérios de aceite:
- CC vazio consolida e mostra "Todos"

<sub>Referências: UC04.08; RF_DA_003; RN_DA_003 · Depende de: US-085</sub>

**US-088** · Ordem 88 · Must · G (16 h) · Ultracode

Como GFIN, quero os demonstrativos de provisões e de aplicações financeiras, para controlar saldos e rendimentos.

Critérios de aceite:
- Edição só no mês corrente e futuros
- Exige TP oficializado

<sub>Referências: UC04.11; UC04.12; RN0360 · Depende de: US-085 · **GAP:** GAP-ORC-001 (RN0433/0434)</sub>

**US-089** · Ordem 89 · Must · M (8 h) · Sessão

Como GFIN, quero o realizado da Administração Central por CC, para acompanhar o orçamento do exercício.

Critérios de aceite:
- Orçado × realizado por CC e conta
- Realizado só leitura

<sub>Referências: spec 6.6 · Depende de: US-085, US-061 · **GAP:** GAP-PGD-006/009</sub>

#### EP16 — IA onda 2 (60 h)

**US-090** · Ordem 90 · Should · M (8 h) · Sessão

Como gestor, quero a explicação do desvio orçado × realizado em texto, para entender o porquê sem montar planilha.

Critérios de aceite:
- Cita meses, contas e ajustes
- Números das ferramentas, não da IA

<sub>Referências: IA-09 · Depende de: US-086 · **GAP:** GAP-IA-001</sub>

**US-091** · Ordem 91 · Should · G (16 h) · Sessão

Como GFIN, quero a previsão de fechamento do ano com as contas em risco de estouro, para agir antes.

Critérios de aceite:
- Projeção pelo motor determinístico
- IA destaca o mês do estouro

<sub>Referências: IA-10 · Depende de: US-086 · **GAP:** GAP-IA-001</sub>

**US-092** · Ordem 92 · Should · M (8 h) · Sessão

Como gestor, quero um alerta semanal por e-mail com os pontos de atenção do que é meu, para não depender de abrir o sistema.

Critérios de aceite:
- Job no worker
- Só dados do escopo do gestor

<sub>Referências: IA-11 · Depende de: US-086, US-025 · **GAP:** GAP-IA-001</sub>

**US-093** · Ordem 93 · Should · M (8 h) · Sessão

Como GFIN, quero ver onde o saldo provisionado está abaixo do necessário, para evitar surpresa no fechamento.

Critérios de aceite:
- Necessidade calculada pelo motor
- IA explica a diferença

<sub>Referências: IA-08 · Depende de: US-088 · **GAP:** GAP-IA-001</sub>

**US-094** · Ordem 94 · Could · P (4 h) · Sessão

Como GFIN, quero sugestão de correspondência para contas e CCs desconhecidos vindos do Senior, para destravar a integração.

Critérios de aceite:
- Sugestão confirmada por pessoa

<sub>Referências: IA-12 · Depende de: US-085 · **GAP:** GAP-IA-001</sub>

**US-095** · Ordem 95 · Could · G (16 h) · Sessão

Como GFIN, quero simular cenários e propostas de corte para caber no teto, para decidir em reunião.

Critérios de aceite:
- Cenário isolado; só vira orçamento pelo fluxo normal
- Cortes por algoritmo determinístico

<sub>Referências: IA-04; IA-05 · Depende de: US-059 · **GAP:** GAP-IA-001</sub>

### R7 — Relatórios, Book, Consolidado + IA onda 3 (13 histórias, 192 h)

#### EP17 — Relatórios e Book (72 h)

**US-096** · Ordem 96 · Must · G (16 h) · Ultracode

Como gestor, quero os relatórios financeiros (receitas e despesas sintético e analítico, despesas analítico), para prestar contas do TP.

Critérios de aceite:
- Exportação XLSX/PDF com marca d'água
- Filtros por TP e período

<sub>Referências: UC05.01; UC05.02; UC05.11 · Depende de: US-085</sub>

**US-097** · Ordem 97 · Must · G (16 h) · Ultracode

Como gestor, quero os relatórios de viagens (I e II) e de aquisições, para prestar contas dessas despesas.

Critérios de aceite:
- Mesmo padrão de relatório

<sub>Referências: UC05.03; UC05.07; UC05.04 · Depende de: US-085 · **GAP:** GAP-INT-013 (RVS)</sub>

**US-098** · Ordem 98 · Must · G (16 h) · Ultracode

Como analista GRH, quero os relatórios de pessoal (salários, distribuição, férias, Adm. Central custeada), para prestar contas da folha.

Critérios de aceite:
- Mascaramento de salários por perfil

<sub>Referências: UC05.05; UC05.06; UC05.09; UC05.10 · Depende de: US-085</sub>

**US-100** · Ordem 99 · Must · G (16 h) · Sessão

Como GFIN, quero emitir o Book mensal em lote, para entregar a prestação de contas completa.

Critérios de aceite:
- Só relatórios da categoria book
- Geração em job

<sub>Referências: UC05.12; RN0449 · Depende de: US-096, US-097, US-098 · **GAP:** GAP-REL-001</sub>

**US-099** · Ordem 102 · Should · M (8 h) · Ultracode

Como gestor, quero o relatório de execução física (produtos previstos × realizados), para acompanhar as entregas.

Critérios de aceite:
- Filtros por código e carta

<sub>Referências: UC05.08 · Depende de: US-067</sub>

#### EP18 — Administração Central: consolidado e rateio (24 h)

**US-101** · Ordem 100 · Must · M (8 h) · Sessão

Como diretor, quero o consolidado de todos os TPs (orçado, realizado, %), com acesso por permissão própria, para ter a visão do portfólio.

Critérios de aceite:
- Único lugar com vários TPs juntos
- Acesso auditado

<sub>Referências: spec 6.7 · Depende de: US-086</sub>

**US-102** · Ordem 101 · Must · G (16 h) · Sessão

Como GFIN, quero o rateio da Administração Central distribuído entre os TPs, para apropriar os custos centrais.

Critérios de aceite:
- Regra a definir

<sub>Referências: RN0270; REQ0277/0278 · Depende de: US-101, US-089 · **GAP:** GAP-REL-001 (regra de rateio)</sub>

#### EP19 — IA onda 3 (96 h)

**US-103** · Ordem 103 · Should · GG (24 h) · Sessão

Como GFIN, quero o rascunho do relatório executivo mensal (indicadores, gráficos, riscos e recomendações) em PDF e PPTX, para apresentar aos diretores e gerentes.

Critérios de aceite:
- Gráficos gerados pelo sistema
- GFIN revisa e aprova antes de distribuir

<sub>Referências: IA-14 · Depende de: US-101, US-019 · **GAP:** GAP-IA-001</sub>

**US-104** · Ordem 104 · Should · GG (24 h) · Sessão

Como diretor, quero perguntar ao SGO em linguagem comum e receber o número com fonte e link, para não depender de quem domina os relatórios.

Critérios de aceite:
- Ferramentas somente leitura com RBAC e TP
- Resposta cita a fonte

<sub>Referências: IA-16 · Depende de: US-096, US-019 · **GAP:** GAP-IA-001</sub>

**US-105** · Ordem 105 · Could · G (16 h) · Sessão

Como GFIN, quero o roteiro de apresentação para reunião de diretoria sobre um tema, para preparar reuniões com dados confiáveis.

Critérios de aceite:
- Slides a partir dos dados consolidados

<sub>Referências: IA-15 · Depende de: US-103 · **GAP:** GAP-IA-001</sub>

**US-106** · Ordem 106 · Could · M (8 h) · Sessão

Como diretor, quero o comparativo entre TPs com comentários sobre os pontos fora da curva, para avaliar o portfólio.

Critérios de aceite:
- Só no menu da Adm. Central

<sub>Referências: IA-17 · Depende de: US-101 · **GAP:** GAP-IA-001</sub>

**US-107** · Ordem 107 · Could · M (8 h) · Sessão

Como analista GRH, quero a análise do quadro de pessoal só com agregados, para apoiar decisões de dimensionamento.

Critérios de aceite:
- Nunca envia nomes nem salários individuais

<sub>Referências: IA-07 · Depende de: US-070 · **GAP:** GAP-IA-001</sub>

**US-108** · Ordem 108 · Could · G (16 h) · Sessão

Como usuário, quero ajuda contextual "como faço..." com base no manual, para usar o sistema sem chamar o suporte.

Critérios de aceite:
- Cita o trecho do manual
- Base: regras do sistema; o manual (US-118) é incorporado quando estiver pronto

<sub>Referências: IA-18 · Depende de: US-020 · **GAP:** GAP-IA-002</sub>

### R8 — Integrações Senior/Rubi/RVS (6 histórias, 88 h)

#### EP20 — Integrações (88 h)

**US-109** · Ordem 109 · Should · G (16 h) · Sessão

Como GFIN, quero a sincronização do plano de contas com o Senior (Integração 1), para não depender de planilha.

Critérios de aceite:
- Mesmo modelo da carga por arquivo (troca só o adaptador)
- Lock pessimista no sincronismo; timeout 10 s

<sub>Referências: Integração V4; OxR Integração 1 · Depende de: US-043 · **GAP:** GAP-INT-001</sub>

**US-110** · Ordem 110 · Should · M (8 h) · Sessão

Como GFIN, quero a sincronização dos centros de custo com o Senior, para manter os CCs atualizados.

Critérios de aceite:
- Mesmo modelo da carga por arquivo

<sub>Referências: GAP-INT-014 · Depende de: US-046 · **GAP:** GAP-INT-014</sub>

**US-111** · Ordem 111 · Should · G (16 h) · Sessão

Como analista GRH, quero a sincronização de cargos, salários e estrutura funcional com o Rubi/Senior, para não digitar dados de RH.

Critérios de aceite:
- Dados sincronizados só leitura no SGO

<sub>Referências: Integração V4 (Rubi) · Depende de: US-049 · **GAP:** GAP-INT-005</sub>

**US-112** · Ordem 112 · Should · G (16 h) · Sessão

Como GFIN, quero o realizado do Senior por integração (Integração 2), para não carregar arquivo todo mês.

Critérios de aceite:
- Mesmas regras de mês aberto/fechado

<sub>Referências: OxR Integração 2 · Depende de: US-085 · **GAP:** GAP-PGD-006/009</sub>

**US-113** · Ordem 113 · Could · G (16 h) · Sessão

Como operador de viagens, quero a integração com o RVS, para trazer as viagens realizadas.

Critérios de aceite:
- Fallback manual mantido

<sub>Referências: Integração V4 (RVS) · Depende de: US-097 · **GAP:** GAP-INT-013</sub>

**US-114** · Ordem 114 · Could · G (16 h) · Sessão

Como usuário, quero entrar com o login da intranet, para não ter mais uma senha.

Critérios de aceite:
- Novo adaptador da porta ProvedorIdentidade
- Bloqueio e manutenção continuam valendo

<sub>Referências: EP084 V5 objetivo; D2 · Depende de: US-026 · **GAP:** GAP-AUT-001</sub>

### R9 — Go-live e operação (5 histórias, 64 h)

#### EP21 — Go-live e operação (64 h)

**US-115** · Ordem 115 · Must · M (8 h) · Sessão

Como PO, quero a carga inicial de produção (plano de contas, CCs aprovados, cargos, parâmetros, usuários), para começar a operar.

Critérios de aceite:
- Carga validada em hml antes
- Conferência dos totais com a GFIN

<sub>Referências: spec 6.1, 6.1a · Depende de: US-043, US-046, US-049 · **GAP:** GAP-CC-001</sub>

**US-116** · Ordem 116 · Must · G (16 h) · Ultracode

Como PO, quero testes de carga e de segurança (OWASP, isolamento por TP, login), para entrar em produção com confiança.

Critérios de aceite:
- Metas de desempenho da 10.3 atendidas
- Sem achado crítico ou alto em aberto

<sub>Referências: RNF gerais (spec 10.3) · Depende de: US-031</sub>

**US-117** · Ordem 117 · Must · G (16 h) · Sessão

Como usuário-chave, quero homologar cada release em hml com roteiro de testes, para aprovar o que vai para produção.

Critérios de aceite:
- Roteiro por release
- Aceite registrado

<sub>Referências: spec 11.6 · Depende de: —</sub>

**US-119** · Ordem 118 · Must · M (8 h) · Sessão

Como PO, quero o runbook de operação (deploy, rollback, restauração, incidentes), para operar sem depender de uma pessoa.

Critérios de aceite:
- Restauração testada documentada
- Procedimento de rollback testado

<sub>Referências: spec 4.3, 11.5 · Depende de: US-015</sub>

**US-118** · Ordem 119 · Should · G (16 h) · Ultracode

Como usuário, quero o manual do usuário e o treinamento por perfil, para usar o sistema desde o primeiro dia.

Critérios de aceite:
- Manual por perfil, sem o nome da instituição
- Material de treinamento

<sub>Referências: — · Depende de: US-031</sub>

## 7. GAPs que bloqueiam histórias

| GAP | Histórias afetadas |
| --- | --- |
| GAP-ADM-001 (ajuste fino) | US-037 |
| GAP-APR-001 | US-082, US-083 |
| GAP-APR-001 (aditivo/ajuste/remanejamento) | US-042 |
| GAP-AUT-001 | US-114 |
| GAP-AUT-002 | US-030 |
| GAP-AUT-002 (valores) | US-027 |
| GAP-CAD-001 / GAP-ORC-007 (ISS) | US-073 |
| GAP-CAR-005 (contas) | US-051 |
| GAP-CC-001 | US-115 |
| GAP-CC-001/002/003 | US-046 |
| GAP-CC-004 (CC por TP) | US-065 |
| GAP-IA-001 | US-063, US-064, US-069, US-084, US-090, US-091, US-092, US-093, US-094, US-095, US-103, US-104, US-105, US-106, US-107 |
| GAP-IA-001 (priorização) | US-062 |
| GAP-IA-002 | US-020, US-108 |
| GAP-INF-001 (SMTP) | US-025 |
| GAP-INF-001 (domínio) | US-014 |
| GAP-INF-001 (storage) | US-015 |
| GAP-INT-001 | US-109 |
| GAP-INT-005 | US-111 |
| GAP-INT-013 | US-113 |
| GAP-INT-013 (RVS) | US-097 |
| GAP-INT-014 | US-110 |
| GAP-ORC-001 (RN0433/0434) | US-088 |
| GAP-ORC-003 (valores) | US-053 |
| GAP-ORC-004 (alçada) | US-061 |
| GAP-ORC-007 (ISS) | US-060 |
| GAP-PGD-006/009 | US-089, US-112 |
| GAP-PGD-006/009 (formato) | US-085 |
| GAP-REL-001 | US-100 |
| GAP-REL-001 (regra de rateio) | US-102 |
| GAP-VIA-001/002/003 | US-071 |

