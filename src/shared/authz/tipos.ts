import type { ContextoAuditoria } from '@/shared/audit';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';

export type Acao = 'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar' | 'imprimir' | 'aprovar' | 'executar';

// Código da funcionalidade ("orc.posicoes") e a chave de permissão ("orc.posicoes:alterar") (#177): o ponto
// único dos dois formatos. Ainda texto livre; estreitar para uma união é uma mudança à parte.
export type Funcionalidade = string;
export type ChavePermissao = `${Funcionalidade}:${Acao}`;

export const MENSAGEM_PERMISSAO = 'Você não tem permissão para esta ação.';

// Contexto de uma requisição autenticada: usuário e sessão sempre presentes. Permissões no
// formato "<funcionalidade>:<acao>", carregadas pelo módulo aut (P5).
export type ContextoRequisicao = Omit<ContextoAuditoria, 'usuarioId' | 'sessaoUid'> & {
  usuarioId: string;
  sessaoUid: string;
  permissoes: ReadonlySet<string>;
  // Sessão com troca de senha obrigatória (P5): só a troca de senha e o logoff são permitidos.
  trocaSenhaPendente?: boolean;
  // Unidades (TPs) ativas do usuário, para a RLS (US-007, app.unidades). Opcional: ausente vale
  // como lista vazia (não vê dado de TP nenhum). A unidade ativa do seletor é `unidadeId`.
  unidades?: readonly string[];
};

// Por que não há sessão: a sessão única foi encerrada por um login em outra estação (US-028), ou o
// sistema foi desativado e a sessão caiu com os outros usuários (US-033/US-036, UC02.15).
export type MotivoAusenciaSessao = 'NOVO_ACESSO' | 'SISTEMA_INATIVO';
// EP084 UC01.02 A2.2 (RN0519), exibida na próxima interação da estação anterior.
export const MENSAGEM_SESSAO_NOVO_ACESSO = 'Sua sessão foi encerrada porque um novo acesso foi realizado com suas credenciais.';
// RN0023 (EP084): o mesmo texto do login do aut, aqui porque o shared não importa o aut.
export const MENSAGEM_SISTEMA_INATIVO = 'Sistema está em manutenção';
// Destino do login e texto de cada motivo (a página de login e a guarda usam os dois).
export const AUSENCIA_SESSAO: Readonly<Record<MotivoAusenciaSessao, { motivoUrl: string; mensagem: string }>> = {
  NOVO_ACESSO: { motivoUrl: 'novo-acesso', mensagem: MENSAGEM_SESSAO_NOVO_ACESSO },
  SISTEMA_INATIVO: { motivoUrl: 'sistema-inativo', mensagem: MENSAGEM_SISTEMA_INATIVO },
};

// Cabeçalho interno posto pelo proxy só na rota do aviso de desativação (D-P9-4): a consulta
// periódica não renova a sessão. O proxy o descarta quando vem do cliente.
export const CABECALHO_SEM_RENOVACAO = 'x-sgo-sem-renovacao';

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
