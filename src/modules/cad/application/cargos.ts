import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import {
  desvioDeMercado,
  dinheiroDoTexto,
  FONTES_ATIVAS,
  salarioDaFonte,
  validarMercadoCargo,
  type FonteAtiva,
  type GrauInsalubridade,
  type SalariosCargo,
} from '../domain/cargo';
import { codigoDescricao, type CargoTela } from '../domain/cargo-tela';
import { criarCifraSalarios, type CampoCifrado, type CifraSalarios } from '../infrastructure/cifra-salarios';
import { MSG_CONCORRENCIA } from '../infrastructure/parametro-sistema';

// Casos de uso dos cargos (US-049 parte 2; plano do P4, Task 12b; R7, R24). A decifra é feita só no
// servidor e só com cad.salarios:consultar; cada leitura sem máscara grava um CONSULTA no Histórico,
// sem os valores. Os envelopes só são regravados quando o valor muda (R7).

type Deps = { cliente?: PrismaClient; cifra?: CifraSalarios };

const contextoDe = (ctx: ContextoRequisicao) => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

const veSalarios = (ctx: ContextoRequisicao) => ctx.permissoes.has('cad.salarios:consultar');

const SELECAO = {
  id: true,
  codigo: true,
  nomeOficial: true,
  nomeMercado: true,
  tabelaSalarialCodigo: true,
  tabelaSalarialDescricao: true,
  faixaCodigo: true,
  faixaDescricao: true,
  nivelCodigo: true,
  nivelDescricao: true,
  salarioRealCifrado: true,
  funcaoGratificadaCifrada: true,
  salarioDefinidoCifrado: true,
  mercadoMinimo: true,
  mercadoMaximo: true,
  origemMercado: true,
  origemMercadoRotulo: true,
  fonteAtiva: true,
  adicionalTipo: true,
  adicionalGrau: true,
  ativo: true,
  versao: true,
  vinculoFuncional: { select: { id: true, nome: true, ativa: true } },
} as const;
type CargoBanco = Prisma.CargoGetPayload<{ select: typeof SELECAO }>;

const decimal = (d: Prisma.Decimal | null) => (d === null ? null : Dinheiro.de(d.toFixed(2)));

/** A cifra só é criada se algum cargo tiver envelope (sem salário, a tela abre sem a chave). */
function cifraPreguicosa(deps: Deps): () => CifraSalarios {
  let cifra: CifraSalarios | null = deps.cifra ?? null;
  return () => (cifra ??= criarCifraSalarios());
}

/**
 * Um envelope que não volta (chave retirada cedo do keyring, adulteração, chave ausente) não derruba a
 * tela: o campo vem nulo e marcado ilegível, com o log só do código e do campo (I9).
 */
type Ilegivel = CargoTela['salariosIlegiveis'][number];
const CAMPO_TELA: Readonly<Record<CampoCifrado, Ilegivel>> = { funcao_gratificada: 'funcaoGratificada', salario_real: 'real', salario_definido: 'definido' };

function salariosDe(c: CargoBanco, cifra: () => CifraSalarios): { salarios: SalariosCargo; ilegiveis: Ilegivel[] } {
  const ilegiveis: Ilegivel[] = [];
  const decifrar = (envelope: string | null, campo: CampoCifrado): Dinheiro | null => {
    if (envelope === null) return null;
    try {
      return cifra().decifrar(envelope, { codigoCargo: c.codigo, campo });
    } catch {
      ilegiveis.push(CAMPO_TELA[campo]);
      console.error('[CIFRA_SALARIOS_ILEGIVEL]', { codigoCargo: c.codigo, campo });
      return null;
    }
  };
  const salarios = {
    minimo: decimal(c.mercadoMinimo),
    maximo: decimal(c.mercadoMaximo),
    funcaoGratificada: decifrar(c.funcaoGratificadaCifrada, 'funcao_gratificada'),
    real: decifrar(c.salarioRealCifrado, 'salario_real'),
    definido: decifrar(c.salarioDefinidoCifrado, 'salario_definido'),
  };
  return { salarios, ilegiveis };
}

const NULOS = { minimo: null, maximo: null, funcaoGratificada: null, real: null, definido: null };

function paraTela(c: CargoBanco, lidos: { salarios: SalariosCargo; ilegiveis: Ilegivel[] } | null): CargoTela {
  const salarios = lidos?.salarios ?? null;
  const txt = (d: Dinheiro | null) => d?.paraString() ?? null;
  return {
    id: c.id,
    codigo: c.codigo,
    nomeOficial: c.nomeOficial,
    nomeMercado: c.nomeMercado,
    tabelaSalarial: codigoDescricao(c.tabelaSalarialCodigo, c.tabelaSalarialDescricao),
    faixa: codigoDescricao(c.faixaCodigo, c.faixaDescricao),
    nivel: codigoDescricao(c.nivelCodigo, c.nivelDescricao),
    salarios: salarios
      ? { minimo: txt(salarios.minimo), maximo: txt(salarios.maximo), funcaoGratificada: txt(salarios.funcaoGratificada), real: txt(salarios.real), definido: txt(salarios.definido) }
      : NULOS,
    mascarado: salarios === null,
    origemMercado: c.origemMercadoRotulo,
    fonteAtiva: c.fonteAtiva,
    salarioDaFonte: salarios && c.fonteAtiva ? txt(salarioDaFonte(salarios, c.fonteAtiva)) : null,
    adicional: c.adicionalTipo === 'PERICULOSIDADE' ? { tipo: 'PERICULOSIDADE' } : c.adicionalTipo === 'INSALUBRIDADE' && c.adicionalGrau ? { tipo: 'INSALUBRIDADE', grau: c.adicionalGrau } : null,
    desvioDeMercado: salarios ? desvioDeMercado(salarios) : null,
    salariosIlegiveis: lidos?.ilegiveis ?? [],
    ativo: c.ativo,
    versao: c.versao,
    lotacao: c.vinculoFuncional
      ? { id: c.vinculoFuncional.id, rotulo: c.vinculoFuncional.nome, ativa: c.vinculoFuncional.ativa }
      : null,
    pendenteAlocacao: c.ativo && (c.vinculoFuncional === null || !c.vinculoFuncional.ativa),
  };
}

// R24: o CONSULTA leva os códigos dos cargos lidos, nunca os valores.
async function registrarConsulta(cliente: PrismaClient, ctx: ContextoRequisicao, registroId: string, descricao: string, codigos: readonly string[]): Promise<void> {
  await cliente.$transaction((tx) =>
    auditar(tx, { contexto: contextoDe(ctx), funcionalidade: 'cad.salarios', tipo: 'CONSULTA', registroId, descricao, depois: { cargos: codigos } }),
  );
}

/** cad.cargos:consultar. Sem cad.salarios, mascarado. Com ela, um CONSULTA no Histórico (sem os valores). */
export async function listarCargos(ctx: ContextoRequisicao, deps: Deps = {}): Promise<readonly CargoTela[]> {
  exigir(ctx, 'cad.cargos', 'consultar');
  const cliente = deps.cliente ?? prisma;
  const cargos = await cliente.cargo.findMany({ select: SELECAO, orderBy: { codigo: 'asc' } });
  if (!veSalarios(ctx)) return cargos.map((c) => paraTela(c, null));
  const cifra = cifraPreguicosa(deps);
  const tela = cargos.map((c) => paraTela(c, salariosDe(c, cifra)));
  await registrarConsulta(cliente, ctx, '*', `Salários de ${cargos.length} ${cargos.length === 1 ? 'cargo consultado' : 'cargos consultados'} sem máscara`, cargos.map((c) => c.codigo));
  return tela;
}

/** Um cargo, ou null. Sem máscara só com cad.salarios, auditado com o código do cargo. */
export async function obterCargo(ctx: ContextoRequisicao, id: string, deps: Deps = {}): Promise<CargoTela | null> {
  exigir(ctx, 'cad.cargos', 'consultar');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const cliente = deps.cliente ?? prisma;
  const c = await cliente.cargo.findUnique({ where: { id }, select: SELECAO });
  if (!c) return null;
  if (!veSalarios(ctx)) return paraTela(c, null);
  const tela = paraTela(c, salariosDe(c, cifraPreguicosa(deps)));
  await registrarConsulta(cliente, ctx, c.codigo, `Salários do cargo ${c.codigo} consultados sem máscara`, [c.codigo]);
  return tela;
}

// ---- Alteração dos campos manuais ----

/** O que a tela manda. Os salários (FG e definido) só vêm de quem tem cad.salarios; ausentes, ficam como estão. */
export type EntradaCargo = {
  mercadoMinimo: string | null;
  mercadoMaximo: string | null;
  periculosidade: boolean;
  insalubridade: GrauInsalubridade | null;
  fonteAtiva: FonteAtiva | null;
  funcaoGratificada?: string | null | undefined;
  salarioDefinido?: string | null | undefined;
};

// Campos de ORIGEM BLINDADA (spec §5, M4): os do Rubi, os de controle e os cifrados por nome de coluna.
const CAMPOS_ORIGEM_BLINDADA = [
  'codigo',
  'nomeOficial',
  'nomeMercado',
  'tabelaSalarialCodigo',
  'tabelaSalarialDescricao',
  'faixaCodigo',
  'faixaDescricao',
  'nivelCodigo',
  'nivelDescricao',
  'salarioReal',
  'salarioRealCifrado',
  'funcaoGratificadaCifrada',
  'salarioDefinidoCifrado',
  'ativo',
  'cargaId',
  'origemMercado',
  'origemMercadoRotulo',
  'id',
  'criadoEm',
  'atualizadoEm',
] as const;

/** M-n4: confere o pedido bruto antes do parse; com campo blindado, audita e lança cad.violacao_governanca. */
export async function conferirOrigemBlindadaCargo(ctx: ContextoRequisicao, bruto: unknown, deps: Deps = {}): Promise<void> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return;
  const achados = CAMPOS_ORIGEM_BLINDADA.filter((c) => Object.hasOwn(bruto, c));
  if (achados.length === 0) return;
  const idCargo = (bruto as { idCargo?: unknown }).idCargo;
  await (deps.cliente ?? prisma).$transaction((tx) =>
    auditar(tx, {
      contexto: contextoDe(ctx),
      funcionalidade: 'cad.cargos',
      tipo: 'SISTEMA',
      registroId: typeof idCargo === 'string' ? idCargo.slice(0, 36) : 'cargo',
      descricao: 'cad.violacao_governanca: campo de origem blindada no pedido',
      depois: { campos: achados },
    }),
  );
  throw new ErroDominio('cad.violacao_governanca', 'O pedido tem campos que não podem ser alterados pela tela.', { campos: achados });
}

const MSG_SMN = 'Cadastre o Salário Mínimo Nacional do exercício antes de usar insalubridade.';

/** Envelope novo só quando o valor muda (R7): sem mudança, o mesmo envelope; vazio, null. */
function regravar(cifra: CifraSalarios, atual: string | null, novo: Dinheiro | null, codigoCargo: string, campo: CampoCifrado): string | null {
  if (novo === null) return null;
  if (atual !== null) {
    try {
      if (cifra.decifrar(atual, { codigoCargo, campo }).comparar(novo) === 0) return atual;
    } catch {
      // Envelope que não volta: grava o novo.
    }
  }
  return cifra.cifrar(novo, { codigoCargo, campo });
}

/** Altera os campos manuais (cad.cargos:alterar). Versão do cargo contra escrita concorrente. */
export async function alterarCargo(ctx: ContextoRequisicao, id: string, versao: number, dados: EntradaCargo, deps: Deps = {}): Promise<Resultado<{ versao: number }>> {
  exigir(ctx, 'cad.cargos', 'alterar');
  const cliente = deps.cliente ?? prisma;
  const erros: ErroCampo[] = [];
  const m = validarMercadoCargo(dados);
  if (!m.ok) erros.push(...m.erros);
  if (dados.fonteAtiva !== null && !(FONTES_ATIVAS as readonly string[]).includes(dados.fonteAtiva)) erros.push({ campo: 'fonteAtiva', mensagem: 'Fonte ativa inválida.' });
  // Os campos de mercado e os salários são todos sensíveis (R24): sem vê-los, não há como alterar o cargo
  // sem apagar o que não se vê. Os perfis do plano já casam as duas permissões (Analista GRH).
  // Negação auditada (403 pela definirAcao), como as outras escritas sem permissão (M4).
  exigir(ctx, 'cad.salarios', 'consultar');
  const mexeSalario = dados.funcaoGratificada !== undefined || dados.salarioDefinido !== undefined;
  const fg = dados.funcaoGratificada === undefined ? undefined : dinheiroDoTexto(dados.funcaoGratificada);
  const definido = dados.salarioDefinido === undefined ? undefined : dinheiroDoTexto(dados.salarioDefinido);
  // I9: as mensagens dos salários não repetem o valor.
  if (fg === 'invalido') erros.push({ campo: 'funcaoGratificada', mensagem: 'Informe o valor com até 2 casas decimais.' });
  if (definido === 'invalido') erros.push({ campo: 'salarioDefinido', mensagem: 'Informe o valor com até 2 casas decimais.' });
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(versao) || versao < 1) erros.push({ campo: '_', mensagem: 'Cargo ou versão inválidos. Recarregue a tela.' });
  if (erros.length > 0 || !m.ok) return falha(erros);

  try {
    return await cliente.$transaction(async (tx: TxCliente) => {
      // E6: insalubridade sobre o SMN do exercício mais recente.
      if (m.valor.adicional?.tipo === 'INSALUBRIDADE') {
        const smn = await tx.parametrosExercicio.findFirst({ orderBy: { ano: 'desc' }, select: { salarioMinimo: true } });
        if (!smn?.salarioMinimo) return falha([{ campo: 'adicional', mensagem: MSG_SMN }]);
      }
      const antes = await tx.cargo.findUnique({ where: { id }, select: SELECAO });
      if (!antes) return falha([{ campo: '_', mensagem: 'Cargo não encontrado. Recarregue a tela.' }]);
      const cifra = mexeSalario ? (deps.cifra ?? criarCifraSalarios()) : null;
      const fgEnvelope = cifra && fg !== undefined ? regravar(cifra, antes.funcaoGratificadaCifrada, fg as Dinheiro | null, antes.codigo, 'funcao_gratificada') : antes.funcaoGratificadaCifrada;
      const defEnvelope = cifra && definido !== undefined ? regravar(cifra, antes.salarioDefinidoCifrado, definido as Dinheiro | null, antes.codigo, 'salario_definido') : antes.salarioDefinidoCifrado;
      const mercadoMudou =
        (antes.mercadoMinimo?.toFixed(2) ?? null) !== (m.valor.mercadoMinimo?.paraString() ?? null) ||
        (antes.mercadoMaximo?.toFixed(2) ?? null) !== (m.valor.mercadoMaximo?.paraString() ?? null);
      const depois = {
        mercadoMinimo: m.valor.mercadoMinimo?.paraString() ?? null,
        mercadoMaximo: m.valor.mercadoMaximo?.paraString() ?? null,
        fonteAtiva: dados.fonteAtiva,
        adicionalTipo: m.valor.adicional?.tipo ?? null,
        adicionalGrau: m.valor.adicional?.tipo === 'INSALUBRIDADE' ? m.valor.adicional.grau : null,
        funcaoGratificadaCifrada: fgEnvelope,
        salarioDefinidoCifrado: defEnvelope,
        // A edição manual do mercado troca a origem (REQ_TAB_005; a cópia da tabela salarial é da 12c).
        ...(mercadoMudou ? { origemMercado: 'MANUAL', origemMercadoRotulo: 'Editado manualmente' } : {}),
      };
      const r = await tx.cargo.updateMany({ where: { id, versao }, data: { ...depois, versao: { increment: 1 } } });
      if (r.count === 0) return falha([{ campo: '_', mensagem: MSG_CONCORRENCIA }]);
      // O Histórico leva os envelopes, nunca os valores (R7).
      await auditar(tx, {
        contexto: contextoDe(ctx),
        funcionalidade: 'cad.cargos',
        tipo: 'ALTERACAO',
        registroId: antes.codigo,
        descricao: `Cargo ${antes.codigo} alterado`,
        antes: {
          mercadoMinimo: antes.mercadoMinimo?.toFixed(2) ?? null,
          mercadoMaximo: antes.mercadoMaximo?.toFixed(2) ?? null,
          fonteAtiva: antes.fonteAtiva,
          adicionalTipo: antes.adicionalTipo,
          adicionalGrau: antes.adicionalGrau,
          funcaoGratificadaCifrada: antes.funcaoGratificadaCifrada,
          salarioDefinidoCifrado: antes.salarioDefinidoCifrado,
        },
        depois,
      });
      return ok({ versao: versao + 1 });
    });
  } catch (e) {
    if (e instanceof ErroDominio && ['cad.cifra_indisponivel', 'cad.cifra_invalida', 'cad.salario_invalido'].includes(e.codigo)) return falha([{ campo: '_', mensagem: e.message }]);
    throw e;
  }
}

// ---- Regravação com a chave atual (I7) ----

const EM_ANDAMENTO = 'Já existe uma carga de cargos em andamento. Tente de novo em instantes.';

/**
 * Regrava os envelopes com a chave atual (cad.cargos:executar): os manuais direto, pelo app, só onde o
 * envelope ainda é o lido (otimista); o salário real, coluna do sgo_sync, por um lote CARGOS_RECIFRA
 * que o worker aplica só onde o envelope atual ainda é o antigo. Sem envelope antigo, nada a fazer.
 */
export async function regravarCifraSalarios(ctx: ContextoRequisicao, deps: Deps = {}): Promise<Resultado<{ manuais: number; cargaId: string | null }>> {
  exigir(ctx, 'cad.cargos', 'executar');
  const cliente = deps.cliente ?? prisma;
  const cifra = deps.cifra ?? criarCifraSalarios();
  // Com uma carga de cargos em andamento, nada começa: senão os manuais seriam regravados e o lote não.
  if (await cliente.cargaEstrutura.count({ where: { grupo: 'CARGOS', situacao: { in: ['PENDENTE', 'PROCESSANDO'] } } })) {
    return falha([{ campo: '_', mensagem: EM_ANDAMENTO }]);
  }
  const atual = `v1:${cifra.idChaveAtual()}:`;
  const antigo = (e: string | null): e is string => e !== null && !e.startsWith(atual);
  const cargos = await cliente.cargo.findMany({ select: { id: true, codigo: true, salarioRealCifrado: true, funcaoGratificadaCifrada: true, salarioDefinidoCifrado: true } });
  const contexto = contextoDe(ctx);

  // Envelope que não volta: o cargo fica de fora (log só do código e do campo, I9), e o resto segue.
  const recifrar = (envelope: string, codigoCargo: string, campo: CampoCifrado): string | null => {
    try {
      return cifra.cifrar(cifra.decifrar(envelope, { codigoCargo, campo }), { codigoCargo, campo });
    } catch {
      console.error('[CIFRA_SALARIOS_ILEGIVEL]', { codigoCargo, campo });
      return null;
    }
  };
  let manuais = 0;
  for (const c of cargos) {
    const fg = antigo(c.funcaoGratificadaCifrada) ? recifrar(c.funcaoGratificadaCifrada, c.codigo, 'funcao_gratificada') : null;
    const def = antigo(c.salarioDefinidoCifrado) ? recifrar(c.salarioDefinidoCifrado, c.codigo, 'salario_definido') : null;
    if (!fg && !def) continue;
    await cliente.$transaction(async (tx) => {
      // Otimista e por coluna: a coluna alterada no meio (envelope já diferente do lido) não é
      // sobrescrita, e a outra segue.
      const fgOk = fg ? (await tx.cargo.updateMany({ where: { id: c.id, funcaoGratificadaCifrada: c.funcaoGratificadaCifrada }, data: { funcaoGratificadaCifrada: fg } })).count > 0 : false;
      const defOk = def ? (await tx.cargo.updateMany({ where: { id: c.id, salarioDefinidoCifrado: c.salarioDefinidoCifrado }, data: { salarioDefinidoCifrado: def } })).count > 0 : false;
      if (!fgOk && !defOk) return;
      await tx.cargo.update({ where: { id: c.id }, data: { versao: { increment: 1 } } });
      manuais++;
      // Os envelopes, nunca os valores (R7).
      await auditar(tx, {
        contexto,
        funcionalidade: 'cad.cargos',
        tipo: 'ALTERACAO',
        registroId: c.codigo,
        descricao: `Salários do cargo ${c.codigo} regravados com a chave atual`,
        antes: { funcaoGratificadaCifrada: c.funcaoGratificadaCifrada, salarioDefinidoCifrado: c.salarioDefinidoCifrado },
        depois: { funcaoGratificadaCifrada: fgOk ? fg : c.funcaoGratificadaCifrada, salarioDefinidoCifrado: defOk ? def : c.salarioDefinidoCifrado },
      });
    });
  }

  const linhas = cargos
    .filter((c) => antigo(c.salarioRealCifrado))
    .map((c) => ({ codigo: c.codigo, envelopeAntigo: c.salarioRealCifrado as string, envelopeNovo: recifrar(c.salarioRealCifrado as string, c.codigo, 'salario_real') }))
    .filter((l): l is { codigo: string; envelopeAntigo: string; envelopeNovo: string } => l.envelopeNovo !== null)
    .map((l, i) => ({ linha: i + 1, ...l }));
  if (linhas.length === 0) return ok({ manuais, cargaId: null });
  const cargaId = randomUUID();
  try {
    await cliente.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "carga_estrutura" ("id", "tipo", "arquivo_nome", "arquivo_sha256", "linhas", "contexto_auditoria")
        VALUES (${cargaId}::uuid, 'CARGOS_RECIFRA', 'Regravação dos salários com a chave atual', ${createHash('sha256').update(cifra.idChaveAtual()).digest('hex')},
          ${linhas.length}, ${JSON.stringify(contexto)}::jsonb)`;
      await tx.cargaEstruturaLinha.createMany({ data: linhas.map((l) => ({ cargaId, numero: l.linha, dados: l as unknown as Prisma.InputJsonValue })) });
      await auditar(tx, { contexto, funcionalidade: 'cad.cargos', tipo: 'INSERCAO', registroId: cargaId, descricao: 'Regravação dos salários com a chave atual solicitada', depois: { linhas: linhas.length } });
    });
  } catch (e) {
    // Uma carga entrou entre a conferência e o lote: os manuais já foram regravados; o salário real
    // fica para a próxima rodada (regravar com a chave atual é inofensivo).
    if (e instanceof Prisma.PrismaClientKnownRequestError && JSON.stringify(e.meta ?? {}).concat(e.message).includes('carga_estrutura_grupo_andamento_key')) {
      return ok({ manuais, cargaId: null });
    }
    throw e;
  }
  return ok({ manuais, cargaId });
}
