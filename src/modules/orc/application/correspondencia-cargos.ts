import { z } from 'zod';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { ConflitoConcorrencia, Dinheiro, ErroDominio, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel, ROTULO_SITUACAO, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { contextoAuditoria, ErroRecalculo, errosNaoEditavel, recalcularExercicio, travarExercicio } from './calculo-linhas';
import { carregarCargos, custoDaPosicao } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirEscopoTotal, resolverEscopo } from './escopo';
import { cargosParaPosicao, gravarLinhasPosicao, nomeDoCargo, retrato, tocarExercicio, validarCargoEscolhido, type CargosPosicao } from './posicoes';

// Tela de correspondência entre o cargo em texto e o cadastro de C&S (US-056, #410; plano do P16, C34).
// Só para quem altera posição com escopo TOTAL (D-P16-1). Lista os textos exatos das posições sem cargo do
// cadastro, com a sugestão pelo nome igual (D-P16-3), e liga de uma vez as posições de um texto ao cargo
// escolhido (D-P16-5): o salário gravado nunca muda; o custo passa a usar os benefícios e o adicional do
// cargo (D-P15-3), com o recálculo da alteração pela tela (D-P12-5). Mensagens [PROVISÓRIAS].

const FUNCIONALIDADE = 'orc.posicoes';

export type ItemCorrespondencia = {
  texto: string;
  posicoes: number;
  ccs: number;
  /** Menor e maior salário gravado, em texto canônico ("1234.56"). */
  salarioMinimo: string;
  salarioMaximo: string;
  sugestaoId: string | null;
};
export type ListaCorrespondencia = { itens: readonly ItemCorrespondencia[]; cargos: CargosPosicao; versao: number; editavel: boolean; rotuloSituacao: string };

/** Nome para a sugestão: sem acentos, sem diferença de maiúsculas e com os espaços colapsados. */
export const normalizarNome = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const SEM_CARGOS: CargosPosicao = { cargos: [], comSalario: false, aviso: null };

async function abrir(ctx: ContextoRequisicao, deps: DepsOrc) {
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  exigirEscopoTotal(await resolverEscopo(deps.cliente, ctx, indice, deps), FUNCIONALIDADE, 'alterar');
}

export async function listarCorrespondencias(ctx: ContextoRequisicao, exercicioId: string, depsParciais: Partial<DepsOrc> = {}): Promise<ListaCorrespondencia> {
  const deps = resolverDeps(depsParciais);
  await abrir(ctx, deps);
  const e = z.uuid().safeParse(exercicioId).success ? await deps.cliente.orcamentoExercicio.findUnique({ where: { id: exercicioId } }) : null;
  if (!e) throw new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');
  const situacao = e.situacao as SituacaoExercicio;
  const base = { versao: e.versao, editavel: editavel(situacao), rotuloSituacao: ROTULO_SITUACAO[situacao] };
  // Fora da edição não há o que ligar: nem a lista dos cargos (sem CONSULTA à toa).
  if (!base.editavel) return { ...base, itens: [], cargos: SEM_CARGOS };
  const posicoes = await deps.cliente.posicaoOrcada.findMany({ where: { exercicioId: e.id, cargoId: null }, select: { cargo: true, cc: true, salarioMensal: true } });
  const cargos = posicoes.length > 0 ? await cargosParaPosicao(ctx, deps) : SEM_CARGOS;
  // Sugestão só com um cargo daquele nome (D-P16-3).
  const porNome = new Map<string, string | null>();
  for (const c of cargos.cargos) {
    const n = normalizarNome(c.nome);
    porNome.set(n, porNome.has(n) ? null : c.id);
  }
  const grupos = new Map<string, { ccs: Set<string>; salarios: Dinheiro[] }>();
  for (const p of posicoes) {
    const g = grupos.get(p.cargo) ?? { ccs: new Set<string>(), salarios: [] };
    g.ccs.add(p.cc);
    g.salarios.push(din(p.salarioMensal));
    grupos.set(p.cargo, g);
  }
  const itens = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([texto, g]): ItemCorrespondencia => {
      const ordenados = [...g.salarios].sort((a, b) => a.comparar(b));
      return {
        texto,
        posicoes: g.salarios.length,
        ccs: g.ccs.size,
        salarioMinimo: ordenados[0]!.paraString(),
        salarioMaximo: ordenados.at(-1)!.paraString(),
        sugestaoId: porNome.get(normalizarNome(texto)) ?? null,
      };
    });
  return { ...base, itens, cargos };
}

const entradaLigar = z.object({ exercicioId: z.string(), texto: z.string().min(1), cargoId: z.string().min(1), versao: z.coerce.number().int().min(0) }).strict();

/**
 * Liga ao cargo do cadastro todas as posições do exercício com aquele texto e sem cargo (D-P16-5). Nada é
 * gravado com erro em qualquer uma delas. Uma ALTERACAO por posição no Histórico.
 */
export async function ligarCargoPosicoes(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number; posicoes: number }>> {
  const deps = resolverDeps(depsParciais);
  await abrir(ctx, deps);
  const parse = entradaLigar.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: 'Dados da correspondência inválidos. Recarregue a tela.' }]);
  const entrada = parse.data;
  try {
    return await deps.cliente.$transaction(async (tx) => {
      const e = await travarExercicio(tx, entrada.exercicioId);
      if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
      if (e.versao !== entrada.versao) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
      const cache = await carregarCargos(tx, deps);
      const cargo = await validarCargoEscolhido(tx, cache, entrada.cargoId, null, deps);
      if (!cargo.ok) return cargo;
      const posicoes = await tx.posicaoOrcada.findMany({ where: { exercicioId: e.id, cargoId: null, cargo: entrada.texto }, orderBy: { id: 'asc' } });
      if (posicoes.length === 0) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.CORRESPONDENCIA_SEM_POSICOES }]);
      const premissas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
      if (!premissas) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_INEXISTENTES }]);
      // O motor roda para todas antes de qualquer escrita (o mesmo cálculo da alteração pela tela).
      const ligadas = [];
      const erros: ErroCampo[] = [];
      for (const p of posicoes) {
        const serie = await custoDaPosicao(tx, deps, cache, premissas, { quantidade: p.quantidade, salarioMensal: din(p.salarioMensal), mesInicio: p.mesInicio, mesSaida: p.mesSaida, cargoId: cargo.valor.id });
        if (!serie.ok) erros.push(...serie.erros.map((x) => ({ campo: '_', mensagem: MENSAGENS_ORC.CORRESPONDENCIA_ERRO_POSICAO(p.cc, x.mensagem) })));
        else ligadas.push({ p, serie: serie.valor });
      }
      if (erros.length > 0) return falha(erros);
      const nome = nomeDoCargo(cargo.valor);
      for (const { p } of ligadas) {
        exigirUmaLinha(await tx.posicaoOrcada.updateMany({ where: { id: p.id, versao: p.versao }, data: { cargo: nome, cargoId: cargo.valor.id, versao: { increment: 1 } } }));
      }
      // Premissas iguais às do último cálculo: só as linhas das posições; mudadas, o exercício inteiro.
      let versoes: { antes: number | null; depois: number } | null = null;
      if (e.versaoPremissas === premissas.versao) {
        for (const { p, serie } of ligadas) await gravarLinhasPosicao(tx, e.id, p.id, p.cc, serie);
        await tocarExercicio(tx, e.id, deps);
      } else {
        versoes = { antes: e.versaoPremissas, depois: (await recalcularExercicio(tx, e.id, deps)).versaoPremissas };
      }
      for (const { p } of ligadas) {
        const antes = retrato(p);
        const depois = retrato({ ...p, cargo: nome, cargoId: cargo.valor.id });
        await auditar(tx, {
          contexto: contextoAuditoria(ctx),
          funcionalidade: FUNCIONALIDADE,
          tipo: 'ALTERACAO',
          registroId: p.id,
          descricao: `Cargo da posição ligado ao cadastro (${cargo.valor.codigo}) no CC ${p.cc}, exercício ${e.ano}${versoes ? ', com o orçamento recalculado' : ''}`,
          antes: versoes ? { ...antes, versaoPremissas: versoes.antes } : antes,
          depois: versoes ? { ...depois, versaoPremissas: versoes.depois } : depois,
        });
      }
      return ok({ ano: e.ano, posicoes: ligadas.length });
    });
  } catch (erro) {
    if (erro instanceof ErroRecalculo) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.RECALCULO_BARROU_POSICAO }, ...erro.erros]);
    if (erro instanceof ConflitoConcorrencia) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
    throw erro;
  }
}
