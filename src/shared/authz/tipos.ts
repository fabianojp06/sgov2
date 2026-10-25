import type { ContextoAuditoria } from '@/shared/audit';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';

export type Acao = 'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar' | 'imprimir' | 'aprovar' | 'executar';

// Permissões no formato "<funcionalidade>:<acao>", carregadas pelo módulo aut (P5).
export type ContextoRequisicao = ContextoAuditoria & { permissoes: ReadonlySet<string> };

export interface ProvedorContexto {
  obter(): Promise<ContextoRequisicao | null>;
}

export type RespostaAcao<O> = Resultado<O> | { ok: false; status: 401 | 403; erros: readonly ErroCampo[] };

export class ErroPermissao extends ErroDominio {
  constructor(funcionalidade: string, acao: Acao) {
    super('PERMISSAO_NEGADA', 'Você não tem permissão para esta ação.', { funcionalidade, acao });
    this.name = 'ErroPermissao';
  }
}
