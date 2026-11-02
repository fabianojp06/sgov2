'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import type { ErroCampo } from '@/shared/kernel';

// Tela da Tabela Mestre de Benefícios (US-050). Lista os itens do exercício na grade do sistema e,
// com a permissão de alterar, edita um item por vez. Valores como texto (ponto ou vírgula decimal).
export type ItemTela = {
  codigo: string;
  nome: string;
  forma: 'VALOR_MENSAL' | 'VALOR_DIARIO' | 'PERCENTUAL_SALARIO';
  valor: string | null;
  percentual: string | null;
  conta: string;
  padraoPosicao: boolean;
  ativo: boolean;
  provisorio: boolean;
  versao: number;
};
type Resposta = { ok: true } | { ok: false; erros: readonly ErroCampo[] };
type Colunas = 'codigo' | 'nome' | 'forma' | 'valor' | 'percentual' | 'conta' | 'situacao';

const ROTULO_FORMA: Record<ItemTela['forma'], string> = {
  VALOR_MENSAL: 'Valor mensal',
  VALOR_DIARIO: 'Valor por dia útil',
  PERCENTUAL_SALARIO: '% do salário',
};

export function TabelaMestre({
  ano,
  itens,
  podeAlterar,
  alterar,
}: {
  ano: number;
  itens: readonly ItemTela[];
  podeAlterar: boolean;
  alterar: (d: Omit<ItemTela, 'provisorio'> & { ano: number }) => Promise<Resposta>;
}) {
  const [editando, setEditando] = useState<ItemTela | null>(null);
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvando, iniciar] = useTransition();
  const [escolhido, setEscolhido] = useState('');
  const titulo = useRef<HTMLHeadingElement>(null);
  // O foco vai para o formulário quando ele abre (teclado e leitor de tela).
  useEffect(() => {
    if (editando) titulo.current?.focus();
  }, [editando?.codigo]);
  const abrir = (codigo: string) => {
    setErros([]);
    setEditando(itens.find((i) => i.codigo === codigo) ?? null);
  };

  const nos: NoGrade<Colunas>[] = itens.map((i) => ({
    id: i.codigo,
    linha: {
      codigo: i.codigo,
      nome: i.nome,
      forma: ROTULO_FORMA[i.forma],
      valor: i.valor,
      percentual: i.percentual,
      conta: i.conta,
      situacao: `${i.ativo ? 'Ativo' : 'Inativo'}${i.padraoPosicao ? ' · padrão da posição' : ''}${i.provisorio ? ' · Provisório' : ''}`,
    },
  }));

  const salvar = () => {
    if (!editando) return;
    const { provisorio: _p, ...dados } = editando;
    void _p;
    iniciar(async () => {
      const r = await alterar({ ...dados, ano });
      if (r.ok) {
        setEditando(null);
        setErros([]);
      } else setErros(r.erros);
    });
  };
  const erroDe = (campo: string) => erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');

  return (
    <section>
      <GradeArvore<Colunas>
        idGrade={`cad.beneficios.${ano}`}
        rotulo={`Tabela Mestre de Benefícios ${ano}`}
        nos={nos}
        colunas={[
          { campo: 'codigo', titulo: 'Código', tipo: 'texto' },
          { campo: 'nome', titulo: 'Nome', tipo: 'texto' },
          { campo: 'forma', titulo: 'Forma', tipo: 'texto' },
          { campo: 'valor', titulo: 'Valor por pessoa', tipo: 'dinheiro' },
          { campo: 'percentual', titulo: '% do salário', tipo: 'percentual' },
          { campo: 'conta', titulo: 'Conta', tipo: 'texto' },
          { campo: 'situacao', titulo: 'Situação', tipo: 'texto' },
        ]}
        {...(podeAlterar ? { acaoSelecionar: async (id: string) => abrir(id) } : {})}
        textoVazio="Nenhum benefício cadastrado neste exercício."
      />
      {podeAlterar && itens.length > 0 && (
        // Caminho pelo teclado para abrir a edição (a seleção pela linha da grade é só pelo mouse).
        // A abertura é pelo botão: em alguns navegadores, cada seta no <select> dispara change.
        <div>
          <label>
            Alterar o benefício{' '}
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
              <option value="">Escolha um item</option>
              {itens.map((i) => (
                <option key={i.codigo} value={i.codigo}>
                  {i.nome}
                </option>
              ))}
            </select>
          </label>{' '}
          <button type="button" disabled={!escolhido} onClick={() => abrir(escolhido)}>
            Abrir
          </button>
        </div>
      )}
      {podeAlterar && editando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
          aria-label={`Alterar ${editando.nome}`}
        >
          <h2 ref={titulo} tabIndex={-1}>
            Alterar {editando.nome} ({editando.codigo})
          </h2>
          {erroDe('_') && <p role="alert">{erroDe('_')}</p>}
          <Campo id="nome" rotulo="Nome" erro={erroDe('nome')} valor={editando.nome} mudar={(v) => setEditando({ ...editando, nome: v })} />
          {editando.forma === 'PERCENTUAL_SALARIO' ? (
            <Campo id="percentual" rotulo="% do salário" erro={erroDe('percentual')} valor={editando.percentual ?? ''} decimal mudar={(v) => setEditando({ ...editando, percentual: v })} />
          ) : (
            <Campo
              id="valor"
              rotulo={editando.forma === 'VALOR_DIARIO' ? 'Valor por dia útil' : 'Valor mensal'}
              erro={erroDe('valor')}
              valor={editando.valor ?? ''}
              decimal
              mudar={(v) => setEditando({ ...editando, valor: v })}
            />
          )}
          <Campo id="conta" rotulo="Conta" erro={erroDe('conta')} valor={editando.conta} mudar={(v) => setEditando({ ...editando, conta: v })} />
          <label>
            <input type="checkbox" checked={editando.padraoPosicao} onChange={(e) => setEditando({ ...editando, padraoPosicao: e.target.checked })} /> Padrão da posição
          </label>
          <label>
            <input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo
          </label>
          <button type="submit" disabled={salvando}>
            Salvar
          </button>
          <button
            type="button"
            onClick={() => {
              setEditando(null);
              setErros([]);
            }}
          >
            Cancelar
          </button>
        </form>
      )}
    </section>
  );
}

// Campo com rótulo, erro ligado por aria-describedby e role="alert" (padrão do form-troca-senha).
function Campo({ id, rotulo, erro, valor, mudar, decimal }: { id: string; rotulo: string; erro: string; valor: string; mudar: (v: string) => void; decimal?: boolean }) {
  const idCampo = `beneficio-${id}`;
  return (
    <div>
      <label htmlFor={idCampo}>{rotulo}</label>{' '}
      <input
        id={idCampo}
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        {...(decimal ? { inputMode: 'decimal' as const } : {})}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      />
      {erro && (
        <span id={`${idCampo}-erro`} role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
