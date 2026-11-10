import { falha, ok, type Resultado } from '@/shared/kernel';

// Exceção de permissão por usuário (US-039; EP085 UC02.12 A2, UC02.13 A4–A6, REQ0080, REQ0081). A
// exceção só retira (D-P10-1): tira do usuário uma funcionalidade que vem de um perfil associado a
// ele. É por perfil: outro perfil do usuário que dê a mesma funcionalidade sem exceção a mantém.

// [PROVISÓRIAS]: o EP085 não dá os textos.
export const MENSAGENS_EXCECAO = {
  PERFIL_NAO_ASSOCIADO: 'A exceção de funcionalidade só vale para um perfil de acesso associado ao usuário',
  FUNCIONALIDADE_FORA_DO_PERFIL: 'A funcionalidade da exceção não pertence ao perfil de acesso ou está inativa',
  ADMINISTRACAO: 'As funcionalidades da Administração não podem ser retiradas do usuário.',
  DEMAIS: 'Exceções de funcionalidade demais para um usuário',
} as const;

// Módulo cujas funcionalidades nunca recebem exceção: uma exceção não pode trancar o sistema, e a
// checagem do último Administrador olha só os perfis (ajuste A1 da revisão do plano do P10).
export const MODULO_SEM_EXCECAO = 'ADMINISTRACAO';

export type Excecao<P extends string = string> = { perfil: P; funcionalidade: string };

// Funcionalidades de um perfil como o painel as mostra: as que aceitam exceção (ativas, de módulo
// ativo, fora da Administração) e as fixas (as da Administração, exibidas sem checkbox).
export type FuncionalidadesDoPerfil = { retiraveis: readonly string[]; fixas: readonly string[] };

export const chaveExcecao = (e: Excecao) => `${e.perfil}:${e.funcionalidade}`;

// Confere as exceções pedidas contra os perfis escolhidos e as funcionalidades de cada perfil (as que
// têm alguma permissão nele, D-P10-2), monta as exceções finais e aplica a REQ0081: o perfil com
// todas as funcionalidades retiráveis excetuadas, e sem fixa, sai da lista, com as exceções dele.
// Ficar sem perfil é o E1 da RN0079, que a validação do usuário confere depois.
// - atuais: as exceções já gravadas. Só as novas passam pela conferência; uma já gravada continua
//   valendo mesmo que a funcionalidade tenha ficado inativa.
// - exibidas: as chaves ("<perfil>:<funcionalidade>") que o painel mostrou ao Administrador. Só uma
//   exceção atual exibida e não pedida é removida (devolvida); as outras ficam, mesmo que a
//   funcionalidade tenha voltado a ser retirável depois que o formulário abriu (ajuste M1 da revisão
//   12.12). Sem `exibidas`, nenhuma exceção atual é removida.
export function aplicarExcecoes<P extends string>(
  perfis: readonly P[],
  pedidas: readonly Excecao<P>[],
  funcionalidadesDoPerfil: (perfil: P) => FuncionalidadesDoPerfil,
  ehAdministracao: (funcionalidade: string) => boolean,
  opcoes: { atuais?: readonly Excecao<P>[]; exibidas?: readonly string[] | undefined } = {},
): Resultado<{ perfis: P[]; excecoes: Excecao<P>[]; perfisDesmarcados: P[] }> {
  const atuais = opcoes.atuais ?? [];
  const chavesAtuais = new Set(atuais.map(chaveExcecao));
  const chavesPedidas = new Set(pedidas.map(chaveExcecao));
  const exibidas = new Set(opcoes.exibidas ?? []);
  for (const e of pedidas) {
    if (chavesAtuais.has(chaveExcecao(e)) && perfis.includes(e.perfil)) continue;
    if (ehAdministracao(e.funcionalidade)) return falha([{ campo: 'excecoes', mensagem: MENSAGENS_EXCECAO.ADMINISTRACAO }]);
    if (!perfis.includes(e.perfil)) return falha([{ campo: 'excecoes', mensagem: MENSAGENS_EXCECAO.PERFIL_NAO_ASSOCIADO }]);
    if (!funcionalidadesDoPerfil(e.perfil).retiraveis.includes(e.funcionalidade)) {
      return falha([{ campo: 'excecoes', mensagem: MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL }]);
    }
  }
  // As do perfil retirado não ficam: caem em cascata com o vínculo.
  const mantidas = atuais.filter((e) => perfis.includes(e.perfil) && !chavesPedidas.has(chaveExcecao(e)) && !exibidas.has(chaveExcecao(e)));
  const finais = [...pedidas, ...mantidas];
  const desmarcados = perfis.filter((p) => {
    const { retiraveis, fixas } = funcionalidadesDoPerfil(p);
    return fixas.length === 0 && retiraveis.length > 0 && retiraveis.every((f) => finais.some((e) => e.perfil === p && e.funcionalidade === f));
  });
  return ok({
    perfis: perfis.filter((p) => !desmarcados.includes(p)),
    excecoes: finais.filter((e) => !desmarcados.includes(e.perfil)),
    perfisDesmarcados: desmarcados,
  });
}
