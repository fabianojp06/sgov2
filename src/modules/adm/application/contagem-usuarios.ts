import type { TxCliente } from '@/shared/db';
import { CODIGOS_PERFIL } from '../domain/perfis';

// Contagem de usuários por perfil para a conferência da carga do rel (frente B, #137; plano do P7,
// Task 2). Só contagens: nenhum nome, login nem e-mail. Pelo servidor.ts, com a transação de quem
// chama; não confere permissão (quem chama confere rel.conferencia_carga:consultar), como o C1 e o C2.
// - ativos: usuários ativos com o perfil, inclusive os bloqueados;
// - bloqueados: os ativos com o perfil que estão bloqueados;
// - usuário com dois perfis conta nos dois;
// - trocaSenhaPendente: usuários ativos que ainda não trocaram a senha temporária.
// Todos os perfis entram, inclusive os criados pela tela (US-037, código P_…; resposta da frente B
// na #137): os padrão primeiro, na ordem do catálogo, e depois os da tela, por nome (pt-BR).
export type ContagemUsuarios = {
  // ativo: o perfil inativo não dá acesso (as permissões só vêm de perfil ativo), mas os vínculos contam.
  perfis: { codigo: string; nome: string; ativo: boolean; ativos: number; bloqueados: number }[];
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
  // Perfil fora do catálogo (criado pela tela) vai para depois de todos os padrão; entre eles, o nome
  // decide e, no empate, o código, para a conferência ficar estável.
  const ordem = (c: string) => {
    const i = (CODIGOS_PERFIL as readonly string[]).indexOf(c);
    return i >= 0 ? i : CODIGOS_PERFIL.length;
  };
  const perfis = linhas
    .sort((a, b) => ordem(a.codigo) - ordem(b.codigo) || a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo))
    .map((l) => ({ codigo: l.codigo, nome: l.nome, ativo: l.ativo, ativos: l.ativos, bloqueados: l.bloqueados }));
  const trocaSenhaPendente = await tx.usuario.count({ where: { ativo: true, trocaSenhaObrigatoria: true } });
  return { perfis, trocaSenhaPendente };
}
