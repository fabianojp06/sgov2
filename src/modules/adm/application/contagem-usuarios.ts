import type { TxCliente } from '@/shared/db';
import { CODIGOS_PERFIL, type CodigoPerfil } from '../domain/perfis';

// Contagem de usuários por perfil para a conferência da carga do rel (frente B, #137; plano do P7,
// Task 2). Só contagens: nenhum nome, login nem e-mail. Pelo servidor.ts, com a transação de quem
// chama; não confere permissão (quem chama confere rel.conferencia_carga:consultar), como o C1 e o C2.
// - ativos: usuários ativos com o perfil, inclusive os bloqueados;
// - bloqueados: os ativos com o perfil que estão bloqueados;
// - usuário com dois perfis conta nos dois;
// - trocaSenhaPendente: usuários ativos que ainda não trocaram a senha temporária.
export type ContagemUsuarios = {
  // ativo: o perfil inativo não dá acesso (as permissões só vêm de perfil ativo), mas os vínculos contam.
  perfis: { codigo: CodigoPerfil; nome: string; ativo: boolean; ativos: number; bloqueados: number }[];
  trocaSenhaPendente: number;
};

export async function contarUsuariosPorPerfil(tx: TxCliente): Promise<ContagemUsuarios> {
  const linhas = await tx.$queryRaw<{ codigo: string; nome: string; ativo: boolean; ativos: number; bloqueados: number }[]>`
    SELECT p.codigo, p.nome, p.ativo,
      COUNT(u.id) FILTER (WHERE u.ativo)::int AS ativos,
      COUNT(u.id) FILTER (WHERE u.ativo AND u.bloqueado)::int AS bloqueados
    FROM perfil p
    LEFT JOIN usuario_perfil up ON up.perfil_id = p.id
    LEFT JOIN usuario u ON u.id = up.usuario_id
    GROUP BY p.codigo, p.nome, p.ativo`;
  const ordem = (c: string) => (CODIGOS_PERFIL as readonly string[]).indexOf(c);
  // Na ordem do catálogo; perfis criados fora dele (testes) ficam de fora.
  const perfis = linhas
    .filter((l) => ordem(l.codigo) >= 0)
    .sort((a, b) => ordem(a.codigo) - ordem(b.codigo))
    .map((l) => ({ codigo: l.codigo as CodigoPerfil, nome: l.nome, ativo: l.ativo, ativos: l.ativos, bloqueados: l.bloqueados }));
  const trocaSenhaPendente = await tx.usuario.count({ where: { ativo: true, trocaSenhaObrigatoria: true } });
  return { perfis, trocaSenhaPendente };
}
