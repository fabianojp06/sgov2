'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
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
import {
  aplicarFiltros,
  chaveFiltros,
  lerFiltrosSalvos,
  validarValoresFiltro,
  type DefinicaoFiltro,
  type ValoresFiltro,
} from './grade-filtros';
import { ALTURA_LINHA_PADRAO, ALTURA_VISIVEL_PADRAO, FOLGA_PADRAO, navegar, TECLAS, type Tecla } from './grade-virtual';

export type { ColunaGrade, LinhaGrade, NoGrade } from './grade-logica';
export type { DefinicaoFiltro, ValoresFiltro } from './grade-filtros';

// Contrato C3: Tree Grid do sistema (US-021, R18): virtualizada (linhas de altura fixa e
// espaçadores, @tanstack/react-virtual), com navegação por teclado de treegrid (WAI-ARIA) e foco
// itinerante. As props novas são opcionais; o C3 não muda. C liga os campos das colunas às linhas.
export type PropsGradeArvore<C extends string = string> = {
  idGrade: string; // chave da expansão (e, na US-021, dos filtros) retida na sessão (RNF0005)
  rotulo?: string; // nome acessível da grade
  nos: readonly NoGrade<C>[];
  colunas: readonly ColunaGrade<C>[];
  expandidos?: Expansao;
  acaoSelecionar?: (id: string) => Promise<void>; // Server Action, opcional; erros vão ao error boundary
  textoVazio?: string;
  alturaLinha?: number; // px, padrão 32
  alturaVisivel?: number; // px, padrão 600
  filtros?: readonly DefinicaoFiltro<C>[];
  escopoSessao?: string; // hash do sessaoUid (R18); sem ele, os filtros não são retidos
};

// Constante: um [] novo a cada render dispararia o efeito de leitura dos filtros sem parar.
const SEM_FILTROS: readonly DefinicaoFiltro[] = [];

export function GradeArvore<C extends string = string>({
  idGrade,
  rotulo,
  nos,
  colunas,
  expandidos,
  acaoSelecionar,
  textoVazio,
  alturaLinha = ALTURA_LINHA_PADRAO,
  alturaVisivel = ALTURA_VISIVEL_PADRAO,
  filtros = SEM_FILTROS as readonly DefinicaoFiltro<C>[],
  escopoSessao,
}: PropsGradeArvore<C>) {
  const [abertos, setAbertos] = useState(() => expansaoInicial(nos, expandidos));
  const [, iniciarTransicao] = useTransition();
  const [valores, setValores] = useState<ValoresFiltro>({});
  const [erroFiltro, setErroFiltro] = useState<string | null>(null);
  // Filtro inválido mostra a mensagem e mantém o resultado anterior (UC0.01 A3).
  const filtrado = useMemo(() => aplicarFiltros(nos, filtros, valores), [nos, filtros, valores]);
  const abertosVisao = useMemo(
    () => (filtrado.abrir.size === 0 ? abertos : new Set([...abertos, ...filtrado.abrir])),
    [abertos, filtrado.abrir],
  );
  const linhas = useMemo(() => visiveis(filtrado.nos, abertosVisao), [filtrado.nos, abertosVisao]);
  const [focoId, setFocoId] = useState<string | null>(null);
  // O foco só é movido depois de uma tecla na grade; um nos novo (revalidação) não puxa o foco de volta.
  const focoPendente = useRef(false);
  const rolagem = useRef<HTMLDivElement>(null);
  // initialRect: no servidor (sem elemento de rolagem), a primeira janela já sai desenhada.
  const virtual = useVirtualizer({
    count: linhas.length,
    getScrollElement: () => rolagem.current,
    estimateSize: () => alturaLinha,
    overscan: FOLGA_PADRAO,
    initialRect: { width: 0, height: alturaVisivel },
    // O cabeçalho fixo cobre a primeira linha da área de rolagem.
    scrollPaddingStart: alturaLinha,
    useFlushSync: false,
  });

  // Sem sessionStorage (janela privada, bloqueio), segue com a expansão inicial.
  useEffect(() => {
    try {
      const salvo = lerExpansaoSalva(sessionStorage.getItem(chaveSessao(idGrade)));
      if (salvo) setAbertos(salvo);
    } catch {
      // sem armazenamento de sessão
    }
  }, [idGrade]);

  // Filtros retidos só com o escopo da sessão (R18): outra sessão no mesmo navegador não os herda.
  useEffect(() => {
    if (!escopoSessao || filtros.length === 0) return;
    try {
      const salvos = lerFiltrosSalvos(sessionStorage.getItem(chaveFiltros(idGrade)), escopoSessao);
      const v = salvos ? validarValoresFiltro(filtros, salvos) : undefined;
      if (v?.ok) setValores(v.valor);
    } catch {
      // sem armazenamento de sessão
    }
  }, [idGrade, escopoSessao, filtros]);

  const mudarFiltro = (id: string, valor: string | boolean) => {
    const v = validarValoresFiltro(filtros, { ...valores, [id]: valor });
    if (!v.ok) {
      setErroFiltro(v.erros.map((e) => e.mensagem).join(' '));
      return;
    }
    setErroFiltro(null);
    setValores(v.valor);
    if (!escopoSessao) return;
    try {
      sessionStorage.setItem(chaveFiltros(idGrade), JSON.stringify({ escopo: escopoSessao, valores: v.valor }));
    } catch {
      // sem armazenamento de sessão
    }
  };

  const limparFiltros = () => {
    setValores({});
    setErroFiltro(null);
    try {
      sessionStorage.removeItem(chaveFiltros(idGrade));
    } catch {
      // sem armazenamento de sessão
    }
  };

  // O foco segue o teclado: rola até a linha e foca o <tr> depois de desenhado.
  useEffect(() => {
    if (focoId === null || !focoPendente.current) return;
    focoPendente.current = false;
    const i = linhas.findIndex((l) => l.no.id === focoId);
    if (i < 0) return;
    virtual.scrollToIndex(i, { align: 'auto' });
    const raf = requestAnimationFrame(() => rolagem.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focoId)}"]`)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [focoId, linhas, virtual]);

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

  const focavel = focoId !== null && linhas.some((l) => l.no.id === focoId) ? focoId : linhas[0]?.no.id;

  const aoTeclar = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const atual = focavel === undefined ? undefined : linhas.find((l) => l.no.id === focavel)?.no;
    // Enter/Espaço só com o foco na linha (no botão de expandir, valem o clique do botão).
    if ((e.key === 'Enter' || e.key === ' ') && atual && e.target === e.currentTarget.querySelector(`[data-id="${CSS.escape(atual.id)}"]`)) {
      // Enter/Espaço na linha: segue o link da primeira célula ou seleciona (a acaoSelecionar).
      const href = atual.href !== undefined && ehCaminhoInterno(atual.href) ? atual.href : undefined;
      if (e.key === 'Enter' && href) {
        e.preventDefault();
        window.location.assign(href);
      } else if (acaoSelecionar) {
        e.preventDefault();
        iniciarTransicao(() => acaoSelecionar(atual.id));
      }
      return;
    }
    if (!TECLAS.includes(e.key)) return;
    e.preventDefault();
    const r = navegar(linhas, focavel ?? linhas[0]!.no.id, e.key as Tecla, abertos);
    if (r.alternar) alternar(r.alternar);
    // Tecla sem efeito (↓ na última, → numa folha) não deixa o foco pendente para depois.
    if (r.foco !== focavel || r.alternar) focoPendente.current = true;
    setFocoId(r.foco);
  };
  const itens = virtual.getVirtualItems();
  const espacoAntes = itens[0]?.start ?? 0;
  const espacoDepois = virtual.getTotalSize() - (itens.at(-1)?.end ?? 0);

  const barraFiltros =
    filtros.length === 0 ? null : (
      <div role="search" aria-label={`Filtros de ${rotulo ?? idGrade}`}>
        {filtros.map((f) =>
          f.tipo === 'texto' ? (
            <label key={f.id}>
              {f.rotulo}{' '}
              <input type="search" maxLength={100} value={typeof valores[f.id] === 'string' ? (valores[f.id] as string) : ''} onChange={(e) => mudarFiltro(f.id, e.target.value)} />
            </label>
          ) : f.tipo === 'selecao' ? (
            <label key={f.id}>
              {f.rotulo}{' '}
              <select value={typeof valores[f.id] === 'string' ? (valores[f.id] as string) : ''} onChange={(e) => mudarFiltro(f.id, e.target.value)}>
                <option value="">Todos</option>
                {f.opcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label key={f.id}>
              <input type="checkbox" checked={valores[f.id] === true} onChange={(e) => mudarFiltro(f.id, e.target.checked)} /> {f.rotulo}
            </label>
          ),
        )}
        <button type="button" onClick={limparFiltros}>
          Limpar filtros
        </button>
        {erroFiltro && <p role="alert">{erroFiltro}</p>}
      </div>
    );

  return (
    <>
    {barraFiltros}
    <div ref={rolagem} style={{ maxHeight: alturaVisivel, overflowY: 'auto' }}>
    <table role="treegrid" aria-label={rotulo ?? idGrade} aria-rowcount={linhas.length + 1}>
      <thead>
        <tr aria-rowindex={1}>
          {colunas.map((c, i) => (
            <th key={i} scope="col" style={{ position: 'sticky', top: 0, ...(c.largura ? { width: c.largura } : {}) }}>
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody onKeyDown={aoTeclar}>
        {espacoAntes > 0 && (
          <tr aria-hidden="true">
            <td colSpan={colunas.length} style={{ height: espacoAntes, padding: 0, border: 0 }} />
          </tr>
        )}
        {itens.map((item) => {
          const { no, nivel } = linhas[item.index]!;
          const temFilhos = Boolean(no.filhos?.length);
          const aberto = abertos.has(no.id);
          const href = no.href !== undefined && ehCaminhoInterno(no.href) ? no.href : undefined;
          return (
            <tr
              key={no.id}
              data-id={no.id}
              aria-rowindex={item.index + 2}
              aria-level={nivel}
              tabIndex={no.id === focavel ? 0 : -1}
              onFocus={() => setFocoId(no.id)}
              style={{ height: alturaLinha }}
              {...(temFilhos ? { 'aria-expanded': aberto } : {})}
              onClick={acaoSelecionar ? () => iniciarTransicao(() => acaoSelecionar(no.id)) : undefined}
            >
              {colunas.map((c, i) => {
                const texto = formatarCelula(c.tipo, no.linha[c.campo] ?? null);
                const numerico = c.tipo === 'dinheiro' || c.tipo === 'percentual';
                return (
                  // Altura fixa (R18): o texto não quebra linha; o excedente vira reticências.
                  <td
                    key={i}
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(numerico ? { textAlign: 'right' } : {}) }}
                  >
                    {i === 0 && (
                      <span style={{ paddingLeft: `${(nivel - 1) * 1.25}rem` }}>
                        {temFilhos && (
                          <button
                            type="button"
                            tabIndex={-1}
                            style={{ padding: 0, margin: 0, lineHeight: 1 }}
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
                      // Fora da ordem de Tab: a grade é uma parada só; Enter na linha segue o link.
                      <a href={href} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
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
        {espacoDepois > 0 && (
          <tr aria-hidden="true">
            <td colSpan={colunas.length} style={{ height: espacoDepois, padding: 0, border: 0 }} />
          </tr>
        )}
      </tbody>
    </table>
    </div>
    </>
  );
}
