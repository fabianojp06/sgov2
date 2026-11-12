import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  beneficiosDosCargos,
  listarArvoreCentrosCusto,
  listarArvoreContas,
  listarCargosSemSalarioCifrado,
  obterPremissasExercicio,
  type CargoExercicio,
} from '@/modules/cad/servidor';
import { ErroIA, servicoIA, type ServicoIA } from '@/shared/ia';
import { Dinheiro } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import type { Prioridade } from '../domain/pacote';
import { calcularPainel } from '../domain/resultado';
import {
  AVISO_SO_POSICOES,
  regraAumento,
  regraDesejaveis,
  regraDuplicados,
  regraForaDaFaixa,
  regraSemBeneficio,
  TIPOS_ACHADO_IA,
  REVISAO_PARADA_MS,
  type Achado,
  type AchadoRegra,
  type LinkAchado,
  type PacoteRegra,
  type PosicaoRegra,
} from '../domain/revisor-regras';
import { ROTULO_PRIORIDADE } from '../domain/sugestao-ia';
import { semMarcas } from '../domain/texto';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA } from './ia-erros';
import { FUNCOES_PESSOA_IA, remontarPessoaIA, type FuncoesPessoaIA } from './ia-pessoa';

// Processamento do revisor no worker (US-064; plano do P14, D-P14-6 a D-P14-8). Sem sessão: quem pediu
// é remontado do banco, como no provedor de contexto (ativo, sem bloqueio, sistema ativo, permissões do
// perfil) e a chamada à IA vai em nome dessa pessoa, nunca do sistema. Este arquivo não importa a
// autorização de tela nem as dependências de página (o worker/bundle.test.ts reprova).
//
// - As regras R1 a R5 (domain/revisor-regras.ts) rodam sempre, sobre o exercício inteiro. A R4 e a R5
//   (plano do P15, D-P15-4) usam o cadastro de cargos sem a cifra (cad/servidor) e o salário gravado na
//   posição, lido numa consulta só para elas; nem o salário nem a faixa vão à IA.
// - A IA recebe só o que a pessoa pode consultar (orc.pacotes, orc.posicoes) e nunca salário: as
//   posições vão sem salário, e os totais por CC × conta vão sem nenhum par que tenha linha de pessoal
//   (num CC com uma posição só, o total revelaria o salário).
// - Os ids que vão à IA são apelidos (PAC-1, POS-1): o servidor descarta referência que não enviou, e um
//   achado nunca aponta para linha de outro exercício.
// - Qualquer ErroIA termina CONCLUIDA, com as regras e um aviso. Só erro que não é de IA leva a FALHOU.

export const FILA_REVISAO = 'orc.revisar' as const;
export const LIMITE_ITENS_IA = 1500;
export const MAXIMO_ACHADOS_IA = 30;
export const MAXIMO_REFERENCIAS_IA = 50;
export const MAXIMO_TEXTO_IA = 1000;
// Chamada longa no worker (§4.4): mais folga que a da tela.
export const TEMPO_LIMITE_REVISOR_MS = 120_000;
const CASO = CASOS_IA_ORC.revisor;

export type DepsRevisor = {
  cliente: PrismaClient;
  ia: ServicoIA;
  agora: () => Date;
  sinalIa: () => AbortSignal;
  estrutura: { listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto; listarArvoreContas: typeof listarArvoreContas };
  // C2, acréscimo de C&S (P15): a versão sem a cifra; o worker não tem a chave.
  custoPessoal: {
    listarCargosSemSalarioCifrado: typeof listarCargosSemSalarioCifrado;
    beneficiosDosCargos: typeof beneficiosDosCargos;
    obterPremissasExercicio: typeof obterPremissasExercicio;
  };
  pessoa: FuncoesPessoaIA;
};

export function resolverDepsRevisor(d: Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'>): DepsRevisor {
  return {
    cliente: d.cliente,
    ia: d.ia ?? servicoIA,
    agora: d.agora ?? (() => new Date()),
    sinalIa: d.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_REVISOR_MS)),
    estrutura: d.estrutura ?? { listarArvoreCentrosCusto, listarArvoreContas },
    custoPessoal: d.custoPessoal ?? { listarCargosSemSalarioCifrado, beneficiosDosCargos, obterPremissasExercicio },
    pessoa: d.pessoa ?? FUNCOES_PESSOA_IA,
  };
}

// Resposta da IA (D-P14-8): fora do formato, o provedor devolve ErroIA('ia.saida_invalida'). Os limites
// (achados, referências e texto) estão na instrução; o que passar deles é cortado aqui, e não reprovado.
// overwrite, e não transform: o schema continua representável em JSON Schema (saída estruturada).
const primeiros = <T>(n: number) => (xs: T[]) => xs.slice(0, n);
export const RESPOSTA_REVISOR = z.object({
  achados: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_ACHADO_IA),
        referencias: z.array(z.object({ tipo: z.enum(['pacote', 'posicao']), id: z.string() })).overwrite(primeiros(MAXIMO_REFERENCIAS_IA)),
        texto: z
          .string()
          .trim()
          .min(1)
          .overwrite((t) => [...t].slice(0, MAXIMO_TEXTO_IA).join('')),
      }),
    )
    .overwrite(primeiros(MAXIMO_ACHADOS_IA)),
});

const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const UUID = z.uuid();

// Links para a linha do exercício revisado (o ano e o CC abrem a tela no lugar certo).
const hrefPacote = (ano: number, cc: string, id: string) => `/orc/pacotes?${new URLSearchParams({ ano: String(ano), cc, editar: id })}`;
const hrefPosicao = (ano: number, cc: string, id: string) => `/orc/posicoes?${new URLSearchParams({ ano: String(ano), cc, editar: id })}`;
const hrefVisao = (ano: number, cc: string) => `/orc/orcamento?${new URLSearchParams({ ano: String(ano), cc })}`;

type PacoteLido = PacoteRegra & { distribuicao: string };
type PosicaoLida = { id: string; cc: string; cargo: string; cargoId: string | null; quantidade: number; mesInicio: number; mesSaida: number };
type LinhaLida = { cc: string; conta: string; origem: string; total: Dinheiro };

// Snapshot do ano anterior (§6.2): só as linhas interessam (CC, conta, origem e total, como texto).
const LINHAS_SNAPSHOT = z.object({ linhas: z.array(z.object({ cc: z.string(), conta: z.string(), origem: z.string(), total: z.string() })) });

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

// `parcial` recebe os achados das regras assim que ficam prontos: um erro depois delas não os perde.
async function revisar(r: { exercicioId: string; solicitadoPor: string }, deps: DepsRevisor, parcial: Revisada): Promise<Revisada> {
  const c = deps.cliente;
  const e = await c.orcamentoExercicio.findUniqueOrThrow({ where: { id: r.exercicioId } });
  const [pacotesDb, posicoes, salariosRegras, linhasDb, receitas, anterior, arvoreContas, arvoreCcs] = await Promise.all([
    c.pacoteBaseZero.findMany({ where: { exercicioId: e.id }, include: { linhas: { select: { total: true } } }, orderBy: [{ cc: 'asc' }, { conta: 'asc' }, { id: 'asc' }] }),
    // Sem o salário: ele nem sai do banco.
    c.posicaoOrcada.findMany({
      where: { exercicioId: e.id },
      select: { id: true, cc: true, cargo: true, cargoId: true, quantidade: true, mesInicio: true, mesSaida: true },
      orderBy: [{ cc: 'asc' }, { cargo: 'asc' }, { id: 'asc' }],
    }),
    // Só para a R4 e a R5 (D-P15-4): o salário das posições com cargo do cadastro. Não vai à IA.
    c.posicaoOrcada.findMany({ where: { exercicioId: e.id, cargoId: { not: null } }, select: { id: true, cc: true, cargoId: true, salarioMensal: true } }),
    c.linhaOrcada.findMany({ where: { exercicioId: e.id }, select: { cc: true, conta: true, origem: true, meses: true, total: true } }),
    c.receitaRateio.findMany({ where: { exercicioId: e.id }, select: { situacao: true, meses: true } }),
    c.orcamentoExercicio.findFirst({ where: { ano: e.ano - 1, situacao: 'OFICIALIZADO' }, include: { snapshot: true } }),
    deps.estrutura.listarArvoreContas(c, { incluirInativos: true }),
    deps.estrutura.listarArvoreCentrosCusto(c, { incluirInativos: true }),
  ]);
  const avisos = parcial.avisos;
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
    return { rotulo: `Pacote ${p.cc} · ${p.conta}`, href: hrefPacote(e.ano, p.cc, p.id), tipo: 'pacote' as const };
  };
  // Par com linha de pessoal, no ano ou no anterior: a tela só o mostra a quem vê salário, e a IA nunca o recebe.
  const comPessoal = new Set([...linhas, ...(linhasAnteriores ?? [])].filter((l) => l.origem === 'PESSOAL').map((l) => `${l.cc}|${l.conta}`));
  // Cargos do cadastro, lidos depois da R1 a R3 (um erro na leitura não as perde); o nome do cadastro
  // substitui o texto gravado quando a posição tem cargo.
  const cargos = new Map<string, CargoExercicio>();
  const nomeCargo = (p: { cargo: string; cargoId: string | null }) => (p.cargoId !== null ? cargos.get(p.cargoId)?.nome : undefined) ?? p.cargo;
  const posicaoPorId = new Map(posicoes.map((p) => [p.id, p]));
  const linkPosicao = (id: string): LinkAchado => {
    const p = posicaoPorId.get(id)!;
    return { rotulo: `Posição ${p.cc} · ${umaLinha(nomeCargo(p))}`, href: hrefPosicao(e.ano, p.cc, p.id), tipo: 'posicao' };
  };
  const registrar = (as: readonly AchadoRegra[]) => {
    for (const a of as) {
      parcial.achados.push({
        origem: 'REGRA',
        tipo: a.tipo,
        texto: a.texto,
        links: a.par
          ? [{ rotulo: `Visão do CC ${a.par.cc}`, href: hrefVisao(e.ano, a.par.cc), tipo: 'par', pessoal: comPessoal.has(`${a.par.cc}|${a.par.conta}`) }]
          : a.posicoes.length > 0
            ? a.posicoes.map((id) => ({ ...linkPosicao(id), ...(a.salario ? { salario: true } : {}) }))
            : a.pacotes.map(linkPacote),
      });
    }
  };
  registrar([...r1, ...r2, ...r3]);

  // R4 e R5 (D-P15-4): só as posições com cargo do cadastro. Cargos sem a cifra, com os inativos.
  for (const k of salariosRegras.length > 0 ? await deps.custoPessoal.listarCargosSemSalarioCifrado(c, { incluirInativos: true }) : []) cargos.set(k.id, k);
  const posicoesRegra: PosicaoRegra[] = salariosRegras.flatMap((p) => {
    // As duas leituras não são uma transação: só a posição que também está na outra leitura entra.
    const k = p.cargoId === null || !posicaoPorId.has(p.id) ? undefined : cargos.get(p.cargoId);
    return k ? [{ id: p.id, cc: p.cc, cargoId: k.id, cargoNome: umaLinha(k.nome), salarioMensal: din(p.salarioMensal) }] : [];
  });
  let r4: AchadoRegra[] = [];
  if (posicoesRegra.length > 0) {
    if (await deps.custoPessoal.obterPremissasExercicio(c, e.ano)) {
      // Uma leitura das premissas para todos os cargos (beneficiosDosCargos, #421).
      const lote = await deps.custoPessoal.beneficiosDosCargos(c, e.ano, [...new Set(posicoesRegra.map((p) => p.cargoId))]);
      const semBeneficio = new Set([...lote].filter(([, b]) => b.beneficios.length === 0).map(([id]) => id));
      r4 = regraSemBeneficio(posicoesRegra, semBeneficio);
    } else {
      // Com o prefixo: o aviso revela que há posição com cargo (só para quem consulta posições).
      avisos.push(`${AVISO_SO_POSICOES}${MENSAGENS_ORC.REVISAO_SEM_PREMISSAS(e.ano)}`);
    }
  }
  const r5 = regraForaDaFaixa(posicoesRegra, new Map([...cargos.values()].map((k) => [k.id, k.faixa])));
  registrar([...r4, ...r5]);
  // Sem cargo do cadastro, ou com um que não está mais nele: fora das duas, cada caso com o seu aviso, que
  // só aparece a quem consulta posições (B3; ultimaRevisao).
  const semCargo = posicoes.filter((p) => p.cargoId === null).length;
  const cargoSumido = posicoes.filter((p) => p.cargoId !== null && !cargos.has(p.cargoId)).length;
  if (semCargo > 0) avisos.push(`${AVISO_SO_POSICOES}${MENSAGENS_ORC.REVISAO_SEM_CARGO(semCargo)}`);
  if (cargoSumido > 0) avisos.push(`${AVISO_SO_POSICOES}${MENSAGENS_ORC.REVISAO_CARGO_FORA_DO_CADASTRO(cargoSumido)}`);
  const regras = [...r1, ...r2, ...r3, ...r4];
  // Posições da R5: todo achado da IA que cita uma delas leva a marca de salário (D-P15-4).
  const posicoesR5 = new Set(r5.flatMap((a) => a.posicoes));
  const achados = parcial.achados;

  // A parte da IA (D-P14-6, D-P14-8).
  // A mesma guarda do pedido: orc.aprovacao:executar e sem CC de escopo (R15).
  const quem = await remontarPessoaIA(r.solicitadoPor, 'orc.aprovacao:executar', deps);
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
        apelidos.set(apelido, { ...linkPacote(p.id), id: p.id });
        return { ...p, apelido };
      })
    : null;
  const posicoesIa = vePosicoes
    ? posicoes.map((p, i) => {
        const apelido = `POS-${i + 1}`;
        apelidos.set(apelido, { ...linkPosicao(p.id), tipo: 'posicao', id: p.id });
        // O nome do cadastro substitui o texto gravado quando há cargo (D-P15-4).
        return { ...p, cargo: nomeCargo(p), apelido };
      })
    : null;
  const apelidoDe = new Map([...apelidos.entries()].map(([apelido, a]) => [a.id, apelido]));

  // Totais sem pessoal: fora qualquer par com linha de pessoal, no ano ou no anterior. Vão só com os
  // pacotes (as linhas que sobram são deles).
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
    // R4: só os apelidos, e só se quem pediu consulta posições. A R5 nunca vai (fica fora de `regras`).
    if (a.tipo === 'POSICAO_SEM_BENEFICIO') return vePosicoes ? [`Posições sem benefício: ${ids(a.posicoes).join(', ')}`] : [];
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
      const links: LinkAchado[] = [];
      for (const ref of a.referencias) {
        const alvo = apelidos.get(ref.id.trim());
        if (!alvo || alvo.tipo !== ref.tipo || vistos.has(alvo.id)) continue;
        vistos.add(alvo.id);
        links.push({ rotulo: alvo.rotulo, href: alvo.href, tipo: alvo.tipo, ...(alvo.tipo === 'posicao' && posicoesR5.has(alvo.id) ? { salario: true } : {}) });
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
  // Parada há mais de 15 minutos: a tela já a mostra como FALHOU e aceitou um pedido novo; não processa.
  if (deps.agora().getTime() - r.criadoEm.getTime() > REVISAO_PARADA_MS) {
    await concluir(deps.cliente, r.id, 'FALHOU', { achados: [], avisos: [MENSAGENS_ORC.REVISAO_PARADA] }, deps.agora());
    return;
  }
  const parcial: Revisada = { achados: [], avisos: [] };
  let revisada: Revisada;
  try {
    revisada = await revisar(r, deps, parcial);
  } catch (erro) {
    // Sem a mensagem: pode ter dado do orçamento. Os achados das regras já prontos ficam.
    console.error('[ORC_REVISAO_FALHOU]', { revisaoId, erro: erro instanceof Error ? erro.name : typeof erro });
    await concluir(deps.cliente, r.id, 'FALHOU', { achados: parcial.achados, avisos: [...parcial.avisos, MENSAGENS_ORC.REVISAO_PARADA] }, deps.agora());
    return;
  }
  await concluir(deps.cliente, r.id, 'CONCLUIDA', revisada, deps.agora());
}
