import type { DadosModeloEmail, ModeloEmail } from '../modelos-email';

// Uma versão publicada de um modelo de e-mail. Recebe os dados já validados e escapados para o
// formato de saída: o modelo nunca escapa nada por conta própria (renderizar-email.ts faz isso).
export type VersaoModelo<M extends ModeloEmail> = {
  // Etiquetas legíveis do módulo mandante no assunto (EP083, RN0006).
  // Recebe os dados validados: o alerta de tentativas tem um assunto para o bloqueio e outro para o limiar.
  assunto: (d: DadosModeloEmail[M]) => string;
  // Linhas do corpo. O cabeçalho (nome do sistema e, se houver, o da instituição) e o rodapé
  // padrão (e-mail automático) são do layout comum (EP083, RF_EML_002).
  corpo: (d: DadosModeloEmail[M]) => readonly LinhaCorpo[];
};

export type LinhaCorpo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'campo'; rotulo: string; valor: string }
  | { tipo: 'link'; texto: string; url: string };
