import { createHash } from 'node:crypto';
import { QUANTIDADE_MAXIMA } from '@/modules/cad/servidor';
import { lerPlanilhaSegura, type LinhaPlanilha } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import {
  COLUNAS_PACOTES,
  COLUNAS_PESSOAL,
  COLUNAS_RECEITAS,
  RAIZES_CONTAS_PESSOAL,
  validarPlanilha,
  type Aba,
  type ErroPlanilha,
} from '../domain/planilha';
import { contextoAuditoria, ErroRecalculo, errosNaoEditavel, recalcularExercicio, travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { resolverEscopo } from './escopo';

// Importação da planilha-modelo ADMC-ORC v1.0 (US-121; plano do P6, Task 4b; R5–R7). Tudo ou
// nada: com qualquer erro, nada é gravado. Reimportar substitui só os CCs presentes no arquivo e
// as receitas dos TPs presentes; o custo de pessoal é recalculado pelo motor (C2), nunca copiado.

export type ResumoCc = { cc: string; posicoes: number; pacotes: number; total: Dinheiro };
export type ResultadoImportacao = { posicoes: number; pacotes: number; ccs: number; receitas: number; resumoPorCc: readonly ResumoCc[]; mensagem: string };
export type DepsImportacao = DepsOrc & { lerPlanilha: typeof lerPlanilhaSegura };

const ABAS: readonly { aba: Aba; colunas: readonly string[] }[] = [
  { aba: 'Pessoal', colunas: COLUNAS_PESSOAL },
  { aba: 'Pacotes base zero', colunas: COLUNAS_PACOTES },
  { aba: 'Receitas', colunas: COLUNAS_RECEITAS },
];

const erroGeral = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
// Erros por linha: o relatório agrupa por aba, na ordem das linhas, com teto (a resposta não cresce
// sem limite com uma planilha inteira errada).
const MAXIMO_ERROS = 500;
const comoCampos = (erros: readonly ErroPlanilha[]): ErroCampo[] => [
  { campo: '_', mensagem: MENSAGENS_ORC.PLANILHA_COM_ERROS },
  ...erros.slice(0, MAXIMO_ERROS).map((e) => ({ campo: `linhas.${e.aba}.${e.linha}.${e.coluna ?? '_'}`, mensagem: e.mensagem })),
  ...(erros.length > MAXIMO_ERROS ? [{ campo: '_', mensagem: MENSAGENS_ORC.MAIS_ERROS(erros.length - MAXIMO_ERROS) }] : []),
];
// Erro de arquivo do leitor: cabeçalho ausente vira a mensagem do layout (R6); o resto, como veio.
const erroDeArquivo = (aba: Aba, colunas: readonly string[], mensagem: string) =>
  mensagem.startsWith('Cabeçalho não encontrado') ? MENSAGENS_ORC.FORA_DO_LAYOUT(aba, colunas) : mensagem;

export async function importarPlanilha(
  ctx: ContextoRequisicao,
  entrada: { exercicioId: string; arquivo: { nome: string; conteudo: Uint8Array } },
  depsParciais: Partial<DepsImportacao> = {},
): Promise<Resultado<ResultadoImportacao>> {
  exigir(ctx, 'orc.importacao', 'executar');
  const deps = resolverDeps(depsParciais);
  const lerPlanilha = depsParciais.lerPlanilha ?? lerPlanilhaSegura;
  const indice = await deps.estrutura.carregarIndiceEstrutura(deps.cliente);
  const escopo = await resolverEscopo(deps.cliente, ctx, indice, deps);

  // Três leituras, uma por aba, só com as colunas de entrada (R6). Erro de arquivo reprova tudo.
  // Sem colunasTexto: um CC de dois segmentos ("4.4") pode chegar como número da lista do Excel e
  // é lido certo; CC de 3 a 5 segmentos e conta nunca são número. TP convertido em data é recusado
  // na validação.
  const lidas: Record<Aba, readonly LinhaPlanilha[]> = { Pessoal: [], 'Pacotes base zero': [], Receitas: [] };
  const errosCelula: ErroPlanilha[] = [];
  let nomeArquivo = entrada.arquivo.nome;
  for (const { aba, colunas } of ABAS) {
    const r = await lerPlanilha(entrada.arquivo, { aba, colunas, linhaCabecalhoMax: 4 });
    if (!r.ok) return falha(r.erros.map((e) => ({ campo: 'arquivo', mensagem: erroDeArquivo(aba, colunas, e.mensagem) })));
    lidas[aba] = r.valor.linhas;
    nomeArquivo = r.valor.nomeArquivo;
    errosCelula.push(...r.valor.errosCelula.map((e) => ({ ...e, aba })));
  }

  const contasPessoal = new Set(RAIZES_CONTAS_PESSOAL.flatMap((r) => indice.contasAnaliticasSob(r)));
  const validacao = validarPlanilha(
    { pessoal: lidas.Pessoal, pacotes: lidas['Pacotes base zero'], receitas: lidas.Receitas },
    {
      ccAnalitico: (cc) => indice.centroCustoAnalitico(cc),
      contaPermitida: (conta) => indice.contaAnaliticaAtiva(conta) && !contasPessoal.has(conta),
      noEscopo: (cc) => escopo.tipo === 'TOTAL' || escopo.ccs.has(cc),
    },
    { quantidadeMaxima: QUANTIDADE_MAXIMA },
  );
  // A célula com erro do leitor chega como null: a validação não repete o erro na mesma célula.
  const comErroDoLeitor = new Set(errosCelula.map((e) => `${e.aba}|${e.linha}|${e.coluna}`));
  const errosValidacao = validacao.ok ? [] : validacao.erros.filter((e) => !comErroDoLeitor.has(`${e.aba}|${e.linha}|${e.coluna}`));
  const erros = [...errosCelula, ...errosValidacao].sort((a, b) => ABAS.findIndex((x) => x.aba === a.aba) - ABAS.findIndex((x) => x.aba === b.aba) || a.linha - b.linha);
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
      const importacao = await tx.importacaoPlanilha.create({
        data: { exercicioId: e.id, arquivoNome: nomeArquivo, arquivoSha256: sha256, criadoPor: ctx.usuarioId, resumo: { porCc: resumoContagem, receitas: receitas.map((r) => r.tp) } },
      });
      // R7: substitui só os CCs do arquivo (as linhas saem em cascata) e as receitas dos TPs do arquivo.
      await tx.posicaoOrcada.deleteMany({ where: { exercicioId: e.id, cc: { in: ccs } } });
      await tx.pacoteBaseZero.deleteMany({ where: { exercicioId: e.id, cc: { in: ccs } } });
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
      await recalcularExercicio(tx, e.id, deps);
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
        depois: { arquivo: nomeArquivo, sha256, porCc: resumoContagem, receitas: receitas.map((r) => r.tp) },
      });
      return ok({
        posicoes: posicoes.length,
        pacotes: pacotes.length,
        ccs: ccs.length,
        receitas: receitas.length,
        resumoPorCc,
        mensagem: MENSAGENS_ORC.IMPORTADA(posicoes.length, pacotes.length, ccs.length, receitas.length),
      });
    });
  } catch (erro) {
    if (erro instanceof ErroRecalculo) return falha(erro.erros);
    throw erro;
  }
}
