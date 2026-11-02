import { lerEnvAcesso } from '@/shared/config';
import { ok } from '@/shared/kernel';
import type { enviarEmail } from './application/email';
import {
  validarDadosModelo,
  validarDestinatario,
  type DadosModeloEmail,
  type Destinatario,
  type ModeloEmail,
} from './domain/modelos-email';
import type { PlanilhaExportacao } from './infrastructure/exportacao';
import type { exportarXlsx } from './infrastructure/exportar-xlsx';

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

// Mesma validação do real (destinatário e dados do modelo, com o link `${urlPublica}/login`);
// guarda os envios em memória. Sem `urlPublica`, usa a URL_PUBLICA do ambiente, como o real.
// Limitação: o falso ignora a transação. Um envio feito antes de o caso de uso desfazer a
// transação continua em `enviados`; para provar "rollback, nenhum e-mail", use o teste de
// integração da US-025.
export function emailFalso(opcoes: { urlPublica?: string } = {}): {
  enviarEmail: typeof enviarEmail;
  enviados: EnvioFalso[];
} {
  const enviados: EnvioFalso[] = [];
  return {
    enviados,
    enviarEmail: async (_tx, modelo, destinatario, dados) => {
      validarDestinatario(destinatario);
      validarDadosModelo(modelo, dados, opcoes.urlPublica ?? lerEnvAcesso().urlPublica);
      enviados.push({ modelo, destinatario, dados } as EnvioFalso);
    },
  };
}
