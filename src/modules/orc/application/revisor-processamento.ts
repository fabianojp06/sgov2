import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { carregarPermissoes, manutencaoEfetiva, obterConfiguracaoAcesso, obterEscopoCentroCusto, obterUsuarioParaSessao } from '@/modules/adm/servidor';
import { listarArvoreCentrosCusto, listarArvoreContas } from '@/modules/cad/servidor';
import { ErroIA, servicoIA, type QuemPedeIA, type ServicoIA } from '@/shared/ia';
import { Dinheiro } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { Prioridade } from '../domain/pacote';
import { calcularPainel } from '../domain/resultado';
import {
  regraAumento,
  regraDesejaveis,
  regraDuplicados,
  TIPOS_ACHADO_IA,
  type Achado,
  type AchadoRegra,
  type PacoteRegra,
} from '../domain/revisor-regras';
import { ROTULO_PRIORIDADE } from '../domain/sugestao-ia';
import { semMarcas } from '../domain/texto';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA } from './ia-erros';

// Processamento do revisor no worker (US-064; plano do P14, D-P14-6 a D-P14-8). Sem sessão: quem pediu
// é remontado do banco, como no provedor de contexto (ativo, sem bloqueio, sistema ativo, permissões do
// perfil) e a chamada à IA vai em nome dessa pessoa, nunca do sistema. Este arquivo não importa a
// autorização de tela nem as dependências de página (o worker/bundle.test.ts reprova).
//
// - As regras R1 a R3 (domain/revisor-regras.ts) rodam sempre, sobre o exercício inteiro.
// - A IA recebe só o que a pessoa pode consultar (orc.pacotes, orc.posicoes) e nunca salário: as
//   posições vão sem salário, e os totais por CC × conta vão sem nenhum par que tenha linha de pessoal
//   (num CC com uma posição só, o total revelaria o salário).
// - Os ids que vão à IA são apelidos (PAC-1, POS-1): o servidor descarta referência que não enviou, e um
//   achado nunca aponta para linha de outro exercício.
// - Qualquer ErroIA termina CONCLUIDA, com as regras e um aviso. Só erro que não é de IA leva a FALHOU.

export const FILA_REVISAO = 'orc.revisar' as const;
export const LIMITE_ITENS_IA = 1500;
export const MAXIMO_ACHADOS_IA = 30;
// Chamada longa no worker (§4.4): mais folga que a da tela.
export const TEMPO_LIMITE_REVISOR_MS = 120_000;
const CASO = CASOS_IA_ORC.revisor;

export type DepsRevisor = {
  cliente: PrismaClient;
  ia: ServicoIA;
  agora: () => Date;
  sinalIa: () => AbortSignal;
  estrutura: { listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto; listarArvoreContas: typeof listarArvoreContas };
  pessoa: {
    obterUsuarioParaSessao: typeof obterUsuarioParaSessao;
    carregarPermissoes: typeof carregarPermissoes;
    obterConfiguracaoAcesso: typeof obterConfiguracaoAcesso;
    manutencaoEfetiva: typeof manutencaoEfetiva;
    obterEscopo: typeof obterEscopoCentroCusto;
  };
};

export function resolverDepsRevisor(d: Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'>): DepsRevisor {
  return {
    cliente: d.cliente,
    ia: d.ia ?? servicoIA,
    agora: d.agora ?? (() => new Date()),
    sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_REVISOR_MS)),
    estrutura: d.estrutura ?? { listarArvoreCentrosCusto, listarArvoreContas },
    pessoa: d.pessoa ?? { obterUsuarioParaSessao, carregarPermissoes, obterConfiguracaoAcesso, manutencaoEfetiva, obterEscopo: obterEscopoCentroCusto },
  };
}

// Resposta da IA (D-P14-8): fora do schema, o provedor devolve ErroIA('ia.saida_invalida').
export const RESPOSTA_REVISOR = z.object({
  achados: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_ACHADO_IA),
        referencias: z.array(z.object({ tipo: z.enum(['pacote', 'posicao']), id: z.string().max(40) })).max(50),
        texto: z.string().trim().min(1).max(1000),
      }),
    )
    .max(MAXIMO_ACHADOS_IA),
});

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const UUID = z.uuid();

// Links para a linha do exercício revisado (o ano e o CC abrem a tela no lugar certo).
const hrefPacote = (ano: number, cc: string, id: string) => `/orc/pacotes?${new URLSearchParams({ ano: String(ano), cc, editar: id })}`;
const hrefPosicao = (ano: number, cc: string, id: string) => `/orc/posicoes?${new URLSearchParams({ ano: String(ano), cc, editar: id })}`;
const hrefVisao = (ano: number, cc: string) => `/orc/orcamento?${new URLSearchParams({ ano: String(ano), cc })}`;

type PacoteLido = PacoteRegra & { distribuicao: string };
type PosicaoLida = { id: string; cc: string; cargo: string; quantidade: number; mesInicio: number; mesSaida: number };
type LinhaLida = { cc: string; conta: string; origem: string; total: Dinheiro };

// Snapshot do ano anterior (§6.2): só as linhas interessam (CC, conta, origem e total, como texto).
const LINHAS_SNAPSHOT = z.object({ linhas: z.array(z.object({ cc: z.string(), conta: z.string(), origem: z.string(), total: z.string() })) });

/** Quem pediu, como no provedor de contexto; null quando a pessoa não pode mais revisar. */
type Pessoa = Exclude<QuemPedeIA, { sistema: true }>;
async function quemPediu(usuarioId: string, deps: DepsRevisor): Promise<Pessoa | null> {
  const c = deps.cliente;
  const u = await deps.pessoa.obterUsuarioParaSessao(c, usuarioId);
  if (!u || !u.ativo || u.bloqueado) return null;
  // Sistema desativado: só o Administrador fica, e só com a Administração (sem o orc).
  if (deps.pessoa.manutencaoEfetiva(await deps.pessoa.obterConfiguracaoAcesso(c), deps.agora())) return null;
  const permissoes = await deps.pessoa.carregarPermissoes(c, usuarioId);
  // A mesma guarda do pedido: orc.aprovacao:executar e sem CC de escopo (R15).
  if (!permissoes.has('orc.aprovacao:executar')) return null;
  if ((await deps.pessoa.obterEscopo(c, usuarioId)) !== null) return null;
  return { usuarioId, unidadeId: null, permissoes };
}

function descricoes(nos: readonly { classificacao: string; descricao: string; filhos: readonly unknown[] }[], saida = new Map<string, string>()): Map<string, string> {
  for (const n of nos) {
    saida.set(n.classificacao, n.descricao);
    descricoes(n.filhos as typeof nos, saida);
  }
  return saida;
}

const umaLinha = (t: string) => semMarcas(t).replace(/\s+/g, ' ').trim();

type DadosMensagem = {
  ano: number;
  temAnterior: boolean;
  pacotes: readonly (PacoteLido & { apelido: string })[] | null;
  posicoes: readonly (PosicaoLida & { apelido: string })[] | null;
  totais: readonly { cc: string; conta: string; atual: Dinheiro | null; anterior: Dinheiro | null }[] | null;
  achados: readonly string[];
  contas: ReadonlyMap<string, string>;
  ccs: ReadonlyMap<string, string>;
};

/** A mensagem do revisor, montada aqui (minimização, §4.4): nunca salário, nome, login ou e-mail. */
export function montarMensagemRevisor(d: DadosMensagem): string {
  const usadasContas = new Set<string>();
  const usadosCcs = new Set<string>();
  for (const p of d.pacotes ?? []) {
    usadasContas.add(p.conta);
    usadosCcs.add(p.cc);
  }
  for (const p of d.posicoes ?? []) usadosCcs.add(p.cc);
  for (const t of d.totais ?? []) {
    usadasContas.add(t.conta);
    usadosCcs.add(t.cc);
  }
  const lista = (codigos: Set<string>, mapa: ReadonlyMap<string, string>) => [...codigos].sort().map((k) => `${k} – ${umaLinha(mapa.get(k) ?? '')}`);
  const linhas = [`Exercício do orçamento: ${d.ano}${d.temAnterior ? ` (comparado com ${d.ano - 1}, oficializado)` : ' (sem ano anterior oficializado)'}`, ''];
  linhas.push('Centros de custo (classificação – descrição):', ...lista(usadosCcs, d.ccs), '');
  linhas.push('Contas (classificação – descrição):', ...lista(usadasContas, d.contas), '');
  if (d.pacotes) {
    linhas.push('Pacotes base zero (id | CC | conta | prioridade | valor anual | distribuição | justificativa entre <<< e >>>):');
    for (const p of d.pacotes) {
      linhas.push(`${p.apelido} | ${p.cc} | ${p.conta} | ${ROTULO_PRIORIDADE[p.prioridade]} | ${p.anual.formatar()} | ${p.distribuicao === 'MENSAL' ? 'mensal' : 'pontual'} | <<<${umaLinha(p.justificativa)}>>>`);
    }
    if (d.pacotes.length === 0) linhas.push('nenhum');
    linhas.push('');
  }
  if (d.posicoes) {
    linhas.push('Posições de pessoal (id | CC | cargo entre <<< e >>> | quantidade | mês de início | mês de saída):');
    for (const p of d.posicoes) linhas.push(`${p.apelido} | ${p.cc} | <<<${umaLinha(p.cargo)}>>> | ${p.quantidade} | ${p.mesInicio} | ${p.mesSaida}`);
    if (d.posicoes.length === 0) linhas.push('nenhuma');
    linhas.push('');
  }
  if (d.totais) {
    linhas.push(`Totais por CC × conta, sem pessoal (CC | conta | ${d.ano} | ${d.ano - 1}):`);
    for (const t of d.totais) linhas.push(`${t.cc} | ${t.conta} | ${t.atual?.formatar() ?? '—'} | ${t.anterior?.formatar() ?? '—'}`);
    linhas.push('');
  }
  linhas.push('Achados automáticos do sistema (não repita):', ...(d.achados.length > 0 ? d.achados.map((a) => `- ${a}`) : ['nenhum']));
  linhas.push('', 'Responda com os achados de texto e coerência, cada um citando os ids acima (tipo pacote ou posicao).');
  return linhas.join('\n');
}

type Revisada = { achados: Achado[]; avisos: string[] };

async function revisar(r: { exercicioId: string; solicitadoPor: string }, deps: DepsRevisor): Promise<Revisada> {
  const c = deps.cliente;
  const e = await c.orcamentoExercicio.findUniqueOrThrow({ where: { id: r.exercicioId } });
  const [pacotesDb, posicoes, linhasDb, receitas, anterior, arvoreContas, arvoreCcs] = await Promise.all([
    c.pacoteBaseZero.findMany({ where: { exercicioId: e.id }, include: { linhas: { select: { total: true } } }, orderBy: [{ cc: 'asc' }, { conta: 'asc' }, { id: 'asc' }] }),
    // Sem o salário: ele nem sai do banco.
    c.posicaoOrcada.findMany({
      where: { exercicioId: e.id },
      select: { id: true, cc: true, cargo: true, quantidade: true, mesInicio: true, mesSaida: true },
      orderBy: [{ cc: 'asc' }, { cargo: 'asc' }, { id: 'asc' }],
    }),
    c.linhaOrcada.findMany({ where: { exercicioId: e.id }, select: { cc: true, conta: true, origem: true, meses: true, total: true } }),
    c.receitaRateio.findMany({ where: { exercicioId: e.id }, select: { situacao: true, meses: true } }),
    c.orcamentoExercicio.findFirst({ where: { ano: e.ano - 1, situacao: 'OFICIALIZADO' }, include: { snapshot: true } }),
    deps.estrutura.listarArvoreContas(c, { incluirInativos: true }),
    deps.estrutura.listarArvoreCentrosCusto(c, { incluirInativos: true }),
  ]);
  const avisos: string[] = [];
  const pacotes: PacoteLido[] = pacotesDb.map((k) => ({
    id: k.id,
    cc: k.cc,
    conta: k.conta,
    prioridade: k.prioridade as Prioridade,
    anual: k.linhas[0] ? din(k.linhas[0].total) : Dinheiro.zero(),
    justificativa: k.justificativa,
    distribuicao: k.distribuicao,
  }));
  const linhas: LinhaLida[] = linhasDb.map((l) => ({ cc: l.cc, conta: l.conta, origem: l.origem, total: din(l.total) }));
  const doSnapshot = anterior?.snapshot ? LINHAS_SNAPSHOT.safeParse(anterior.snapshot.conteudo) : null;
  const linhasAnteriores: LinhaLida[] | null = doSnapshot?.success ? doSnapshot.data.linhas.map((l) => ({ cc: l.cc, conta: l.conta, origem: l.origem, total: Dinheiro.de(l.total) })) : null;

  // Regras (D-P14-7), sempre, sobre o exercício inteiro.
  const r1 = regraDuplicados(pacotes);
  let r2: AchadoRegra[] = [];
  if (linhasAnteriores) r2 = regraAumento(linhas, linhasAnteriores);
  else avisos.push(MENSAGENS_ORC.REVISAO_SEM_ANTERIOR(e.ano - 1));
  const painel = calcularPainel(
    Array.from({ length: 12 }, (_, i) => Dinheiro.somarTodos(linhasDb.map((l) => din(l.meses[i]!)))),
    receitas.map((x) => ({ situacao: x.situacao as 'CONFIRMADO' | 'PREVISTO', meses: x.meses.map(din) })),
    e.tetoManual === null ? null : din(e.tetoManual),
  );
  const r3 = regraDesejaveis(painel.orcado, painel.tetoEfetivo, pacotes);
  const porId = new Map(pacotes.map((p) => [p.id, p]));
  const linkPacote = (id: string) => {
    const p = porId.get(id)!;
    return { rotulo: `Pacote ${p.cc} · ${p.conta}`, href: hrefPacote(e.ano, p.cc, p.id) };
  };
  const regras = [...r1, ...r2, ...r3];
  const achados: Achado[] = regras.map((a) => ({
    origem: 'REGRA',
    tipo: a.tipo,
    texto: a.texto,
    links: a.par ? [{ rotulo: `Visão do CC ${a.par.cc}`, href: hrefVisao(e.ano, a.par.cc) }] : a.pacotes.map(linkPacote),
  }));

  // A parte da IA (D-P14-6, D-P14-8).
  const quem = await quemPediu(r.solicitadoPor, deps);
  if (!quem) {
    avisos.push(MENSAGENS_ORC.REVISAO_SEM_ACESSO);
    return { achados, avisos };
  }
  const vePacotes = quem.permissoes.has('orc.pacotes:consultar');
  const vePosicoes = quem.permissoes.has('orc.posicoes:consultar');
  if (!vePacotes) avisos.push(MENSAGENS_ORC.REVISAO_SEM_PACOTES);
  if (!vePosicoes) avisos.push(MENSAGENS_ORC.REVISAO_SEM_POSICOES);
  const itens = (vePacotes ? pacotes.length : 0) + (vePosicoes ? posicoes.length : 0);
  if (itens > LIMITE_ITENS_IA) {
    avisos.push(MENSAGENS_ORC.REVISAO_GRANDE);
    return { achados, avisos };
  }
  if (itens === 0) return { achados, avisos };

  const apelidos = new Map<string, { tipo: 'pacote' | 'posicao'; id: string; rotulo: string; href: string }>();
  const pacotesIa = vePacotes
    ? pacotes.map((p, i) => {
        const apelido = `PAC-${i + 1}`;
        apelidos.set(apelido, { tipo: 'pacote', id: p.id, ...linkPacote(p.id) });
        return { ...p, apelido };
      })
    : null;
  const posicoesIa = vePosicoes
    ? posicoes.map((p, i) => {
        const apelido = `POS-${i + 1}`;
        apelidos.set(apelido, { tipo: 'posicao', id: p.id, rotulo: `Posição ${p.cc} · ${umaLinha(p.cargo)}`, href: hrefPosicao(e.ano, p.cc, p.id) });
        return { ...p, apelido };
      })
    : null;
  const apelidoDe = new Map([...apelidos.entries()].map(([apelido, a]) => [a.id, apelido]));

  // Totais sem pessoal: fora qualquer par com linha de pessoal, no ano ou no anterior. Vão só com os
  // pacotes (as linhas que sobram são deles).
  const comPessoal = new Set([...linhas, ...(linhasAnteriores ?? [])].filter((l) => l.origem === 'PESSOAL').map((l) => `${l.cc}|${l.conta}`));
  const somar = (ls: readonly LinhaLida[]) => {
    const m = new Map<string, { cc: string; conta: string; total: Dinheiro }>();
    for (const l of ls) {
      const k = `${l.cc}|${l.conta}`;
      if (comPessoal.has(k)) continue;
      m.set(k, { cc: l.cc, conta: l.conta, total: (m.get(k)?.total ?? Dinheiro.zero()).somar(l.total) });
    }
    return m;
  };
  const atuais = somar(linhas);
  const anteriores = somar(linhasAnteriores ?? []);
  const totais = vePacotes
    ? [...new Set([...atuais.keys(), ...anteriores.keys()])].sort().map((k) => {
        const [cc, conta] = k.split('|') as [string, string];
        return { cc, conta, atual: atuais.get(k)?.total ?? null, anterior: linhasAnteriores ? (anteriores.get(k)?.total ?? null) : null };
      })
    : null;

  // Os achados das regras vão sem valores: só o tipo e os ids (ou o par, se não for de pessoal).
  const ids = (xs: readonly string[]) => xs.map((x) => apelidoDe.get(x)).filter((x): x is string => x !== undefined);
  const resumoRegras = regras.flatMap((a): string[] => {
    if (a.tipo === 'DUPLICADO') return vePacotes ? [`Pacotes iguais: ${ids(a.pacotes).join(', ')}`] : [];
    if (a.tipo === 'AUMENTO_ANO_ANTERIOR') return a.par && !comPessoal.has(`${a.par.cc}|${a.par.conta}`) ? [`Aumento de mais de 50 % sobre o ano anterior: CC ${a.par.cc}, conta ${a.par.conta}`] : [];
    return [`Orçado acima do teto${vePacotes && a.pacotes.length > 0 ? `; pacotes Desejáveis: ${ids(a.pacotes).join(', ')}` : ''}`];
  });

  const mensagem = montarMensagemRevisor({
    ano: e.ano,
    temAnterior: linhasAnteriores !== null,
    pacotes: pacotesIa,
    posicoes: posicoesIa,
    totais,
    achados: resumoRegras,
    contas: descricoes(arvoreContas),
    ccs: descricoes(arvoreCcs),
  });
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(quem, CASO, mensagem, RESPOSTA_REVISOR, sinal);
    for (const a of valor.achados) {
      // Conferência (Review Focus 3): só ids enviados, do tipo certo, sem repetir.
      const vistos = new Set<string>();
      const links: { rotulo: string; href: string }[] = [];
      for (const ref of a.referencias) {
        const alvo = apelidos.get(ref.id.trim());
        if (!alvo || alvo.tipo !== ref.tipo || vistos.has(alvo.id)) continue;
        vistos.add(alvo.id);
        links.push({ rotulo: alvo.rotulo, href: alvo.href });
      }
      if (links.length > 0) achados.push({ origem: 'IA', tipo: a.tipo, texto: a.texto, links });
    }
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    avisos.push(x.codigo === 'ia.desligada' ? MENSAGENS_ORC.REVISAO_IA_DESLIGADA : MENSAGENS_ORC.REVISAO_ERRO_IA(mensagemErroIA(x, sinal)));
  }
  return { achados, avisos };
}

async function concluir(c: PrismaClient, id: string, situacao: 'CONCLUIDA' | 'FALHOU', r: Revisada, agora: Date): Promise<void> {
  // Só a PENDENTE muda (o trigger também recusa reescrever a concluída).
  await c.revisaoOrcamento.updateMany({ where: { id, situacao: 'PENDENTE' }, data: { situacao, achados: r.achados as object[], avisos: r.avisos, concluidoEm: agora } });
}

/**
 * Processa a revisão pedida (trabalhador da fila orc.revisar). Só a PENDENTE: uma nova tentativa do
 * pg-boss, ou o job de uma revisão já concluída, não faz nada. Erro que não é de IA: FALHOU, com o aviso
 * da revisão parada; se nem isso puder ser gravado, o erro sobe e a fila tenta de novo.
 */
export async function processarRevisao(revisaoId: string, depsParciais: Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'>): Promise<void> {
  const deps = resolverDepsRevisor(depsParciais);
  if (!UUID.safeParse(revisaoId).success) return;
  const r = await deps.cliente.revisaoOrcamento.findUnique({ where: { id: revisaoId } });
  if (!r || r.situacao !== 'PENDENTE') return;
  let revisada: Revisada;
  try {
    revisada = await revisar(r, deps);
  } catch (erro) {
    // Sem a mensagem: pode ter dado do orçamento.
    console.error('[ORC_REVISAO_FALHOU]', { revisaoId, erro: erro instanceof Error ? erro.name : typeof erro });
    await concluir(deps.cliente, r.id, 'FALHOU', { achados: [], avisos: [MENSAGENS_ORC.REVISAO_PARADA] }, deps.agora());
    return;
  }
  await concluir(deps.cliente, r.id, 'CONCLUIDA', revisada, deps.agora());
}
