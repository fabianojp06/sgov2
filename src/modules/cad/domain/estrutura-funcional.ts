import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';

// Estrutura funcional (US-048; UC03.18, REQ_EST_002, E1): Diretoria e Gerência são sintéticas (só
// consolidam); Assessoria, Coordenadoria e Setor são analíticas (onde os cargos ficam, RN_EST_02). As
// mesmas regras ficam no trigger da migration; aqui, para a tela responder antes de ir ao banco.

export const TIPOS_UNIDADE = ['DIRETORIA', 'GERENCIA', 'ASSESSORIA', 'COORDENADORIA', 'SETOR'] as const;
export type TipoUnidade = (typeof TIPOS_UNIDADE)[number];

export const ROTULO_TIPO: Readonly<Record<TipoUnidade, string>> = {
  DIRETORIA: 'Diretoria',
  GERENCIA: 'Gerência',
  ASSESSORIA: 'Assessoria',
  COORDENADORIA: 'Coordenadoria',
  SETOR: 'Setor',
};

export const ehAnalitica = (tipo: TipoUnidade) => tipo === 'ASSESSORIA' || tipo === 'COORDENADORIA' || tipo === 'SETOR';

/** Tipos de superior aceitos para cada tipo; null = pode ficar no topo. */
export const SUPERIORES_ACEITOS: Readonly<Record<TipoUnidade, readonly (TipoUnidade | null)[]>> = {
  DIRETORIA: [null],
  GERENCIA: [null, 'DIRETORIA'],
  ASSESSORIA: ['DIRETORIA'],
  COORDENADORIA: ['GERENCIA'],
  SETOR: ['GERENCIA'],
};

export const TAMANHO_NOME_UNIDADE = 120;

export type NovaUnidade = { nome: string; tipo: string; superior: { tipo: TipoUnidade; ativa: boolean } | null };

/** O nome sem os espaços das pontas e o tipo, ou os erros por campo (nome, tipo, superiorId). */
export function validarNovaUnidade(e: NovaUnidade): Resultado<{ nome: string; tipo: TipoUnidade }> {
  const erros: ErroCampo[] = [];
  const nome = validarNomeUnidade(e.nome);
  if (!nome.ok) erros.push(...nome.erros);
  if (!(TIPOS_UNIDADE as readonly string[]).includes(e.tipo)) {
    erros.push({ campo: 'tipo', mensagem: 'Escolha o tipo da unidade.' });
    return falha(erros);
  }
  const tipo = e.tipo as TipoUnidade;
  if (e.superior && !e.superior.ativa) {
    erros.push({ campo: 'superiorId', mensagem: 'A unidade superior está inativa.' });
  } else if (!SUPERIORES_ACEITOS[tipo].includes(e.superior?.tipo ?? null)) {
    erros.push({ campo: 'superiorId', mensagem: mensagemSuperior(tipo) });
  }
  if (erros.length > 0) return falha(erros);
  return ok({ nome: (nome as { ok: true; valor: string }).valor, tipo });
}

function mensagemSuperior(tipo: TipoUnidade): string {
  switch (tipo) {
    case 'DIRETORIA':
      return 'A Diretoria fica no topo, sem unidade superior.';
    case 'GERENCIA':
      return 'A Gerência fica no topo ou sob uma Diretoria.';
    case 'ASSESSORIA':
      return 'A Assessoria fica sob uma Diretoria.';
    default:
      // E1: Coordenadoria ou Setor direto sob a Diretoria, sem a Gerência intermediária.
      return `${ROTULO_TIPO[tipo]} fica sob uma Gerência.`;
  }
}

export function validarNomeUnidade(texto: string): Resultado<string> {
  const nome = texto.trim();
  if (nome.length === 0) return falha([{ campo: 'nome', mensagem: 'Informe o nome da unidade.' }]);
  if (nome.length > TAMANHO_NOME_UNIDADE) return falha([{ campo: 'nome', mensagem: `Use no máximo ${TAMANHO_NOME_UNIDADE} caracteres.` }]);
  return ok(nome);
}

export type UnidadeLida = Readonly<{ id: string; nome: string; tipo: TipoUnidade; superiorId: string | null; ativa: boolean; versao: number }>;
export type NoUnidade = UnidadeLida & Readonly<{ filhos: readonly NoUnidade[] }>;

/** A árvore a partir da lista plana, com os filhos em ordem de nome (pt-BR). Órfão (superior fora da lista) vira raiz. */
export function montarArvoreFuncional(unidades: readonly UnidadeLida[]): readonly NoUnidade[] {
  const ids = new Set(unidades.map((u) => u.id));
  const porSuperior = new Map<string | null, UnidadeLida[]>();
  for (const u of unidades) {
    const chave = u.superiorId !== null && ids.has(u.superiorId) ? u.superiorId : null;
    porSuperior.set(chave, [...(porSuperior.get(chave) ?? []), u]);
  }
  const ordenar = (lista: UnidadeLida[]) => [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const montar = (superiorId: string | null): NoUnidade[] =>
    ordenar(porSuperior.get(superiorId) ?? []).map((u) => ({ ...u, filhos: montar(u.id) }));
  return montar(null);
}
