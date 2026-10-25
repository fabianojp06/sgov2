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
};

export interface ProvedorContexto {
  obter(): Promise<ContextoRequisicao | null>;
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
