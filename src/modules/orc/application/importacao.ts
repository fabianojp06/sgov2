import { createHash } from 'node:crypto';
import { z } from 'zod';
import { QUANTIDADE_MAXIMA } from '@/modules/cad/servidor';
import { lerPlanilhasSegura, type LinhaPlanilha } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import {
  ABA_INSTRUCOES,
  ABAS,
  CELULA_LAYOUT,
  COLUNAS_PACOTES,
  COLUNAS_PESSOAL,
  COLUNAS_RECEITAS,
  LAYOUT,
  LINHA_CABECALHO_MAX,
  validarPlanilha,
  type Aba,
  type ErroPlanilha,
} from '../domain/planilha';
import { contextoAuditoria, ErroRecalculo, errosNaoEditavel, recalcularExercicio, travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { contasVetadasEmPacote } from './contas-vetadas';
import { resolverEscopo } from './escopo';

// Importação da planilha-modelo ADMC-ORC v1.0 (US-121; plano do P6, Task 4b; R5–R7). Tudo ou
// nada: com qualquer erro, nada é gravado. Reimportar substitui só os CCs presentes no arquivo e
// as receitas dos TPs presentes; o custo de pessoal é recalculado pelo motor (C2), nunca copiado.

export type ResumoCc = { cc: string; posicoes: number; pacotes: number; total: Dinheiro };
export type ResultadoImportacao = { posicoes: number; pacotes: number; ccs: number; receitas: number; resumoPorCc: readonly ResumoCc[]; mensagem: string };
export type DepsImportacao = DepsOrc & { lerPlanilhas: typeof lerPlanilhasSegura };

const COLUNAS_POR_ABA: Record<Aba, readonly string[]> = { Pessoal: COLUNAS_PESSOAL, 'Pacotes base zero': COLUNAS_PACOTES, Receitas: COLUNAS_RECEITAS };
const LEITURA_ABAS = ABAS.map((aba) => ({ aba, colunas: COLUNAS_POR_ABA[aba] }));

const erroGeral = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
// Erros por linha: o relatório agrupa por aba, na ordem das linhas, com teto (a resposta não cresce
// sem limite com uma planilha inteira errada).
const MAXIMO_ERROS = 500;
const comoCampos = (erros: readonly ErroPlanilha[]): ErroCampo[] => [
  { campo: '_', mensagem: MENSAGENS_ORC.PLANILHA_COM_ERROS },
  ...erros.slice(0, MAXIMO_ERROS).map((e) => ({ campo: `linhas.${e.aba}.${e.linha}.${e.coluna ?? '_'}`, mensagem: e.mensagem })),
  ...(erros.length > MAXIMO_ERROS ? [{ campo: '_', mensagem: MENSAGENS_ORC.MAIS_ERROS(erros.length - MAXIMO_ERROS) }] : []),
];
// Com escopo, o erro de posição de CC fora dele vira um aviso só, sem CC nem cargo.
function errosNoEscopo(erro: ErroRecalculo, ccs: ReadonlySet<string>): ErroCampo[] {
  const dentro = erro.erros.filter((_, i) => erro.ccs[i] === null || ccs.has(erro.ccs[i]!));
  return dentro.length === erro.erros.length ? [...erro.erros] : [...dentro, { campo: '_', mensagem: MENSAGENS_ORC.RECALCULO_FORA_DO_ESCOPO }];
}
// Erro de arquivo do leitor: cabeçalho ausente vira a mensagem do layout (R6); o resto, como veio.
const erroDeArquivo = (aba: Aba, colunas: readonly string[], mensagem: string) =>
  mensagem.startsWith('Cabeçalho não encontrado') ? MENSAGENS_ORC.FORA_DO_LAYOUT(aba, colunas) : mensagem;

// Pacotes e posições da tela que ficaram em cada CC do arquivo, em ordem de CC (só os CCs com algum).
// Só contagens: nenhum valor nem salário.
async function mantidosDaTela(tx: TxCliente, exercicioId: string, ccs: readonly string[]): Promise<{ cc: string; pacotes: number; posicoes: number }[]> {
  const where = { exercicioId, cc: { in: [...ccs] }, origem: 'TELA' };
  const [pacotes, posicoes] = await Promise.all([
    tx.pacoteBaseZero.groupBy({ by: ['cc'], where, _count: { _all: true }, orderBy: { cc: 'asc' } }),
    tx.posicaoOrcada.groupBy({ by: ['cc'], where, _count: { _all: true }, orderBy: { cc: 'asc' } }),
  ]);
  const contar = (gs: readonly { cc: string; _count: { _all: number } }[], cc: string) => gs.find((g) => g.cc === cc)?._count._all ?? 0;
  return ccs
    .map((cc) => ({ cc, pacotes: contar(pacotes, cc), posicoes: contar(posicoes, cc) }))
    .filter((g) => g.pacotes + g.posicoes > 0);
}

export async function importarPlanilha(
  ctx: ContextoRequisicao,
  entrada: { exercicioId: string; arquivo: { nome: string; conteudo: Uint8Array } },
  depsParciais: Partial<DepsImportacao> = {},
): Promise<Resultado<ResultadoImportacao>> {
  exigir(ctx, 'orc.importacao', 'executar');
  const deps = resolverDeps(depsParciais);
  const lerPlanilhas = depsParciais.lerPlanilhas ?? lerPlanilhasSegura;
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);

  // Uma leitura só (#279): a versão do layout em Instruções!E1 e as três abas, só com as colunas de
  // entrada (R6). Erro de arquivo reprova tudo; o índice do pedido diz qual aba falhou.
  // Sem colunasTexto: um CC de dois segmentos ("4.4") pode chegar como número da lista do Excel e
  // é lido certo; CC de 3 a 5 segmentos e conta nunca são número. TP convertido em data é recusado
  // na validação.
  const lidas: Record<Aba, readonly LinhaPlanilha[]> = { Pessoal: [], 'Pacotes base zero': [], Receitas: [] };
  const errosCelula: ErroPlanilha[] = [];
  let nomeArquivo = entrada.arquivo.nome;
  const r = await lerPlanilhas(entrada.arquivo, [
    { aba: ABA_INSTRUCOES, colunas: [], linhaCabecalhoMax: 1, celulas: [CELULA_LAYOUT] },
    ...LEITURA_ABAS.map(({ aba, colunas }) => ({ aba, colunas, linhaCabecalhoMax: LINHA_CABECALHO_MAX })),
  ]);
  if (!r.ok) {
    // Sem a aba Instruções: fora do layout. Outro erro nela (prazo, limite, arquivo malformado) vem
    // como o leitor disse.
    if (r.indiceAba === 0 && r.erros.every((e) => e.mensagem.startsWith('A aba "'))) return falha([{ campo: 'arquivo', mensagem: MENSAGENS_ORC.VERSAO_LAYOUT }]);
    const pedido = r.indiceAba === null || r.indiceAba === 0 ? undefined : LEITURA_ABAS[r.indiceAba - 1];
    return falha(r.erros.map((e) => ({ campo: 'arquivo', mensagem: pedido ? erroDeArquivo(pedido.aba, pedido.colunas, e.mensagem) : e.mensagem })));
  }
  const [instrucoes, ...abas] = r.valor;
  if (instrucoes!.celulasAvulsas?.[CELULA_LAYOUT]?.trim() !== LAYOUT) return falha([{ campo: 'arquivo', mensagem: MENSAGENS_ORC.VERSAO_LAYOUT }]);
  for (const [i, { aba }] of LEITURA_ABAS.entries()) {
    lidas[aba] = abas[i]!.linhas;
    nomeArquivo = abas[i]!.nomeArquivo;
    errosCelula.push(...abas[i]!.errosCelula.map((e) => ({ ...e, aba })));
  }

  // Premissas do ano do exercício para o veto das contas de pessoal em pacote; o exercício é travado
  // e relido depois, na transação.
  // Id que não é UUID não vai ao banco (o Postgres recusaria com erro inesperado): a transação responde
  // "Exercício não encontrado." como antes.
  const ano = z.uuid().safeParse(entrada.exercicioId).success
    ? (await deps.cliente.orcamentoExercicio.findUnique({ where: { id: entrada.exercicioId }, select: { ano: true } }))?.ano
    : undefined;
  const contasVetadas = contasVetadasEmPacote(indice, ano === undefined ? null : await deps.custoPessoal.obterPremissasExercicio(deps.cliente, ano));
  const validacao = validarPlanilha(
    { pessoal: lidas.Pessoal, pacotes: lidas['Pacotes base zero'], receitas: lidas.Receitas },
    {
      ccAnalitico: (cc) => indice.centroCustoAnalitico(cc),
      contaPermitida: (conta) => indice.contaAnaliticaAtiva(conta) && !contasVetadas.has(conta),
      noEscopo: (cc) => escopo.tipo === 'TOTAL' || escopo.ccs.has(cc),
    },
    { quantidadeMaxima: QUANTIDADE_MAXIMA },
  );
  // A célula com erro do leitor chega como null: a validação não repete o erro na mesma célula.
  const comErroDoLeitor = new Set(errosCelula.map((e) => `${e.aba}|${e.linha}|${e.coluna}`));
  const errosValidacao = validacao.ok ? [] : validacao.erros.filter((e) => !comErroDoLeitor.has(`${e.aba}|${e.linha}|${e.coluna}`));
  const erros = [...errosCelula, ...errosValidacao].sort((a, b) => ABAS.indexOf(a.aba) - ABAS.indexOf(b.aba) || a.linha - b.linha);
  if (escopo.tipo !== 'TOTAL' && lidas.Receitas.length > 0) return erroGeral(MENSAGENS_ORC.RECEITAS_SO_ESCOPO_TOTAL);
  if (erros.length > 0 || !validacao.ok) return falha(comoCampos(erros));
  const { posicoes, pacotes, receitas } = validacao.conteudo;
  if (posicoes.length + pacotes.length + receitas.length === 0) return erroGeral(MENSAGENS_ORC.PLANILHA_VAZIA);

  const ccs = [...new Set([...posicoes, ...pacotes].map((l) => l.cc))].sort();
  const sha256 = createHash('sha256').update(entrada.arquivo.conteudo).digest('hex');
  const resumoContagem = ccs.map((cc) => ({ cc, posicoes: posicoes.filter((p) => p.cc === cc).length, pacotes: pacotes.filter((k) => k.cc === cc).length }));
  try {
    return await deps.cliente.$transaction(async (tx) => {
      const e = await travarExercicio(tx, entrada.exercicioId);
      if (!editavel(e.situacao)) return falha(errosNaoEditavel(e.situacao));
      // A importação recalcula o exercício inteiro. Com escopo, ela não pode trazer premissas novas para
      // os CCs de fora: isso é o Recalcular que a R15 nega ao gestor.
      if (escopo.tipo !== 'TOTAL' && e.versaoPremissas !== null) {
        const atuais = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
        if (atuais && atuais.versao !== e.versaoPremissas) return erroGeral(MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_ESCOPO);
      }
      const importacao = await tx.importacaoPlanilha.create({
        data: { exercicioId: e.id, arquivoNome: nomeArquivo, arquivoSha256: sha256, criadoPor: ctx.usuarioId, resumo: { porCc: resumoContagem, receitas: receitas.map((r) => r.tp) } },
      });
      // R7: substitui só os CCs do arquivo (as linhas saem em cascata) e as receitas dos TPs do arquivo.
      // Os pacotes e as posições lançados pela tela (origem TELA) sobrevivem à reimportação (planos do
      // P11 e do P12).
      // [PROVISÓRIO] D-P15-6: a posição importada ou copiada que foi ligada a um cargo do cadastro pela
      // tela também é substituída (e perde o vínculo); a importação avisa quantas.
      const comCargo = await tx.posicaoOrcada.count({ where: { exercicioId: e.id, cc: { in: ccs }, origem: { not: 'TELA' }, cargoId: { not: null } } });
      const avisos = comCargo > 0 ? [MENSAGENS_ORC.POSICOES_COM_CARGO_SUBSTITUIDAS(comCargo)] : [];
      await tx.posicaoOrcada.deleteMany({ where: { exercicioId: e.id, cc: { in: ccs }, origem: { not: 'TELA' } } });
      await tx.pacoteBaseZero.deleteMany({ where: { exercicioId: e.id, cc: { in: ccs }, origem: { not: 'TELA' } } });
      await tx.posicaoOrcada.createMany({
        data: posicoes.map((p) => ({
          exercicioId: e.id, cc: p.cc, cargo: p.cargo, quantidade: p.quantidade, salarioMensal: p.salarioMensal.paraString(),
          mesInicio: p.mesInicio, mesSaida: p.mesSaida, observacao: p.observacao, origem: 'IMPORTACAO', importacaoId: importacao.id,
        })),
      });
      await tx.pacoteBaseZero.createMany({
        data: pacotes.map((k) => ({
          exercicioId: e.id, cc: k.cc, conta: k.conta, justificativa: k.justificativa, prioridade: k.prioridade, quantidade: k.quantidade,
          valorUnitario: k.valorUnitario.paraString(), corrigirIpca: k.corrigirIpca, distribuicao: k.distribuicao, mesOcorrencia: k.mesOcorrencia,
          origem: 'IMPORTACAO', importacaoId: importacao.id,
        })),
      });
      await tx.receitaRateio.deleteMany({ where: { exercicioId: e.id, tp: { in: receitas.map((r) => r.tp) } } });
      await tx.receitaRateio.createMany({
        data: receitas.map((r) => ({
          exercicioId: e.id, tp: r.tp, descricao: r.descricao, situacao: r.situacao, meses: r.meses.map((m) => m.paraString()),
          total: Dinheiro.somarTodos(r.meses).paraString(), importacaoId: importacao.id,
        })),
      });
      // [PROVISÓRIO] Aviso dos pacotes e das posições da tela que ficaram nos CCs do arquivo (D-P11-7, D-P12-7).
      const daTela = await mantidosDaTela(tx, e.id, ccs);
      const recalculo = await recalcularExercicio(tx, e.id, deps);
      // As premissas são relidas no recálculo: uma versão nova gravada entre as duas leituras também desfaz.
      if (escopo.tipo !== 'TOTAL' && e.versaoPremissas !== null && recalculo.versaoPremissas !== e.versaoPremissas) {
        throw new ErroRecalculo([{ campo: '_', mensagem: MENSAGENS_ORC.PREMISSAS_DESATUALIZADAS_ESCOPO }]);
      }
      const linhas = await tx.linhaOrcada.findMany({ where: { exercicioId: e.id, cc: { in: ccs } }, select: { cc: true, total: true } });
      const resumoPorCc = resumoContagem.map((c) => ({
        ...c,
        total: Dinheiro.somarTodos(linhas.filter((l) => l.cc === c.cc).map((l) => Dinheiro.de(l.total.toString()))),
      }));
      // Um evento só, com o resumo (não um por linha) e sem salários.
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: 'orc.importacao',
        tipo: 'INSERCAO',
        registroId: importacao.id,
        descricao: `Planilha ${nomeArquivo} importada no exercício ${e.ano}: ${posicoes.length} posições e ${pacotes.length} pacotes em ${ccs.length} CCs, ${receitas.length} receitas`,
        // Só contagens: o total de um CC com uma só posição revelaria o custo daquela pessoa.
        // O recálculo embutido refaz o exercício inteiro (R9): a versão das premissas vai junto.
        antes: { versaoPremissas: e.versaoPremissas },
        depois: {
          arquivo: nomeArquivo,
          sha256,
          porCc: resumoContagem,
          receitas: receitas.map((r) => r.tp),
          versaoPremissas: recalculo.versaoPremissas,
          linhas: recalculo.linhas,
          mantidosDaTela: daTela,
          ...(avisos.length > 0 ? { avisos } : {}),
        },
      });
      return ok({
        posicoes: posicoes.length,
        pacotes: pacotes.length,
        ccs: ccs.length,
        receitas: receitas.length,
        resumoPorCc,
        mensagem: [
          MENSAGENS_ORC.IMPORTADA(posicoes.length, pacotes.length, ccs.length, receitas.length),
          ...daTela.flatMap((g) => [
            ...(g.posicoes > 0 ? [MENSAGENS_ORC.POSICOES_DA_TELA_MANTIDAS(g.cc, g.posicoes)] : []),
            ...(g.pacotes > 0 ? [MENSAGENS_ORC.PACOTES_DA_TELA_MANTIDOS(g.cc, g.pacotes)] : []),
          ]),
          ...avisos,
        ].join(' '),
      });
    });
  } catch (erro) {
    if (erro instanceof ErroRecalculo) return falha(escopo.tipo === 'TOTAL' ? erro.erros : errosNoEscopo(erro, escopo.ccs));
    throw erro;
  }
}
