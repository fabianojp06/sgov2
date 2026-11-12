# Runbook de operação

Como operar o SGO em hml e prod sem depender de uma pessoa (US-119, #141; plano do P3, Tarefa 8; spec §4.3 e §11.5). Cada procedimento traz quando usar, as pré-condições, os passos, a verificação e como desfazer. O detalhe de cada assunto fica nos documentos citados:

- `deploy.md`: imagem, deploy, seed e comando dos serviços;
- `ambientes.md`: papéis, variáveis e estado dos ambientes;
- `backup.md`: backup, PITR e teste de restauração;
- `vps.md`: VPS, memória e endurecimento.

**Regras que valem para todo procedimento:**
- **Antes de mexer em prod**, tire o snapshot da VPS no hPanel (ou pelo MCP da Hostinger). Ele dura 24 h e é único: um novo substitui o anterior.
- As sessões do Claude Code **não** criam tag, não aprovam o *environment* `producao` e não disparam o `imagem.yml`. Quem faz isso é o PO.
- Segredo nunca vai para chat, e-mail ou repositório. Ele fica só no Easypanel, nos arquivos `0600` de `/etc/sgo` e no cofre do PO.
- **Painel do Easypanel:** `ssh -L 3000:127.0.0.1:3000 root@<ip>` → `http://localhost:3000`. Também abre pelo domínio padrão do Easypanel, com 2FA.

## 1. Deploy

**hml:** é automático. Cada merge na `main` faz o `imagem.yml` publicar `sgov2:hml` e chamar os webhooks do `app` e do `worker`.
1. **Verificar:** em até 1 minuto, `https://<hml>/int/saude` responde `ok`. Para conferir a versão, compare o digest registrado no run (`DIGEST` no log do job "Publicar e implantar em hml") com o digest da imagem em execução. No Easypanel, ele aparece no serviço; no host, em `docker image inspect`.
2. **Seed nova:** se o merge trouxe catálogo, perfis ou dados de referência novos, faça o *redeploy* do `migracao` no Easypanel. Hoje ele não tem webhook. O log deve terminar com `[IMPLANTAR_CONCLUIDO]`.
3. **Se o run da `main` ficar vermelho no webhook:** é o incidente 6.4.

**prod:** por tag, com a aprovação do PO.
1. **Pré-condições:**
   - o run do `imagem.yml` na `main` daquele commit terminou **com sucesso**;
   - o commit passou pela homologação em hml (`homologacao/README.md`).
2. Crie a tag no commit: `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`, ou pela tela de *Releases*.
3. O job **Verificar a release** confere três coisas:
   - o commit está na `main`;
   - o digest vem do artefato do run da `main`;
   - a imagem é do commit.

   Ele também escreve no resumo se há migration desde a release anterior.
4. **Se há migration, ou se é a primeira release:** tire o snapshot da VPS **antes** de aprovar.
5. **Aprove o *environment* `producao`.** Na tela do run, e não no resumo, confira que o commit é da `main` e que o workflow é o `imagem.yml` da `main` (`deploy.md`, "Antes de aprovar").
6. **Verificar:**
   - `https://<prod>/int/saude` responde `ok`;
   - o UptimeRobot do prod não alertou;
   - no Easypanel, o `app` e o `worker` estão na versão nova.
7. **Desfazer:** procedimento 2.

## 2. Rollback do app (sem mexer no banco)

**Quando usar:** a versão nova de prod tem defeito, **e a migration dela é compatível com a versão anterior**. Se ela só acrescentou, ou se não houve migration, a versão antiga roda sobre o schema novo.

**Regra para as duas frentes:** uma migration destrutiva (apagar ou renomear coluna ou tabela, mudar tipo) vai em **dois passos**:
1. *expandir*: acrescenta o novo, e o código passa a usar os dois;
2. *contrair*: numa release seguinte, remove o velho.

Assim, sempre dá para voltar uma versão.

1. **PO:**
   ```
   gh workflow run imagem.yml --ref vX.Y.Z -f acao=rollback
   ```
   `vX.Y.Z` é a release **anterior** boa. Aprove o *environment* `producao`.
2. O job aponta `sgov2-prod:prod` para o digest da `vX.Y.Z` e chama os webhooks do `app` e do `worker` de prod.
3. **Verificar:** a saúde responde `ok`, e no Easypanel o `app` está no digest da `vX.Y.Z`.
4. **Desfazer:** corrija o defeito numa release nova (`vX.Y.Z+1`), pelo procedimento 1.
5. **Se a migration nova não for compatível:** não faça só o rollback do app. Vá para o procedimento 4 (rollback com dado), ou corrija para a frente com uma release nova.

## 3. Migration presa (P3009)

**Sintoma:** o `app` novo não sobe. O log mostra a migration com falha, e a versão anterior continua no ar, porque a atualização é *start-first*.

1. No Easypanel, volte o `app` para a imagem anterior. Em prod, use o procedimento 2. Em hml, use o digest anterior, que aparece no histórico de deploys do serviço.
2. No console do `app` (o console entra como root), rode:
   ```
   /app/docker/entrypoint.sh resolver <nome-da-migration>
   ```
3. Corrija a migration num **PR novo**. A migration mergeada nunca é editada (spec §12.7).
4. Faça o deploy de novo e verifique se sobe sem P3009.

Detalhe em `deploy.md`, "Migration presa".

## 4. Rollback com dado (PITR)

**Quando usar:** dado oficial foi corrompido ou apagado por erro, e é preciso voltar o banco a um horário anterior ao incidente.

1. **Decisão do PO.** Tudo o que foi gravado depois do horário escolhido se perde. Registre o horário exato (UTC) e o motivo.
2. Tire o snapshot da VPS. Avise na #138 e para os usuários.
3. Pare o `app` e o `worker` do ambiente no Easypanel, e depois o `db`.
4. No host, restaure no volume do `db` com a imagem do banco e as variáveis de **leitura**:
   ```
   docker run --rm --env-file /etc/sgo/backup-leitura-<ambiente>.env \
     -v <volume do db>:/var/lib/postgresql/data --entrypoint /bin/bash ghcr.io/fabianojp06/sgov2-postgres:atual -c \
     'gosu postgres pgbackrest --stanza=sgo --delta --type=time --target="AAAA-MM-DD HH:MM:SS+00" --target-action=promote restore'
   ```
   - O volume do `db` aparece no Easypanel, em *Mounts*, ou com `docker service inspect`.
   - O `--env-file` do Docker não tira as aspas dos valores, ao contrário do systemd. Para este comando, os valores do arquivo precisam estar **sem aspas**.
5. Suba o `db` e espere `pg_isready`. Depois suba o `app` e o `worker`.
6. **Verificar:** a saúde responde `ok`. O último registro do Histórico (`max(ocorrido_em)`) é anterior ao horário escolhido, e o dado que tinha sido perdido voltou.
7. **Depois:** rode um backup full na hora, com `systemctl start sgo-backup-full@<ambiente>.service`. A linha do tempo do banco mudou.
8. **Desfazer:** restaure o snapshot da VPS do passo 2.

Detalhe em `backup.md`, "Restaurar de verdade".

## 5. Restauração completa

**Quando usar:** o banco ou a VPS se perdeu.

- **Do backup físico:**
  1. com a VPS nova e o Easypanel instalados, crie o `db` com a imagem do banco e as variáveis do pgBackRest (`backup.md`, "Ativar", passo 2);
  2. com o serviço parado, rode o passo 4 do procedimento 4 **sem** `--type=time`, para restaurar até o fim dos WAL;
  3. depois rode o `deploy/postgres/01-papeis-ambiente.sql`, porque o backup físico já traz os papéis, mas o script confere os privilégios;
  4. por fim, suba o `migracao`, o `app` e o `worker`.
- **Do dump cifrado** (último recurso, ou para levar o dado a outro lugar), sempre **fora da VPS**:
  1. baixe o arquivo com `rclone copyto sgo:<bucket>/dumps/<ambiente>/<data>.dump.age .`;
  2. decifre com `age -d -i chave-sgo.txt`;
  3. num servidor novo, rode **antes** o `01-papeis-ambiente.sql`, porque o dump leva só o banco `sgo`, sem os papéis;
  4. restaure como `postgres` com `pg_restore -d sgo <arquivo>.dump`. Os donos e os GRANTs voltam, porque os papéis já existem.
- **Verificar:** a mesma conferência do teste mensal (`backup.md`) e o login de um usuário.
- O teste mensal (`sgo-backup-restauracao@<ambiente>.timer`) prova sozinho que o backup volta. Cada resultado vai para `restauracoes.md`.

## 6. Incidentes

### 6.1 Falta de memória (gatilho de D12)

- **Sintomas:**
  - alerta "memória disponível baixa" no journal (`journalctl -t sgo-alerta`) e no webhook;
  - o earlyoom encerrando processos (`journalctl -u earlyoom`);
  - a saúde em 503.
- **Passos:**
  1. Veja quem consome: `ps -eo pid,rss,comm --sort=-rss | head`.
  2. O dev é o primeiro a sair, porque tem `oom_score_adj` 500. Pare os processos pesados de dev (`vitest`, `next build`, `playwright`).
  3. Confira as prioridades com `sgo-ajustar-oom --simular`: produção em −500, painel em −300 e hml em −200.
- **Gatilho:** mais de 3 episódios na semana tiram o dev da VPS (`vps.md`, "Contador semanal"). **Decisão do PO.**

### 6.2 Disco cheio

- **Sintomas:** `df -h /` acima de 85%, erros de escrita, Postgres recusando gravar.
- **Passos:**
  1. Veja onde está o espaço: `docker system df`, `du -xsh /var/lib/docker/* /var/log/* | sort -h | tail`.
  2. Limpe o que é seguro:
     - `docker builder prune -f`;
     - `docker image prune -f` (só imagens sem uso);
     - `journalctl --vacuum-size=500M`.
  3. **Nunca** apague volumes `sgo-*` nem os arquivos de `/etc/easypanel`.
  4. **WAL acumulando no `db`:** é o arquivamento falhando. Veja o 6.5. Não apague WAL à mão.

### 6.3 Certificado vencendo ou inválido

- **O normal:** o Traefik do Easypanel renova o Let's Encrypt sozinho, cerca de 30 dias antes do vencimento.
- **Conferir:**
  ```
  echo | openssl s_client -connect <host>:443 -servername <host> 2>/dev/null | openssl x509 -noout -enddate
  ```
- **Se não renovou:**
  - o DNS do domínio aponta para a VPS?
  - as portas 80 e 443 estão abertas no firewall do hPanel?
  - no Easypanel, tire o domínio do serviço e ponha de novo, para forçar a emissão;
  - o log do Traefik está no serviço do Easypanel.

### 6.4 Webhook de deploy falhando

- **Sintoma:** o run do `imagem.yml` na `main` fica vermelho em "Webhook do Easypanel". Com `HML_WEBHOOK_OBRIGATORIO=1`, isso é erro.
- **Passos:**
  1. O painel está no ar? Abra o domínio padrão do Easypanel.
  2. O token do serviço mudou? Isso acontece se o serviço foi recriado. Pegue a URL nova em *Deployments* e atualize o secret `EASYPANEL_WEBHOOK` ou `EASYPANEL_WEBHOOK_WORKER` do *environment*.
  3. Rode de novo os jobs que falharam. Se o commit não for mais o HEAD da `main`, veja `deploy.md`, "Origem da imagem".
- **Enquanto isso:** o hml fica na versão anterior. Faça o *redeploy* manual pelo painel.

### 6.5 Backup falhando

- **Sintoma:** alerta "SGO backup: …" ou "SGO restauração: … FALHOU". Para ver: `journalctl -t sgo-backup -n 50` e `systemctl list-timers 'sgo-backup-*'`.
- **Passos:**
  1. No console do `db`, como `postgres`, rode `pgbackrest --stanza=sgo check` e `pgbackrest --stanza=sgo info`.
  2. Causas comuns:
     - chave do storage revogada ou vencida;
     - bucket cheio ou sem permissão;
     - `PGBACKREST_REPO1_*` mudadas no Easypanel;
     - imagem do `db` trocada para outra, sem pgBackRest.
  3. **Arquivamento parado:** os WAL se acumulam no `db`. Corrija em até um ou dois dias e acompanhe o disco (6.2). Em último caso, tire `PGBACKREST_REPO1_S3_BUCKET` do `db` e faça o *redeploy*. Isso desliga o arquivamento e para o acúmulo, mas também o PITR. **Decisão do PO.**
  4. **Dump falhando:** veja o `/etc/sgo/backup-dump-<ambiente>.env`, se o `age` e o `rclone` existem e se a chave grava em `dumps/`.
  5. Depois de corrigir, rode na hora: `systemctl start sgo-backup-diff@<ambiente>.service sgo-backup-dump@<ambiente>.service`.

### 6.6 Sistema fora do ar (alerta do UptimeRobot)

1. Abra `https://<host>/int/saude`.
   - `banco: "falha"`: veja o serviço `db` no Easypanel (log, memória, disco).
   - `worker: "parado"`: veja o log do `worker`. Logo depois de um deploy, 1 minuto de 503 é normal.
   - Sem resposta nenhuma: é o Traefik, a VPS ou a rede.
2. Sem resposta, entre na VPS por SSH ou pelo console do hPanel e rode `docker ps`. Também veja a memória (6.1) e o disco (6.2).
3. A VPS inteira fora: use o console e o reinício pelo hPanel. Depois, `docker ps` e a saúde.

## 7. Contatos e decisões

| Assunto | Quem decide ou aciona |
| --- | --- |
| Tag e deploy de prod, rollback de prod, PITR em prod, snapshot | **PO** |
| Variáveis e segredos no Easypanel, chaves do storage, DNS, firewall do hPanel, 2FA | **PO** |
| Incidente de hml, webhook, CI, scripts de operação e backup | **Frente B** (`docs/operacao`, `ops/`, `.github/workflows/`) |
| Defeito no domínio (orçamento, aprovação, autenticação, administração) | **Frente A** |
| Migration destrutiva em dois passos | a frente dona do módulo, avisando a outra na #138 |
| Coordenação entre frentes | issue #138 |
| Hostinger (VPS, DNS, snapshot) | hPanel, ou o MCP da Hostinger com o "sim" do PO para cada mudança |
| Alertas | UptimeRobot (saúde), `ALERTA_WEBHOOK_URL` (memória e backup) |

## Testes deste runbook

O critério de aceite da US-119 pede o rollback e a restauração **testados seguindo só este texto**. Cada teste vai com data, tempo e o que precisou de correção.

| Data | Procedimento | Ambiente | Resultado | Tempo | Correções no texto |
| --- | --- | --- | --- | --- | --- |
| — | 2. Rollback do app | hml ou prod (`v0.1.1` → `v0.1.0`) | pendente: depende do `sgo-prod` e da primeira tag | — | — |
| — | 5. Restauração | hml | pendente: depende do storage (US-015) | — | — |
