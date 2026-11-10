import { z } from 'zod';

// Entradas das ações de usuário (US-038). O Formulario do C3 entrega FormData; a conversão
// fica aqui, e a validação dos campos continua no domínio (validarUsuario), que devolve os erros
// por campo. Chamada com objeto comum segue sem conversão.

const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};

const textos = (f: FormData, campo: string): string[] => f.getAll(campo).filter((v): v is string => typeof v === 'string');

// Painel "Funcionalidade(s) do Perfil" (US-039, REQ0080): cada funcionalidade exibida vem no campo
// oculto "funcionalidadesExibidas" ("<perfil>:<funcionalidade>"); a marcada vem também em
// "funcionalidades". A exibida e desmarcada de um perfil marcado é a exceção; o caso de uso confere
// se ela pertence ao perfil.
// As exibidas seguem para o caso de uso: só uma exceção exibida pode ser removida (ajuste M1).
const exibidasDeFormulario = (f: FormData, perfis: readonly string[]) =>
  [...new Set(textos(f, 'funcionalidadesExibidas'))].filter((chave) => perfis.includes(chave.slice(0, Math.max(0, chave.indexOf(':')))));

function excecoesDeFormulario(f: FormData, perfis: readonly string[]): { perfil: string; funcionalidade: string }[] {
  const marcadas = new Set(textos(f, 'funcionalidades'));
  return exibidasDeFormulario(f, perfis)
    .filter((chave) => !marcadas.has(chave))
    .map((chave) => {
      const i = chave.indexOf(':');
      return { perfil: chave.slice(0, i), funcionalidade: chave.slice(i + 1), valida: i > 0 };
    })
    .filter((e) => e.valida && perfis.includes(e.perfil))
    .map(({ perfil, funcionalidade }) => ({ perfil, funcionalidade }));
}

function usuarioDeFormulario(f: FormData): Record<string, unknown> {
  const cc = texto(f, 'ccEscopo');
  const perfis = textos(f, 'perfis');
  return {
    nome: texto(f, 'nome'),
    email: texto(f, 'email'),
    login: texto(f, 'login'),
    ativo: f.has('ativo'), // checkbox: só vem marcado
    perfis,
    unidades: textos(f, 'unidades'),
    ccEscopo: cc === '' ? null : cc,
    excecoes: excecoesDeFormulario(f, perfis),
    exibidas: exibidasDeFormulario(f, perfis),
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
