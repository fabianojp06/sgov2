import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import {
  conferirAjuda,
  contarCaracteres,
  MAXIMO_CITACOES,
  MAXIMO_PERGUNTA,
  MAXIMO_RESPOSTA,
  mensagemAjuda,
  MINIMO_PERGUNTA,
  semMarcas,
  trechosDoManual,
  type AjudaManual,
} from '../domain/ajuda-manual';
import { CASO_AJUDA_MANUAL } from './ia-casos';
import { manualDoPerfil } from './manual';

// Ajuda "como faço..." com base no manual (US-108, IA-18). Só leitura: nada é gravado além do
// registro da chamada (ia_chamada, pela governança da US-019). A mensagem leva só o manual do perfil
// de quem pergunta e a pergunta; nunca o nome, o login ou o e-mail. A pergunta não fica guardada
// (guardarTexto falso): só o hash.

export const TEMPO_LIMITE_AJUDA_MS = 30_000;
const PERMISSAO = `${CASO_AJUDA_MANUAL.funcionalidade}:executar`;

export const MENSAGENS_AJUDA = {
  PERGUNTA_CURTA: `Escreva a pergunta com pelo menos ${MINIMO_PERGUNTA} caracteres.`,
  PERGUNTA_LONGA: `A pergunta tem mais de ${MAXIMO_PERGUNTA} caracteres.`,
  MANUAL_VAZIO: 'O seu perfil de acesso não tem funcionalidades no manual. Contate o Administrador.',
  TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
} as const;

const SAIDA = z.object({
  encontrou: z.boolean(),
  resposta: z.string().max(MAXIMO_RESPOSTA),
  trechos: z.array(z.string().max(10)).max(MAXIMO_CITACOES * 2),
});

const ENTRADA = z.object({ pergunta: z.unknown().optional() }).passthrough();

export type DepsAjuda = { cliente: PrismaClient; ia: ServicoIA; sinalIa: () => AbortSignal };

const resolver = (d: Partial<DepsAjuda>): DepsAjuda => ({
  cliente: d.cliente ?? prisma,
  ia: d.ia ?? servicoIA,
  sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_AJUDA_MS)),
});

const erro = (mensagem: string, campo = '_'): Resultado<never> => falha([{ campo, mensagem }]);
const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';

/** O campo de pergunta aparece? A permissão do caso, a chave geral, o caso ativo e os tetos (sem reservar nem registrar). */
export function ajudaManualLiberada(ctx: ContextoRequisicao, deps: Partial<Pick<DepsAjuda, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASO_AJUDA_MANUAL);
}

export async function perguntarAoManual(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsAjuda> = {}): Promise<Resultado<AjudaManual>> {
  // A governança também confere; aqui, antes de qualquer leitura, com a mensagem do ErroIA.
  if (!ctx.permissoes.has(PERMISSAO)) return erro(new ErroIA('ia.sem_permissao').message);
  const lido = ENTRADA.safeParse(bruto);
  const valor = lido.success ? lido.data.pergunta : undefined;
  // As marcas saem antes de contar: '<<<>>>' e espaços não valem como pergunta.
  const pergunta = semMarcas(typeof valor === 'string' ? valor : '').trim();
  if (contarCaracteres(pergunta) < MINIMO_PERGUNTA) return erro(MENSAGENS_AJUDA.PERGUNTA_CURTA, 'pergunta');
  if (contarCaracteres(pergunta) > MAXIMO_PERGUNTA) return erro(MENSAGENS_AJUDA.PERGUNTA_LONGA, 'pergunta');

  const deps = resolver(depsParciais);
  const trechos = trechosDoManual(await manualDoPerfil(ctx, deps.cliente));
  if (trechos.length === 0) return erro(MENSAGENS_AJUDA.MANUAL_VAZIO);

  const sinal = deps.sinalIa();
  try {
    const r = await deps.ia.gerarEstruturado(ctx, CASO_AJUDA_MANUAL, mensagemAjuda(trechos, pergunta), SAIDA, sinal);
    return ok(conferirAjuda(r.valor, trechos));
  } catch (x) {
    // definirAcao só traduz ErroDominio: o ErroIA vira aqui a mensagem fixa dele (sem detalhe do provedor).
    if (!(x instanceof ErroIA)) throw x;
    return erro(x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_AJUDA.TEMPO_ESGOTADO : x.message);
  }
}
