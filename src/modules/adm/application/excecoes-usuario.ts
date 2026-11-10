import type { TxCliente } from '@/shared/db';
import { MODULO_SEM_EXCECAO, type FuncionalidadesDoPerfil } from '../domain/excecao-usuario';

// Catálogo das exceções de permissão (US-039): as funcionalidades de cada perfil como o painel
// "Funcionalidade(s) do Perfil" as mostra. Retiráveis: com alguma permissão no perfil, ativas, de
// módulo ativo e fora da Administração. Fixas: as da Administração ativas, exibidas sem checkbox
// (ajuste A1). As inativas não aparecem, e uma exceção já gravada nelas é mantida pelo Salvar
// (ajuste M2): ela não está no painel, então o Administrador não a desfez.

export type FuncionalidadePainel = { codigo: string; nome: string };
export type PainelPerfil = { retiraveis: readonly FuncionalidadePainel[]; fixas: readonly FuncionalidadePainel[] };

export type CatalogoExcecoes = {
  painel: (perfil: string) => PainelPerfil;
  funcionalidades: (perfil: string) => FuncionalidadesDoPerfil;
  retiravel: (perfil: string, funcionalidade: string) => boolean;
  nome: (funcionalidade: string) => string;
  ehAdministracao: (funcionalidade: string) => boolean;
};

const VAZIO: PainelPerfil = { retiraveis: [], fixas: [] };

export async function carregarCatalogoExcecoes(tx: TxCliente, codigosPerfil: readonly string[]): Promise<CatalogoExcecoes> {
  const [linhas, administracao] = await Promise.all([
    tx.perfilPermissao.findMany({
      where: { perfil: { codigo: { in: [...codigosPerfil] } }, funcionalidade: { ativo: true, modulo: { ativo: true } } },
      distinct: ['perfilId', 'funcionalidadeCodigo'],
      select: {
        perfil: { select: { codigo: true } },
        funcionalidade: { select: { codigo: true, nome: true, moduloCodigo: true, ordem: true, modulo: { select: { ordem: true } } } },
      },
    }),
    tx.funcionalidade.findMany({ where: { moduloCodigo: MODULO_SEM_EXCECAO }, select: { codigo: true } }),
  ]);
  // Ordem do menu: módulo, funcionalidade, nome.
  linhas.sort(
    (a, b) =>
      a.funcionalidade.modulo.ordem - b.funcionalidade.modulo.ordem ||
      a.funcionalidade.ordem - b.funcionalidade.ordem ||
      a.funcionalidade.nome.localeCompare(b.funcionalidade.nome, 'pt-BR'),
  );
  const porPerfil = new Map<string, { retiraveis: FuncionalidadePainel[]; fixas: FuncionalidadePainel[] }>();
  const nomes = new Map<string, string>();
  for (const { perfil, funcionalidade: f } of linhas) {
    const painel = porPerfil.get(perfil.codigo) ?? { retiraveis: [], fixas: [] };
    porPerfil.set(perfil.codigo, painel);
    (f.moduloCodigo === MODULO_SEM_EXCECAO ? painel.fixas : painel.retiraveis).push({ codigo: f.codigo, nome: f.nome });
    nomes.set(f.codigo, f.nome);
  }
  const daAdministracao = new Set(administracao.map((f) => f.codigo));
  const painel = (perfil: string) => porPerfil.get(perfil) ?? VAZIO;
  return {
    painel,
    funcionalidades: (perfil) => ({ retiraveis: painel(perfil).retiraveis.map((f) => f.codigo), fixas: painel(perfil).fixas.map((f) => f.codigo) }),
    retiravel: (perfil, funcionalidade) => painel(perfil).retiraveis.some((f) => f.codigo === funcionalidade),
    nome: (funcionalidade) => nomes.get(funcionalidade) ?? funcionalidade,
    ehAdministracao: (funcionalidade) => daAdministracao.has(funcionalidade),
  };
}
