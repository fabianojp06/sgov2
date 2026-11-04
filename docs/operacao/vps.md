# VPS — operação e endurecimento

VPS Hostinger srv2039095 (Ubuntu 24.04.5, 2 vCPU, 7,8 GiB, 96 GB), com Docker Swarm do Easypanel e Traefik. Referências: spec §4.3, D12, §11.5.

## Estado antes (24/10/2026)

| Item | Valor |
| --- | --- |
| Memória | 7,8 GiB, ~5,8 GiB disponíveis, **sem swap**, `swappiness` 60 |
| Contêineres | `easypanel`, `easypanel-traefik` |
| SSH | login de root **por senha**, sem chave em `authorized_keys`; **802 tentativas de senha falhas em 7 dias** |
| Portas abertas | 22, 80, 443, 3000 (Easypanel), **2377 e 7946 (Docker Swarm)** |
| Firewall | ufw inativo; `DOCKER-USER` vazia |
| Snapshot | **dispensado pelo PO** em 24/10/2026, antes das alterações |

## US-122 — Mitigações da convivência do dev com a produção (D12)

| O quê | Onde | Como desfazer |
| --- | --- | --- |
| Swap de 8 GB | `/swapfile` e linha em `/etc/fstab` | `swapoff /swapfile`, remover a linha do fstab e o arquivo |
| `vm.swappiness=10`, `vm.vfs_cache_pressure=50` | `/etc/sysctl.d/90-sgo.conf` | remover o arquivo e rodar `sysctl --system` |
| earlyoom | `/etc/default/earlyoom` (origem: `ops/vps/earlyoom.default`): age com memória livre ≤ 8%, sem esperar o swap (`-s 100`) | `apt remove earlyoom` |
| Prioridade de memória por contêiner, a cada minuto | `/usr/local/sbin/sgo-ajustar-oom` + `sgo-oom.timer` | `systemctl disable --now sgo-oom.timer` |
| Alerta de memória < 1 GiB, verificado a cada minuto, registrado **por episódio** (volta ao normal acima de 120% do limite) | `/usr/local/sbin/sgo-alerta-memoria` + `sgo-alerta-memoria.timer`; config em `/etc/sgo/alerta.env`; estado em `/var/lib/sgo/alerta-memoria.estado` | `systemctl disable --now sgo-alerta-memoria.timer` |

- Prioridades (`oom_score_adj`): `sgo-prod_*`/`sgo-prod-*` −500 · `easypanel.*`/`easypanel-*` −300 · `sgo-hml_*`/`sgo-hml-*` −200 · dev `sgo-a-*`/`sgo-b-*` +500 (o compose de dev da P1, Tarefa 3, também vai definir +500). Nomes parecidos (`sgo-api`, `sgo-backup`, `sgo-ab`) **não** recebem ajuste. Conferir com `sgo-ajustar-oom --simular`.
- **Os projetos do Easypanel precisam se chamar exatamente `sgo-prod` e `sgo-hml`.** O ajuste é pelo nome do contêiner. Com outro nome, a produção fica com 0, abaixo do −300 do Traefik e do painel, e passa a morrer antes deles.
- **Por que proteger o Easypanel e o Traefik (−300), desvio do plano:** o Traefik atende todo o tráfego de produção e o painel é o único jeito de operar os serviços. Sem o ajuste, eles ficam com 0, o mesmo valor das sessões do Claude Code no host, e podem morrer antes delas. O script só escreve o `oom_score_adj` dos processos; não reinicia nem altera contêiner, rede ou volume. **Aguarda o aceite do PO.**
- O earlyoom **não** tem `node` nem `next-server` na lista de preferidos, porque o painel do Easypanel e o app de produção também rodam assim. Quem morre primeiro é decidido pelo `oom_score_adj`. Desvio da spec §4.3, que cita `node`/`next`: registrar na próxima revisão da spec.
- **Contador semanal (gatilho de D12):** `grep -c "^$(date +%G-W%V) " /var/lib/sgo/alertas-memoria.log` conta **episódios** de memória baixa. Acima de 3 na semana, o dev sai da VPS (spec §4.3).
- **Canal do alerta: pendente (decisão do PO).** Hoje o alerta vai só para o journal (`journalctl -t sgo-alerta`). Para receber no celular, preencher `ALERTA_WEBHOOK_URL` em `/etc/sgo/alerta.env` (ex.: um tópico do ntfy).
- O teste do alerta (Step 11) gravou uma linha em 24/10/2026 19:32, que foi apagada em seguida para não contar no gatilho.
- Reinstalar ou atualizar: `sudo bash ops/vps/instalar.sh` (D12, inclusive swap e earlyoom) e `sudo bash ops/vps/endurecer.sh` (US-016). Os dois são idempotentes.

## US-016 — Endurecimento

| O quê | Situação | Detalhe |
| --- | --- | --- |
| ufw | **feito** | entrada negada por padrão; liberadas 22, 80, 443. Fecha também as portas 2377 e 7946 do Swarm |
| fail2ban (sshd) | **feito** | `/etc/fail2ban/jail.d/sgo.local`: 8 tentativas em 10 min → 30 min de bloqueio. A unit do Ubuntu 24.04 é `ssh.service`, por isso o `journalmatch` explícito |
| Atualizações automáticas de segurança | **feito** | `unattended-upgrades` ativo, sem reboot automático (`/etc/apt/apt.conf.d/52-sgo-unattended`, origem `ops/vps/52-sgo-unattended.conf`) |
| SSH só por chave | **pendente (PO)** | o PO hoje entra por senha. Primeiro: gerar uma chave no computador do PO, instalar em `/root/.ssh/authorized_keys` e testar. Só depois aplicar `ops/vps/sshd-90-sgo.conf` |
| Porta 3000 (Easypanel) fechada para a internet | **pendente (PO)** | o Docker ignora o ufw para portas publicadas. Fechar exige a regra na cadeia `DOCKER-USER`, e o painel passa a ser acessado por túnel: `ssh -L 3000:127.0.0.1:3000 root@<ip>` → `http://localhost:3000`. Definitivo: subdomínio HTTPS (GAP-INF-001) |
| Firewall do hPanel | **pendente (PO), prioridade alta** | regras de entrada só para TCP 22, 80 e 443 (plano P2, Tarefa 2, Step 3). Filtra antes da VPS e fecha a 3000 sem mexer no Docker |

- Desbloquear um IP banido: `fail2ban-client set sshd unbanip <ip>`. Se o PO for bloqueado, entrar pelo console do hPanel.

## Como desfazer

| Item | Comando |
| --- | --- |
| Swap | `swapoff /swapfile`, remover a linha `/swapfile` do `/etc/fstab` e `rm /swapfile` |
| sysctl | `rm /etc/sysctl.d/90-sgo.conf && sysctl --system` |
| earlyoom | `apt remove earlyoom` |
| Timers | `systemctl disable --now sgo-oom.timer sgo-alerta-memoria.timer` |
| ufw | `ufw disable` |
| fail2ban | `rm /etc/fail2ban/jail.d/sgo.local && systemctl restart fail2ban` (ou `apt remove fail2ban`) |
| Atualizações automáticas | `rm /etc/apt/apt.conf.d/52-sgo-unattended` |
| Scripts, units e dados | `systemctl disable --now sgo-oom.timer sgo-alerta-memoria.timer`; `rm /usr/local/sbin/sgo-ajustar-oom /usr/local/sbin/sgo-alerta-memoria /etc/systemd/system/sgo-oom.* /etc/systemd/system/sgo-alerta-memoria.*`; `systemctl daemon-reload`; `rm -r /etc/sgo /var/lib/sgo` |
| `oom_score_adj` já aplicado | continua até o contêiner reiniciar; para zerar já: `sgo-ajustar-oom --simular \| while read -r _ pid _; do echo 0 > /proc/$pid/oom_score_adj; done` |

## Pendências

- [ ] Teste de pico de memória (US-122 Step 10): rodar quando não houver fluxo de agentes em execução, porque o teste pode encerrar processos de dev.
- [ ] **Reboot de prova** (P2 Tarefa 2 Step 9), numa janela combinada com o PO: conferir `swapon` 8G, `swappiness` 10, earlyoom/fail2ban/ufw/timers `sgo-*` ativos, `docker ps` com o Easypanel e, quando existir, a regra da `DOCKER-USER`. O fail2ban só se valida com tentativas reais: depois de algumas falhas de login de fora, `fail2ban-client status sshd` deve mostrar `Total failed` maior que 0.
- [ ] Firewall do hPanel (PO) e conferência **de fora**: `nc -zv <ip> 3000` fechado; `nc -zv <ip> 443` aberto.
- [ ] Quando o Easypanel criar `sgo-prod`/`sgo-hml` (US-014): reserva de memória nos serviços, swap travado nos contêineres de produção (`memory.swap.max=0` ou `memswap_limit` = `mem_limit`) e conferência do −500 com `sgo-ajustar-oom --simular`.
- [ ] Compose de dev com `mem_limit` e `oom_score_adj` 500 (P1, Tarefa 3).
- [ ] Aceite do PO para o desvio Easypanel/Traefik −300.
- [ ] Aceite do PO para o earlyoom sem `node`/`next-server` no `--prefer`, e ajuste da spec §4.3 na próxima versão.
- [ ] `ops/vps/docker-user.sh` e `sgo-docker-user.service` (plano P2, Tarefa 2): serão criados junto com a aplicação da regra da porta 3000.
- [ ] **Risco aceito até a pendência acima:** o Easypanel segue aberto na 3000 por HTTP; a senha do painel trafega sem criptografia. Registrar a data do aceite do PO.
- [ ] Atualizar `docs/memoria/memoria-do-projeto.md` no encerramento do P2.
- [x] Verificar os hooks das sessões (US-122 Step 12): verificado numa sessão nova da frente B em 04/11/2026, com as travas de produção, da `main` e de banco ativas (#145).
- [ ] Chave SSH do PO → SSH só por chave → fail2ban mais rígido (5 tentativas, 1 h).
- [ ] Fechar a 3000 na `DOCKER-USER` (com o túnel combinado com o PO), no `iptables` **e** no `ip6tables` (ou com a publicação em IPv6 desligada no Docker): só a regra IPv4 deixaria a 3000 aberta pelo IPv6 da VPS. Conferir de fora pelos dois endereços.
- [ ] Canal do alerta (`ALERTA_WEBHOOK_URL`). Depois do merge do PR #308, reinstalar o `alerta-memoria.sh` (pelo `instalar.sh` ou só com `install -m 0755 ops/vps/alerta-memoria.sh /usr/local/sbin/sgo-alerta-memoria`): a URL passou a ir pelo stdin do `curl`, fora do `ps`.
- [ ] Opcional, com a chave SSH do PO: `ignoreip = 127.0.0.1/8 ::1 <IP fixo do PO>` no `jail-sgo.local`, se o PO tiver IP fixo. Com IP dinâmico, fica o console do hPanel como acesso de emergência.
