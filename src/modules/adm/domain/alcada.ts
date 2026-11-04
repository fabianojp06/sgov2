import { z } from 'zod';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';

// Alçadas de aprovação (US-042, spec §6.5 e §11.4; UC02.28 a redigir, GAP-ADM-002). Por fluxo, sem
// escopo (D-P8-5). WA03 e WA04 ficam fora até o GAP-APR-001 (D-P8-6).
export const FLUXOS_APROVACAO = ['WA01', 'WA02', 'WA05'] as const;
export type FluxoAprovacao = (typeof FLUXOS_APROVACAO)[number];

export const ROTULO_FLUXO: Readonly<Record<FluxoAprovacao, string>> = {
  WA01: 'Oficialização de proposta',
  WA02: 'Logística de viagens',
  WA05: 'Alocação de pessoal',
};

// Os textos de "sem aprovador" e o de WA02 para o mesmo usuário vêm do EP de Aprovações (UC6.00 E5,
// UC6.01 E1, UC6.02 E2/E4); os demais são [PROVISÓRIOS].
export const MENSAGENS_ALCADA = {
  SEM_APROVADOR: (fluxo: FluxoAprovacao) =>
    fluxo === 'WA02'
      ? 'Operação indisponível: Não há validador homologador ativo cadastrado para este fluxo. Contate o Administrador do sistema.'
      : 'Operação indisponível: Não há aprovador ativo cadastrado para este fluxo. Contate o Administrador do sistema.',
  MESMO_USUARIO: (fluxo: FluxoAprovacao) =>
    fluxo === 'WA02'
      ? 'O mesmo usuário não pode submeter e aprovar o próprio lote de viagens. Contate o Administrador para revisar o cadastro de alçadas.'
      : 'O mesmo usuário não pode submeter e aprovar a própria solicitação. Contate o Administrador para revisar o cadastro de alçadas.',
  FLUXO: 'Selecione o fluxo de aprovação',
  TITULAR: 'Selecione o titular',
  SUBSTITUTO: 'Selecione o substituto',
  DIFERENTES: 'Titular e substituto devem ser usuários ativos diferentes.',
  DUPLICADA: 'Já existe alçada ativa para este fluxo.',
  INATIVA: 'Esta alçada já está inativa.',
  INEXISTENTE: 'Alçada não encontrada',
  ALTERADO: 'Este registro foi alterado por outro usuário. Recarregue a tela.',
} as const;

export type AprovadoresAlcada = { titularId: string; substitutoId: string };
export type AlcadaValidada = AprovadoresAlcada & { fluxo: FluxoAprovacao };

const uuid = (mensagem: string) => z.uuid({ error: mensagem });

function validar<T>(schema: z.ZodType<T>, entrada: unknown): Resultado<T> {
  const r = schema.safeParse(entrada);
  if (!r.success) {
    const erros: ErroCampo[] = r.error.issues.map((i) => ({ campo: String(i.path[0] ?? '_'), mensagem: i.message }));
    return falha(erros);
  }
  return ok(r.data);
}

const aprovadores = z
  .object({ titularId: uuid(MENSAGENS_ALCADA.TITULAR), substitutoId: uuid(MENSAGENS_ALCADA.SUBSTITUTO) })
  .refine((a) => a.titularId !== a.substitutoId, { path: ['substitutoId'], message: MENSAGENS_ALCADA.DIFERENTES });

// Titular e substituto obrigatórios e diferentes (§11.4); estarem ativos é conferido no banco.
export function validarAprovadores(entrada: unknown): Resultado<AprovadoresAlcada> {
  return validar(aprovadores, entrada);
}

export function validarAlcada(entrada: unknown): Resultado<AlcadaValidada> {
  const fluxo = z.enum(FLUXOS_APROVACAO, { error: MENSAGENS_ALCADA.FLUXO }).safeParse((entrada as { fluxo?: unknown } | null)?.fluxo);
  const a = validarAprovadores(entrada);
  const erros = [...(fluxo.success ? [] : [{ campo: 'fluxo', mensagem: MENSAGENS_ALCADA.FLUXO }]), ...(a.ok ? [] : a.erros)];
  if (erros.length > 0 || !fluxo.success || !a.ok) return falha(erros);
  return ok({ fluxo: fluxo.data, ...a.valor });
}
