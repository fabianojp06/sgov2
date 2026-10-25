import type { PrismaClient } from '@/generated/prisma/client';
import { carregarPermissoes, obterConfiguracaoAcesso, obterUsuarioParaSessao } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import type { ContextoRequisicao, ProvedorContexto } from '@/shared/authz';
import { CABECALHO_IP } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { nomeCookieSessao } from '../infrastructure/cookies';
import { hashDoToken } from './autenticar';

// Permissões de toda sessão válida (R5), fora do menu e dos perfis.
export const PERMISSOES_BASICAS: readonly string[] = [
  'aut.tela_principal:consultar',
  'aut.sessao:excluir',
  'aut.senha:alterar',
  'aut.unidade:alterar',
];
// Sessão com troca de senha obrigatória (REQ0039): só trocar a senha ou sair.
export const PERMISSOES_TROCA_OBRIGATORIA: readonly string[] = ['aut.senha:alterar', 'aut.sessao:excluir'];

const RENOVACAO_MS = 60 * 1000;

type DepsProvedor = {
  cliente: PrismaClient;
  agora: () => Date;
  lerCookie: (nome: string) => Promise<string | undefined>;
  lerCabecalho: (nome: string) => Promise<string | null>;
};

// next/headers só é carregado quando o provedor roda no Next (os testes injetam as funções).
const lerCookieNext = async (nome: string) => (await (await import('next/headers')).cookies()).get(nome)?.value;
const lerCabecalhoNext = async (nome: string) => (await (await import('next/headers')).headers()).get(nome);

// Provedor do contexto da requisição (contrato C5): cookie → sessão → usuário → permissões. As
// permissões são relidas a cada requisição, então perfil ou funcionalidade alterados valem na hora.
export function criarProvedorContexto(deps: Partial<DepsProvedor> = {}): ProvedorContexto {
  const cliente = deps.cliente ?? prisma;
  const relogio = deps.agora ?? (() => new Date());
  const lerCookie = deps.lerCookie ?? lerCookieNext;
  const lerCabecalho = deps.lerCabecalho ?? lerCabecalhoNext;

  async function encerrar(sessaoId: string, usuarioId: string, login: string, sessaoUid: string, ip: string | null) {
    // Só quem de fato apagou a sessão registra: requisições paralelas geram um Histórico só.
    await cliente.$transaction(async (tx) => {
      const { count } = await tx.sessaoUsuario.deleteMany({ where: { id: sessaoId } });
      if (count !== 1) return;
      await auditar(tx, {
        contexto: { usuarioId, usuarioRotulo: login, sessaoUid, ip },
        funcionalidade: 'aut.sessao',
        tipo: 'LOGOFF',
        descricao: `Usuário ${login} desconectado pelo sistema`,
      });
    });
  }

  return {
    id: 'aut.sessao',
    async obter(): Promise<ContextoRequisicao | null> {
      const token = await lerCookie(nomeCookieSessao());
      if (!token) return null;
      const sessao = await cliente.sessaoUsuario.findUnique({ where: { tokenHash: hashDoToken(token) } });
      if (!sessao) return null;
      const agora = relogio();
      const ip = (await lerCabecalho(CABECALHO_IP)) || null;
      const config = await obterConfiguracaoAcesso(cliente);

      const inativa = agora.getTime() - sessao.ultimoAcessoEm.getTime() > config.inatividadeMin * 60 * 1000;
      if (inativa || sessao.expiraEm.getTime() <= agora.getTime()) {
        await cliente.sessaoUsuario.deleteMany({ where: { id: sessao.id } });
        return null;
      }
      const usuario = await obterUsuarioParaSessao(cliente, sessao.usuarioId);
      if (!usuario || !usuario.ativo || usuario.bloqueado || usuario.acessoVersao !== sessao.acessoVersao) {
        await encerrar(sessao.id, sessao.usuarioId, usuario?.login ?? 'Sistema', sessao.sessaoUid, ip);
        return null;
      }
      if (agora.getTime() - sessao.ultimoAcessoEm.getTime() >= RENOVACAO_MS) {
        await cliente.sessaoUsuario.updateMany({ where: { id: sessao.id }, data: { ultimoAcessoEm: agora } });
      }
      const permissoes = sessao.trocaSenhaPendente
        ? new Set(PERMISSOES_TROCA_OBRIGATORIA)
        : new Set([...(await carregarPermissoes(cliente, sessao.usuarioId)), ...PERMISSOES_BASICAS]);
      return {
        usuarioId: sessao.usuarioId,
        usuarioRotulo: usuario.login,
        sessaoUid: sessao.sessaoUid,
        ip,
        unidadeId: null,
        permissoes,
        trocaSenhaPendente: sessao.trocaSenhaPendente,
      };
    },
  };
}
