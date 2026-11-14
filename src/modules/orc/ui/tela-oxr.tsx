import type { CelulaOxr, LinhaOxr, TotalOxr } from '../application/grade-oxr';
import { mesOxr } from '../application/grade-oxr';
import { MENSAGENS_OXR, type ResultadoOxr } from '../application/orcado-realizado';
import { valorParaTela } from '../domain/valor-tela';
import { BotaoImprimirPagina } from './botao-imprimir-pagina';

// Orçado x Realizado do TP (US-086, parte 1; OxR V2, seção 5 e 5.1). Só leitura: filtros num formulário GET (passo 2),
// a grade com Orçado, Realizado e % de uso por mês e os totais do período com o saldo (RN_OXR_010 e 011). "Sem
// orçamento" em vermelho (RN_OXR_012) e a linha acima de 100% em vermelho e negrito (RN0314). E3: o aviso das
// pendências, com link para a lista. A1: a atualização do realizado é a carga do arquivo (US-085).

const VERMELHO = '#cf222e';
// O mesmo valor do exportar-oxr.ts (o componente não importa a aplicação de servidor).
const MESES_MAXIMOS_PDF_OXR = 6;
const linkExportar = (t: NonNullable<ResultadoOxr['tela']>, formato: 'xlsx' | 'pdf') => {
  const q = new URLSearchParams({ proposta: t.propostaId, de: t.filtros.de, ate: t.filtros.ate, zeradas: t.filtros.zeradas ? 'sim' : 'nao', formato });
  if (t.filtros.conta) q.set('conta', t.filtros.conta);
  return `/orc/orcado-realizado/exportar?${q.toString()}`;
};
const dataHora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

// RN0314 por célula (revisão 12.12): só o % acima de 100% fica em vermelho e negrito.
function Uso({ c }: { c: CelulaOxr }) {
  if (c.semOrcamento) return <span style={{ color: VERMELHO }}>Sem orçamento</span>;
  if (!c.uso) return <>—</>;
  return c.estouro ? (
    <strong style={{ color: VERMELHO }} data-estouro="sim">
      {c.uso.formatar()}
    </strong>
  ) : (
    <>{c.uso.formatar()}</>
  );
}

function Celulas({ c }: { c: CelulaOxr }) {
  return (
    <>
      <td>{valorParaTela(c.orcado)}</td>
      <td>{valorParaTela(c.realizado)}</td>
      <td>
        <Uso c={c} />
      </td>
    </>
  );
}

function Periodo({ t }: { t: TotalOxr }) {
  return (
    <>
      <td>{valorParaTela(t.orcado)}</td>
      <td>{valorParaTela(t.realizado)}</td>
      <td>{valorParaTela(t.saldo)}</td>
      <td>
        <Uso c={t} />
      </td>
    </>
  );
}

function Linha({ l }: { l: LinhaOxr }) {
  const nome = `${l.conta} ${l.descricao}${l.inativa ? ' (inativa)' : ''}`;
  return (
    <tr>
      <th scope="row" style={{ paddingLeft: `${(l.nivel - 1) * 0.75}rem`, fontWeight: l.analitica ? 'normal' : 'bold' }}>
        {nome}
      </th>
      {l.meses.map((c, i) => (
        <Celulas key={i} c={c} />
      ))}
      <Periodo t={l.periodo} />
    </tr>
  );
}

export function TelaOxr(props: { dados: ResultadoOxr; podeAtualizar: boolean; podeVerRealizado: boolean; podeExportar?: boolean }) {
  const { dados, podeAtualizar, podeVerRealizado, podeExportar } = props;
  const { propostas, tela, erro } = dados;
  const f = tela?.filtros;
  return (
    <>
      <form method="get" action="/orc/orcado-realizado" role="search" aria-label="Filtros do Orçado x Realizado" className="sem-impressao">
        <p>
          <label htmlFor="oxr-proposta">Termo de Parceria</label>{' '}
          <select id="oxr-proposta" name="proposta" defaultValue={tela?.propostaId ?? ''}>
            <option value="">Selecione</option>
            {propostas.map((p) => (
              <option key={p.id} value={p.id}>{`${p.numero} – ${p.objeto}`}</option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="oxr-de">Período inicial</label> <input id="oxr-de" name="de" type="month" defaultValue={f?.de ?? ''} />{' '}
          <label htmlFor="oxr-ate">Período final</label> <input id="oxr-ate" name="ate" type="month" defaultValue={f?.ate ?? ''} />
        </p>
        <p>
          <label htmlFor="oxr-conta">Conta (opcional)</label> <input id="oxr-conta" name="conta" defaultValue={f?.conta ?? ''} placeholder="ex.: 4.1.1.1" />{' '}
          <label htmlFor="oxr-zeradas">Exibir contas zeradas</label>{' '}
          <select id="oxr-zeradas" name="zeradas" defaultValue={f?.zeradas ? 'sim' : 'nao'}>
            <option value="nao">Não</option>
            <option value="sim">Sim</option>
          </select>
        </p>
        <button type="submit">Consultar</button>
      </form>
      {propostas.length === 0 && <p>Nenhum Termo de Parceria oficializado nos seus Termos de Parceria.</p>}
      {erro && <p role="alert">{erro}</p>}
      {tela && (
        <section aria-labelledby="oxr-titulo">
          <h2 id="oxr-titulo">{`${tela.numero} – ${tela.objeto}`}</h2>
          <p>{`Versão oficial ${tela.versaoOficial} · ${mesOxr(tela.filtros.de)} a ${mesOxr(tela.filtros.ate)} · Conta: ${tela.filtros.conta || 'Todas'}`}</p>
          <p>
            {tela.atualizadoEm ? `Última atualização do Realizado: ${dataHora(tela.atualizadoEm)}.` : 'O Realizado deste TP ainda não foi carregado.'}
            {podeAtualizar && (
              <>
                {' '}
                <a href={`/orc/realizado?proposta=${tela.propostaId}`} className="sem-impressao">
                  Atualizar Realizado
                </a>
              </>
            )}
          </p>
          {tela.pendencias.quantidade > 0 && (
            <p role="note">
              {`Existem ${tela.pendencias.quantidade} valores do ERP sem conta correspondente no SGO (R$ ${valorParaTela(tela.pendencias.valor)}).`}
              {podeVerRealizado && (
                <>
                  {' '}
                  <a href={`/orc/realizado?proposta=${tela.propostaId}`}>Ver a lista</a>
                </>
              )}
            </p>
          )}
          {tela.semPessoal && <p role="note">As contas de pessoal não aparecem para o seu perfil, nem no orçado nem no realizado.</p>}
          {tela.pessoalNaoHomologado && <p role="note">O pessoal da versão oficial ainda não foi homologado e não entra no orçado.</p>}
          <p className="sem-impressao">
            <BotaoImprimirPagina />
            {podeExportar && (
              <>
                {' '}
                <a href={linkExportar(tela, 'xlsx')}>Exportar XLSX</a> <a href={linkExportar(tela, 'pdf')}>Exportar PDF</a>
                {tela.meses.length > MESES_MAXIMOS_PDF_OXR && ` (o PDF aceita até ${MESES_MAXIMOS_PDF_OXR} meses)`}
              </>
            )}
          </p>
          <div role="region" aria-labelledby="oxr-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
            <table>
              <caption id="oxr-caption">Orçado x Realizado por conta e mês (R$)</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    Conta
                  </th>
                  {tela.meses.map((m) => (
                    <th key={m} scope="col" colSpan={3}>
                      {mesOxr(m)}
                    </th>
                  ))}
                  <th scope="col" colSpan={4}>
                    Total do período
                  </th>
                </tr>
                <tr>
                  {tela.meses.map((m) => (
                    <SubCabecalho key={m} />
                  ))}
                  <th scope="col">Orçado</th>
                  <th scope="col">Realizado</th>
                  <th scope="col">Saldo</th>
                  <th scope="col">% uso</th>
                </tr>
              </thead>
              <tbody>
                {tela.grade.linhas.map((l) => (
                  <Linha key={l.conta} l={l} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{tela.filtros.conta ? `Total da conta ${tela.filtros.conta}` : 'Total período'}</th>
                  {tela.grade.total.meses.map((c, i) => (
                    <Celulas key={i} c={c} />
                  ))}
                  <Periodo t={tela.grade.total.periodo} />
                </tr>
              </tfoot>
            </table>
          </div>
          {tela.grade.linhas.length === 0 && <p>Nenhuma conta com orçado ou realizado no período.</p>}
          {tela.grade.foraDoPlano.length > 0 && (
            <p role="note">{`Valores em conta fora do plano de contas: ${tela.grade.foraDoPlano.map((x) => `${x.conta} (orçado ${valorParaTela(x.orcado)})`).join('; ')}.`}</p>
          )}
        </section>
      )}
      {!tela && !erro && propostas.length > 0 && <p>{MENSAGENS_OXR.SEM_TP}</p>}
    </>
  );
}

function SubCabecalho() {
  return (
    <>
      <th scope="col">Orçado</th>
      <th scope="col">Realiz.</th>
      <th scope="col">% uso</th>
    </>
  );
}
