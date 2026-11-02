import { z } from 'zod';

// Entradas das ações de usuário (US-038). O Formulario do C3 entrega FormData; a conversão
// fica aqui, e a validação dos campos continua no domínio (validarUsuario), que devolve os erros
// por campo. Chamada com objeto comum segue sem conversão.

const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};

const textos = (f: FormData, campo: string): string[] => f.getAll(campo).filter((v): v is string => typeof v === 'string');

function usuarioDeFormulario(f: FormData): Record<string, unknown> {
  const cc = texto(f, 'ccEscopo');
  return {
    nome: texto(f, 'nome'),
    email: texto(f, 'email'),
    login: texto(f, 'login'),
    ativo: f.has('ativo'), // checkbox: só vem marcado
    perfis: textos(f, 'perfis'),
    unidades: textos(f, 'unidades'),
    ccEscopo: cc === '' ? null : cc,
  };
}

const dadosUsuario = z.record(z.string(), z.unknown());

export const entradaCadastro = z.preprocess((v) => (v instanceof FormData ? usuarioDeFormulario(v) : v), dadosUsuario);

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';

export const entradaAlteracao = z.preprocess(
  (v) =>
    v instanceof FormData
      ? { id: texto(v, 'id'), versao: /^\d{1,9}$/.test(texto(v, 'versao')) ? Number(texto(v, 'versao')) : NaN, dados: usuarioDeFormulario(v) }
      : v,
  z.object({
    id: z.string(),
    versao: z.number(MENSAGEM_VERSAO).int(MENSAGEM_VERSAO).nonnegative(MENSAGEM_VERSAO),
    dados: dadosUsuario,
  }),
);

export const entradaId = z.preprocess((v) => (v instanceof FormData ? { id: texto(v, 'id') } : v), z.object({ id: z.string() }));
