'use client';

import { useState, useTransition } from 'react';
import { Dinheiro } from '@/shared/kernel';
import { FONTES_ATIVAS, GRAUS_INSALUBRIDADE, type FonteAtiva, type GrauInsalubridade } from '../domain/cargo';
import { ROTULO_DESVIO, ROTULO_FONTE, type CargoTela, type FaixaTela } from '../domain/cargo-tela';
import { depoisDeSalvar, type EstadoSalvar, type RespostaSalvar } from './form-parametros-logica';

// Cargo (US-049 parte 2; plano do P4, Task 12b). Os campos do Rubi ficam desabilitados (só a carga
// muda); os manuais se editam com cad.cargos:alterar. Sem cad.salarios, os salários não vêm à tela
// (R24) e não vão no envio. O desvio de mercado tem cor e texto (não só cor).
export type EnvioCargo = {
  idCargo: string;
  versao: number;
  mercadoMinimo: string | null;
  mercadoMaximo: string | null;
  periculosidade: boolean;
  insalubridade: GrauInsalubridade | null;
  fonteAtiva: FonteAtiva | null;
  funcaoGratificada?: string | null;
  salarioDefinido?: string | null;
};

const ROTULO_GRAU: Readonly<Record<GrauInsalubridade, string>> = { MINIMO: 'Mínimo (10%)', MEDIO: 'Médio (20%)', MAXIMO: 'Máximo (40%)' };
export const COR_DESVIO: Readonly<Record<NonNullable<CargoTela['desvioDeMercado']>, string>> = { ABAIXO: '#b45309', DENTRO: '#15803d', ACIMA: '#b91c1c' };

const vazioParaNulo = (s: string) => (s.trim() === '' ? null : s);
// Exibição em pt-BR ("10.200,00"); os campos editáveis aceitam ponto ou vírgula.
const emReais = (v: string) => Dinheiro.de(v).formatar();

/** O pedido do Salvar: os salários só vão quando a tela os mostra (sem máscara). */
export function montarEnvioCargo(c: CargoTela, versao: number, f: Campos): EnvioCargo {
  return {
    idCargo: c.id,
    versao,
    mercadoMinimo: vazioParaNulo(f.mercadoMinimo),
    mercadoMaximo: vazioParaNulo(f.mercadoMaximo),
    periculosidade: f.adicional === 'PERICULOSIDADE',
    insalubridade: f.adicional === 'INSALUBRIDADE' ? f.grau : null,
    fonteAtiva: f.fonteAtiva === '' ? null : f.fonteAtiva,
    // Mascarado não envia salário; o ilegível também não (vazio na tela, mandar null apagaria o gravado).
    ...(c.mascarado || c.salariosIlegiveis.includes('funcaoGratificada') ? {} : { funcaoGratificada: vazioParaNulo(f.funcaoGratificada) }),
    ...(c.mascarado || c.salariosIlegiveis.includes('definido') ? {} : { salarioDefinido: vazioParaNulo(f.salarioDefinido) }),
  };
}

export type Campos = {
  mercadoMinimo: string;
  mercadoMaximo: string;
  adicional: '' | 'PERICULOSIDADE' | 'INSALUBRIDADE';
  grau: GrauInsalubridade;
  fonteAtiva: FonteAtiva | '';
  funcaoGratificada: string;
  salarioDefinido: string;
};

export const camposIniciais = (c: CargoTela): Campos => ({
  mercadoMinimo: c.salarios.minimo ?? '',
  mercadoMaximo: c.salarios.maximo ?? '',
  adicional: c.adicional?.tipo ?? '',
  grau: c.adicional?.tipo === 'INSALUBRIDADE' ? c.adicional.grau : 'MINIMO',
  fonteAtiva: c.fonteAtiva ?? '',
  funcaoGratificada: c.salarios.funcaoGratificada ?? '',
  salarioDefinido: c.salarios.definido ?? '',
});

export function FormCargo({
  cargo,
  podeAlterar,
  alterar,
  faixas = [],
  copiarFaixa,
}: {
  cargo: CargoTela;
  podeAlterar: boolean;
  alterar: (e: EnvioCargo) => Promise<RespostaSalvar>;
  /** Faixas ativas da tabela salarial deste cargo (REQ_TAB_003), para quem tem cad.tabela_salarial. */
  faixas?: readonly FaixaTela[];
  copiarFaixa?: (e: { idCargo: string; idFaixa: string; versao: number }) => Promise<RespostaSalvar>;
}) {
  const [origem, setOrigem] = useState(cargo.origemMercado);
  const [f, setF] = useState<Campos>(() => camposIniciais(cargo));
  const [estado, setEstado] = useState<EstadoSalvar>({ versao: cargo.versao, erros: [], salvo: false });
  const [salvando, iniciar] = useTransition();
  const bloqueado = !podeAlterar;
  const erroDe = (campo: string) => estado.erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');
  const gerais = estado.erros.filter((e) => !['mercadoMinimo', 'mercadoMaximo', 'adicional', 'fonteAtiva', 'funcaoGratificada', 'salarioDefinido'].includes(e.campo));

  const salvar = () =>
    iniciar(async () => {
      setEstado((a) => ({ ...a, salvo: false }));
      try {
        const r = await alterar(montarEnvioCargo(cargo, estado.versao, f));
        setEstado((a) => depoisDeSalvar(a, r));
      } catch {
        setEstado((a) => ({ ...a, erros: [{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }] }));
      }
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
      aria-busy={salvando}
      noValidate
    >
      {gerais.length > 0 && (
        <ul role="alert">
          {gerais.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
      <p role="status">{estado.salvo ? `Cargo ${cargo.codigo} salvo.` : ''}</p>
      <fieldset disabled>
        <legend>Dados do Rubi (só a importação muda)</legend>
        <Somente id="codigo" rotulo="Código" valor={cargo.codigo} />
        <Somente id="nome" rotulo="Cargo" valor={cargo.nomeOficial} />
        <Somente id="mercado" rotulo="Cargo mercado" valor={cargo.nomeMercado ?? ''} />
        <Somente id="tabela" rotulo="Tabela salarial" valor={cargo.tabelaSalarial ?? ''} />
        <Somente id="faixa" rotulo="Faixa" valor={cargo.faixa ?? ''} />
        <Somente id="nivel" rotulo="Nível" valor={cargo.nivel ?? ''} />
        {!cargo.mascarado && <Somente id="real" rotulo="Salário real" valor={cargo.salarios.real ? emReais(cargo.salarios.real) : ''} />}
      </fieldset>
      {cargo.mascarado && <p>Os salários ficam mascarados: você não tem a permissão de ver salários.</p>}
      {cargo.salariosIlegiveis.length > 0 && (
        <p role="alert">Algum salário deste cargo não pôde ser lido (chave de cifra) e não muda ao salvar. Avise o administrador.</p>
      )}
      <fieldset disabled={bloqueado}>
        <legend>Mercado e salários</legend>
        {!cargo.mascarado && (
          <>
            <Campo id="mercadoMinimo" rotulo="Salário mínimo de mercado (R$)" erro={erroDe('mercadoMinimo')} valor={f.mercadoMinimo} mudar={(v) => setF({ ...f, mercadoMinimo: v })} />
            <Campo id="mercadoMaximo" rotulo="Salário máximo de mercado (R$)" erro={erroDe('mercadoMaximo')} valor={f.mercadoMaximo} mudar={(v) => setF({ ...f, mercadoMaximo: v })} />
            <Campo id="funcaoGratificada" rotulo="Função gratificada (R$)" erro={erroDe('funcaoGratificada')} valor={f.funcaoGratificada} mudar={(v) => setF({ ...f, funcaoGratificada: v })} />
            <Campo id="salarioDefinido" rotulo="Salário definido (R$)" erro={erroDe('salarioDefinido')} valor={f.salarioDefinido} mudar={(v) => setF({ ...f, salarioDefinido: v })} />
          </>
        )}
        {origem && <p>Origem do mercado: {origem}</p>}
        <div>
          <label htmlFor="cargo-fonteAtiva">Fonte ativa</label>{' '}
          <select
            id="cargo-fonteAtiva"
            value={f.fonteAtiva}
            onChange={(e) => setF({ ...f, fonteAtiva: e.target.value as Campos['fonteAtiva'] })}
            {...(erroDe('fonteAtiva') ? { 'aria-invalid': true, 'aria-describedby': 'cargo-fonteAtiva-erro' } : {})}
          >
            <option value="">Não definida</option>
            {FONTES_ATIVAS.map((x) => (
              <option key={x} value={x}>
                {ROTULO_FONTE[x]}
              </option>
            ))}
          </select>
          {erroDe('fonteAtiva') && <span id="cargo-fonteAtiva-erro">{erroDe('fonteAtiva')}</span>}
        </div>
        {!cargo.mascarado && cargo.salarioDaFonte !== null && <p>Salário da fonte ativa: {emReais(cargo.salarioDaFonte)}</p>}
        {cargo.desvioDeMercado && (
          <p>
            <span style={{ color: COR_DESVIO[cargo.desvioDeMercado] }} aria-hidden="true">
              ●
            </span>{' '}
            {ROTULO_DESVIO[cargo.desvioDeMercado]}
          </p>
        )}
      </fieldset>
      <fieldset disabled={bloqueado} {...(erroDe('adicional') ? { 'aria-describedby': 'cargo-adicional-erro' } : {})}>
        <legend>Adicional trabalhista</legend>
        {erroDe('adicional') && <p id="cargo-adicional-erro">{erroDe('adicional')}</p>}
        {(
          [
            ['', 'Nenhum'],
            ['PERICULOSIDADE', 'Periculosidade (30%)'],
            ['INSALUBRIDADE', 'Insalubridade'],
          ] as const
        ).map(([v, r]) => (
          <label key={v}>
            <input type="radio" name="adicional" value={v} checked={f.adicional === v} onChange={() => setF({ ...f, adicional: v })} /> {r}
          </label>
        ))}
        {f.adicional === 'INSALUBRIDADE' && (
          <div>
            <label htmlFor="cargo-grau">Grau</label>{' '}
            <select id="cargo-grau" value={f.grau} onChange={(e) => setF({ ...f, grau: e.target.value as GrauInsalubridade })}>
              {GRAUS_INSALUBRIDADE.map((g) => (
                <option key={g} value={g}>
                  {ROTULO_GRAU[g]}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      {!bloqueado && !cargo.mascarado && copiarFaixa && faixas.length > 0 && (
        <section aria-labelledby="titulo-tabela-salarial">
          <h2 id="titulo-tabela-salarial">Tabela salarial deste cargo</h2>
          <ul>
            {faixas.map((fx) => (
              <li key={fx.id}>
                {`${fx.senioridade}: ${emReais(fx.minimo)} a ${emReais(fx.maximo)}`}{' '}
                <button
                  type="button"
                  disabled={salvando}
                  onClick={() =>
                    iniciar(async () => {
                      try {
                        const r = await copiarFaixa({ idCargo: cargo.id, idFaixa: fx.id, versao: estado.versao });
                        setEstado((a) => depoisDeSalvar(a, r));
                        if (r.ok) {
                          // RN_TAB_04: a faixa sobrescreve o mínimo e o máximo; seguem editáveis.
                          setF((a) => ({ ...a, mercadoMinimo: fx.minimo, mercadoMaximo: fx.maximo }));
                          setOrigem(`Preenchido via Tabela Salarial — ${cargo.nomeOficial}/${fx.senioridade}`);
                        }
                      } catch {
                        setEstado((a) => ({ ...a, erros: [{ campo: '_', mensagem: 'Não foi possível usar a faixa. Confira a conexão e tente de novo.' }] }));
                      }
                    })
                  }
                >
                  Usar a faixa {fx.senioridade}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!bloqueado && (
        <button type="submit" disabled={salvando}>
          Salvar
        </button>
      )}
    </form>
  );
}

function Somente({ id, rotulo, valor }: { id: string; rotulo: string; valor: string }) {
  return (
    <div>
      <label htmlFor={`cargo-${id}`}>{rotulo}</label> <input id={`cargo-${id}`} value={valor} readOnly />
    </div>
  );
}

function Campo({ id, rotulo, erro, valor, mudar }: { id: string; rotulo: string; erro: string; valor: string; mudar: (v: string) => void }) {
  const idCampo = `cargo-${id}`;
  return (
    <div>
      <label htmlFor={idCampo}>{rotulo}</label>{' '}
      <input
        id={idCampo}
        value={valor}
        inputMode="decimal"
        onChange={(e) => mudar(e.target.value)}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      />
      {erro && <span id={`${idCampo}-erro`}>{erro}</span>}
    </div>
  );
}
