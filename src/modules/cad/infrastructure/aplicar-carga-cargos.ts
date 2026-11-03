import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import type { AdicionalTrabalhista, FonteAtiva as FonteAtivaBanco, GrauInsalubridade as GrauBanco } from '@/generated/prisma/enums';
import type { FonteAtiva, GrauInsalubridade, MercadoCargoValidado } from '../domain/cargo';
import type { LinhaCargoValidada } from '../domain/cargo';
import type { ResultadoCarga } from './aplicar-carga';

// Merge da carga de cargos do Rubi (plano do P4, Task 12a; R6, R20): só as colunas de origem Rubi e de
// controle, como o sgo_sync tem por coluna (m2). O casamento é pelo código; o cargo que saiu do
// arquivo fica inativo; os campos manuais nunca são tocados. O salário real chega cifrado pelo app
// (R7): o worker só copia o envelope, e o Histórico leva o envelope, nunca o valor.

// Os enums do banco e os do domínio têm de ser os mesmos: uma mudança de um lado sem o outro não compila.
type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _enunsIguais: [Igual<FonteAtivaBanco, FonteAtiva>, Igual<GrauBanco, GrauInsalubridade>, Igual<AdicionalTrabalhista, NonNullable<MercadoCargoValidado['adicional']>['tipo']>] = [
  true,
  true,
  true,
];
void _enunsIguais;

/** Linha do staging dos cargos: a saída do domínio com o salário já cifrado. */
export type LinhaCargoStaging = Omit<LinhaCargoValidada, 'salarioReal'> & { salarioRealCifrado: string | null };

/** A linha validada como vai ao staging: o salário em claro sai, e entra o envelope (ou nada). */
export function paraStaging(c: LinhaCargoValidada, salarioRealCifrado: string | null): LinhaCargoStaging {
  return {
    linha: c.linha,
    codigo: c.codigo,
    nomeOficial: c.nomeOficial,
    nomeMercado: c.nomeMercado,
    tabelaSalarialCodigo: c.tabelaSalarialCodigo,
    tabelaSalarialDescricao: c.tabelaSalarialDescricao,
    faixaCodigo: c.faixaCodigo,
    faixaDescricao: c.faixaDescricao,
    nivelCodigo: c.nivelCodigo,
    nivelDescricao: c.nivelDescricao,
    salarioRealCifrado,
  };
}

export const CAMPOS_RUBI = [
  'nomeOficial',
  'nomeMercado',
  'tabelaSalarialCodigo',
  'tabelaSalarialDescricao',
  'faixaCodigo',
  'faixaDescricao',
  'nivelCodigo',
  'nivelDescricao',
  'salarioRealCifrado',
] as const;

type CargoRubi = { [K in (typeof CAMPOS_RUBI)[number]]: K extends 'nomeOficial' ? string : string | null };

const rubi = (l: CargoRubi): CargoRubi => Object.fromEntries(CAMPOS_RUBI.map((k) => [k, l[k]])) as CargoRubi;

export async function aplicarCargaCargos(
  tx: TxCliente,
  contexto: ContextoAuditoria,
  carga: { id: string },
  linhas: readonly LinhaCargoStaging[],
): Promise<ResultadoCarga> {
  const banco = await tx.cargo.findMany({
    select: {
      id: true,
      codigo: true,
      ativo: true,
      nomeOficial: true,
      nomeMercado: true,
      tabelaSalarialCodigo: true,
      tabelaSalarialDescricao: true,
      faixaCodigo: true,
      faixaDescricao: true,
      nivelCodigo: true,
      nivelDescricao: true,
      salarioRealCifrado: true,
    },
  });
  const porCodigo = new Map(banco.map((c) => [c.codigo, c]));
  const noArquivo = new Set(linhas.map((l) => l.codigo));
  const origem = contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO';
  const funcionalidade = 'cad.cargos';
  let incluidas = 0;
  let alteradas = 0;
  let inativadas = 0;
  let inalteradas = 0;

  for (const l of linhas) {
    const depois = rubi(l);
    const antes = porCodigo.get(l.codigo);
    if (!antes) {
      await tx.cargo.create({ data: { codigo: l.codigo, ...depois, ativo: true, versao: 1, cargaId: carga.id } });
      incluidas++;
      await auditar(tx, { contexto, origem, funcionalidade, tipo: 'INSERCAO', registroId: l.codigo, descricao: `Cargo ${l.codigo} incluído pela carga`, depois });
      continue;
    }
    const mudou = !antes.ativo || CAMPOS_RUBI.some((k) => antes[k] !== depois[k]);
    if (!mudou) {
      inalteradas++;
      continue;
    }
    alteradas++;
    // A versão sobe no banco (increment), não a partir da leitura: uma gravação manual no meio não se perde.
    await tx.cargo.update({ where: { id: antes.id }, data: { ...depois, ativo: true, versao: { increment: 1 }, cargaId: carga.id } });
    await auditar(tx, {
      contexto,
      origem,
      funcionalidade,
      tipo: 'ALTERACAO',
      registroId: l.codigo,
      descricao: antes.ativo ? `Cargo ${l.codigo} alterado pela carga` : `Cargo ${l.codigo} reativado pela carga`,
      antes: { ativo: antes.ativo, ...rubi(antes) },
      depois: { ativo: true, ...depois },
    });
  }

  for (const antes of porCodigo.values()) {
    if (noArquivo.has(antes.codigo) || !antes.ativo) continue;
    inativadas++;
    await tx.cargo.update({ where: { id: antes.id }, data: { ativo: false, versao: { increment: 1 }, cargaId: carga.id } });
    await auditar(tx, {
      contexto,
      origem,
      funcionalidade,
      tipo: 'ALTERACAO',
      registroId: antes.codigo,
      descricao: `Cargo ${antes.codigo} inativado pela carga (fora do arquivo)`,
      antes: { ativo: true },
      depois: { ativo: false },
    });
  }
  return { incluidas, alteradas, inativadas, inalteradas, avisos: [] };
}
