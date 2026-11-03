// Entrada só de servidor do ger (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
import type { PrismaClient } from '@/generated/prisma/client';
import { lerEnvAcesso } from '@/shared/config';
import type { FilaGerenciada } from '@/shared/filas';
import { lerConfigSmtp } from './infrastructure/config-smtp';
import { criarTransporteSmtp } from './infrastructure/smtp';
import { criarTrabalhadorEmail } from './infrastructure/trabalhador-email';

export { lerAmbiente, type Ambiente } from './infrastructure/ambiente';
export { NOVAS_TENTATIVAS_EMAIL } from './infrastructure/trabalhador-email';

/**
 * Registra os trabalhadores do ger no worker: hoje, o de email.enviar. Ele é registrado mesmo sem
 * SMTP (cada tentativa falha com "SMTP não configurado" e a mensagem não fica parada com a senha,
 * R23); nesse caso, emite [EMAIL_SEM_SMTP] uma vez. O nome de exibição da instituição vem do cad
 * (parametro_sistema, pelo worker); sem ele, vazio.
 */
export async function registrarTrabalhadoresGer(
  fila: FilaGerenciada,
  deps: { cliente: PrismaClient; obterNomeExibicao?: () => Promise<string> },
): Promise<void> {
  const config = lerConfigSmtp();
  if (!config) console.warn('[EMAIL_SEM_SMTP] SMTP_HOST não definido: os e-mails falham até a configuração.');
  const trabalhar = criarTrabalhadorEmail({
    fila,
    transporte: config ? criarTransporteSmtp(config) : null,
    cliente: deps.cliente,
    urlPublica: lerEnvAcesso().urlPublica,
    agora: () => new Date(),
    obterNomeExibicao: deps.obterNomeExibicao ?? (async () => ''),
  });
  // Todo erro que volta para a fila fica no log, só com o nome e o código (nunca a mensagem, que
  // pode ter o endereço): a fila não registra os erros dos trabalhadores.
  await fila.registrarTrabalhador('email.enviar', async (m: unknown, job) => {
    try {
      await trabalhar(m, job);
    } catch (erro) {
      const e = erro as { name?: unknown; code?: unknown; codigo?: unknown };
      console.error('[EMAIL_TENTATIVA_FALHOU]', {
        job: job.id,
        tipo: typeof e?.name === 'string' ? e.name : 'desconhecido',
        ...(typeof e?.codigo === 'string' ? { codigo: e.codigo } : typeof e?.code === 'string' ? { codigo: e.code } : {}),
      });
      throw erro;
    }
  });
}

// Leitura segura de .xlsx (R4; acréscimo ao C3 para o cad e para a US-121).
export {
  lerPlanilhaSegura,
  lerPlanilhasSegura,
  LIMITES_PADRAO,
  MAXIMO_ABAS,
  MSG_LEITOR_OCUPADO,
  type ErroLinha,
  type LimitesPlanilha,
  type LinhaPlanilha,
  type OpcoesLeitura,
  type PedidoAba,
  type PlanilhaLida,
  type ResultadoAbas,
} from './infrastructure/ler-xlsx';

// Exportação XLSX real do C3 (R21): só no servidor (Server Actions, relatórios), nunca no navegador.
export { exportarXlsx } from './infrastructure/exportar-xlsx';
