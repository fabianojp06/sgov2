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
import type { exportarCsv } from './infrastructure/exportar-csv';
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

export function exportarCsvFalso(): {
  exportar: typeof exportarCsv;
  chamadas: PlanilhaExportacao[];
} {
  const chamadas: PlanilhaExportacao[] = [];
  return {
    chamadas,
    exportar: (planilha) => {
      chamadas.push(planilha);
      return ok(new Uint8Array());
    },
  };
}

// Um envio registrado pelo falso, com os dados tipados pelo modelo (união discriminada).
// Por padrão, só os modelos de senha: os testes que conferem a senha temporária leem
// `dados.senhaTemporaria` sem estreitar o modelo. Quem envia outros modelos passa o tipo.
export type ModeloAcesso = 'usuario.senha_inicial' | 'usuario.senha_redefinida' | 'usuario.recuperacao_senha';
export type EnvioFalso<T extends ModeloEmail = ModeloAcesso> = {
  [M in T]: { modelo: M; destinatario: Destinatario; dados: DadosModeloEmail[M] };
}[T];

// Mesma validação do real (destinatário e dados do modelo, com o link do modelo);
// guarda os envios em memória. Sem `urlPublica`, usa a URL_PUBLICA do ambiente, como o real.
// Limitação: o falso ignora a transação. Um envio feito antes de o caso de uso desfazer a
// transação continua em `enviados`; para provar "rollback, nenhum e-mail", use o teste de
// integração da US-025.
type EmailFalso<T extends ModeloEmail> = { enviarEmail: typeof enviarEmail; enviados: EnvioFalso<T>[] };
// A assinatura sem parâmetro de tipo fica por último: é a que o ReturnType<typeof emailFalso> usa.
export function emailFalso<T extends ModeloEmail = ModeloAcesso>(opcoes?: { urlPublica?: string }): EmailFalso<T>;
export function emailFalso(opcoes?: { urlPublica?: string }): EmailFalso<ModeloAcesso>;
export function emailFalso(opcoes: { urlPublica?: string } = {}): EmailFalso<ModeloEmail> {
  const enviados: EnvioFalso<ModeloEmail>[] = [];
  return {
    enviados,
    enviarEmail: async (_tx, modelo, destinatario, dados) => {
      validarDestinatario(destinatario);
      validarDadosModelo(modelo, dados, opcoes.urlPublica ?? lerEnvAcesso().urlPublica);
      enviados.push({ modelo, destinatario, dados } as EnvioFalso<ModeloEmail>);
    },
  };
}
