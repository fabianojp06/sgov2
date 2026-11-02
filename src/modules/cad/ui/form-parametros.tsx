'use client';

import { useState, useTransition, type ReactNode } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import { ROTULO_COMPONENTE, totalEncargos, type ComponenteComConta, type OpcaoConta, type ParametrosTela } from '../domain/parametros-tela';

// Parâmetros do exercício (US-053 parte 2; plano do P4, Task 9b): premissas, semáforo, encargos com
// o total e as contas por componente, escolhidas entre as analíticas ativas. Com o ano congelado ou
// sem a permissão de alterar, tudo fica desabilitado. Valores como texto (ponto ou vírgula decimal).
type Resposta = { ok: true; valor: { versao: number } } | { ok: false; erros: readonly ErroCampo[] };
type Editavel = Omit<ParametrosTela, 'ano' | 'versao' | 'congelado' | 'provisorio' | 'provisorios'>;
export type EntradaAlterarParametros = Omit<Editavel, 'encargos'> & {
  ano: number;
  versao: number;
  encargos: { componente: ParametrosTela['encargos'][number]['componente']; percentual: string; conta: string }[];
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const COMPONENTES: readonly ComponenteComConta[] = ['salario', 'adicional', 'ferias', 'decimo_terceiro'];

export const mensagemCongelado = (ano: number) => `Os parâmetros de ${ano} estão congelados: o exercício foi oficializado e nada pode ser alterado.`;

export function FormParametros({
  tela,
  contas,
  podeAlterar,
  alterar,
}: {
  tela: ParametrosTela;
  contas: readonly OpcaoConta[];
  podeAlterar: boolean;
  alterar: (e: EntradaAlterarParametros) => Promise<Resposta>;
}) {
  const [dados, setDados] = useState<Editavel>(() => ({
    reajuste: tela.reajuste,
    mesDataBase: tela.mesDataBase,
    ipca: tela.ipca,
    diasUteisMes: tela.diasUteisMes,
    semaforo: tela.semaforo,
    encargos: tela.encargos,
    contas: tela.contas,
  }));
  const [versao, setVersao] = useState(tela.versao);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [salvando, iniciar] = useTransition();
  const bloqueado = tela.congelado || !podeAlterar;
  const erroDe = (campo: string) => erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');
  const provisorio = (c: string) => tela.provisorios.includes(c as (typeof tela.provisorios)[number]);
  const total = totalEncargos(dados.encargos.map((e) => e.percentual));

  const salvar = () =>
    iniciar(async () => {
      setSalvo(false);
      try {
        const r = await alterar({ ...dados, ano: tela.ano, versao, encargos: dados.encargos.map(({ componente, percentual, conta }) => ({ componente, percentual, conta })) });
        if (r.ok) {
          setVersao(r.valor.versao);
          setErros([]);
          setSalvo(true);
        } else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }]);
      }
    });

  const mudarEncargo = (i: number, campo: 'percentual' | 'conta', v: string) =>
    setDados({ ...dados, encargos: dados.encargos.map((e, j) => (j === i ? { ...e, [campo]: v } : e)) });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
      aria-busy={salvando}
      noValidate
    >
      {erros.length > 0 && (
        <ul role="alert">
          {erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      <p role="status">{salvo ? `Parâmetros de ${tela.ano} salvos.` : ''}</p>
      {tela.congelado && <p>{mensagemCongelado(tela.ano)}</p>}
      <fieldset disabled={bloqueado}>
        <legend>Premissas</legend>
        <Campo id="reajuste" rotulo="Reajuste (%)" erro={erroDe('reajuste')} valor={dados.reajuste} mudar={(v) => setDados({ ...dados, reajuste: v })} />
        <div>
          <label htmlFor="param-mesDataBase">Mês da data-base</label>{' '}
          <select id="param-mesDataBase" value={dados.mesDataBase} onChange={(e) => setDados({ ...dados, mesDataBase: Number(e.target.value) })}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <Campo id="ipca" rotulo="IPCA (%)" erro={erroDe('ipca')} valor={dados.ipca} mudar={(v) => setDados({ ...dados, ipca: v })} />
        <Campo
          id="diasUteisMes"
          rotulo="Dias úteis por mês"
          erro={erroDe('diasUteisMes')}
          valor={String(dados.diasUteisMes)}
          numerico
          mudar={(v) => setDados({ ...dados, diasUteisMes: /^\d{1,2}$/.test(v) ? Number(v) : 0 })}
        />
      </fieldset>
      <fieldset disabled={bloqueado}>
        <legend>Semáforo da execução (% do orçado)</legend>
        {erroDe('semaforo') && <p>{erroDe('semaforo')}</p>}
        {(['verdeAte', 'amareloAte', 'laranjaAte'] as const).map((f) => (
          <Campo
            key={f}
            id={`semaforo.${f}`}
            rotulo={{ verdeAte: 'Verde até', amareloAte: 'Amarelo até', laranjaAte: 'Laranja até' }[f]}
            erro={erroDe(`semaforo.${f}`)}
            valor={dados.semaforo[f]}
            mudar={(v) => setDados({ ...dados, semaforo: { ...dados.semaforo, [f]: v } })}
          />
        ))}
      </fieldset>
      <fieldset disabled={bloqueado}>
        <legend>Encargos</legend>
        {erroDe('encargos') && <p>{erroDe('encargos')}</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">Encargo</th>
              <th scope="col">Percentual (%)</th>
              <th scope="col">Conta</th>
            </tr>
          </thead>
          <tbody>
            {dados.encargos.map((e, i) => (
              <tr key={e.componente}>
                <th scope="row">
                  {e.nome}
                  {provisorio(e.componente) && <Selo />}
                </th>
                <td>
                  <Campo
                    id={`encargos.${i}.percentual`}
                    rotulo={`Percentual de ${e.nome}`}
                    oculto
                    erro={erroDe(`encargos.${i}.percentual`)}
                    valor={e.percentual}
                    mudar={(v) => mudarEncargo(i, 'percentual', v)}
                  />
                </td>
                <td>
                  <SeletorConta
                    id={`encargos.${i}.conta`}
                    rotulo={`Conta de ${e.nome}`}
                    erro={erroDe(`encargos.${i}.conta`)}
                    valor={e.conta}
                    contas={contas}
                    mudar={(v) => mudarEncargo(i, 'conta', v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total dos encargos</th>
              <td>{total ?? '—'}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </fieldset>
      <fieldset disabled={bloqueado}>
        <legend>Contas por componente</legend>
        {COMPONENTES.map((c) => (
          <div key={c}>
            <SeletorConta
              id={`contas.${c}`}
              rotulo={ROTULO_COMPONENTE[c]}
              erro={erroDe(`contas.${c}`)}
              valor={dados.contas[c]}
              contas={contas}
              mudar={(v) => setDados({ ...dados, contas: { ...dados.contas, [c]: v } })}
              selo={provisorio(c) ? <Selo /> : null}
            />
          </div>
        ))}
      </fieldset>
      {!bloqueado && (
        <button type="submit" disabled={salvando}>
          Salvar
        </button>
      )}
    </form>
  );
}

export function Selo() {
  return <strong> Provisório</strong>;
}

const idDe = (campo: string) => `param-${campo.replace(/\./g, '-')}`;

function Campo({
  id,
  rotulo,
  erro,
  valor,
  mudar,
  numerico,
  oculto,
}: {
  id: string;
  rotulo: string;
  erro: string;
  valor: string;
  mudar: (v: string) => void;
  numerico?: boolean;
  oculto?: boolean;
}) {
  const idCampo = idDe(id);
  return (
    <div>
      {oculto ? null : <label htmlFor={idCampo}>{rotulo}</label>}{' '}
      <input
        id={idCampo}
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        inputMode={numerico ? 'numeric' : 'decimal'}
        {...(oculto ? { 'aria-label': rotulo } : {})}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      />
      {erro && <span id={`${idCampo}-erro`}>{erro}</span>}
    </div>
  );
}

function SeletorConta({
  id,
  rotulo,
  erro,
  valor,
  contas,
  mudar,
  selo,
}: {
  id: string;
  rotulo: string;
  erro: string;
  valor: string;
  contas: readonly OpcaoConta[];
  mudar: (v: string) => void;
  selo?: ReactNode;
}) {
  const idCampo = idDe(id);
  // A conta gravada que deixou de ser analítica ativa continua visível, para não trocar sozinha.
  const fora = valor !== '' && !contas.some((c) => c.classificacao === valor);
  return (
    <>
      <label htmlFor={idCampo}>{rotulo}</label>
      {selo}{' '}
      <select
        id={idCampo}
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      >
        {fora && <option value={valor}>{`${valor} (não é mais analítica ativa)`}</option>}
        {contas.map((c) => (
          <option key={c.classificacao} value={c.classificacao}>
            {`${c.classificacao} — ${c.descricao}`}
          </option>
        ))}
      </select>
      {erro && <span id={`${idCampo}-erro`}>{erro}</span>}
    </>
  );
}
