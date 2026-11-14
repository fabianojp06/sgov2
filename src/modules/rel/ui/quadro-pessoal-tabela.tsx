import { Dinheiro } from '@/shared/kernel';
import type { PropostaQuadro, QuadroPessoal } from '../domain/quadro-pessoal';

// Os agregados do quadro de pessoal (US-107), exatamente o que a IA recebe: a tela mostra para o
// usuário conferir. Componente puro (sem estado), usado pela página e pela região da análise.

export const TEXTOS_QUADRO = {
  TOTAL: 'Total',
  PROPOSTAS: 'Propostas com pessoal',
  POSTOS: 'Postos',
  EMPREGADOS: 'Empregados',
  ESTAGIARIOS: 'Estagiários',
  APRENDIZES: 'Jovens aprendizes',
  A_CONTRATAR: 'Vagas A CONTRATAR',
  CUSTO: 'Custo no período',
  CUSTO_TOTAL: 'Custo no período (soma das propostas com custo exibido)',
  EVOLUCAO: 'Postos ativos por ano (no mês de referência e em algum mês do ano)',
  NO_ANO: 'Ativos no ano',
  CARGOS: 'Postos por cargo',
  LIMITE: 'Há mais propostas com pessoal além das analisadas aqui (no máximo 40). Use os filtros para analisar as demais.',
  SEM_CUSTO: {
    SEM_PERMISSAO: 'Não exibido para o seu perfil',
    POUCOS_POSTOS: 'Omitido: menos de 3 postos',
    CUSTO_INCOMPLETO: 'Omitido: custo de algum posto não calculado ou com aviso',
    CUSTOS_IGUAIS: 'Omitido: todos os postos com o mesmo custo',
  },
} as const;

const ROTULO_TIPO: Record<string, string> = { CONTRATO: 'Contrato', TERMO_PARCERIA: 'Termo de Parceria' };
const ROTULO_SITUACAO: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  EM_ELABORACAO: 'Em Elaboração',
  EM_APROVACAO: 'Em Aprovação',
  OFICIALIZADO: 'Oficializado',
  ENCERRADO: 'Encerrado',
};
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const moeda = (v: string | null) => (v === null ? '—' : Dinheiro.de(v).formatar());
const variacao = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}` : String(v));

export function textoCusto(p: PropostaQuadro): string {
  return p.semCusto ? TEXTOS_QUADRO.SEM_CUSTO[p.semCusto] : moeda(p.custoPeriodo);
}

function Proposta({ p, prefixo }: { p: PropostaQuadro; prefixo: string }) {
  const id = `${prefixo}-${encodeURIComponent(p.numero)}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>
        {p.numero} – {ROTULO_TIPO[p.tipo] ?? p.tipo} ({ROTULO_SITUACAO[p.situacao] ?? p.situacao}), vigência {mes(p.vigencia.inicio)} a {mes(p.vigencia.fim)}
      </h3>
      <p>
        {TEXTOS_QUADRO.EMPREGADOS}: {p.postos.EMPREGADO} · {TEXTOS_QUADRO.ESTAGIARIOS}: {p.postos.ESTAGIARIO} · {TEXTOS_QUADRO.APRENDIZES}:{' '}
        {p.postos.JOVEM_APRENDIZ} · {TEXTOS_QUADRO.A_CONTRATAR}: {p.aContratar} · {TEXTOS_QUADRO.CUSTO}: {textoCusto(p)}
      </p>
      <table>
        <caption>{TEXTOS_QUADRO.EVOLUCAO}</caption>
        <thead>
          <tr>
            <th scope="col">Ano</th>
            <th scope="col">Referência</th>
            <th scope="col">{TEXTOS_QUADRO.POSTOS}</th>
            <th scope="col">Variação</th>
            <th scope="col">{TEXTOS_QUADRO.A_CONTRATAR}</th>
            <th scope="col">{TEXTOS_QUADRO.NO_ANO}</th>
          </tr>
        </thead>
        <tbody>
          {p.anos.map((a) => (
            <tr key={a.ano}>
              <th scope="row">{a.ano}</th>
              <td>{mes(a.referencia)}</td>
              <td>{a.postos}</td>
              <td>{variacao(a.variacao)}</td>
              <td>{a.aContratar}</td>
              <td>{a.postosNoAno}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>{TEXTOS_QUADRO.CARGOS}</caption>
        <thead>
          <tr>
            <th scope="col">Cargo</th>
            <th scope="col">{TEXTOS_QUADRO.POSTOS}</th>
            <th scope="col">{TEXTOS_QUADRO.A_CONTRATAR}</th>
          </tr>
        </thead>
        <tbody>
          {p.cargos.map((c) => (
            <tr key={c.cargo}>
              <th scope="row">{c.cargo}</th>
              <td>{c.postos}</td>
              <td>{c.aContratar}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** `prefixo` distingue os ids quando a tabela aparece duas vezes na página (a da tela e a enviada à IA). */
export function TabelaQuadro({ quadro, prefixo = 'quadro' }: { quadro: QuadroPessoal; prefixo?: string }) {
  const t = quadro.total;
  return (
    <div>
      <p>
        <strong>{TEXTOS_QUADRO.TOTAL}:</strong> {TEXTOS_QUADRO.PROPOSTAS}: {t.propostas} · {TEXTOS_QUADRO.EMPREGADOS}: {t.postos.EMPREGADO} ·{' '}
        {TEXTOS_QUADRO.ESTAGIARIOS}: {t.postos.ESTAGIARIO} · {TEXTOS_QUADRO.APRENDIZES}: {t.postos.JOVEM_APRENDIZ} · {TEXTOS_QUADRO.A_CONTRATAR}:{' '}
        {t.aContratar} · {TEXTOS_QUADRO.CUSTO_TOTAL}: {moeda(t.custoPeriodoExibido)}
      </p>
      {quadro.limiteAtingido && <p role="note">{TEXTOS_QUADRO.LIMITE}</p>}
      {quadro.propostas.map((p) => (
        <Proposta key={p.numero} p={p} prefixo={prefixo} />
      ))}
    </div>
  );
}
