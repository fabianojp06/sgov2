import { ok } from '@/shared/kernel';
import type { enviarEmail } from './application/email';
import { validarDestinatario, type Destinatario, type ModeloEmail } from './domain/modelos-email';
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

// Mesma validação de destinatário do real; guarda os envios em memória.
export function emailFalso(): {
  enviarEmail: typeof enviarEmail;
  enviados: { modelo: ModeloEmail; destinatario: Destinatario; dados: unknown }[];
} {
  const enviados: { modelo: ModeloEmail; destinatario: Destinatario; dados: unknown }[] = [];
  return {
    enviados,
    enviarEmail: async (_tx, modelo, destinatario, dados) => {
      validarDestinatario(destinatario);
      enviados.push({ modelo, destinatario, dados });
    },
  };
}
