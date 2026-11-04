import { z } from 'zod';

// Entradas das ações das alçadas (US-042): o Formulario do C3 entrega FormData; a validação dos
// campos fica no domínio (validarAlcada), que devolve os erros por campo.
const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';
const versao = (f: FormData) => (/^\d{1,9}$/.test(texto(f, 'versao')) ? Number(texto(f, 'versao')) : NaN);
const numeroVersao = z.number(MENSAGEM_VERSAO).int(MENSAGEM_VERSAO).nonnegative(MENSAGEM_VERSAO);

export const entradaCadastroAlcada = z.preprocess(
  (v) => (v instanceof FormData ? { fluxo: texto(v, 'fluxo'), titularId: texto(v, 'titularId'), substitutoId: texto(v, 'substitutoId') } : v),
  z.record(z.string(), z.unknown()),
);

export const entradaAlteracaoAlcada = z.preprocess(
  (v) => (v instanceof FormData ? { id: texto(v, 'id'), versao: versao(v), dados: { titularId: texto(v, 'titularId'), substitutoId: texto(v, 'substitutoId') } } : v),
  z.object({ id: z.string(), versao: numeroVersao, dados: z.record(z.string(), z.unknown()) }),
);

export const entradaExclusaoAlcada = z.preprocess(
  (v) => (v instanceof FormData ? { id: texto(v, 'id'), versao: versao(v) } : v),
  z.object({ id: z.string(), versao: numeroVersao }),
);
