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

// Perfil padrão: o de código fixo do catálogo, instalado pela seed. Os criados pela tela (US-037)
// recebem um código gerado com o prefixo PREFIXO_PERFIL_TELA, que nenhum padrão usa (D-P13-2, A5).
export const ehPerfilPadrao = (codigo: string): boolean => ehCodigoPerfil(codigo);

// Formato de todo código de perfil (o CHECK da migration 202611102000_adm_perfil_tela repete a regra).
export const FORMATO_CODIGO_PERFIL = /^[A-Z][A-Z0-9_]{1,39}$/;
// Reservado aos perfis criados pela tela: o gatilho do banco só deixa apagar perfil com ele (A5).
export const PREFIXO_PERFIL_TELA = 'P_';
// Criado pela tela: só ele pode ser excluído (D-P13-3). Os demais (padrões e os semeados por teste)
// contam como padrão na tela.
export const ehPerfilDaTela = (codigo: string): boolean => codigo.startsWith(PREFIXO_PERFIL_TELA);

// Código do perfil criado pela tela (D-P13-2): P_ + 12 hexadecimais maiúsculos de um UUID aleatório.
// Imutável e invisível na tela; o caso de uso confere a colisão e tenta de novo.
export function gerarCodigoPerfil(uuid: string = globalThis.crypto.randomUUID()): string {
  return `${PREFIXO_PERFIL_TELA}${uuid.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

// Módulo exclusivo do Administrador (RN_SEED_003) e a única exceção a ela (D-P8-8): o Auditor consulta
// o Histórico de Operações (spec §11.3). O mesmo código do módulo protegido da D-P9-7.
const MODULO_ADMINISTRACAO = 'ADMINISTRACAO';
const EXCECOES_ADMINISTRACAO: Readonly<Record<string, readonly string[]>> = { 'adm.historico': ['AUDITOR'] };

// RN_SEED_003 num lugar só (D-P13-4), usado pela seed (validarDeclaracoes) e pela tela de perfis: só o
// Administrador recebe funcionalidade da Administração (código adm.* ou módulo ADMINISTRACAO), salvo
// adm.historico ao Auditor. Fora da Administração, qualquer perfil pode receber.
export function podeReceberFuncionalidade(perfilCodigo: string, funcionalidadeCodigo: string, moduloCodigo: string): boolean {
  const daAdministracao = moduloCodigo === MODULO_ADMINISTRACAO || funcionalidadeCodigo.startsWith('adm.');
  if (!daAdministracao || perfilCodigo === 'ADMINISTRADOR') return true;
  return Object.hasOwn(EXCECOES_ADMINISTRACAO, funcionalidadeCodigo) && EXCECOES_ADMINISTRACAO[funcionalidadeCodigo]!.includes(perfilCodigo);
}

// As funcionalidades da Administração do perfil Administrador ficam fora da tela de perfis (D-P13-4,
// ajuste A2): a grade as mostra fixas, e o caso de uso não as toca.
export const ehFixaDoAdministrador = (perfilCodigo: string, funcionalidadeCodigo: string, moduloCodigo: string): boolean =>
  perfilCodigo === 'ADMINISTRADOR' && (moduloCodigo === MODULO_ADMINISTRACAO || funcionalidadeCodigo.startsWith('adm.'));
