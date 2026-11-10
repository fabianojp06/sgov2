// Nomes das filas do sistema: novos nomes entram nesta lista (US-010).
export const NOMES_FILA = ['teste.eco', 'email.enviar', 'outbox.publicar', 'exportacao.gerar'] as const;
export type NomeFila = (typeof NOMES_FILA)[number];

// Regra para quem enfileira: job e outbox carregam o mínimo necessário. Dado sensível (ex.: a
// senha temporária do C4) só quando não houver como buscá-lo depois; nesse caso o outbox já
// apaga os dados ao publicar, e o trabalhador chama apagarJob depois do envio.
export type OpcoesEnvio = {
  // Identificador idempotente do job (UUID): enviar de novo com a mesma chave não cria outro job.
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
  registrarTrabalhador<T>(nome: NomeFila, tratar: (dados: T, job: { id: string }) => Promise<void>): Promise<void>;
  // Job com falha fica visível e reprocessável (critério da US-010).
  consultar(nome: NomeFila, id: string): Promise<{ estado: EstadoJob; tentativas: number } | null>;
  reprocessar(nome: NomeFila, id: string): Promise<void>;
  // Remove o job e seus dados (C4: senha temporária não fica guardada depois do envio).
  apagarJob(nome: NomeFila, id: string): Promise<void>;
  // Filas com trabalhador registrado neste processo (para o log de partida do worker).
  filasComTrabalhador(): readonly NomeFila[];
}
