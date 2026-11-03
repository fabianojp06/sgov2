'use client';

import { useState, useTransition } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import type { ErroCampo } from '@/shared/kernel';
import { ROTULO_DESVIO, ROTULO_FONTE, type CargoTela } from '../domain/cargo-tela';

// Lista dos cargos (US-049 parte 2): só leitura, sem Novo (os cargos entram pelo Rubi). Cada linha leva
// ao cargo. Sem a permissão de ver salários, a coluna do salário vem "mascarado" (R24).
type Colunas = 'codigo' | 'nome' | 'tabela' | 'faixa' | 'nivel' | 'fonte' | 'salario' | 'desvio' | 'situacao';
type RespostaRegravar = { ok: true; valor: { manuais: number; cargaId: string | null } } | { ok: false; erros: readonly ErroCampo[] };

export function ListaCargos({
  cargos,
  escopoSessao,
  podeRegravar,
  regravar,
}: {
  cargos: readonly CargoTela[];
  escopoSessao: string;
  podeRegravar: boolean;
  regravar?: (e: Record<string, never>) => Promise<RespostaRegravar>;
}) {
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [regravando, iniciar] = useTransition();
  const nos: NoGrade<Colunas>[] = cargos.map((c) => ({
    id: c.id,
    href: `/cad/cargos/${c.id}`,
    linha: {
      codigo: c.codigo,
      nome: c.nomeOficial,
      tabela: c.tabelaSalarial,
      faixa: c.faixa,
      nivel: c.nivel,
      fonte: c.fonteAtiva ? ROTULO_FONTE[c.fonteAtiva] : null,
      salario: c.mascarado ? 'mascarado' : c.salariosIlegiveis.length > 0 && c.salarioDaFonte === null ? 'ilegível' : c.salarioDaFonte,
      desvio: c.desvioDeMercado ? ROTULO_DESVIO[c.desvioDeMercado] : null,
      situacao: c.ativo ? 'Ativo' : 'Inativo',
    },
  }));
  return (
    <section>
      <p role="status">{aviso}</p>
      {erro && <p role="alert">{erro}</p>}
      {podeRegravar && regravar && (
        <button
          type="button"
          disabled={regravando}
          onClick={() =>
            iniciar(async () => {
              setAviso('');
              setErro('');
              try {
                const r = await regravar({});
                if (r.ok) {
                  const m = r.valor.manuais;
                  setAviso(`Regravação pedida: ${m} ${m === 1 ? 'cargo' : 'cargos'} com salários manuais regravados${r.valor.cargaId ? `; o salário real segue na carga ${r.valor.cargaId} do worker. Repita até não haver o que regravar.` : '.'}`);
                }
                else setErro(r.erros.map((e) => e.mensagem).join(' '));
              } catch {
                setErro('Não foi possível pedir a regravação. Confira a conexão e tente de novo.');
              }
            })
          }
        >
          Regravar salários com a chave atual
        </button>
      )}
      <GradeArvore<Colunas>
        idGrade="cad.cargos"
        rotulo="Cargos"
        nos={nos}
        colunas={[
          { campo: 'codigo', titulo: 'Código', tipo: 'texto' },
          { campo: 'nome', titulo: 'Cargo', tipo: 'texto' },
          { campo: 'tabela', titulo: 'Tabela salarial', tipo: 'texto' },
          { campo: 'faixa', titulo: 'Faixa', tipo: 'texto' },
          { campo: 'nivel', titulo: 'Nível', tipo: 'texto' },
          { campo: 'fonte', titulo: 'Fonte ativa', tipo: 'texto' },
          { campo: 'salario', titulo: 'Salário da fonte', tipo: cargos.some((c) => c.mascarado) ? 'texto' : 'dinheiro' },
          { campo: 'desvio', titulo: 'Mercado', tipo: 'texto' },
          { campo: 'situacao', titulo: 'Situação', tipo: 'texto' },
        ]}
        filtros={[{ tipo: 'texto', id: 'busca', rotulo: 'Buscar por código ou cargo', campos: ['codigo', 'nome'] }]}
        escopoSessao={escopoSessao}
        textoVazio="Nenhum cargo cadastrado. Os cargos entram pela importação da planilha do Rubi."
      />
    </section>
  );
}
