'use client';

import { useState, useTransition } from 'react';
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
        {...(podeAlterar ? { acaoSelecionar: async (id: string) => setEditando(itens.find((i) => i.codigo === id) ?? null) } : {})}
        textoVazio="Nenhum benefício cadastrado neste exercício."
      />
      {podeAlterar && editando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
          aria-label={`Alterar ${editando.nome}`}
        >
          <h2>Alterar {editando.codigo}</h2>
          {erroDe('_') && <p role="alert">{erroDe('_')}</p>}
          <label>
            Nome <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} aria-invalid={Boolean(erroDe('nome'))} />
          </label>
          {erroDe('nome') && <span>{erroDe('nome')}</span>}
          {editando.forma === 'PERCENTUAL_SALARIO' ? (
            <label>
              % do salário{' '}
              <input inputMode="decimal" value={editando.percentual ?? ''} onChange={(e) => setEditando({ ...editando, percentual: e.target.value })} />
            </label>
          ) : (
            <label>
              {editando.forma === 'VALOR_DIARIO' ? 'Valor por dia útil' : 'Valor mensal'}{' '}
              <input inputMode="decimal" value={editando.valor ?? ''} onChange={(e) => setEditando({ ...editando, valor: e.target.value })} />
            </label>
          )}
          {(erroDe('valor') || erroDe('percentual')) && <span>{erroDe('valor')} {erroDe('percentual')}</span>}
          <label>
            Conta <input value={editando.conta} onChange={(e) => setEditando({ ...editando, conta: e.target.value })} />
          </label>
          {erroDe('conta') && <span>{erroDe('conta')}</span>}
          <label>
            <input type="checkbox" checked={editando.padraoPosicao} onChange={(e) => setEditando({ ...editando, padraoPosicao: e.target.checked })} /> Padrão da posição
          </label>
          <label>
            <input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo
          </label>
          <button type="submit" disabled={salvando}>
            Salvar
          </button>
          <button type="button" onClick={() => setEditando(null)}>
            Cancelar
          </button>
        </form>
      )}
    </section>
  );
}
