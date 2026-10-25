# Deploy do SGO: hml e prod

Como a imagem chega a hml e a prod (US-013; plano do P3, Tarefa 4). O runbook completo, com rollback, restauração e incidentes, vem na US-119 (Tarefa 8).

## Como funciona

| Evento | O que acontece | Quem aprova |
| --- | --- | --- |
| Merge na `main` | O `imagem.yml` publica `sgov2:sha-<commit>` e `sgov2:hml`, registra o digest no artefato `origem-imagem` do run e chama o webhook de hml | Ninguém: é automático |
| Tag `vX.Y.Z` | O `verificar-prod` confere o commit e pega o digest do artefato do run da `main` daquele commit. Depois, o `prod` copia esse digest para `sgov2-prod:vX.Y.Z` e `:prod` e chama o webhook de prod | **O PO**, no *environment* `producao` |
| `workflow_dispatch` `acao=teste` | Publica só `sgov2:teste-<nome>`, sem deploy | Ninguém |
| `workflow_dispatch` `acao=rollback` com `--ref vX.Y.Z` | `sgov2-prod:prod` volta para `vX.Y.Z` e o webhook de prod é chamado | **O PO**, no *environment* `producao` |

As sessões do Claude Code não criam tag `v*`, não aprovam o *environment* e não disparam o `imagem.yml`: o hook `guarda-bash` bloqueia. Quem faz isso é o PO.

## Origem da imagem

O digest que vai para prod vem do artefato `origem-imagem` do run do `imagem.yml` no push na `main` do commit da tag. O `verificar-prod` acha esse run pela API do GitHub, filtrando por workflow, evento, branch e commit, e só aceita um run com sucesso. Outro run não grava no artefato dele. A tag `sgov2:sha-<commit>` não entra na conta, porque qualquer branch com `packages: write` pode sobrescrevê-la.

- **Por que não a atestação do GitHub:** a `attest-build-provenance` não existe para repositório privado de usuário. O primeiro run na `main` (`36f27a4`) falhou nesse passo.
- **O artefato dura 90 dias**, o máximo padrão do repositório. Para lançar um commit mais antigo, faça a tag num commit mais novo da `main`. Para guardar por mais tempo, aumente a retenção em *Settings → Actions → General* (até 400 dias) e o `retention-days` do `imagem.yml`.
- **Se o run da `main` falhou ou foi cancelado** (o webhook de hml fora do ar, ou um merge mais novo na fila do `deploy-hml`), o commit não vai para prod.
  - Se ele é o HEAD da `main`, rode de novo os jobs que falharam e só depois faça a tag.
  - Se não é, faça a tag num commit mais novo. Rodar de novo o run de um commit antigo refaz o build com outro digest e volta hml para esse commit.
- **Tag feita antes de o run da `main` terminar:** o `verificar-prod` falha com "Não há run com sucesso". Espere o run da `main` e rode de novo o job `verificar-prod` da tag.

## Antes da primeira tag (PO, uma vez)

O `homologacao` foi criado sozinho pelo primeiro run, sem restrição, e o `producao` ainda não existe. Um job que cita um *environment* inexistente cria-o sem revisor. Por isso, antes de cadastrar qualquer secret e antes da primeira tag:

1. `homologacao`: em *Deployment branches*, só a `main`.
2. Criar o `producao`: você como revisor obrigatório e, em *Deployment branches and tags*, só as tags `v*`.
3. Só então cadastrar os secrets da tabela de credenciais.

## Antes de aprovar um deploy de prod (PO)

1. **Na tela do run, e não no resumo:** confira que o commit da tag é o HEAD da `main` ou um ancestral dela, e que o workflow que rodou é o `.github/workflows/imagem.yml` da `main`.
   - O resumo do run é escrito pelo próprio workflow. Se uma tag for posta num commit de branch com o workflow alterado, esse workflow pode pular as checagens e escrever um resumo falso.
   - A sua aprovação é a barreira contra isso.
2. **Se o resumo disser "há migration", ou se for a primeira release:** tire o snapshot da VPS no hPanel da Hostinger e só depois aprove (spec §4.3).
3. **Depois de aprovar:** confira no Easypanel que o serviço `app` de prod subiu a versão nova. O webhook responder 2xx só quer dizer que o Easypanel recebeu o pedido. A conferência automática do deploy entra na Tarefa 6.

## Migration presa (P3009)

Quando uma migration falha, o Prisma a marca como falha em `_prisma_migrations` e recusa as seguintes. A versão anterior continua no ar, porque a atualização é *start-first*. Para destravar:

1. No Easypanel, volte o serviço `app` para a imagem anterior.
2. No console do serviço, rode `/app/docker/entrypoint.sh resolver <nome-da-migration>`.
3. Corrija a migration num PR novo, porque migration mergeada nunca é editada (spec §12.7), e faça o deploy de novo.

**Console do Easypanel:** como a imagem não tem `USER node`, o console e o `docker exec` entram como root. É assim que o `resolver` funciona. Use o console só para os procedimentos deste documento.

## Credenciais (só nos *environments* do GitHub e no Easypanel)

| Onde | Nome | Para quê |
| --- | --- | --- |
| *environment* `homologacao` (só a `main`) | `EASYPANEL_WEBHOOK` | Deploy de hml |
| *environment* `homologacao` | variável `HML_WEBHOOK_OBRIGATORIO=1` (depois da Tarefa 6) | A falta do webhook passa a ser erro, não só aviso |
| *environment* `producao` (só tags `v*`, revisor: PO) | `EASYPANEL_WEBHOOK` | Deploy de prod |
| *environment* `producao` | `GHCR_PROD_TOKEN` | Gravar em `sgov2-prod` |

- **`GHCR_PROD_TOKEN`:** é um PAT clássico com `read:packages` e `write:packages`, e grava em **todos** os pacotes do usuário, não só no `sgov2-prod`. Guarde-o só no *environment* `producao` e troque-o se houver suspeita de vazamento.
- **Logo depois do primeiro push em `sgov2-prod`:** em *Package settings → Manage Actions access*, deixe o repositório com **só leitura**. Assim, um workflow de branch com o `GITHUB_TOKEN` não grava no pacote de prod.
- **Credencial de leitura do GHCR para o Easypanel:** use uma por ambiente, só de leitura.

## A imagem

- `docker/app.Dockerfile`: app Next.js *standalone* mais o migrador autossuficiente em `/opt/migrador`. O `tini -g` é o PID 1, e ele e o entrypoint (com a migração) rodam como root. O servidor desce para o usuário `node` com `setpriv`, sem capacidades. Os arquivos pertencem ao root, e o `node` grava só em `/app/.next/cache`. Se uma rota futura usar ISR ou `revalidate`, ela vai precisar de escrita em `/app/.next/server`.
- `docker/entrypoint.sh app`: migra o banco e só sobe o servidor se a migração passar. O servidor sobe **sem** a `MIGRATE_DATABASE_URL` no ambiente, e o usuário `node` não lê o ambiente do PID 1, onde ela está. O passo 7 do `testar-imagem.sh` prova isso.
- Variáveis do serviço `app`: `DATABASE_URL` (`sgo_app`) e `MIGRATE_DATABASE_URL` (`sgo_migrator`).
- **Serviço `worker`:** a mesma imagem, com o comando (argumento) `worker`. Variáveis: `DATABASE_URL` (`sgo_app`) e `FILA_DATABASE_URL` (`sgo_fila`), sem a `MIGRATE_DATABASE_URL`, porque quem migra é só o app.
  - O worker roda o bundle `/app/worker/index.mjs`, gerado pelo `worker/build.mjs` com esbuild no build da imagem. Ele também desce para o usuário `node` com `setpriv`.
  - Sem a `FILA_DATABASE_URL`, ele sai com o código 64. Com falhas seguidas no outbox (banco fora, schema ainda não migrado), ele sai sozinho, e o Easypanel o reinicia.
  - O *healthcheck* (`docker/saude.sh`) testa o `/login` no app. No worker, que não abre porta, ele só confirma que o processo está vivo.
- Teste da imagem: `docker/testes/testar-imagem.sh <imagem>`, que roda no job `Imagem` do CI. O passo 8 sobe o worker, publica uma mensagem real do outbox no pg-boss e confere o encerramento no SIGTERM. Na VPS, rode com `nice -n 10`, um processo pesado por vez (D12).
