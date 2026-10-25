// Perfis padrão do sistema (spec §11.3, C12, C25, C30, C36), instalados pela seed (UC02.27).
export const CODIGOS_PERFIL = [
  'ADMINISTRADOR',
  'ORCAMENTISTA',
  'GFIN',
  'ANALISTA_GRH',
  'OPERADOR_VIAGENS',
  'AUDITOR',
  'GESTOR_DIRETORIA',
  'DIREX',
] as const;

export type CodigoPerfil = (typeof CODIGOS_PERFIL)[number];

export const PERFIS_PADRAO: Readonly<Record<CodigoPerfil, { nome: string; descricao: string }>> = {
  ADMINISTRADOR: { nome: 'Administrador', descricao: 'Módulo de Administração inteiro e leitura do histórico completo' },
  ORCAMENTISTA: { nome: 'Orçamentista', descricao: 'Cadastros e Orçamentário: elaboração das propostas e relatórios' },
  GFIN: { nome: 'Gestor Financeiro (GFIN)', descricao: 'Leitura de Cadastros e Orçamentário, aprovações e parâmetros financeiros' },
  ANALISTA_GRH: { nome: 'Analista GRH', descricao: 'Estrutura funcional, cargos e salários, benefícios e empregados' },
  OPERADOR_VIAGENS: { nome: 'Operador de Viagens (SCOR/GAD)', descricao: 'Aba Viagens das propostas e validação WA02' },
  AUDITOR: { nome: 'Auditor', descricao: 'Somente leitura nos módulos de negócio, histórico e versões congeladas' },
  GESTOR_DIRETORIA: { nome: 'Gestor de Diretoria', descricao: 'Lançamentos da Adm. Central só nos CCs da sua diretoria' },
  DIREX: { nome: 'Diretoria Executiva (DIREX)', descricao: 'Leitura da Adm. Central e aprovação do exercício enviado pelo GFIN' },
};

export const ehCodigoPerfil = (v: string): v is CodigoPerfil => (CODIGOS_PERFIL as readonly string[]).includes(v);
