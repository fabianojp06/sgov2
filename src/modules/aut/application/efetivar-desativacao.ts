import type { PrismaClient } from '@/generated/prisma/client';
import { travarDesativacaoEfetiva } from '@/modules/adm';
import { auditar } from '@/shared/audit';

// Efetivação da desativação do sistema (US-036 e US-033; UC02.01 FA1 2.8, UC02.15, REQ0044, RN0060;
// D-P9-5). Sem job: a primeira requisição de qualquer usuário depois do instante da desativação
// chama esta função, que apaga de uma vez as sessões abertas antes do instante, menos as de quem
// desativou. Cada sessão ainda viva deixa o Histórico do UC02.15 e a marca SISTEMA_INATIVO, para a
// estação ver "Sistema está em manutenção" na próxima interação. Idempotente: as sessões abertas
// depois do instante (Administradores que entram de novo, RN0023) não caem, e a segunda chamada não
// encontra o que apagar. A trava adm:sistema serializa com a ativação e com outra efetivação.
//
// Devolve o corte e o autor quando o sistema está inativo (o provedor decide se a sessão da
// requisição caiu), ou null com o sistema ativo.
export async function efetivarDesativacao(
  cliente: PrismaClient,
  agora: Date,
  config: { manutencaoAPartir: Date | null; manutencaoPor: string | null; inatividadeMin: number },
): Promise<{ corte: Date; por: string | null } | null> {
  // Atalho sem trava, para o caso comum (já efetivada): nada aberto antes do instante, fora o autor.
  if (config.manutencaoAPartir) {
    const pendentes = await cliente.sessaoUsuario.count({ where: { criadaEm: { lt: config.manutencaoAPartir }, ...semAutor(config.manutencaoPor) } });
    if (pendentes === 0) return { corte: config.manutencaoAPartir, por: config.manutencaoPor };
  }
  return cliente.$transaction(async (tx) => {
    const estado = await travarDesativacaoEfetiva(tx, agora);
    if (!estado) return null;
    const sessoes = await tx.sessaoUsuario.findMany({
      where: { criadaEm: { lt: estado.corte }, ...semAutor(estado.por) },
      select: { id: true, tokenHash: true, usuarioId: true, sessaoUid: true, ip: true, ultimoAcessoEm: true, expiraEm: true, usuario: { select: { loginNormalizado: true } } },
    });
    if (sessoes.length === 0) return estado;
    await tx.sessaoUsuario.deleteMany({ where: { id: { in: sessoes.map((s) => s.id) } } });
    // Só as sessões ainda vivas recebem o aviso e o Histórico: a parada por inatividade ou pelo teto
    // já tinha caído (a estação vê "Sessão expirada").
    const ativaDesde = agora.getTime() - config.inatividadeMin * 60 * 1000;
    const vivas = sessoes.filter((s) => s.expiraEm.getTime() > agora.getTime() && s.ultimoAcessoEm.getTime() >= ativaDesde);
    if (vivas.length > 0) {
      await tx.sessaoEncerrada.createMany({
        data: vivas.map((s) => ({ tokenHash: s.tokenHash, usuarioId: s.usuarioId, motivo: 'SISTEMA_INATIVO', encerradaEm: agora, expiraEm: s.expiraEm })),
        skipDuplicates: true,
      });
    }
    for (const s of vivas) {
      await auditar(tx, {
        contexto: { usuarioId: s.usuarioId, usuarioRotulo: s.usuario.loginNormalizado, sessaoUid: s.sessaoUid, ip: s.ip },
        funcionalidade: 'aut.sessao',
        tipo: 'LOGOFF',
        origem: 'SISTEMA',
        descricao: `Usuário ${s.usuario.loginNormalizado} desconectado pelo sistema`,
      });
    }
    return estado;
  });
}

const semAutor = (por: string | null) => (por ? { usuarioId: { not: por } } : {});
