import { Dinheiro } from '@/shared/kernel';
import type { TxCliente } from '@/shared/db';
import { criarCifraSalarios, type CifraSalarios } from './cifra-salarios';

// Resumo dos cadastros para a conferência da carga inicial (plano do P7, Task 2; US-115): contagens
// e totais que a GFIN confere contra as planilhas de origem. Só leitura. A soma dos salários reais
// só é decifrada com `salarios: true` (quem chama confere cad.salarios:consultar, R24).

export type ContagemNivel = { nivel: number; ativos: number; inativos: number; analiticosAtivos: number };

export type ResumoCadastros = {
  contas: readonly ContagemNivel[];
  centrosCusto: readonly ContagemNivel[];
  centrosCustoProvisorios: number;
  // salariosIlegiveis: envelopes que não decifram (chave trocada, AAD de outro cargo); ficam fora da soma.
  cargos: { ativos: number; inativos: number; comSalarioReal: number; somaSalarioReal: string | null; salariosIlegiveis: number };
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

/** Exercícios com parâmetros, do mais recente para o mais antigo. */
export async function listarAnosExercicio(tx: TxCliente): Promise<number[]> {
  return (await tx.parametrosExercicio.findMany({ select: { ano: true }, orderBy: { ano: 'desc' } })).map((p) => p.ano);
}

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

export async function resumirCadastros(
  tx: TxCliente,
  ano: number,
  opcoes: { salarios: boolean; cifra?: CifraSalarios },
): Promise<ResumoCadastros> {
  const contas = await tx.$queryRaw<Linha[]>`
    SELECT "nivel"::int AS nivel, "ativa" AS ativo, ("tipo" = 'ANALITICA') AS analitico, count(*) AS quantidade
    FROM "conta_contabil" GROUP BY 1, 2, 3`;
  const centros = await tx.$queryRaw<Linha[]>`
    SELECT "nivel"::int AS nivel, "ativo" AS ativo, "aceita_lancamento" AS analitico, count(*) AS quantidade
    FROM "centro_custo" GROUP BY 1, 2, 3`;
  const centrosCustoProvisorios = await tx.centroCusto.count({ where: { ativo: true, provisorio: true } });

  const cargos = await tx.cargo.findMany({ select: { codigo: true, ativo: true, salarioRealCifrado: true } });
  const ativos = cargos.filter((c) => c.ativo);
  const comSalario = ativos.filter((c) => c.salarioRealCifrado !== null);
  let somaSalarioReal: string | null = null;
  let salariosIlegiveis = 0;
  if (opcoes.salarios) {
    const cifra = opcoes.cifra ?? criarCifraSalarios();
    let soma = Dinheiro.zero();
    for (const c of comSalario) {
      try {
        soma = soma.somar(cifra.decifrar(c.salarioRealCifrado!, { codigoCargo: c.codigo, campo: 'salario_real' }));
      } catch {
        salariosIlegiveis++;
      }
    }
    somaSalarioReal = soma.paraString();
  }

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
  const beneficiosCargoAtivos = p ? await tx.beneficioCargo.count({ where: { ano, ativo: true, cargo: { ativo: true } } }) : 0;

  return {
    contas: porNivel(contas),
    centrosCusto: porNivel(centros),
    centrosCustoProvisorios,
    cargos: { ativos: ativos.length, inativos: cargos.length - ativos.length, comSalarioReal: comSalario.length, somaSalarioReal, salariosIlegiveis },
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
