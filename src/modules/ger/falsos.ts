import { ok } from '@/shared/kernel';
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
