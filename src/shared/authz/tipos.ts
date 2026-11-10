import type { ContextoAuditoria } from '@/shared/audit';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';

export type Acao = 'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar' | 'imprimir' | 'aprovar' | 'executar';

export const MENSAGEM_PERMISSAO = 'Você não tem permissão para esta ação.';

// Contexto de uma requisição autenticada: usuário e sessão sempre presentes. Permissões no
// formato "<funcionalidade>:<acao>", carregadas pelo módulo aut (P5).
export type ContextoRequisicao = Omit<ContextoAuditoria, 'usuarioId' | 'sessaoUid'> & {
  usuarioId: string;
  sessaoUid: string;
  permissoes: ReadonlySet<string>;
  // Sessão com troca de senha obrigatória (P5): só a troca de senha e o logoff são permitidos.
  trocaSenhaPendente?: boolean;
};

// Por que não há sessão (US-028): a sessão única foi encerrada por um login em outra estação.
export type MotivoAusenciaSessao = 'NOVO_ACESSO';
// EP084 UC01.02 A2.2 (RN0519), exibida na próxima interação da estação anterior.
export const MENSAGEM_SESSAO_NOVO_ACESSO = 'Sua sessão foi encerrada porque um novo acesso foi realizado com suas credenciais.';

export interface ProvedorContexto {
  // Marca estável do provedor: o módulo aut pode ser avaliado em mais de uma camada do Next e
  // recriar o provedor; com o mesmo id, o novo registro é aceito.
  readonly id?: string;
  obter(): Promise<ContextoRequisicao | null>;
  // Só quando obter() devolve null: o motivo, se houver. Opcional para os provedores de teste.
  motivoAusencia?(): Promise<MotivoAusenciaSessao | null>;
}

// Consumo: `ok` separa sucesso de falha; `'status' in r` separa 401/403 de erro de validação
// ou de negócio.
export type RespostaAcao<O> = Resultado<O> | { ok: false; status: 401 | 403; erros: readonly ErroCampo[] };

export class ErroPermissao extends ErroDominio {
  readonly funcionalidade: string;
  readonly acao: Acao;

  constructor(funcionalidade: string, acao: Acao) {
    super('PERMISSAO_NEGADA', MENSAGEM_PERMISSAO, { funcionalidade, acao });
    this.name = 'ErroPermissao';
    this.funcionalidade = funcionalidade;
    this.acao = acao;
  }
}
