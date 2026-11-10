// Estado da grade "Definição de Permissões de Acesso" do formulário de perfil (US-037; UC02.25/26
// A2 e A3, RN0058; plano do P13, D-P13-12). Funções puras, para o componente e os testes de unidade.
// O estado guarda, por funcionalidade, as ações marcadas. As funcionalidades fixas (as da
// Administração no perfil Administrador, D-P13-4) não mudam e não vão no formulário (ajuste A2).

export type FuncionalidadeGrade = { codigo: string; nome: string; grupo: string; acoes: readonly string[]; fixas: readonly string[] };
export type ModuloGrade = { modulo: string; nome: string; funcionalidades: readonly FuncionalidadeGrade[] };
export type EstadoGrade = ReadonlyMap<string, ReadonlySet<string>>;
export type EstadoCaixa = 'marcado' | 'desmarcado' | 'indeterminado';

// Colunas na ordem do C5, com o rótulo da tela.
export const ACOES_GRADE: readonly (readonly [string, string])[] = [
  ['consultar', 'Consultar'],
  ['incluir', 'Incluir'],
  ['alterar', 'Alterar'],
  ['excluir', 'Excluir'],
  ['exportar', 'Exportar'],
  ['imprimir', 'Imprimir'],
  ['aprovar', 'Aprovar'],
  ['executar', 'Executar'],
];

export const ehFixa = (f: FuncionalidadeGrade) => f.fixas.length > 0;

// Colunas do módulo: as ações que alguma funcionalidade dele declara.
export const colunasDoModulo = (m: ModuloGrade) => ACOES_GRADE.filter(([acao]) => m.funcionalidades.some((f) => f.acoes.includes(acao)));

// Cadastro começa sem nada marcado (RN0058), fora as fixas; na alteração, as permissões atuais.
export function estadoInicial(modulos: readonly ModuloGrade[], permissoes: readonly { funcionalidade: string; acoes: readonly string[] }[] = []): EstadoGrade {
  const atuais = new Map(permissoes.map((p) => [p.funcionalidade, p.acoes]));
  const estado = new Map<string, ReadonlySet<string>>();
  for (const m of modulos) {
    for (const f of m.funcionalidades) {
      const acoes = ehFixa(f) ? f.fixas : (atuais.get(f.codigo) ?? []).filter((a) => f.acoes.includes(a));
      estado.set(f.codigo, new Set(acoes));
    }
  }
  return estado;
}

function comAcoes(estado: EstadoGrade, f: FuncionalidadeGrade, acoes: Iterable<string>): EstadoGrade {
  if (ehFixa(f)) return estado;
  const novo = new Map(estado);
  novo.set(f.codigo, new Set(acoes));
  return novo;
}

// A2: marcar o módulo marca todas as funcionalidades e todas as ações dele; A3: desmarcar desmarca tudo.
export function alternarModulo(estado: EstadoGrade, modulo: ModuloGrade, marcado: boolean): EstadoGrade {
  return modulo.funcionalidades.reduce((e, f) => comAcoes(e, f, marcado ? f.acoes : []), estado);
}

export function alternarFuncionalidade(estado: EstadoGrade, f: FuncionalidadeGrade, marcada: boolean): EstadoGrade {
  return comAcoes(estado, f, marcada ? f.acoes : []);
}

// Marcar uma ação marca Consultar (a página exige Consultar, D-P13-5); desmarcar Consultar desmarca a
// funcionalidade inteira.
export function alternarAcao(estado: EstadoGrade, f: FuncionalidadeGrade, acao: string, marcada: boolean): EstadoGrade {
  const atuais = new Set(estado.get(f.codigo) ?? []);
  if (marcada) {
    atuais.add(acao);
    if (f.acoes.includes('consultar')) atuais.add('consultar');
  } else if (acao === 'consultar') {
    atuais.clear();
  } else {
    atuais.delete(acao);
  }
  return comAcoes(estado, f, atuais);
}

const estadoDe = (marcadas: number, total: number): EstadoCaixa => (marcadas === 0 ? 'desmarcado' : marcadas === total ? 'marcado' : 'indeterminado');

export function estadoFuncionalidade(estado: EstadoGrade, f: FuncionalidadeGrade): EstadoCaixa {
  return estadoDe(estado.get(f.codigo)?.size ?? 0, f.acoes.length);
}

// A caixa do módulo: marcada com tudo marcado, desmarcada sem nada, indeterminada no meio.
export function estadoModulo(estado: EstadoGrade, m: ModuloGrade): EstadoCaixa {
  const total = m.funcionalidades.reduce((n, f) => n + f.acoes.length, 0);
  const marcadas = m.funcionalidades.reduce((n, f) => n + (estado.get(f.codigo)?.size ?? 0), 0);
  return estadoDe(marcadas, total);
}

// O que o formulário envia: as permissões das funcionalidades não fixas (ações na ordem do C5) e a
// lista das exibidas, que o servidor confere com a grade dele (D-P13-6, ajuste A1).
export function paraEntrada(estado: EstadoGrade, modulos: readonly ModuloGrade[]): { permissoes: { funcionalidade: string; acoes: string[] }[]; exibidas: string[] } {
  const editaveis = modulos.flatMap((m) => m.funcionalidades.filter((f) => !ehFixa(f)));
  return {
    permissoes: editaveis
      .map((f) => ({ funcionalidade: f.codigo, acoes: ACOES_GRADE.map(([a]) => a).filter((a) => estado.get(f.codigo)?.has(a)) }))
      .filter((p) => p.acoes.length > 0),
    exibidas: editaveis.map((f) => f.codigo),
  };
}
