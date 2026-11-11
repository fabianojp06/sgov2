import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import type { CustoCargoTela } from '../domain/cargo-tela';
import type { SerieMensalComponentes } from '../domain/custo-pessoal';
import { calcularCustoPosicao, calcularEncargo } from '../domain/motor-custo-pessoal';
import type { CifraSalarios } from '../infrastructure/cifra-salarios';
import { salarioFonteAtiva } from '../infrastructure/fonte-ativa';
import { obterPremissasExercicio } from '../infrastructure/premissas';

// Custo unitário mensal do cargo no exercício (US-051 parte 2; plano do P4, Task 14): 1 pessoa, de
// janeiro a dezembro, com a Fonte Ativa, o adicional e os benefícios do cargo (Task 13), pelo
// MotorCustoPessoal (C2). Sem cad.salarios, tudo mascarado (R24); com ela, um CONSULTA no Histórico.

type Deps = { cliente?: PrismaClient; cifra?: CifraSalarios };

export const MSG_SEM_FONTE = 'Selecione a Fonte Ativa para calcular o custo.';

export type CustoCargo = {
  serie: SerieMensalComponentes | null;
  encargo: ReturnType<typeof calcularEncargo> | null;
  /** Base do encargo no mês 1: Fonte Ativa + adicional (RN_CAR_17). */
  base: Dinheiro | null;
  /** Nome e percentual de cada encargo do exercício, para o detalhe. */
  encargos: readonly { componente: string; nome: string; percentual: Percentual }[];
  /** Nome de cada componente da série (encargos e benefícios), para os rótulos. */
  nomes: ReadonlyMap<string, string>;
  /** Avisos das premissas (ex.: benefício ativo sem valor), para a tela. */
  avisos: readonly string[];
  mascarado: boolean;
};

/** Os dados do bloco do custo para a tela (texto); sem cad.salarios, só `mascarado`. */
export function paraTelaCusto(r: Resultado<CustoCargo>): CustoCargoTela {
  if (!r.ok) return { mascarado: false, erro: r.erros.map((e) => e.mensagem).join(' ') };
  const c = r.valor;
  if (c.mascarado || !c.serie || !c.encargo || !c.base) return { mascarado: true };
  const porComponente = new Map(c.encargo.componentes.map((x) => [x.componente, x.valor]));
  const soma = c.encargos.reduce((t, e) => t.plus(e.percentual.comoFracao()), Percentual.dePontos('0').comoFracao());
  return {
    mascarado: false,
    base: c.base.paraString(),
    encargoTotal: c.encargo.total.paraString(),
    percentualTotal: Percentual.dePontos(soma.times(100)).formatar(),
    componentes: c.encargos.map((e) => ({ nome: e.nome, percentual: e.percentual.formatar(), valor: (porComponente.get(e.componente as never) ?? Dinheiro.zero()).paraString() })),
    totalMes1: c.serie.totalMes[0]?.paraString() ?? '0.00',
    totalAno: c.serie.total.paraString(),
    linhasMes1: c.serie.linhas.map((l) => ({ componente: l.componente, nome: c.nomes.get(l.componente) ?? null, valor: l.meses[0]?.paraString() ?? '0.00' })),
    avisos: c.avisos,
  };
}

const decimal = (d: { toFixed(n: number): string } | null) => (d === null ? null : Dinheiro.de(d.toFixed(2)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function calcularCustoCargo(ctx: ContextoRequisicao, cargoId: string, ano: number, deps: Deps = {}): Promise<Resultado<CustoCargo>> {
  exigir(ctx, 'cad.cargos', 'consultar');
  if (!ctx.permissoes.has('cad.salarios:consultar')) return ok({ serie: null, encargo: null, base: null, encargos: [], nomes: new Map(), avisos: [], mascarado: true });
  if (!UUID.test(cargoId) || !Number.isInteger(ano)) return falha([{ campo: '_', mensagem: 'Cargo ou exercício inválidos. Recarregue a tela.' }]);
  const cliente = deps.cliente ?? prisma;
  // Cargo, benefícios e premissas na mesma transação: a escolha e a Tabela Mestre do mesmo instante.
  return cliente.$transaction(async (tx) => {
    const c = await tx.cargo.findUnique({
      where: { id: cargoId },
      select: {
        codigo: true,
        fonteAtiva: true,
        mercadoMinimo: true,
        mercadoMaximo: true,
        salarioRealCifrado: true,
        funcaoGratificadaCifrada: true,
        salarioDefinidoCifrado: true,
        adicionalTipo: true,
        adicionalGrau: true,
        beneficios: { where: { ano }, select: { codigo: true, ativo: true, valorManual: true } },
      },
    });
    if (!c) return falha([{ campo: '_', mensagem: 'Cargo não encontrado. Recarregue a tela.' }]);
    if (!c.fonteAtiva) return falha([{ campo: 'fonteAtiva', mensagem: MSG_SEM_FONTE }]);

    // Só decifra o que a fonte usa (o envelope ilegível de outro campo não impede o cálculo).
    let fonte: Dinheiro | null;
    try {
      fonte = salarioFonteAtiva(c, deps.cifra ?? null);
    } catch (e) {
      // Envelope ilegível ou sem a chave: mensagem na tela, nunca erro (spec §5).
      if (e instanceof ErroDominio && ['cad.cifra_invalida', 'cad.cifra_indisponivel'].includes(e.codigo)) return falha([{ campo: '_', mensagem: e.message }]);
      throw e;
    }
    if (fonte === null) return falha([{ campo: 'fonteAtiva', mensagem: 'A Fonte Ativa escolhida está sem valor neste cargo.' }]);

    const escolha = new Map(c.beneficios.map((b) => [b.codigo, { ativo: b.ativo, valorManual: decimal(b.valorManual) }]));
    const premissas = await obterPremissasExercicio(tx, ano, escolha);
    if (!premissas) return falha([{ campo: '_', mensagem: `O exercício ${ano} não tem parâmetros.` }]);
    const adicional =
      c.adicionalTipo === 'PERICULOSIDADE' ? { tipo: 'PERICULOSIDADE' as const } : c.adicionalTipo === 'INSALUBRIDADE' && c.adicionalGrau ? { tipo: 'INSALUBRIDADE' as const, grau: c.adicionalGrau } : undefined;
    const r = calcularCustoPosicao({ quantidade: 1, salarioMensal: fonte, mesInicio: 1, mesSaida: 12, ...(adicional ? { adicional } : {}) }, premissas);
    if (!r.ok) return r;
    // UC03.19 §6.1 e REQ_CAR_013: Base_Encargo = Fonte Ativa + adicional (o exemplo 6.500,00 → 3.315,00).
    // A série tem também o encargo sobre férias e 13º provisionados (C33): o bloco mostra os dois, com rótulos distintos.
    const mes1 = (componente: string) => r.valor.linhas.find((l) => l.componente === componente)?.meses[0] ?? Dinheiro.zero();
    const base = mes1('salario').somar(mes1('adicional'));
    await auditar(tx, {
      contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
      funcionalidade: 'cad.salarios',
      tipo: 'CONSULTA',
      registroId: c.codigo,
      descricao: `Custo do cargo ${c.codigo} em ${ano} consultado sem máscara`,
      depois: { cargos: [c.codigo], ano },
    });
    const nomes = new Map<string, string>([...premissas.encargos.map((e) => [e.componente, e.nome] as const), ...premissas.beneficios.map((b) => [b.componente, b.nome] as const)]);
    return ok({ serie: r.valor, encargo: calcularEncargo(base, premissas.encargos), base, encargos: premissas.encargos, nomes, avisos: premissas.avisos, mascarado: false });
  });
}
