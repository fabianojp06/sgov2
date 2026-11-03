import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { ErroPermissao, exigir, type ContextoRequisicao } from '@/shared/authz';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { anoPadrao, exercicioOrigemDaCopia, ROTULO_SITUACAO, transicionar, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { contextoAuditoria, ErroRecalculo, recalcularExercicio, travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import { contasVetadasEmPacote } from './contas-vetadas';

// Exercícios do orçamento da Adm. Central (US-055; plano do P6, Task 3; spec §6.6).

const CONSULTAS_ORC = ['orc.orcamento', 'orc.exercicios', 'orc.receitas', 'orc.importacao', 'orc.aprovacao'];

export type ResumoExercicio = { id: string; ano: number; situacao: SituacaoExercicio; rotuloSituacao: string; versao: number; oficializadoEm: Date | null };

// Seletor de exercício e lista: quem consulta qualquer tela do orc (inclusive o Gestor de
// Diretoria, pelo orçamento) vê os anos.
export async function listarExercicios(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly ResumoExercicio[]> {
  if (!CONSULTAS_ORC.some((f) => ctx.permissoes.has(`${f}:consultar`))) {
    throw new ErroPermissao('orc.orcamento', 'consultar');
  }
  const { cliente } = resolverDeps(depsParciais);
  const linhas = await cliente.orcamentoExercicio.findMany({ orderBy: { ano: 'desc' }, select: { id: true, ano: true, situacao: true, versao: true, oficializadoEm: true } });
  return linhas.map((e) => ({ ...e, situacao: e.situacao as SituacaoExercicio, rotuloSituacao: ROTULO_SITUACAO[e.situacao as SituacaoExercicio] }));
}

// Ano sugerido no Novo exercício.
export async function sugerirAno(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<number> {
  exigir(ctx, 'orc.exercicios', 'incluir');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, 'orc.exercicios', 'incluir');
  const anos = await deps.cliente.orcamentoExercicio.findMany({ select: { ano: true } });
  return anoPadrao(anos.map((a) => a.ano), deps.agora());
}

const entradaCriacao = z
  .object({
    ano: z.coerce.number({ error: MENSAGENS_ORC.ANO_INVALIDO }).int(MENSAGENS_ORC.ANO_INVALIDO).min(2000, MENSAGENS_ORC.ANO_INVALIDO).max(2099, MENSAGENS_ORC.ANO_INVALIDO),
    forma: z.enum(['EM_BRANCO', 'COPIA'], { error: 'Escolha a forma de início do exercício.' }),
  })
  .strict();

export type ResultadoCriacao = { id: string; copiadas: { posicoes: number; pacotes: number }; puladas: { posicoes: number; pacotes: number } };

const ehAnoDuplicado = (erro: unknown) => erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';

// Novo exercício (só GFIN, orc.exercicios:incluir): em branco ou copiando o exercício anterior
// (R18), com as premissas do novo ano (C2) e as linhas recalculadas. A cópia pula posição ou
// pacote cujo CC ou conta deixou de ser analítico ativo e conta quantos pulou (D-P6-5). Receitas e
// teto não são copiados.
export async function criarExercicio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResultadoCriacao>> {
  exigir(ctx, 'orc.exercicios', 'incluir');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, 'orc.exercicios', 'incluir');
  await recusarCamposBlindados(ctx, 'orc.exercicios', bruto, CAMPOS_ORIGEM_BLINDADA.exercicio, deps);
  const entrada = entradaCriacao.safeParse(bruto);
  if (!entrada.success) return falha(entrada.error.issues.map((i) => ({ campo: String(i.path[0] ?? '_'), mensagem: i.message })));
  const { ano, forma } = entrada.data;
  try {
    return await deps.cliente.$transaction(async (tx) => {
      await exigirSemEscopo(tx, ctx, deps, 'orc.exercicios', 'incluir');
      const anos = (await tx.orcamentoExercicio.findMany({ select: { id: true, ano: true } })).map((e) => e);
      if (anos.some((e) => e.ano === ano)) return falha([{ campo: 'ano', mensagem: MENSAGENS_ORC.EXERCICIO_DUPLICADO(ano) }]);
      const anoOrigem = forma === 'COPIA' ? exercicioOrigemDaCopia(anos.map((e) => e.ano), ano) : null;
      if (forma === 'COPIA' && anoOrigem === null) return falha([{ campo: 'forma', mensagem: MENSAGENS_ORC.SEM_EXERCICIO_ANTERIOR }]);

      const novo = await tx.orcamentoExercicio.create({ data: { ano } });
      const premissasNovas = await deps.custoPessoal.garantirPremissasExercicio(tx, contextoAuditoria(ctx), ano);
      const copiadas = { posicoes: 0, pacotes: 0 };
      const puladas = { posicoes: 0, pacotes: 0 };
      if (anoOrigem !== null) {
        const origem = anos.find((e) => e.ano === anoOrigem)!;
        // Trava de leitura na origem: uma escrita nela (que pega FOR UPDATE) espera a cópia, e
        // posições e pacotes saem do mesmo estado.
        await tx.$queryRaw`SELECT 1 FROM orc_exercicio WHERE id = ${origem.id}::uuid FOR SHARE`;
        const indice = await deps.estrutura.carregarIndiceEstrutura(tx);
        const contasVetadas = contasVetadasEmPacote(indice, premissasNovas);
        const [posicoes, pacotes] = await Promise.all([
          tx.posicaoOrcada.findMany({ where: { exercicioId: origem.id } }),
          tx.pacoteBaseZero.findMany({ where: { exercicioId: origem.id } }),
        ]);
        const posicoesValidas = posicoes.filter((p) => indice.centroCustoAnalitico(p.cc));
        const pacotesValidos = pacotes.filter((k) => indice.centroCustoAnalitico(k.cc) && indice.contaAnaliticaAtiva(k.conta) && !contasVetadas.has(k.conta));
        await tx.posicaoOrcada.createMany({
          data: posicoesValidas.map(({ cc, cargo, quantidade, salarioMensal, mesInicio, mesSaida, observacao }) => ({
            exercicioId: novo.id, cc, cargo, quantidade, salarioMensal, mesInicio, mesSaida, observacao, origem: 'COPIA',
          })),
        });
        await tx.pacoteBaseZero.createMany({
          data: pacotesValidos.map(({ cc, conta, justificativa, prioridade, quantidade, valorUnitario, corrigirIpca, distribuicao, mesOcorrencia }) => ({
            exercicioId: novo.id, cc, conta, justificativa, prioridade, quantidade, valorUnitario, corrigirIpca, distribuicao, mesOcorrencia, origem: 'COPIA',
          })),
        });
        copiadas.posicoes = posicoesValidas.length;
        copiadas.pacotes = pacotesValidos.length;
        puladas.posicoes = posicoes.length - posicoesValidas.length;
        puladas.pacotes = pacotes.length - pacotesValidos.length;
      }
      await recalcularExercicio(tx, novo.id, deps);
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: 'orc.exercicios',
        tipo: 'INSERCAO',
        registroId: novo.id,
        descricao:
          anoOrigem === null
            ? `Exercício ${ano} criado em branco`
            : `Exercício ${ano} criado copiando ${anoOrigem}: ${copiadas.posicoes} posições e ${copiadas.pacotes} pacotes; puladas ${puladas.posicoes} posições e ${puladas.pacotes} pacotes (CC ou conta inativos, ou conta de pessoal em pacote)`,
        depois: { ano, forma, anoOrigem, copiadas, puladas },
      });
      return ok({ id: novo.id, copiadas, puladas });
    });
  } catch (erro) {
    if (ehAnoDuplicado(erro)) return falha([{ campo: 'ano', mensagem: MENSAGENS_ORC.EXERCICIO_DUPLICADO(ano) }]);
    if (erro instanceof ErroRecalculo) return falha(erro.erros);
    throw erro;
  }
}

const MENSAGEM_VERSAO = 'Versão do registro inválida. Recarregue a tela.';
const entradaVersionada = z.object({ id: z.string(), versao: z.coerce.number({ error: MENSAGEM_VERSAO }).int(MENSAGEM_VERSAO).min(0, MENSAGEM_VERSAO) }).strict();

// Avançar Rascunho → Em Elaboração (orc.exercicios:alterar), com o trâmite e o Histórico.
export async function avancarExercicio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<void>> {
  exigir(ctx, 'orc.exercicios', 'alterar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, 'orc.exercicios', 'alterar');
  await recusarCamposBlindados(ctx, 'orc.exercicios', bruto, CAMPOS_ORIGEM_BLINDADA.exercicio, deps);
  const entrada = entradaVersionada.safeParse(bruto);
  if (!entrada.success) return falha([{ campo: '_', mensagem: MENSAGEM_VERSAO }]);
  const { id, versao } = entrada.data;
  return deps.cliente.$transaction(async (tx) => {
    const e = await travarExercicio(tx, id);
    if (e.versao !== versao) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
    const t = transicionar(e.situacao, 'AVANCAR');
    if (!t.ok) return t;
    await tx.orcamentoExercicio.update({ where: { id: e.id }, data: { situacao: t.valor, versao: { increment: 1 }, atualizadoEm: deps.agora() } });
    await tx.tramiteExercicio.create({ data: { exercicioId: e.id, de: e.situacao, para: t.valor, usuarioId: ctx.usuarioId } });
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: 'orc.exercicios',
      tipo: 'ALTERACAO',
      registroId: e.id,
      descricao: `Exercício ${e.ano}: ${ROTULO_SITUACAO[e.situacao]} → ${ROTULO_SITUACAO[t.valor]}`,
      antes: { situacao: e.situacao },
      depois: { situacao: t.valor },
    });
    return ok(undefined);
  });
}
