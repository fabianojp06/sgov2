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
3. **Depois de aprovar:** confira no Easypanel que os serviços `app` e `worker` de prod subiram a versão nova (o webhook do worker é chamado depois do do app, que é quem migra; se o worker subir antes da migração terminar, ele sai pelas falhas do outbox e reinicia até o schema chegar). O webhook responder 2xx só quer dizer que o Easypanel recebeu o pedido. A conferência automática do deploy entra na Tarefa 6.

## Migration presa (P3009)

Quando uma migration falha, o Prisma a marca como falha em `_prisma_migrations` e recusa as seguintes. A versão anterior continua no ar, porque a atualização é *start-first*. Para destravar:

1. No Easypanel, volte o serviço `app` para a imagem anterior.
2. No console do serviço, rode `/app/docker/entrypoint.sh resolver <nome-da-migration>`.
3. Corrija a migration num PR novo, porque migration mergeada nunca é editada (spec §12.7), e faça o deploy de novo.

**Console do Easypanel:** como a imagem não tem `USER node`, o console e o `docker exec` entram como root. É assim que o `resolver` funciona. Use o console só para os procedimentos deste documento.

## Seed e administrador inicial (#195)

A imagem traz a seed (`prisma/seed.ts` em bundle, `/app/seed/seed.mjs`): configuração de acesso, perfis, catálogo, administrador inicial e os dados de referência do `cad`. Ela roda **só** num serviço próprio, nunca no `app` nem no `worker`.

- **Serviço `migracao`** (um por ambiente): a mesma imagem, com `implantar` no campo de argumentos. Ele migra, semeia e fica **parado e saudável** (`[IMPLANTAR_CONCLUIDO]` no log), para o Swarm do Easypanel não reiniciá-lo em laço. Uma falha na migração ou na seed encerra o contêiner com erro.
  - Variáveis: `MIGRATE_DATABASE_URL` (`sgo_migrator`) e `AMBIENTE` (`hml` ou `producao`).
  - Em hml, também `CARGA_DADOS_REFERENCIA=1`: plano de contas oficial, minuta de CC provisória e cargos sintéticos. Em prod, **sem** ela: a seed recusa (R15).
  - No `app` de hml, `CC_CARGA_PROVISORIA=1`; no de prod, **sem** ela.
- **Até a Tarefa 6 (sem webhook do `migracao`):** o deploy **não** semeia sozinho. A cada release com seed nova (catálogo, perfis, dados de referência), o PO faz o *redeploy* do serviço `migracao` no Easypanel **antes** do `app`.
- **Ordem:** `migracao` → `app` → `worker`. Os webhooks são assíncronos e o `app` também migra: a ordem **não é garantida**. As duas migrações juntas são seguras (o Prisma usa trava consultiva). Mas um `app` novo pode subir antes da seed; até ela terminar, o primeiro acesso e as funcionalidades novas do catálogo ficam indisponíveis.
- **Rollback:** voltar uma versão **não** chama o `migracao` (a seed antiga contra o schema novo não é testada). A seed da versão nova continua valendo.

### Primeiro deploy e administrador inicial

1. Acrescente ao serviço `migracao` as `ADMIN_INICIAL_LOGIN`, `ADMIN_INICIAL_EMAIL` e `ADMIN_INICIAL_SENHA` (16 ou mais caracteres) e faça o *redeploy* dele.
2. A senha inicial **expira em 7 dias** e exige troca no primeiro acesso. Um administrador com a senha expirada continua ativo, e o break-glass não dispara.
3. Depois do primeiro acesso, **tire as três variáveis do Easypanel e faça o *redeploy* do `migracao`**. Enquanto ele não reinicia, o PID 1 do contêiner parado ainda as tem.

### O que a seed faz e os alertas

- Banco **sem nenhum usuário** e sem as `ADMIN_INICIAL_*`: falha de propósito (`Administrador inicial: defina ...`), e o serviço sai com erro.
- Com usuários e sem as variáveis: só avisa, sem derrubar o deploy. `[ADMIN_INICIAL_AUSENTE]`: não há administrador ativo. `[ADMIN_INICIAL_CONFLITO]`: o login das variáveis já existe sem ser administrador ativo.
- **Ainda não há alerta automático** (entra com a conferência do deploy, na Tarefa 6). A cada *redeploy* do `migracao`, o PO confere o log: `[IMPLANTAR_CONCLUIDO]` é o normal; `[ADMIN_INICIAL_AUSENTE]` ou `[ADMIN_INICIAL_CONFLITO]` pede ação.
- **Só a seed** (sem migrar): `semear` no lugar de `implantar`. Ela sai ao terminar, então serve para o console, não como argumento do serviço.

### Break-glass: nenhum administrador ativo

1. No serviço `migracao`, defina as três `ADMIN_INICIAL_*` com um **login novo** (o login de um usuário que já existe dá `[ADMIN_INICIAL_CONFLITO]`).
2. Faça o *redeploy* do `migracao`. A seed cria o administrador só quando não há nenhum ativo, numa trava do banco: duas execuções juntas criam um só.
3. Entre com o login novo, troque a senha (ela expira em 7 dias) e reative ou corrija os administradores.
4. Tire as três variáveis e faça o *redeploy* do `migracao` de novo.
5. O Histórico registra a criação pelo sistema.

## Credenciais (só nos *environments* do GitHub e no Easypanel)

| Onde | Nome | Para quê |
| --- | --- | --- |
| *environment* `homologacao` (só a `main`) | `EASYPANEL_WEBHOOK` | Deploy de hml (serviço `app`) |
| *environment* `homologacao` | `EASYPANEL_WEBHOOK_WORKER` | Deploy de hml (serviço `worker`) |
| *environment* `homologacao` | variável `HML_WEBHOOK_OBRIGATORIO=1` (depois da Tarefa 6) | A falta do webhook passa a ser erro, não só aviso |
| *environment* `producao` (só tags `v*`, revisor: PO) | `EASYPANEL_WEBHOOK` | Deploy de prod (serviço `app`) |
| *environment* `producao` | `EASYPANEL_WEBHOOK_WORKER` | Deploy e rollback de prod (serviço `worker`) |
| *environment* `producao` | `GHCR_PROD_TOKEN` | Gravar em `sgov2-prod` |

- **`GHCR_PROD_TOKEN`:** é um PAT clássico com `read:packages` e `write:packages`, e grava em **todos** os pacotes do usuário, não só no `sgov2-prod`. Guarde-o só no *environment* `producao` e troque-o se houver suspeita de vazamento.
- **Logo depois do primeiro push em `sgov2-prod`:** em *Package settings → Manage Actions access*, deixe o repositório com **só leitura**. Assim, um workflow de branch com o `GITHUB_TOKEN` não grava no pacote de prod.
- **Credencial de leitura do GHCR para o Easypanel:** use uma por ambiente, só de leitura.

## E-mail com falha (US-025)

- **Novas tentativas:** até 3 depois da primeira, também quando o servidor recusa o endereço (EP083). Cada tentativa fica no Histórico de Operações (funcionalidade `ger.email`, tipo SISTEMA), com o destinatário mascarado e o resultado: `enviado`, `falha_temporaria`, `falha_definitiva` ou `expirada`.
- **Falha definitiva:** o log mostra `[EMAIL_FALHA_DEFINITIVA]`. O caminho de recuperação é **redefinir a senha** do usuário, que gera outra senha e outro e-mail. Mensagem com senha temporária de mais de 24 h nunca é enviada (`expirada`).
- **`[EMAIL_JOB_NAO_APAGADO]` com o id do job:** o job com os dados (que podem ter a senha temporária) não foi apagado da fila. O worker tenta de novo e, se já tinha enviado, só apaga, sem reenviar. **Todo `[EMAIL_JOB_NAO_APAGADO]` exige conferir o job à mão** um minuto depois (abaixo).
- **`[EMAIL_HISTORICO_FALHOU]`:** o Histórico daquela tentativa não foi gravado. O job é apagado mesmo assim no resultado final. Se o resultado era `enviado`, não ficou o marcador: uma queda do worker antes de apagar o job reenviaria o e-mail (a entrega é "pelo menos uma vez").
- **`[EMAIL_TENTATIVA_FALHOU]` repetido para o mesmo job:** o trabalhador falha antes de decidir (banco instável, por exemplo). Depois das tentativas da fila, o job pode terminar `failed` com os dados. Confira à mão.
- **Conferir e apagar à mão,** no console do serviço `db` do ambiente (Easypanel), como superusuário. Este comando só lê:

  ```sh
  psql -U postgres -d sgo -c "SELECT id, state, created_on FROM pgboss.job WHERE name = 'email.enviar' AND (state IN ('completed', 'failed') OR id = '<id do log>')"
  ```

  Apague só os jobs em `completed` ou `failed`. Um job em `retry`, `created` ou `active` ainda é do worker: apagá-lo cancela uma tentativa legítima, e o e-mail pode se perder sem Histórico final. Confira de novo depois de alguns minutos.

  Para cada id em `completed` ou `failed`, este comando **apaga** só aquele job:

  ```sh
  psql -U postgres -d sgo -c "DELETE FROM pgboss.job WHERE name = 'email.enviar' AND id = '<id>'"
  ```

  Um e-mail com falha definitiva se recupera redefinindo a senha do usuário.

## Saúde e alerta de indisponibilidade (US-017)

- **Endpoint:** `GET https://<host>/int/saude`, público, sem sessão.
  - Responde `200 {"status":"ok","banco":"ok","worker":"ok"}`, ou `503` com o componente que falhou: `banco: "falha"` (sem resposta em 2 s), ou `worker: "parado"` (sem sinal de vida há mais de 60 s).
  - Não mostra versão, dado nem erro, e nunca vai para cache.
- **Sinal de vida do worker:** o worker grava `sinal_vida` a cada ciclo do outbox (10 s) que dá certo, com a hora do banco.
  - Um worker que sobe mas não publica fica "parado" aqui, como no *healthcheck* do contêiner.
  - Logo depois de um deploy, o `503` por até 1 minuto é esperado, até o primeiro ciclo.
- **Alerta por e-mail (PO, uma vez por ambiente):** num monitor externo à VPS, que avisa mesmo com a VPS inteira fora (por exemplo, um plano gratuito de serviço de *uptime*):
  - um monitor HTTP para `https://<host>/int/saude`;
  - intervalo de 1 a 5 min;
  - alerta por e-mail ao PO quando a resposta não for 200 em 2 checagens seguidas.

  Um alerta de dentro da VPS cairia junto com ela. A conta e o e-mail do monitor não entram no repositório.
- **Em andamento:** a rota em si entra em seguida, depois de dois passos: a lista de rotas públicas no teste de arquitetura (PR `compartilhado`) e a liberação de `/int/saude` no `PUBLICAS` do `src/proxy.ts` (frente A, #138). Já estão na `main` o sinal de vida e a verificação.

## A imagem

- `docker/app.Dockerfile`: app Next.js *standalone*, o worker (bundle do esbuild em `/app/worker/index.mjs`), a seed (bundle em `/app/seed/seed.mjs`, `docker/seed/build.mjs`) e o migrador autossuficiente em `/opt/migrador`. O `tini -g` é o PID 1, e ele e o entrypoint (com a migração) rodam como root. O servidor desce para o usuário `node` com `setpriv`, sem capacidades. Os arquivos pertencem ao root, e o `node` grava só em `/app/.next/cache`. Se uma rota futura usar ISR ou `revalidate`, ela vai precisar de escrita em `/app/.next/server`.
- `docker/entrypoint.sh app`: migra o banco e só sobe o servidor se a migração passar. O servidor sobe **sem** a `MIGRATE_DATABASE_URL` no ambiente, e o usuário `node` não lê o ambiente do PID 1, onde ela está. O passo 7 do `testar-imagem.sh` prova isso.
- Variáveis do serviço `app`: `DATABASE_URL` (`sgo_app`), `MIGRATE_DATABASE_URL` (`sgo_migrator`) e `URL_PUBLICA` (o endereço público com `https`, que o app exige em produção desde a US-026; ver `CONFIAR_PROXY` no `.env.example`). Para a IA, também a `ANTHROPIC_API_KEY` (ver o serviço `worker`, abaixo).
- **Serviço `worker`:** a mesma imagem, com `worker` no campo de **argumentos** (o CMD) do Easypanel, sem trocar o *entrypoint*. O *healthcheck* e o `tini` dependem do *entrypoint* da imagem. Variáveis: `DATABASE_URL` (`sgo_app`), `FILA_DATABASE_URL` (`sgo_fila`), `AMBIENTE` (`hml` ou `producao`) e `URL_PUBLICA` (a **mesma** do app), além das de e-mail abaixo. Sem a `MIGRATE_DATABASE_URL`, porque quem migra é só o app.
  - **Partida:** sem `AMBIENTE` válido ou sem `URL_PUBLICA`, o worker não parte (`AMBIENTE ausente ou inválido`, `[URL_PUBLICA_AUSENTE]`, `[URL_PUBLICA_INVALIDA]`). Uma `URL_PUBLICA` diferente da do app faz todo e-mail ser recusado na revalidação (falha definitiva no Histórico), nunca sair com link errado.
  - **IA (US-018/US-019):** `ANTHROPIC_API_KEY` **no `app` e no `worker`**. O app chama a IA nas telas, e o worker nos jobs, como o revisor antes do envio para aprovação (US-064, fila `orc.revisar`). As chaves de hml e de prod são separadas, e cada uma fica só nas variáveis do Easypanel, nunca no repositório nem em `.env`. Sem a chave, nada quebra: a IA responde "A IA não está configurada neste ambiente." (`ia.desabilitada`), e o revisor sai só com os achados das regras. A chave só habilita o provedor. Ligar a IA é na tela **Inteligência artificial** (`/int/ia`, Administrador): chave geral, casos de uso e tetos mensais, tudo desligado por padrão.
  - **E-mail (US-025):** `SMTP_HOST`, `SMTP_PORTA`, `SMTP_SEGURANCA` (`tls` ou `starttls`; `nenhuma` só no Mailpit de dev), `SMTP_USUARIO`, `SMTP_SENHA` e `EMAIL_REMETENTE` (`Nome <nao-responda@dominio>`), **só no serviço `worker`**. Sem `SMTP_HOST`, o log mostra `[EMAIL_SEM_SMTP]` e cada e-mail falha até a configuração (pendência P7 do plano do P4, GAP-INF-001).
  - O worker roda o bundle `/app/worker/index.mjs`, gerado pelo `worker/build.mjs` com esbuild no build da imagem. O *source map* traz só arquivo e linha, sem o código-fonte. Ele também desce para o usuário `node` com `setpriv`.
  - Na partida, o log mostra `worker pronto`, com o ambiente e as filas com trabalhador (hoje, `email.enviar`).
  - Sem a `FILA_DATABASE_URL`, ele sai com o código 64. Com 6 falhas seguidas no outbox (banco fora, schema ainda não migrado), ou com um ciclo preso por mais de 5 minutos (`[OUTBOX_TRAVADO]`), ele sai sozinho, e o Easypanel o reinicia.
  - **Healthcheck** (`docker/saude.sh`): no app, testa o `/login`. No worker, exige o sinal de vida `/tmp/sgo-worker-vivo` com menos de 60 s. Ele é gravado a cada tique depois do primeiro ciclo do outbox com sucesso, e deixa de ser gravado com um ciclo em curso há mais de 60 s. Por isso, uma versão nova do worker que não consegue publicar nunca fica saudável. Limite: com o outbox vazio, o pg-boss não é chamado, e uma conexão dele quebrada não aparece no *healthcheck*.
  - O encerramento no SIGTERM cabe nos 10 s do `stop_grace_period` padrão quando não há mensagem sendo publicada. Com uma conexão presa, o worker sai à força em 9 s (`[WORKER_ENCERRAMENTO_FORCADO]`).
- Teste da imagem: `docker/testes/testar-imagem.sh <imagem>`, que roda no job `Imagem` do CI. O passo 8 sobe o worker, publica uma mensagem real do outbox no pg-boss e confere o encerramento no SIGTERM. O passo 9 prova que o *healthcheck* não fica verde sem servidor nem com o worker sem schema. Na VPS, rode com `nice -n 10`, um processo pesado por vez (D12).
