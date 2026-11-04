# Carga de desempenho (US-116)

Cenários do k6 do plano do P7 (Task 3). As metas de servidor da §10.3 são medidas por teste de integração com o tempo. Aqui ficam só as páginas, por HTTP: o k6 navega como os usuários navegam.

## Antes de rodar

- **Onde (D-P7-1):** primeiro no app de dev da frente B (`next build` + `next start` em `127.0.0.1:3200`, banco 56432). Depois, em hml, pela URL pública, numa janela de 30 minutos combinada com o PO e antes de prod receber usuários.
- **Memória:** hml, prod e o dev dividem a VPS. O PO acompanha ao vivo (`free -m`) e para tudo perto de 1,5 GiB disponíveis, antes do `alerta-memoria` (1 GiB). Um episódio do alerta conta para o gatilho do D12. O k6 roda com `--memory 256m --cpus 1`.
- **Um processo pesado por vez:** o `rodar.sh` pega o mesmo lock do `test:int` e do `test:e2e`.
- **Usuário:** um usuário do ambiente com o perfil das páginas medidas. Login e senha vêm do ambiente na hora, nunca de arquivo.

## Como rodar

```bash
SGO_BASE=http://127.0.0.1:3200 SGO_LOGIN=<login> SGO_SENHA=<senha> \
  SGO_PAGINAS=/inicio,/cad/plano-contas,/cad/centros-custo SGO_VUS=20 SGO_DURACAO=2m \
  ops/carga/rodar.sh
```

- **`sessao.mjs`:** entra uma vez pelo login real (Playwright), mede o tempo até a tela principal (`[CARGA_LOGIN]`) e passa o cookie de sessão ao k6.
- **`paginas.js`:** abre as páginas em sequência, com 1 s entre elas. Uma resposta diferente de 200 conta como erro, inclusive o 307 para o login de uma sessão perdida.

## Resultados

Registrar aqui cada rodada: data, destino, commit, número de usuários virtuais, duração, p95 por página, taxa de erro e a memória mínima da VPS.

| Data | Destino | Commit | VUs | p95 (ms) | Erros | Memória mínima |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — |
