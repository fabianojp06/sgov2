// Erro de programação na auditoria (evento inválido, cliente fora da transação, valor não serializável).
// Não é regra de negócio nem texto de tela: fica fora do ErroDominio para a borda (definirAcao,
// definirRota) tratar como erro inesperado, com log e mensagem genérica, nunca 4xx com o texto técnico.
export type CodigoErroAuditoria = 'AUDITORIA_FORA_DA_TRANSACAO' | 'AUDITORIA_INVALIDA' | 'AUDITORIA_NAO_SERIALIZAVEL';

export class ErroAuditoria extends Error {
  constructor(
    readonly codigo: CodigoErroAuditoria,
    mensagem: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ErroAuditoria';
  }
}
