import type { PrismaClient } from '@/generated/prisma/client';
import { carregarPermissoes, listarUnidadesDoUsuario, manutencaoEfetiva, obterConfiguracaoAcesso, obterUsuarioParaSessao } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import type { ContextoRequisicao, MotivoAusenciaSessao, ProvedorContexto } from '@/shared/authz';
import { CABECALHO_IP, CABECALHO_SEM_RENOVACAO } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { resolverUnidadeAtiva } from '@/shared/unidade';
import { nomeCookieSessao, nomeCookieUnidade } from '../infrastructure/cookies';
import { hashDoToken } from './autenticar';
import { efetivarDesativacao } from './efetivar-desativacao';

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

// Com o sistema inativo, todo Administrador conectado fica só com a Administração (RN0060, D-P9-5).
const MODULO_SISTEMA_INATIVO = 'ADMINISTRACAO';

const MOTIVOS_AUSENCIA: ReadonlySet<string> = new Set<MotivoAusenciaSessao>(['NOVO_ACESSO', 'SISTEMA_INATIVO']);

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
      // Sistema desativado (US-036/US-033): a primeira requisição depois do instante desconecta todos
      // os que entraram antes, menos quem desativou; esta sessão pode ter caído com eles.
      const efetivada = manutencaoEfetiva(config, agora) ? await efetivarDesativacao(cliente, agora, config) : null;
      if (efetivada && sessao.criadaEm.getTime() < efetivada.corte.getTime() && sessao.usuarioId !== efetivada.por) return null;
      const inativo = efetivada !== null;
      const usuario = await obterUsuarioParaSessao(cliente, sessao.usuarioId);
      if (!usuario || !usuario.ativo || usuario.bloqueado || usuario.acessoVersao !== sessao.acessoVersao) {
        await encerrar(sessao.id, sessao.usuarioId, usuario?.login ?? 'Sistema', sessao.sessaoUid, ip);
        return null;
      }
      // A consulta periódica do aviso de desativação (cabeçalho posto pelo proxy, D-P9-4) não renova.
      const renovar = (await lerCabecalho(CABECALHO_SEM_RENOVACAO)) === null;
      if (renovar && agora.getTime() - sessao.ultimoAcessoEm.getTime() >= RENOVACAO_MS) {
        await cliente.sessaoUsuario.updateMany({ where: { id: sessao.id }, data: { ultimoAcessoEm: agora } });
      }
      const permissoes = sessao.trocaSenhaPendente
        ? new Set(PERMISSOES_TROCA_OBRIGATORIA)
        : new Set([
            ...(await carregarPermissoes(cliente, sessao.usuarioId, inativo ? { modulo: MODULO_SISTEMA_INATIVO } : {})),
            ...PERMISSOES_BASICAS,
          ]);
      // Unidade ativa: o cookie só escolhe dentro da lista do usuário (nunca é confiado). A lista vai
      // inteira para a RLS (US-007); com a troca de senha pendente, nenhuma.
      const unidades = sessao.trocaSenhaPendente ? [] : await listarUnidadesDoUsuario(cliente, sessao.usuarioId);
      const unidadeId = sessao.trocaSenhaPendente ? null : resolverUnidadeAtiva(unidades, (await lerCookie(nomeCookieUnidade())) ?? null);
      return {
        usuarioId: sessao.usuarioId,
        usuarioRotulo: usuario.login,
        sessaoUid: sessao.sessaoUid,
        ip,
        unidadeId,
        unidades: unidades.map((u) => u.id),
        permissoes,
        trocaSenhaPendente: sessao.trocaSenhaPendente,
      };
    },
    // A sessão deste cookie foi encerrada por um login em outra estação (US-028) ou pela desativação
    // do sistema (US-033)? Não apaga a marca (o layout e a página perguntam na mesma requisição); ela
    // vale até o prazo e sai depois de vencida.
    async motivoAusencia(): Promise<MotivoAusenciaSessao | null> {
      const token = await lerCookie(nomeCookieSessao());
      if (!token) return null;
      const marca = await cliente.sessaoEncerrada.findUnique({ where: { tokenHash: hashDoToken(token) } });
      if (!marca || marca.expiraEm.getTime() <= relogio().getTime()) return null;
      return MOTIVOS_AUSENCIA.has(marca.motivo) ? (marca.motivo as MotivoAusenciaSessao) : null;
    },
  };
}
