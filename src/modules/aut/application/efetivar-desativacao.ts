import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { travarDesativacaoEfetiva } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';

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
    // DELETE … RETURNING: só as linhas que esta transação de fato apagou recebem o Histórico e a marca.
    // Uma sessão apagada em paralelo (logoff, novo login, queda por acesso alterado) não volta aqui.
    const apagadas = await tx.$queryRaw<Apagada[]>`
      DELETE FROM sessao_usuario s USING usuario u
      WHERE u.id = s.usuario_id AND s.criada_em < ${estado.corte}
        AND (${estado.por}::uuid IS NULL OR s.usuario_id <> ${estado.por}::uuid)
      RETURNING ${COLUNAS_APAGADA}`;
    await registrarDesconexoes(tx, apagadas, agora, config.inatividadeMin);
    return estado;
  });
}

// Sessão de quem não é Administrador ainda aberta com o sistema inativo (ex.: emitida pela troca de
// senha depois do corte): cai do mesmo jeito, com o Histórico e a marca (RN0023). Idempotente.
export async function desconectarSessaoPorSistemaInativo(cliente: PrismaClient, sessaoId: string, agora: Date, inatividadeMin: number): Promise<void> {
  await cliente.$transaction(async (tx) => {
    const apagadas = await tx.$queryRaw<Apagada[]>`
      DELETE FROM sessao_usuario s USING usuario u
      WHERE u.id = s.usuario_id AND s.id = ${sessaoId}::uuid
      RETURNING ${COLUNAS_APAGADA}`;
    await registrarDesconexoes(tx, apagadas, agora, inatividadeMin);
  });
}

type Apagada = { tokenHash: string; usuarioId: string; sessaoUid: string; ip: string | null; ultimoAcessoEm: Date; expiraEm: Date; login: string };

const COLUNAS_APAGADA = Prisma.sql`s.token_hash AS "tokenHash", s.usuario_id::text AS "usuarioId", s.sessao_uid AS "sessaoUid", host(s.ip) AS ip,
        s.ultimo_acesso_em AS "ultimoAcessoEm", s.expira_em AS "expiraEm", u.login_normalizado AS login`;

// Só as sessões ainda vivas recebem o aviso e o Histórico do UC02.15: a parada por inatividade ou
// pelo teto já tinha caído (a estação vê "Sessão expirada").
async function registrarDesconexoes(tx: TxCliente, apagadas: readonly Apagada[], agora: Date, inatividadeMin: number): Promise<void> {
  const ativaDesde = agora.getTime() - inatividadeMin * 60 * 1000;
  const vivas = apagadas.filter((s) => s.expiraEm.getTime() > agora.getTime() && s.ultimoAcessoEm.getTime() >= ativaDesde);
  if (vivas.length === 0) return;
  await tx.sessaoEncerrada.createMany({
    data: vivas.map((s) => ({ tokenHash: s.tokenHash, usuarioId: s.usuarioId, motivo: 'SISTEMA_INATIVO', encerradaEm: agora, expiraEm: s.expiraEm })),
    skipDuplicates: true,
  });
  for (const s of vivas) {
    await auditar(tx, {
      contexto: { usuarioId: s.usuarioId, usuarioRotulo: s.login, sessaoUid: s.sessaoUid, ip: s.ip },
      funcionalidade: 'aut.sessao',
      tipo: 'LOGOFF',
      origem: 'SISTEMA',
      descricao: `Usuário ${s.login} desconectado pelo sistema`,
    });
  }
}

const semAutor = (por: string | null) => (por ? { usuarioId: { not: por } } : {});
