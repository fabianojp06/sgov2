// Estado do painel "Funcionalidade(s) do Perfil" do formulário de usuário (US-039; UC02.12 A2,
// UC02.13 A4–A6, REQ0080, REQ0081). Funções puras, para o componente e os testes de unidade.

export type EstadoPainel = { perfis: ReadonlySet<string>; retiradas: ReadonlySet<string> };
export type PerfilPainel = {
  codigo: string;
  funcionalidades?: readonly { codigo: string }[];
  fixas?: readonly { codigo: string }[];
};

export const chave = (perfil: string, funcionalidade: string) => `${perfil}:${funcionalidade}`;

// [PROVISÓRIO]: o EP085 não dá o texto do aviso da REQ0081 (ajuste B1 da revisão 12.12).
export const mensagemPerfilDesmarcado = (nome: string) => `Perfil ${nome} desmarcado: todas as funcionalidades foram retiradas.`;

export function estadoInicial(perfis: readonly string[], excecoes: readonly { perfil: string; funcionalidade: string }[]): EstadoPainel {
  return { perfis: new Set(perfis), retiradas: new Set(excecoes.map((e) => chave(e.perfil, e.funcionalidade))) };
}

// Marcar ou desmarcar um perfil. Desmarcado, ele perde as exceções (a cascata do banco); marcado de
// novo, volta com todas as funcionalidades marcadas (A4).
export function alternarPerfil(estado: EstadoPainel, codigo: string, marcado: boolean): EstadoPainel {
  const perfis = new Set(estado.perfis);
  if (marcado) perfis.add(codigo);
  else perfis.delete(codigo);
  return { perfis, retiradas: new Set([...estado.retiradas].filter((k) => !k.startsWith(`${codigo}:`))) };
}

// Marcar ou desmarcar uma funcionalidade de um perfil (desmarcar cria a exceção, REQ0080). REQ0081:
// a última desmarcada desmarca o perfil, se ele não tiver funcionalidade fixa (Administração).
export function alternarFuncionalidade(
  estado: EstadoPainel,
  perfil: PerfilPainel,
  funcionalidade: string,
  marcada: boolean,
): { estado: EstadoPainel; perfilDesmarcado: boolean } {
  const k = chave(perfil.codigo, funcionalidade);
  const retiradas = new Set(estado.retiradas);
  if (marcada) retiradas.delete(k);
  else retiradas.add(k);
  const todas = perfil.funcionalidades ?? [];
  const semFixa = (perfil.fixas ?? []).length === 0;
  if (!marcada && semFixa && todas.length > 0 && todas.every((f) => retiradas.has(chave(perfil.codigo, f.codigo)))) {
    return { estado: alternarPerfil({ ...estado, retiradas }, perfil.codigo, false), perfilDesmarcado: true };
  }
  return { estado: { ...estado, retiradas }, perfilDesmarcado: false };
}
