'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatarCelula } from '../domain/celula';
import { ehCaminhoInterno } from '../domain/navegacao';
import {
  chaveSessao,
  expansaoInicial,
  lerExpansaoSalva,
  visiveis,
  type ColunaGrade,
  type Expansao,
  type NoGrade,
} from './grade-logica';

export type { ColunaGrade, LinhaGrade, NoGrade } from './grade-logica';

// Contrato C3: Tree Grid do sistema. Esta é a versão mínima do contrato, sem virtualização nem
// navegação por teclado; a US-021 (P4) troca a implementação mantendo as props (props novas
// entram como opcionais). C liga os campos das colunas às chaves das linhas.
export type PropsGradeArvore<C extends string = string> = {
  idGrade: string; // chave da expansão (e, na US-021, dos filtros) retida na sessão (RNF0005)
  rotulo?: string; // nome acessível da grade
  nos: readonly NoGrade<C>[];
  colunas: readonly ColunaGrade<C>[];
  expandidos?: Expansao;
  acaoSelecionar?: (id: string) => Promise<void>; // Server Action, opcional; erros vão ao error boundary
  textoVazio?: string;
};

export function GradeArvore<C extends string = string>({
  idGrade,
  rotulo,
  nos,
  colunas,
  expandidos,
  acaoSelecionar,
  textoVazio,
}: PropsGradeArvore<C>) {
  const [abertos, setAbertos] = useState(() => expansaoInicial(nos, expandidos));
  const [, iniciarTransicao] = useTransition();

  // Sem sessionStorage (janela privada, bloqueio), segue com a expansão inicial.
  useEffect(() => {
    try {
      const salvo = lerExpansaoSalva(sessionStorage.getItem(chaveSessao(idGrade)));
      if (salvo) setAbertos(salvo);
    } catch {
      // sem armazenamento de sessão
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
    <table role="treegrid" aria-label={rotulo ?? idGrade}>
      <thead>
        <tr>
          {colunas.map((c, i) => (
            <th key={i} scope="col" style={c.largura ? { width: c.largura } : undefined}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visiveis(nos, abertos).map(({ no, nivel }) => {
          const temFilhos = Boolean(no.filhos?.length);
          const aberto = abertos.has(no.id);
          const href = no.href !== undefined && ehCaminhoInterno(no.href) ? no.href : undefined;
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
                  <td key={i} style={numerico ? { textAlign: 'right' } : undefined}>
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
                    {i === 0 && href ? (
                      // O link navega; não dispara também a acaoSelecionar da linha.
                      <a href={href} onClick={(e) => e.stopPropagation()}>
                        {texto}
                      </a>
                    ) : (
                      texto
                    )}
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
