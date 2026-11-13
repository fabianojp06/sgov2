// Manual do usuário e roteiro de treinamento por perfil (US-118). Montados do catálogo de
// funcionalidades (nome, rota e ajuda de cada uma) e das permissões de quem lê: cada pessoa vê o
// manual do seu perfil, sempre igual ao sistema que está no ar, sem o nome da instituição (a ajuda do
// catálogo segue a marca neutra). Puro: a leitura do catálogo fica em application/.

export const ACOES_MANUAL = ['consultar', 'incluir', 'alterar', 'excluir', 'exportar', 'imprimir', 'aprovar', 'executar'] as const;
export type AcaoManual = (typeof ACOES_MANUAL)[number];

export const ROTULO_ACAO: Readonly<Record<AcaoManual, string>> = {
  consultar: 'consultar',
  incluir: 'incluir',
  alterar: 'alterar',
  excluir: 'excluir',
  exportar: 'exportar',
  imprimir: 'imprimir',
  aprovar: 'aprovar',
  executar: 'executar (importar, calcular ou parametrizar)',
};

// O exercício do roteiro para cada ação, na ordem em que se aprende.
const EXERCICIO: Readonly<Record<AcaoManual, string>> = {
  consultar: 'abra a tela, use a busca e os filtros e confira o que aparece',
  incluir: 'inclua um registro de teste no ambiente de homologação',
  alterar: 'altere o registro de teste e confira a mensagem de sucesso',
  excluir: 'exclua o registro de teste e veja a confirmação com o que será afetado',
  exportar: 'exporte a lista (XLSX, CSV ou PDF) e abra o arquivo',
  imprimir: 'imprima ou gere o PDF da tela',
  aprovar: 'aprove ou devolva um item da sua fila, com a justificativa',
  executar: 'execute a operação da tela (importação, cálculo ou parametrização) com um arquivo ou dado de teste',
};

/** Uma linha do catálogo, como o adm a devolve (listarCatalogoDoMenu). */
export type ItemCatalogoManual = Readonly<{
  modulo: Readonly<{ codigo: string; nome: string; ordem: number }>;
  grupo: string;
  funcionalidade: Readonly<{ codigo: string; nome: string; rota: string; ordem: number; ajuda: string | null }>;
}>;

export type FuncionalidadeManual = Readonly<{ codigo: string; nome: string; rota: string; ajuda: string | null; acoes: readonly AcaoManual[] }>;
export type ModuloManual = Readonly<{ nome: string; grupos: readonly Readonly<{ nome: string; funcionalidades: readonly FuncionalidadeManual[] }>[] }>;
export type PassoTreinamento = Readonly<{ funcionalidade: string; rota: string; local: string; exercicios: readonly string[] }>;

/**
 * O manual de quem tem estas permissões ('codigo:acao'): só as funcionalidades com alguma ação
 * permitida, na ordem do menu (módulo, depois funcionalidade), agrupadas por módulo e grupo, com as
 * ações permitidas na ordem canônica. As da tela principal (aut.*) ficam de fora, como no menu.
 */
export function montarManual(catalogo: readonly ItemCatalogoManual[], permissoes: ReadonlySet<string>): readonly ModuloManual[] {
  const acoesDe = (codigo: string) => ACOES_MANUAL.filter((a) => permissoes.has(`${codigo}:${a}`));
  const ordenado = [...catalogo]
    .filter((c) => !c.funcionalidade.codigo.startsWith('aut.') && acoesDe(c.funcionalidade.codigo).length > 0)
    .sort((x, y) => x.modulo.ordem - y.modulo.ordem || x.funcionalidade.ordem - y.funcionalidade.ordem);
  const modulos: { codigo: string; nome: string; grupos: { nome: string; funcionalidades: FuncionalidadeManual[] }[] }[] = [];
  for (const c of ordenado) {
    let m = modulos.find((x) => x.codigo === c.modulo.codigo);
    if (!m) modulos.push((m = { codigo: c.modulo.codigo, nome: c.modulo.nome, grupos: [] }));
    let g = m.grupos.find((x) => x.nome === c.grupo);
    if (!g) m.grupos.push((g = { nome: c.grupo, funcionalidades: [] }));
    const { codigo, nome, rota, ajuda } = c.funcionalidade;
    g.funcionalidades.push({ codigo, nome, rota, ajuda, acoes: acoesDe(codigo) });
  }
  return modulos.map(({ nome, grupos }) => ({ nome, grupos }));
}

/** O roteiro de treinamento: um passo por funcionalidade do manual, com um exercício por ação permitida. */
export function roteiroTreinamento(manual: readonly ModuloManual[]): readonly PassoTreinamento[] {
  return manual.flatMap((m) =>
    m.grupos.flatMap((g) =>
      g.funcionalidades.map((f) => ({
        funcionalidade: f.nome,
        rota: f.rota,
        local: `${m.nome} › ${g.nome}`,
        exercicios: f.acoes.map((a) => EXERCICIO[a]),
      })),
    ),
  );
}

/** "consultar, incluir e alterar". */
export function listarAcoes(acoes: readonly AcaoManual[]): string {
  const r = acoes.map((a) => ROTULO_ACAO[a]);
  return r.length <= 1 ? (r[0] ?? '') : `${r.slice(0, -1).join(', ')} e ${r[r.length - 1]}`;
}
