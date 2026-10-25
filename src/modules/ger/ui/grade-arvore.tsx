'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatarCelula, type TipoColuna, type ValorCelula } from '../domain/celula';

// Contrato C3: Tree Grid do sistema. Esta é a versão mínima do contrato, sem virtualização;
// a US-021 (P4) troca a implementação mantendo as props (props novas entram como opcionais).
export type LinhaGrade = Readonly<Record<string, ValorCelula>>;

export type ColunaGrade = {
  campo: string; // chave em LinhaGrade
  titulo: string;
  tipo: TipoColuna;
  largura?: number; // px
};

export type NoGrade = {
  id: string;
  linha: LinhaGrade;
  href?: string; // navegação ao clicar na linha
  filhos?: readonly NoGrade[];
};

export type PropsGradeArvore = {
  idGrade: string; // chave da expansão (e, na US-021, dos filtros) retida na sessão (RNF0005)
  nos: readonly NoGrade[];
  colunas: readonly ColunaGrade[];
  expandidos?: 'todos' | 'nenhum' | readonly string[];
  acaoSelecionar?: (id: string) => Promise<void>; // Server Action, opcional
  textoVazio?: string;
};

type LinhaVisivel = { no: NoGrade; nivel: number };

function idsComFilhos(nos: readonly NoGrade[], acc: string[] = []): string[] {
  for (const no of nos) {
    if (no.filhos?.length) {
      acc.push(no.id);
      idsComFilhos(no.filhos, acc);
    }
  }
  return acc;
}

function expansaoInicial(nos: readonly NoGrade[], expandidos: PropsGradeArvore['expandidos']): Set<string> {
  if (expandidos === 'todos') return new Set(idsComFilhos(nos));
  if (expandidos === undefined || expandidos === 'nenhum') return new Set();
  return new Set(expandidos);
}

function visiveis(nos: readonly NoGrade[], abertos: Set<string>, nivel = 1, acc: LinhaVisivel[] = []): LinhaVisivel[] {
  for (const no of nos) {
    acc.push({ no, nivel });
    if (no.filhos?.length && abertos.has(no.id)) visiveis(no.filhos, abertos, nivel + 1, acc);
  }
  return acc;
}

const chaveSessao = (idGrade: string) => `sgo.grade.${idGrade}.expandidos`;

export function GradeArvore({ idGrade, nos, colunas, expandidos, acaoSelecionar, textoVazio }: PropsGradeArvore) {
  const [abertos, setAbertos] = useState(() => expansaoInicial(nos, expandidos));
  const [, iniciarTransicao] = useTransition();

  // Expansão retida na sessão do navegador (RNF0005). Sem sessionStorage (privado, bloqueado), segue sem reter.
  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(chaveSessao(idGrade));
      if (salvo) setAbertos(new Set(JSON.parse(salvo) as string[]));
    } catch {
      // sem armazenamento de sessão: mantém a expansão inicial
    }
  }, [idGrade]);

  const alternar = (id: string) => {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      try {
        sessionStorage.setItem(chaveSessao(idGrade), JSON.stringify([...novo]));
      } catch {
        // sem armazenamento de sessão: a expansão vale só nesta tela
      }
      return novo;
    });
  };

  if (nos.length === 0) return <p>{textoVazio ?? 'Nenhum registro.'}</p>;

  return (
    <table role="treegrid" aria-label={idGrade}>
      <thead>
        <tr>
          {colunas.map((c) => (
            <th key={c.campo} scope="col" style={c.largura ? { width: c.largura } : undefined}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visiveis(nos, abertos).map(({ no, nivel }) => {
          const temFilhos = Boolean(no.filhos?.length);
          const aberto = abertos.has(no.id);
          return (
            <tr
              key={no.id}
              aria-level={nivel}
              {...(temFilhos ? { 'aria-expanded': aberto } : {})}
              onClick={acaoSelecionar ? () => iniciarTransicao(() => acaoSelecionar(no.id)) : undefined}
            >
              {colunas.map((c, i) => {
                const texto = formatarCelula(c.tipo, no.linha[c.campo] ?? null);
                const numerico = c.tipo === 'dinheiro' || c.tipo === 'percentual';
                return (
                  <td key={c.campo} style={numerico ? { textAlign: 'right' } : undefined}>
                    {i === 0 && (
                      <span style={{ paddingLeft: `${(nivel - 1) * 1.25}rem` }}>
                        {temFilhos && (
                          <button
                            type="button"
                            aria-label={aberto ? 'Recolher' : 'Expandir'}
                            onClick={(e) => {
                              e.stopPropagation();
                              alternar(no.id);
                            }}
                          >
                            {aberto ? '▾' : '▸'}
                          </button>
                        )}
                      </span>
                    )}
                    {i === 0 && no.href ? <a href={no.href}>{texto}</a> : texto}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
