import { z } from 'zod';

// Entradas das ações de perfis (US-037). O Formulario do C3 entrega FormData; a conversão fica aqui,
// e a validação continua no domínio (validarPerfil) e no caso de uso (conferirPermissoes), que
// devolvem os erros por campo. Chamada com objeto comum segue sem conversão.
const texto = (f: FormData, campo: string): string => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : '';
};
const textos = (f: FormData, campo: string): string[] => f.getAll(campo).filter((v): v is string => typeof v === 'string');

// A grade manda uma caixa "permissao" por ação marcada ("<funcionalidade>:<ação>") e um campo oculto
// "exibidas" por funcionalidade mostrada (D-P13-6, A1). Status: "true" (Ativo) ou "false" (Inativo).
function perfilDeFormulario(f: FormData): Record<string, unknown> {
  const porFuncionalidade = new Map<string, string[]>();
  for (const chave of new Set(textos(f, 'permissao'))) {
    const i = chave.lastIndexOf(':');
    if (i <= 0) continue;
    const funcionalidade = chave.slice(0, i);
    porFuncionalidade.set(funcionalidade, [...(porFuncionalidade.get(funcionalidade) ?? []), chave.slice(i + 1)]);
  }
  const status = texto(f, 'ativo');
  return {
    nome: texto(f, 'nome'),
    descricao: texto(f, 'descricao'),
    ativo: status === 'true' ? true : status === 'false' ? false : undefined,
    permissoes: [...porFuncionalidade].map(([funcionalidade, acoes]) => ({ funcionalidade, acoes })),
    exibidas: textos(f, 'exibidas'),
    confirmarInativacao: texto(f, 'confirmarInativacao') === 'true',
  };
}

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';
const versao = (f: FormData) => (/^\d{1,9}$/.test(texto(f, 'versao')) ? Number(texto(f, 'versao')) : NaN);
const numeroVersao = z.number(MENSAGEM_VERSAO).int(MENSAGEM_VERSAO).nonnegative(MENSAGEM_VERSAO);
const dadosPerfil = z.record(z.string(), z.unknown());

export const entradaCadastroPerfil = z.preprocess((v) => (v instanceof FormData ? perfilDeFormulario(v) : v), dadosPerfil);

export const entradaAlteracaoPerfil = z.preprocess(
  (v) => (v instanceof FormData ? { id: texto(v, 'id'), versao: versao(v), dados: perfilDeFormulario(v) } : v),
  z.object({ id: z.string(), versao: numeroVersao, dados: dadosPerfil }),
);

export const entradaExclusaoPerfil = z.preprocess(
  (v) => (v instanceof FormData ? { id: texto(v, 'id'), versao: versao(v) } : v),
  z.object({ id: z.string(), versao: numeroVersao }),
);
