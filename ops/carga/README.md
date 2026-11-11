# Carga de desempenho (US-116)

Cenários do k6 do plano do P7 (Task 3). As metas de servidor da §10.3 são medidas por teste de integração com o tempo. Aqui ficam só as páginas, por HTTP: o k6 navega como os usuários navegam.

## Antes de rodar

- **Onde (D-P7-1):** primeiro no app de dev da frente B (`next build` + `next start` em `127.0.0.1:3200`, banco 56432). Depois, em hml, pela URL pública, numa janela de 30 minutos combinada com o PO e antes de prod receber usuários.
- **Memória:** hml, prod e o dev dividem a VPS. O PO acompanha ao vivo (`free -m`) e para tudo perto de 1,5 GiB disponíveis, antes do `alerta-memoria` (1 GiB). Um episódio do alerta conta para o gatilho do D12. O k6 roda com `--memory 256m --cpus 1`.
- **Um processo pesado por vez:** o `rodar.sh` pega o mesmo lock do `test:int` e do `test:e2e`.
- **Usuário:** um usuário do ambiente com o perfil das páginas medidas. Login e senha vêm do ambiente na hora, nunca de arquivo.

## Plano de contas de 5.000 linhas (D-P7-3)

- **Gerar:** `npx tsx ops/carga/gerar-plano.ts plano-sintetico.xlsx 5000`. O arquivo tem o plano oficial inteiro mais o ramo `9`, e o script não toca banco.
- **Importar:** pela tela do plano de contas, com um usuário GFIN. O worker processa a carga.
- **Atenção:** a seed com `CARGA_DADOS_REFERENCIA=1` (`npm run db:seed` no dev e todo deploy do `migracao` em hml) recarrega só o plano oficial e **inativa o ramo `9`**. Não semear nem implantar entre a importação e a medição. Antes de cada rodada, conferir na tela que o ramo `9` ("CARGA SINTÉTICA") está ativo; se não estiver, importar o arquivo de novo.

## Orçamento de 5 exercícios da Adm. Central (D-P7-3)

- **Gerar:** `npx tsx ops/carga/gerar-orcamento.ts orcamento-sintetico/`. São 5 arquivos (2027 a 2031), um por exercício, no layout ADMC-ORC v1.0. Cada um tem 216 posições, 675 pacotes e 5 receitas (cerca de 900 linhas analíticas) e pesa cerca de 46 KiB, bem abaixo de 1 MiB. O gerador é determinístico (o mesmo ano dá o mesmo arquivo) e não toca banco.
- **Regras seguidas** (resposta da frente A na #138, 10/11):
  - CCs analíticos da minuta;
  - contas analíticas do plano oficial fora de `4.1.1.1`, `4.1.1.2` e `4.1.1.8`, onde ficam as contas das premissas, vetadas em pacote; o ramo `9` fica de fora;
  - limites do leitor seguro respeitados;
  - nenhum texto começando com `=`, `+`, `-` ou `@`.
- **Importar:**
  1. A GFIN cria cada exercício pelo **Novo exercício**, o que também cria as premissas do ano.
  2. Importa o arquivo do ano pela tela de importação do `orc`, com escopo TOTAL (as receitas exigem esse escopo), com o exercício em Rascunho ou Em Elaboração.
  3. A importação recalcula o exercício. Se der erro, nada é gravado.
- **Conferido em 11/11:** os 5 arquivos passam no leitor seguro do `ger` e na validação da planilha do `orc`, sem nenhum erro.
- **Atenção:**
  - se um benefício cadastrado pela tela usar conta de `4.1.1.3` a `4.1.1.7` ou `4.1.1.9`, a importação recusa os pacotes dessa conta (ela vira vetada pelas premissas);
  - o banco precisa da minuta de CC e do plano oficial (`CARGA_DADOS_REFERENCIA=1`).

## Como rodar

```bash
read -r -p 'Login: ' SGO_LOGIN; read -rs -p 'Senha: ' SGO_SENHA; echo; export SGO_LOGIN SGO_SENHA
SGO_BASE=http://127.0.0.1:3200 SGO_PAGINAS=/inicio,/cad/plano-contas,/cad/centros-custo \
  SGO_VUS=20 SGO_DURACAO=2m ops/carga/rodar.sh
```

- A senha não vai para o histórico do shell nem para a linha de comando.
- **Em hml:** use `SGO_BASE=https://<host>`, `SGO_HOST_HML=<host>` (o host de hml informado pelo PO) e `SGO_JANELA_PO=sim`. Sem eles, o script recusa. Também recusa IP literal, `localhost`, mais de 20 usuários virtuais e mais de 25 minutos.
- **A sessão aberta pela carga** continua válida até expirar: 30 minutos sem uso ou 12 horas no máximo. O Sair de outra sessão não a encerra. Use um usuário só para a carga.

- **`sessao.mjs`:** entra uma vez pelo login real (Playwright, no contêiner oficial, porque o host não tem as bibliotecas do Chromium), mede o tempo até a tela principal (`[CARGA_LOGIN]`) e passa o cookie de sessão ao k6.
- **`paginas.js`:** abre as páginas em sequência, com 1 s entre elas. Uma resposta diferente de 200 conta como erro, inclusive o 307 para o login de uma sessão perdida.

## Resultados

Registrar aqui cada rodada: data, destino, commit, número de usuários virtuais, duração, p95 por página, taxa de erro e a memória mínima da VPS.

| Data | Destino | Commit | VUs | p95 (ms) | Erros | Memória mínima |
| --- | --- | --- | --- | --- | --- | --- |
| 04/11/2026 | dev local (`next start`, 127.0.0.1:3200, banco 56432) | `36b5bca` | 20 (2 min de patamar) | geral 149; `/inicio` 146, `/cad/plano-contas` 143, `/cad/centros-custo` 135, `/cad/cargos` 167, `/orc/orcamento` 134, `/rel/conferencia-carga` 169 | 0 de 2.730 | 5.235 MB (5.597 antes) |

Login de ponta a ponta (`sessao.mjs`, uma vez): 253 ms até a tela principal. Perfil GFIN, num banco de dev com o plano oficial, a minuta de CC e os cargos sintéticos (não a base de referência da D-P7-3: o plano de 5.000 linhas vem do `gerar-plano.ts`, e os exercícios do orçamento, da importação do `orc`).
