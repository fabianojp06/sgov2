import { ErroDominio } from './erros';

// Concorrência otimista (US-011; spec l.276, RNF_CON_002): a gravação confere a versão lida pela
// tela (`WHERE id = ? AND versao = ?`); zero linhas afetadas é conflito, e a guarda mostra a mensagem.
export const MENSAGEM_CONFLITO = 'Este registro foi alterado por outro usuário. Recarregue a tela.';

export class ConflitoConcorrencia extends ErroDominio {
  constructor() {
    super('concorrencia.conflito', MENSAGEM_CONFLITO);
    this.name = 'ConflitoConcorrencia';
  }
}

// Resultado de um updateMany/deleteMany com a versão no where: exatamente uma linha.
export function exigirUmaLinha(r: { count: number }): void {
  if (r.count !== 1) throw new ConflitoConcorrencia();
}
