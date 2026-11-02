import type { Acao } from '@/shared/authz';
import { ErroDominio } from '@/shared/kernel';
import { ehCodigoPerfil, type CodigoPerfil } from '../domain/perfis';

// Contrato C6 (spec §12.6): cada módulo declara as próprias funcionalidades na sua seed. O menu
// é montado a partir do catálogo no banco, porque o Administrador ativa e desativa itens.
// Fica em application/ (e não em domain/) porque usa o tipo Acao de @/shared/authz.
export const MODULOS_MENU = [
  { codigo: 'ADMINISTRACAO', nome: 'Administração', ordem: 1 },
  { codigo: 'CADASTROS', nome: 'Cadastros', ordem: 2 },
  { codigo: 'ORCAMENTARIO', nome: 'Orçamentário', ordem: 3 },
  { codigo: 'ADM_CENTRAL', nome: 'Administração Central', ordem: 4 },
  { codigo: 'RELATORIOS', nome: 'Relatórios', ordem: 5 },
  { codigo: 'APROVACOES', nome: 'Aprovações', ordem: 6 },
] as const satisfies readonly { codigo: string; nome: string; ordem: number }[];

export type CodigoModuloMenu = (typeof MODULOS_MENU)[number]['codigo'];

export type DeclaracaoFuncionalidade = {
  codigo: string; // '<modulo-de-codigo>.<nome>', ex.: 'adm.usuarios' (validado por FORMATO_CODIGO)
  modulo: CodigoModuloMenu;
  grupo: string;
  nome: string;
  rota: string;
  ordem: number;
  ajuda?: string;
  nivelLog?: 'SIMPLES' | 'AVANCADO';
  exibirNoMenu?: boolean; // padrão true; false: permissão vale, mas fora do menu e da busca (R24 do P4)
  acoes: readonly Acao[];
  perfisPadrao: Partial<Record<CodigoPerfil, readonly Acao[]>>; // subconjunto de acoes
};

export const MODULO_EXCLUSIVO_ADMIN: CodigoModuloMenu = 'ADMINISTRACAO';
// Código de 3 letras do módulo de código (spec §4.1) + nome: 'adm.usuarios', 'cad.cargos'.
const FORMATO_CODIGO = /^[a-z]{3}\.[a-z0-9_]+$/;

// Uma declaração errada é defeito de código: a seed inteira para, com o código do problema.
export function validarDeclaracoes(itens: readonly DeclaracaoFuncionalidade[]): void {
  const vistos = new Set<string>();
  for (const item of itens) {
    if (vistos.has(item.codigo)) {
      throw new ErroDominio('seed.codigo_duplicado', `Funcionalidade declarada duas vezes: ${item.codigo}`);
    }
    vistos.add(item.codigo);
    if (!FORMATO_CODIGO.test(item.codigo)) {
      throw new ErroDominio('seed.codigo_invalido', `Código de funcionalidade fora do formato <mod>.<nome>: ${item.codigo}`);
    }
    // RN_SEED_003: código do adm e módulo de Administração andam juntos, para nenhum dos dois
    // servir de atalho para dar administração a outro perfil.
    if (item.codigo.startsWith('adm.') !== (item.modulo === MODULO_EXCLUSIVO_ADMIN)) {
      throw new ErroDominio('seed.perfil_proibido', `${item.codigo}: funcionalidade do adm só no módulo de Administração (RN_SEED_003)`);
    }
    if (item.exibirNoMenu !== undefined && typeof item.exibirNoMenu !== 'boolean') {
      throw new ErroDominio('seed.exibir_no_menu_invalido', `exibirNoMenu precisa ser booleano em ${item.codigo}`);
    }
    if (new Set(item.acoes).size !== item.acoes.length) {
      throw new ErroDominio('seed.acao_invalida', `Ação repetida em ${item.codigo}`);
    }
    if (!MODULOS_MENU.some((m) => m.codigo === item.modulo)) {
      throw new ErroDominio('seed.modulo_invalido', `Módulo de menu desconhecido em ${item.codigo}: ${item.modulo}`);
    }
    for (const [perfil, acoes] of Object.entries(item.perfisPadrao)) {
      if (!ehCodigoPerfil(perfil)) {
        throw new ErroDominio('seed.perfil_invalido', `Perfil desconhecido em ${item.codigo}: ${perfil}`);
      }
      // RN_SEED_003: só o Administrador acessa o módulo de Administração (por módulo de menu, R10).
      if (item.modulo === MODULO_EXCLUSIVO_ADMIN && perfil !== 'ADMINISTRADOR' && (acoes?.length ?? 0) > 0) {
        throw new ErroDominio('seed.perfil_proibido', `Só o Administrador acessa ${item.codigo} (RN_SEED_003)`);
      }
      for (const acao of acoes ?? []) {
        if (!item.acoes.includes(acao)) {
          throw new ErroDominio('seed.acao_invalida', `Ação ${acao} não existe em ${item.codigo}`);
        }
      }
    }
  }
}
