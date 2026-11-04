/* global __ENV */
// Carga das páginas da área logada (plano do P7, Task 3, Step 3; US-116). Roda no k6, por imagem
// (ops/carga/rodar.sh), nunca pelo npm. A sessão vem pronta (SGO_SESSAO, de um login pelo
// Playwright, sessao.mjs): o login é uma Server Action cujo ID muda a cada build, e o limitador do
// login (limite-login.ts) mediria a si mesmo. Aqui só GET de páginas, como um usuário navegando.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.SGO_BASE;
const SESSAO = __ENV.SGO_SESSAO;
const NOME_COOKIE = __ENV.SGO_COOKIE || 'sgo_sessao';
if (!BASE || !SESSAO) throw new Error('SGO_BASE e SGO_SESSAO são obrigatórias (veja ops/carga/README.md)');

// Páginas que o perfil da sessão abre; outras dariam 404 e entrariam como erro.
const PAGINAS = (__ENV.SGO_PAGINAS || '/inicio,/cad/plano-contas,/cad/centros-custo').split(',');

export const options = {
  // D-P7-1: no máximo 20 usuários virtuais; rampa curta para o PO acompanhar a memória.
  stages: [
    { duration: '30s', target: Number(__ENV.SGO_VUS || 20) },
    { duration: __ENV.SGO_DURACAO || '2m', target: Number(__ENV.SGO_VUS || 20) },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    // §10.3 não fixa meta para a navegação; o p95 de 1,5 s é o da escrita simples, usado como
    // referência. Falha registrada, não corte: o corte é a memória da VPS (D-P7-1).
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  for (const p of PAGINAS) {
    const r = http.get(`${BASE}${p}`, { cookies: { [NOME_COOKIE]: SESSAO }, redirects: 0, tags: { pagina: p } });
    // 307 para /login seria sessão perdida: o teste deixa de medir o sistema.
    check(r, { [`${p}: 200`]: (x) => x.status === 200 });
    sleep(1);
  }
}
