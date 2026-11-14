import type { ContaPrevista, ResultadoPrevisao } from '../application/previsao-fechamento';
import { valorParaTela } from '../domain/valor-tela';
import { AjudaPrevisaoIA, type AcaoDestacarRiscos } from './ajuda-previsao-ia';

// Previsão de fechamento do ano do TP (US-091; IA-10; plano do P34). Só leitura: filtro GET (TP oficializado e ano), a
// tabela das contas com o orçado do ano, o realizado até o corte, a tendência, o projetado, o desvio e o mês do estouro
// (as em risco primeiro, em vermelho e negrito) e o destaque da IA, quando ela estiver ligada.

const VERMELHO = '#cf222e';
const mesTela = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function Linha({ c }: { c: ContaPrevista }) {
  const estilo = c.risco ? { color: VERMELHO, fontWeight: 'bold' as const } : undefined;
  return (
    <tr>
      <th scope="row">{`${c.conta} ${c.descricao}`}</th>
      <td>{valorParaTela(c.orcadoAno)}</td>
      <td>{valorParaTela(c.realizadoAteCorte)}</td>
      <td>{c.tendencia ? c.tendencia.formatar() : '—'}</td>
      <td>{valorParaTela(c.projetadoAno)}</td>
      <td style={estilo}>{valorParaTela(c.desvio)}</td>
      <td style={estilo}>{c.risco ? (c.mesEstouro ? mesTela(c.mesEstouro) : 'Sim') : 'Não'}</td>
    </tr>
  );
}

export function TelaPrevisao({ dados, ia }: { dados: ResultadoPrevisao; ia: AcaoDestacarRiscos | null }) {
  const { propostas, tela, erro } = dados;
  const emRisco = tela?.contas.filter((c) => c.risco).length ?? 0;
  return (
    <>
      <form method="get" action="/orc/orcado-realizado/previsao" role="search" aria-label="Filtros da previsão de fechamento">
        <p>
          <label htmlFor="previsao-proposta">Termo de Parceria</label>{' '}
          <select id="previsao-proposta" name="proposta" defaultValue={tela?.propostaId ?? ''}>
            <option value="">Selecione</option>
            {propostas.map((p) => (
              <option key={p.id} value={p.id}>{`${p.numero} – ${p.objeto}`}</option>
            ))}
          </select>{' '}
          <label htmlFor="previsao-ano">Ano</label>{' '}
          <select id="previsao-ano" name="ano" defaultValue={tela ? String(tela.ano) : ''}>
            {(tela?.anos ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            {!tela && <option value="">Padrão</option>}
          </select>{' '}
          <button type="submit">Consultar</button>
        </p>
      </form>
      {erro && <p role="alert">{erro}</p>}
      {tela && (
        <section aria-labelledby="previsao-titulo">
          <h2 id="previsao-titulo">{`${tela.numero} – ${tela.objeto} · ${tela.ano}`}</h2>
          <p>
            {tela.mesCorte
              ? `Realizado carregado até ${mesTela(tela.mesCorte)}; os meses seguintes são o orçado da versão oficial ${tela.versaoOficial} × a tendência de cada conta.`
              : `Ainda não há realizado em ${tela.ano}: a projeção é o orçado da versão oficial ${tela.versaoOficial}.`}
          </p>
          {tela.semPessoal && <p role="note">As contas de pessoal não aparecem para o seu perfil.</p>}
          <p role="status">{emRisco === 0 ? 'Nenhuma conta com risco de estouro no ano.' : `${emRisco} conta(s) com risco de estouro no ano.`}</p>
          {ia && emRisco > 0 && <AjudaPrevisaoIA acao={ia} proposta={tela.propostaId} ano={String(tela.ano)} />}
          <div role="region" aria-labelledby="previsao-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
            <table>
              <caption id="previsao-caption">Previsão de fechamento por conta (R$)</caption>
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Orçado do ano</th>
                  <th scope="col">Realizado até o corte</th>
                  <th scope="col">Tendência</th>
                  <th scope="col">Projetado</th>
                  <th scope="col">Desvio</th>
                  <th scope="col">Estouro</th>
                </tr>
              </thead>
              <tbody>
                {tela.contas.map((c) => (
                  <Linha key={c.conta} c={c} />
                ))}
              </tbody>
              <tfoot>
                <Linha c={{ ...tela.total, descricao: 'do ano' }} />
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
