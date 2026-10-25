import { ok } from '@/shared/kernel';
import type { enviarEmail } from './application/email';
import { validarDestinatario, type DadosModeloEmail, type Destinatario, type ModeloEmail } from './domain/modelos-email';
import type { exportarXlsx, PlanilhaExportacao } from './infrastructure/exportar-xlsx';

// Adaptadores falsos dos contratos do ger, só para testes dos módulos consumidores (spec §12.6).

export function exportarXlsxFalso(): {
  exportar: typeof exportarXlsx;
  chamadas: (readonly PlanilhaExportacao[])[];
} {
  const chamadas: (readonly PlanilhaExportacao[])[] = [];
  return {
    chamadas,
    exportar: async (planilhas) => {
      chamadas.push(planilhas);
      return ok(new Uint8Array());
    },
  };
}

// Um envio registrado pelo falso, com os dados tipados pelo modelo (união discriminada).
export type EnvioFalso = {
  [M in ModeloEmail]: { modelo: M; destinatario: Destinatario; dados: DadosModeloEmail[M] };
}[ModeloEmail];

// Mesma validação de destinatário do real; guarda os envios em memória.
// Limitação: o falso ignora a transação. Um envio feito antes de o caso de uso desfazer a
// transação continua em `enviados`; para provar "rollback, nenhum e-mail", use o teste de
// integração da US-025.
export function emailFalso(): {
  enviarEmail: typeof enviarEmail;
  enviados: EnvioFalso[];
} {
  const enviados: EnvioFalso[] = [];
  return {
    enviados,
    enviarEmail: async (_tx, modelo, destinatario, dados) => {
      validarDestinatario(destinatario);
      enviados.push({ modelo, destinatario, dados } as EnvioFalso);
    },
  };
}
