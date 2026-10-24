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

## US-122 — Mitigações da convivência do dev com a produção (D12)

| O quê | Onde | Como desfazer |
| --- | --- | --- |
| Swap de 8 GB | `/swapfile` e linha em `/etc/fstab` | `swapoff /swapfile`, remover a linha do fstab e o arquivo |
| `vm.swappiness=10`, `vm.vfs_cache_pressure=50` | `/etc/sysctl.d/90-sgo.conf` | remover o arquivo e rodar `sysctl --system` |
| earlyoom | `/etc/default/earlyoom` (origem: `ops/vps/earlyoom.default`) | `apt remove earlyoom` |
| Prioridade de memória por contêiner, a cada minuto | `/usr/local/sbin/sgo-ajustar-oom` + `sgo-oom.timer` | `systemctl disable --now sgo-oom.timer` |
| Alerta de memória < 1 GiB, a cada minuto | `/usr/local/sbin/sgo-alerta-memoria` + `sgo-alerta-memoria.timer`; config em `/etc/sgo/alerta.env` | `systemctl disable --now sgo-alerta-memoria.timer` |

- Prioridades (`oom_score_adj`): `sgo-prod*` −500 · `easypanel*` −300 · `sgo-hml*` −200 · dev `sgo-a*`/`sgo-b*` +500 (também definido no compose de dev). Conferir com `sgo-ajustar-oom --simular`.
- O earlyoom **não** tem `node` na lista de preferidos, porque o painel do Easypanel e o app de produção também são processos `node`. A proteção vem do `oom_score_adj`.
- **Contador semanal (gatilho de D12):** `grep -c "^$(date +%G-W%V) " /var/lib/sgo/alertas-memoria.log`. Acima de 3 na semana, o dev sai da VPS (spec §4.3).
- **Canal do alerta: pendente (decisão do PO).** Hoje o alerta vai só para o journal (`journalctl -t sgo-alerta`). Para receber no celular, preencher `ALERTA_WEBHOOK_URL` em `/etc/sgo/alerta.env` (ex.: um tópico do ntfy).
- Reinstalar ou atualizar: `sudo bash ops/vps/instalar.sh` (idempotente).

## US-016 — Endurecimento

| O quê | Situação | Detalhe |
| --- | --- | --- |
| ufw | **feito** | entrada negada por padrão; liberadas 22, 80, 443. Fecha também as portas 2377 e 7946 do Swarm |
| fail2ban (sshd) | **feito** | `/etc/fail2ban/jail.d/sgo.local`: 8 tentativas em 10 min → 30 min de bloqueio. A unit do Ubuntu 24.04 é `ssh.service`, por isso o `journalmatch` explícito |
| Atualizações automáticas de segurança | **feito** | `unattended-upgrades` ativo, sem reboot automático (`/etc/apt/apt.conf.d/52-sgo-unattended`) |
| SSH só por chave | **pendente (PO)** | o PO hoje entra por senha. Primeiro: gerar uma chave no computador do PO, instalar em `/root/.ssh/authorized_keys` e testar. Só depois aplicar `ops/vps/sshd-90-sgo.conf` |
| Porta 3000 (Easypanel) fechada para a internet | **pendente (PO)** | o Docker ignora o ufw para portas publicadas. Fechar exige a regra na cadeia `DOCKER-USER`, e o painel passa a ser acessado por túnel: `ssh -L 3000:127.0.0.1:3000 root@<ip>` → `http://localhost:3000`. Definitivo: subdomínio HTTPS (GAP-INF-001) |
| Firewall do hPanel | opcional | segunda camada, fora da VPS |

- Desbloquear um IP banido: `fail2ban-client set sshd unbanip <ip>`. Se o PO for bloqueado, entrar pelo console do hPanel.
- Desfazer o ufw: `ufw disable`.

## Pendências

- [ ] Teste de pico de memória (US-122 Step 10): rodar quando não houver fluxo de agentes em execução, porque o teste pode encerrar processos de dev.
- [ ] Verificar os hooks das sessões (US-122 Step 12) depois do merge da US-002.
- [ ] Chave SSH do PO → SSH só por chave → fail2ban mais rígido (5 tentativas, 1 h).
- [ ] Fechar a 3000 na `DOCKER-USER` (com o túnel combinado com o PO).
- [ ] Canal do alerta (`ALERTA_WEBHOOK_URL`).
