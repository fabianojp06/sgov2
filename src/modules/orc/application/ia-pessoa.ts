import type { PrismaClient } from '@/generated/prisma/client';
import { carregarPermissoes, manutencaoEfetiva, obterConfiguracaoAcesso, obterEscopoCentroCusto, obterUsuarioParaSessao } from '@/modules/adm/servidor';
import type { QuemPedeIA } from '@/shared/ia';

// Quem pediu uma chamada de IA que roda no worker, sem sessão (US-064 e US-062; plano do P14, D-P14-6):
// remontada do banco como no provedor de contexto, e a chamada vai em nome dessa pessoa, nunca do
// sistema. Usada pelo revisor (fila orc.revisar) e pela avaliação da sugestão de conta (fila
// ia.avaliar). Sem autorização de tela nem dependências de página (o worker/bundle.test.ts reprova).

export type PessoaIA = Exclude<QuemPedeIA, { sistema: true }>;

export type FuncoesPessoaIA = {
  obterUsuarioParaSessao: typeof obterUsuarioParaSessao;
  carregarPermissoes: typeof carregarPermissoes;
  obterConfiguracaoAcesso: typeof obterConfiguracaoAcesso;
  manutencaoEfetiva: typeof manutencaoEfetiva;
  obterEscopo: typeof obterEscopoCentroCusto;
};

export const FUNCOES_PESSOA_IA: FuncoesPessoaIA = { obterUsuarioParaSessao, carregarPermissoes, obterConfiguracaoAcesso, manutencaoEfetiva, obterEscopo: obterEscopoCentroCusto };

export type DepsPessoaIA = { cliente: PrismaClient; agora: () => Date; pessoa: FuncoesPessoaIA };

/**
 * A pessoa, se ela ainda pode: ativa, sem bloqueio, sistema fora de manutenção, com a permissão pedida
 * e sem CC de escopo (R15: o orçamento inteiro da Adm. Central). null quando não pode.
 */
export async function remontarPessoaIA(usuarioId: string, permissao: string, deps: DepsPessoaIA): Promise<PessoaIA | null> {
  const c = deps.cliente;
  const u = await deps.pessoa.obterUsuarioParaSessao(c, usuarioId);
  if (!u || !u.ativo || u.bloqueado) return null;
  // Sistema desativado: só o Administrador fica, e só com a Administração (sem o orc).
  if (deps.pessoa.manutencaoEfetiva(await deps.pessoa.obterConfiguracaoAcesso(c), deps.agora())) return null;
  const permissoes = await deps.pessoa.carregarPermissoes(c, usuarioId);
  if (!permissoes.has(permissao)) return null;
  if ((await deps.pessoa.obterEscopo(c, usuarioId)) !== null) return null;
  // Sem unidade: o orçamento da Adm. Central não é de nenhum TP (o Histórico do orc também grava unidade
  // nula, contextoAuditoria), então a chamada à IA vai só com a pessoa.
  return { usuarioId, unidadeId: null, permissoes };
}
