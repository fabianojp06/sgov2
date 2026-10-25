// Nomes das filas do sistema: novos nomes entram nesta união (US-010).
export type NomeFila = 'teste.eco' | 'email.enviar' | 'outbox.publicar';

export type OpcoesEnvio = {
  // Evita job duplicado com a mesma chave enquanto houver um pendente (pg-boss singletonKey).
  chaveUnica?: string;
  // Total de tentativas, contando a primeira. Padrão: 1 + 5 novas tentativas.
  tentativas?: number;
};

export type EstadoJob = 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';

export interface Fila {
  enviar<T extends object>(nome: NomeFila, dados: T, opcoes?: OpcoesEnvio): Promise<string>;
}

export interface FilaGerenciada extends Fila {
  parar(): Promise<void>;
  registrarTrabalhador<T>(nome: NomeFila, tratar: (dados: T) => Promise<void>): Promise<void>;
  // Job com falha fica visível e reprocessável: o estado e o erro podem ser consultados.
  consultar(nome: NomeFila, id: string): Promise<{ estado: EstadoJob; tentativas: number } | null>;
}
