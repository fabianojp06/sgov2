import type { TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio } from '@/shared/kernel';

// Resumo dos cadastros para a conferência da carga inicial (plano do P7, Task 2; US-115): contagens
// e totais que a GFIN confere contra as planilhas de origem. Só leitura. Sem cifra própria: quem
// quer a soma dos salários passa o `decifrar` (cad/application/conferencia-cadastros.ts confere
// cad.salarios e audita, R24). Sem import de server-only, como todo o servidor.ts do cad.

export type ContagemNivel = { nivel: number; ativos: number; inativos: number; analiticosAtivos: number };

// soma: 'oculta' sem a permissão; 'indisponivel' sem a chave de cifra (nunca 0,00 por engano).
// ilegiveis: envelopes que não decifram (AAD de outro cargo, chave antiga removida), fora da soma.
export type SomaSalarios = { situacao: 'oculta' } | { situacao: 'indisponivel' } | { situacao: 'calculada'; total: string; ilegiveis: number };

export type ResumoCadastros = {
  contas: readonly ContagemNivel[];
  centrosCusto: readonly ContagemNivel[];
  centrosCustoProvisorios: number;
  cargos: { ativos: number; inativos: number; comSalarioReal: number; somaSalarioReal: SomaSalarios };
  faixasSalariaisAtivas: number;
  exercicio: {
    ano: number;
    provisorio: boolean;
    congelado: boolean;
    salarioMinimo: string | null;
    encargos: number;
    beneficiosAtivos: number;
    beneficiosCargoAtivos: number;
  } | null;
};

export type DecifrarSalarioReal = (codigoCargo: string, envelope: string) => Dinheiro;

type Linha = { nivel: number; ativo: boolean; analitico: boolean; quantidade: bigint };

function porNivel(linhas: readonly Linha[]): ContagemNivel[] {
  const mapa = new Map<number, ContagemNivel>();
  for (const l of linhas) {
    const c = mapa.get(l.nivel) ?? { nivel: l.nivel, ativos: 0, inativos: 0, analiticosAtivos: 0 };
    const q = Number(l.quantidade);
    if (l.ativo) c.ativos += q;
    else c.inativos += q;
    if (l.ativo && l.analitico) c.analiticosAtivos += q;
    mapa.set(l.nivel, c);
  }
  return [...mapa.values()].sort((a, b) => a.nivel - b.nivel);
}

function somar(cargos: readonly { codigo: string; salarioRealCifrado: string | null }[], decifrar: DecifrarSalarioReal): SomaSalarios {
  let total = Dinheiro.zero();
  let ilegiveis = 0;
  for (const c of cargos) {
    try {
      total = total.somar(decifrar(c.codigo, c.salarioRealCifrado!));
    } catch (e) {
      // Sem a chave, nenhum envelope decifra: a soma inteira fica indisponível.
      if (e instanceof ErroDominio && e.codigo === 'cad.cifra_indisponivel') return { situacao: 'indisponivel' };
      ilegiveis++;
    }
  }
  return { situacao: 'calculada', total: total.paraString(), ilegiveis };
}

/** Exercícios com parâmetros, do mais recente para o mais antigo. */
export async function listarAnosExercicio(tx: TxCliente): Promise<number[]> {
  return (await tx.parametrosExercicio.findMany({ select: { ano: true }, orderBy: { ano: 'desc' } })).map((p) => p.ano);
}

export async function resumirCadastros(tx: TxCliente, ano: number, decifrar: DecifrarSalarioReal | null): Promise<ResumoCadastros> {
  const contas = await tx.$queryRaw<Linha[]>`
    SELECT "nivel"::int AS nivel, "ativa" AS ativo, ("tipo" = 'ANALITICA') AS analitico, count(*) AS quantidade
    FROM "conta_contabil" GROUP BY 1, 2, 3`;
  // Analítico de CC pelo tipo, a mesma regra do C1 (ehCentroCustoAnalitico).
  const centros = await tx.$queryRaw<Linha[]>`
    SELECT "nivel"::int AS nivel, "ativo" AS ativo, ("tipo" = 'ANALITICO') AS analitico, count(*) AS quantidade
    FROM "centro_custo" GROUP BY 1, 2, 3`;
  const centrosCustoProvisorios = await tx.centroCusto.count({ where: { ativo: true, provisorio: true } });

  const cargos = await tx.cargo.findMany({ select: { codigo: true, ativo: true, salarioRealCifrado: true } });
  const ativos = cargos.filter((c) => c.ativo);
  const comSalario = ativos.filter((c) => c.salarioRealCifrado !== null);

  const p = await tx.parametrosExercicio.findUnique({
    where: { ano },
    select: {
      ano: true,
      provisorio: true,
      congeladoEm: true,
      salarioMinimo: true,
      _count: { select: { encargos: true, beneficios: { where: { ativo: true } } } },
    },
  });
  // Benefício ativo no cargo ativo e ativo também na Tabela Mestre do ano.
  const beneficiosCargoAtivos = p ? await tx.beneficioCargo.count({ where: { ano, ativo: true, cargo: { ativo: true }, item: { ativo: true } } }) : 0;

  return {
    contas: porNivel(contas),
    centrosCusto: porNivel(centros),
    centrosCustoProvisorios,
    cargos: {
      ativos: ativos.length,
      inativos: cargos.length - ativos.length,
      comSalarioReal: comSalario.length,
      somaSalarioReal: decifrar ? somar(comSalario, decifrar) : { situacao: 'oculta' },
    },
    faixasSalariaisAtivas: await tx.faixaSalarial.count({ where: { ativa: true, cargo: { ativo: true } } }),
    exercicio: p
      ? {
          ano: p.ano,
          provisorio: p.provisorio,
          congelado: p.congeladoEm !== null,
          salarioMinimo: p.salarioMinimo === null ? null : p.salarioMinimo.toFixed(2),
          encargos: p._count.encargos,
          beneficiosAtivos: p._count.beneficios,
          beneficiosCargoAtivos,
        }
      : null,
  };
}
