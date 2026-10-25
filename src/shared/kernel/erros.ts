// Erro de regra de negócio, com código estável para a interface e para os testes.
export class ErroDominio extends Error {
  readonly codigo: string;
  readonly detalhes: Record<string, unknown> | undefined;

  constructor(codigo: string, mensagem: string, detalhes?: Record<string, unknown>) {
    super(mensagem);
    this.name = 'ErroDominio';
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
