import type { Acao } from '@/shared/authz';
import { ErroDominio } from '@/shared/kernel';
import { ehCodigoPerfil, type CodigoPerfil } from '../domain/perfis';

// Contrato C6 (spec §12.6): cada módulo declara as próprias funcionalidades na sua seed. O menu
// é montado a partir do catálogo no banco, porque o Administrador ativa e desativa itens.
// Fica em application/ (e não em domain/) porque usa o tipo Acao de @/shared/authz.
export const MODULOS_MENU: readonly { codigo: string; nome: string; ordem: number }[] = [
  { codigo: 'ADMINISTRACAO', nome: 'Administração', ordem: 1 },
  { codigo: 'CADASTROS', nome: 'Cadastros', ordem: 2 },
  { codigo: 'ORCAMENTARIO', nome: 'Orçamentário', ordem: 3 },
  { codigo: 'ADM_CENTRAL', nome: 'Administração Central', ordem: 4 },
  { codigo: 'RELATORIOS', nome: 'Relatórios', ordem: 5 },
  { codigo: 'APROVACOES', nome: 'Aprovações', ordem: 6 },
];

export type DeclaracaoFuncionalidade = {
  codigo: string; // '<modulo-de-codigo>.<nome>', ex.: 'adm.usuarios'
  modulo: string; // código de MODULOS_MENU
  grupo: string;
  nome: string;
  rota: string;
  ordem: number;
  ajuda?: string;
  nivelLog?: 'SIMPLES' | 'AVANCADO';
  acoes: readonly Acao[];
  perfisPadrao: Partial<Record<CodigoPerfil, readonly Acao[]>>; // subconjunto de acoes
};

const MODULO_EXCLUSIVO_ADMIN = 'ADMINISTRACAO';

// Uma declaração errada é defeito de código: a seed inteira para, com o código do problema.
export function validarDeclaracoes(itens: readonly DeclaracaoFuncionalidade[]): void {
  const vistos = new Set<string>();
  for (const item of itens) {
    if (vistos.has(item.codigo)) {
      throw new ErroDominio('seed.codigo_duplicado', `Funcionalidade declarada duas vezes: ${item.codigo}`);
    }
    vistos.add(item.codigo);
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
