import type { TxCliente } from '@/shared/db';

// Catálogo para o menu (RN0030/RN0031): só funcionalidades ativas de módulos ativos e exibidas no
// menu (exibirNoMenu, C6). A permissão de uma funcionalidade fora do menu continua valendo; tela de
// permissões ou de perfis não usa esta função (esconderia as funcionalidades fora do menu).
export async function listarCatalogoDoMenu(tx: TxCliente): Promise<
  readonly {
    modulo: { codigo: string; nome: string; ordem: number };
    grupo: string;
    funcionalidade: { codigo: string; nome: string; rota: string; ordem: number; ajuda: string | null };
  }[]
> {
  const linhas = await tx.funcionalidade.findMany({
    where: { ativo: true, exibirNoMenu: true, modulo: { ativo: true } },
    include: { modulo: true },
    orderBy: [{ modulo: { ordem: 'asc' } }, { ordem: 'asc' }],
  });
  return linhas.map((f) => ({
    modulo: { codigo: f.modulo.codigo, nome: f.modulo.nome, ordem: f.modulo.ordem },
    grupo: f.grupo,
    funcionalidade: { codigo: f.codigo, nome: f.nome, rota: f.rota, ordem: f.ordem, ajuda: f.ajuda },
  }));
}

// TPs ativos que o usuário pode acessar (spec §5).
export async function listarUnidadesDoUsuario(
  tx: TxCliente,
  usuarioId: string,
): Promise<readonly { id: string; codigo: string; nome: string }[]> {
  const linhas = await tx.usuarioUnidade.findMany({
    where: { usuarioId, unidade: { ativo: true } },
    select: { unidade: { select: { id: true, codigo: true, nome: true } } },
    orderBy: { unidade: { codigo: 'asc' } },
  });
  return linhas.map((l) => l.unidade);
}
