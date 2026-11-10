import { z } from 'zod';
import { falha, MENSAGEM_CONFLITO, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { MENSAGEM_CONFIRMAR_INATIVACAO } from './perfil-textos';
import { ehFixaDoAdministrador, podeReceberFuncionalidade } from './perfis';

// Cadastro de perfis e permissões (US-037; EP085 UC02.07–10 e UC02.25/26 como um caso de uso só,
// plano do P13). Regras puras: o caso de uso lê o catálogo e o perfil no banco e passa para cá.

// Ações do C5, na ordem das colunas da grade. O domínio não importa o @/shared/authz: a lista repete o
// tipo Acao, e o caso de uso confere que uma é atribuível à outra.
export const ACOES_PERFIL = ['consultar', 'incluir', 'alterar', 'excluir', 'exportar', 'imprimir', 'aprovar', 'executar'] as const;
export type AcaoPerfil = (typeof ACOES_PERFIL)[number];

export const MENSAGENS_PERFIL = {
  // EP085, textos fixados (UC02.25, UC02.26, E2 e E3).
  CADASTRADO: 'Perfil cadastrado com sucesso.',
  ALTERADO_SUCESSO: 'Perfil alterado com sucesso.',
  SEM_FUNCIONALIDADE: 'O perfil deve possuir ao menos uma funcionalidade associada.',
  CONFIRMAR_INATIVACAO: MENSAGEM_CONFIRMAR_INATIVACAO,
  // [PROVISÓRIOS] (D-P13-3, D-P13-4, D-P13-5, D-P13-10).
  EXCLUIDO: 'Perfil excluído com sucesso.',
  NOME: 'O nome do perfil é obrigatório.',
  NOME_TAMANHO: 'O nome do perfil deve ter até 100 caracteres, sem quebras de linha.',
  NOME_DUPLICADO: 'Já existe um perfil com este nome.',
  DESCRICAO: 'A descrição do perfil deve ter até 500 caracteres, sem quebras de linha.',
  STATUS: 'Informe o status do perfil.',
  PERMISSAO_REPETIDA: 'A mesma funcionalidade aparece mais de uma vez nas permissões.',
  PERMISSOES_DEMAIS: 'Permissões demais para um perfil.',
  FUNCIONALIDADE_INVALIDA: 'Funcionalidade inexistente ou inativa nas permissões do perfil.',
  ACAO_INVALIDA: 'Ação não disponível para a funcionalidade.',
  ADMINISTRACAO_EXCLUSIVA: 'As funcionalidades da Administração são exclusivas do perfil Administrador.',
  ADMINISTRADOR_INATIVO: 'O perfil Administrador não pode ser inativado.',
  PADRAO_EXCLUSAO: 'Os perfis padrão do sistema não podem ser excluídos. Inative o perfil se ele não for usado.',
  COM_USUARIOS: 'Este perfil possui usuários associados e não pode ser excluído.',
  INEXISTENTE: 'Perfil não encontrado.',
  ALTERADO: MENSAGEM_CONFLITO,
} as const;

// [PROVISÓRIO] (D-P13-5): a página exige Consultar; sem ele, a ação ficaria inalcançável.
export const mensagemSemConsultar = (funcionalidade: string) => `Marque Consultar para dar outras ações em ${funcionalidade}.`;

const CONTROLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

const texto = (max: number, mensagem: string) =>
  z
    .string(mensagem)
    .trim()
    .transform((t) => t.normalize('NFC'))
    .pipe(
      z
        .string()
        .max(max, mensagem)
        .refine((t) => !CONTROLE.test(t), mensagem),
    );

// Entrada do formulário (D-P13-5). As regras que dependem do catálogo ficam em conferirPermissoes.
export const esquemaPerfil = z.object({
  // RN0069: nunca em branco ou só espaços; trim (A10: espaço interno vale, como nos nomes padrão).
  nome: texto(100, MENSAGENS_PERFIL.NOME_TAMANHO).pipe(z.string().min(1, MENSAGENS_PERFIL.NOME)),
  descricao: texto(500, MENSAGENS_PERFIL.DESCRICAO).default(''),
  ativo: z.boolean(MENSAGENS_PERFIL.STATUS),
  permissoes: z
    .array(
      z.object({
        funcionalidade: z.string().trim().min(1, MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA).max(100, MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA),
        acoes: z
          .array(z.enum(ACOES_PERFIL, { error: MENSAGENS_PERFIL.ACAO_INVALIDA }))
          .max(ACOES_PERFIL.length, MENSAGENS_PERFIL.ACAO_INVALIDA)
          .transform((a) => ACOES_PERFIL.filter((x) => a.includes(x))),
      }),
    )
    .max(1000, MENSAGENS_PERFIL.PERMISSOES_DEMAIS)
    // RN0084: uma funcionalidade uma vez só.
    .refine((l) => new Set(l.map((p) => p.funcionalidade)).size === l.length, MENSAGENS_PERFIL.PERMISSAO_REPETIDA)
    // Funcionalidade sem ação não é associação (não há como guardá-la em perfil_permissao).
    .transform((l) => l.filter((p) => p.acoes.length > 0)),
  // Funcionalidades que a grade mostrou (D-P13-6, ajuste A1): o caso de uso confere com o catálogo.
  exibidas: z
    .array(z.string().max(100, MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA))
    .max(1000, MENSAGENS_PERFIL.PERMISSOES_DEMAIS)
    .default([])
    .transform((e) => [...new Set(e)]),
  // E3 (D-P13-10): inativar com usuários ativos só com a confirmação.
  confirmarInativacao: z.boolean().optional(),
});

const PORTUGUES = z.locales.ptBR().localeError;

export type EntradaPerfil = z.input<typeof esquemaPerfil>;
export type PerfilValidado = z.output<typeof esquemaPerfil>;
// Permissões por funcionalidade, como o Histórico e o diff as usam.
export type MapaPermissoes = Readonly<Record<string, readonly AcaoPerfil[]>>;

export function validarPerfil(entrada: unknown): Resultado<PerfilValidado> {
  const r = esquemaPerfil.safeParse(entrada, { error: PORTUGUES });
  if (r.success) return ok(r.data);
  const erros: ErroCampo[] = [];
  for (const issue of r.error.issues) {
    const campo = String(issue.path[0] ?? '_');
    if (!erros.some((e) => e.campo === campo)) erros.push({ campo, mensagem: issue.message });
  }
  return falha(erros);
}

// Funcionalidade do catálogo como o caso de uso a lê: `ativa` já soma o módulo (RN0078).
export type FuncionalidadeCatalogo = { codigo: string; nome: string; modulo: string; acoes: readonly string[]; ativa: boolean };

// As funcionalidades que a grade do perfil mostra (D-P13-6, ajuste A1): ativas, de módulo ativo, com
// ação declarada, que o perfil pode receber (RN_SEED_003), menos as fixas do Administrador (A2).
export function funcionalidadesDaGrade(perfilCodigo: string, catalogo: readonly FuncionalidadeCatalogo[]): FuncionalidadeCatalogo[] {
  return catalogo.filter(
    (f) => f.ativa && f.acoes.length > 0 && podeReceberFuncionalidade(perfilCodigo, f.codigo, f.modulo) && !ehFixaDoAdministrador(perfilCodigo, f.codigo, f.modulo),
  );
}

// Confere as permissões pedidas contra o catálogo e devolve o diff só sobre as funcionalidades da
// grade (D-P13-6, A1, A2):
// - concessão da Administração a quem não pode recebê-la → recusa (RN_SEED_003, D-P13-4);
// - funcionalidade fora do catálogo ativo ou ação não declarada → recusa (RN0078, RN0046);
// - ação sem Consultar, quando a funcionalidade o declara → recusa (D-P13-5);
// - `exibidas` diferente da grade do servidor → conflito (tela desatualizada ou forjada, A1).
export function conferirPermissoes(
  perfilCodigo: string,
  pedidas: PerfilValidado['permissoes'],
  exibidas: readonly string[],
  catalogo: readonly FuncionalidadeCatalogo[],
): Resultado<{ grade: ReadonlySet<string> }> {
  const porCodigo = new Map(catalogo.map((f) => [f.codigo, f]));
  const grade = new Set(funcionalidadesDaGrade(perfilCodigo, catalogo).map((f) => f.codigo));
  const recusa = (mensagem: string) => falha([{ campo: 'permissoes', mensagem }]);
  for (const p of pedidas) {
    const f = porCodigo.get(p.funcionalidade);
    if (f && !podeReceberFuncionalidade(perfilCodigo, f.codigo, f.modulo)) return recusa(MENSAGENS_PERFIL.ADMINISTRACAO_EXCLUSIVA);
    if (!f || !grade.has(f.codigo)) {
      // As da Administração do Administrador ficam de fora (A2): pedi-las não é erro, só não muda nada.
      if (f && ehFixaDoAdministrador(perfilCodigo, f.codigo, f.modulo)) continue;
      return recusa(MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA);
    }
    if (!p.acoes.every((a) => f.acoes.includes(a))) return recusa(MENSAGENS_PERFIL.ACAO_INVALIDA);
    if (f.acoes.includes('consultar') && !p.acoes.includes('consultar')) return recusa(mensagemSemConsultar(f.nome));
  }
  if (exibidas.length !== grade.size || !exibidas.every((c) => grade.has(c))) {
    return falha([{ campo: '_', mensagem: MENSAGENS_PERFIL.ALTERADO }]);
  }
  return ok({ grade });
}

export type DiferencaPermissoes = {
  associadas: { funcionalidade: string; acoes: readonly AcaoPerfil[] }[];
  retiradas: { funcionalidade: string; acoes: readonly AcaoPerfil[] }[];
  alteradas: { funcionalidade: string; antes: readonly AcaoPerfil[]; depois: readonly AcaoPerfil[] }[];
  // O conjunto final: as da grade como pedidas, as de fora (inativas, fixas) como estavam.
  final: MapaPermissoes;
};

const ordenadas = (acoes: readonly AcaoPerfil[]) => ACOES_PERFIL.filter((a) => acoes.includes(a));
const iguais = (a: readonly AcaoPerfil[], b: readonly AcaoPerfil[]) => ordenadas(a).join(',') === ordenadas(b).join(',');

// O que muda nas permissões (RN0080, RN0081), só nas funcionalidades da grade.
export function diferencaPermissoes(antes: MapaPermissoes, pedidas: PerfilValidado['permissoes'], grade: ReadonlySet<string>): DiferencaPermissoes {
  const pedidasNaGrade = new Map(pedidas.filter((p) => grade.has(p.funcionalidade)).map((p) => [p.funcionalidade, ordenadas(p.acoes)]));
  const final: Record<string, readonly AcaoPerfil[]> = {};
  for (const [f, acoes] of Object.entries(antes)) if (!grade.has(f) && acoes.length > 0) final[f] = ordenadas(acoes);
  for (const [f, acoes] of pedidasNaGrade) final[f] = acoes;
  const r: DiferencaPermissoes = { associadas: [], retiradas: [], alteradas: [], final: ordenarMapa(final) };
  for (const f of [...grade].sort()) {
    const a = antes[f] ?? [];
    const d = pedidasNaGrade.get(f) ?? [];
    if (a.length === 0 && d.length > 0) r.associadas.push({ funcionalidade: f, acoes: d });
    else if (a.length > 0 && d.length === 0) r.retiradas.push({ funcionalidade: f, acoes: ordenadas(a) });
    else if (a.length > 0 && !iguais(a, d)) r.alteradas.push({ funcionalidade: f, antes: ordenadas(a), depois: d });
  }
  return r;
}

export const mudouPermissoes = (d: DiferencaPermissoes) => d.associadas.length + d.retiradas.length + d.alteradas.length > 0;

// RN0082 (E2): ao menos uma funcionalidade ativa com ação. As inativas não dão acesso e não contam.
export const temFuncionalidadeAtiva = (final: MapaPermissoes, ativas: ReadonlySet<string>) =>
  Object.entries(final).some(([f, acoes]) => acoes.length > 0 && ativas.has(f));

export function ordenarMapa(m: MapaPermissoes): MapaPermissoes {
  return Object.fromEntries(Object.keys(m).sort().map((f) => [f, ordenadas(m[f]!)]));
}

// O que vai ao Histórico (D-P13-8): os dados do formulário e as permissões por funcionalidade.
export const retratoPerfil = (p: { nome: string; descricao: string; ativo: boolean; permissoes: MapaPermissoes }) => ({
  nome: p.nome,
  descricao: p.descricao,
  ativo: p.ativo,
  permissoes: ordenarMapa(p.permissoes),
});

// Descrições do Histórico (D-P13-8). [PROVISÓRIAS]: o EP085 não dá os textos.
export const DESCRICOES_PERFIL = {
  cadastrado: (nome: string) => `Perfil ${nome} cadastrado`,
  alterado: (nome: string) => `Perfil ${nome} alterado`,
  inativado: (nome: string) => `Perfil ${nome} inativado`,
  excluido: (nome: string) => `Perfil ${nome} excluído`,
  associada: (funcionalidade: string, nome: string) => `Funcionalidade ${funcionalidade} associada ao perfil ${nome}`,
  retirada: (funcionalidade: string, nome: string) => `Funcionalidade ${funcionalidade} retirada do perfil ${nome}`,
  acoes: (funcionalidade: string, nome: string) => `Ações da funcionalidade ${funcionalidade} no perfil ${nome} alteradas`,
} as const;
