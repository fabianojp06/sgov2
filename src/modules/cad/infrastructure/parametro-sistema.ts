import { auditar, type ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { COMPONENTES_FIXOS } from '../domain/custo-pessoal';
import { copiarBeneficiosCargoDoAno } from './beneficios-cargo';
import { criarTabelaMestreDoAno } from './beneficios-mestre';
import { ENCARGOS, COMPONENTES_COM_CONTA, type ParametrosExercicio } from '../domain/parametros';

// Parâmetros por exercício e do sistema, sem guarda (plano do P4, R10 e R22): usados pelos casos de
// uso (com exigir), pelo C2 real e pela seed. Sem @/shared/authz nem next/.

export const CHAVES_PARAMETRO_SISTEMA = ['instituicao.nome_exibicao', 'instituicao.logotipo'] as const;
export type ChaveParametroSistema = (typeof CHAVES_PARAMETRO_SISTEMA)[number];

export const MSG_CONCORRENCIA = 'Este registro foi alterado por outro usuário. Recarregue a tela.';

/** Valor do parâmetro do sistema; vazio se não cadastrado (spec §6.7: o nome nunca vem do código). */
export async function obterParametroSistema(tx: TxCliente, chave: ChaveParametroSistema): Promise<string> {
  const p = await tx.parametroSistema.findUnique({ where: { chave } });
  return p?.valor ?? '';
}

/**
 * Toda escrita em qualquer tabela do ano passa por aqui, na mesma transação (R10, I6): recusa ano
 * congelado e incrementa a versão. Com `versaoEsperada`, recusa a escrita concorrente.
 */
export async function tocarVersaoExercicio(tx: TxCliente, ano: number, versaoEsperada?: number): Promise<number> {
  const linhas = await tx.$queryRaw<{ versao: number }[]>`UPDATE "parametros_exercicio"
    SET "versao" = "versao" + 1, "atualizado_em" = clock_timestamp()
    WHERE "ano" = ${ano} AND "congelado_em" IS NULL AND (${versaoEsperada ?? null}::int IS NULL OR "versao" = ${versaoEsperada ?? null}::int)
    RETURNING "versao"`;
  if (linhas[0]) return linhas[0].versao;
  const atual = await tx.parametrosExercicio.findUnique({ where: { ano }, select: { congeladoEm: true } });
  if (!atual) throw new ErroDominio('cad.premissas_inexistentes', `O exercício ${ano} não tem parâmetros.`);
  if (atual.congeladoEm) throw new ErroDominio('cad.exercicio_congelado', `Os parâmetros de ${ano} estão congelados: o exercício foi oficializado.`);
  throw new ErroDominio('cad.concorrencia', MSG_CONCORRENCIA);
}

/** Lê os parâmetros completos do ano, ou null. */
export async function lerParametrosExercicio(tx: TxCliente, ano: number): Promise<ParametrosExercicio | null> {
  const p = await tx.parametrosExercicio.findUnique({ where: { ano }, include: { encargos: true, contas: true } });
  if (!p) return null;
  const pct = (d: { toString(): string }) => Percentual.dePontos(d.toString());
  const porComponente = new Map(p.contas.map((c) => [c.componente, c.conta]));
  return {
    ano: p.ano,
    versao: p.versao,
    congelado: p.congeladoEm !== null,
    provisorio: p.provisorio,
    reajuste: pct(p.reajuste),
    mesDataBase: p.mesDataBase,
    ipca: pct(p.ipca),
    salarioMinimo: p.salarioMinimo === null ? null : Dinheiro.de(p.salarioMinimo.toString()),
    diasUteisMes: p.diasUteisMes,
    semaforo: { verdeAte: pct(p.semaforoVerdeAte), amareloAte: pct(p.semaforoAmareloAte), laranjaAte: pct(p.semaforoLaranjaAte) },
    encargos: ENCARGOS.map((c) => {
      const e = p.encargos.find((x) => x.componente === c);
      if (!e) throw new ErroDominio('cad.parametros_incompletos', `O exercício ${ano} está sem o encargo ${c}.`);
      return { componente: c, nome: e.nome, percentual: pct(e.percentual), conta: e.conta };
    }),
    provisorios: [...p.encargos.filter((e) => e.provisorio).map((e) => e.componente), ...p.contas.filter((c) => c.provisorio).map((c) => c.componente)]
      .filter((c): c is ParametrosExercicio['provisorios'][number] => (COMPONENTES_FIXOS as readonly string[]).includes(c))
      .sort(),
    contas: Object.fromEntries(
      COMPONENTES_COM_CONTA.map((c) => {
        const conta = porComponente.get(c);
        if (conta === undefined) throw new ErroDominio('cad.parametros_incompletos', `O exercício ${ano} está sem a conta de ${c}.`);
        return [c, conta];
      }),
    ) as ParametrosExercicio['contas'],
  };
}

// Padrões provisórios (plano do P4, Task 9a; R14): as contas fora da §6.6 ficam marcadas provisórias.
const PADRAO = {
  reajuste: '5',
  mesDataBase: 5,
  ipca: '4',
  diasUteisMes: 22,
  semaforo: ['70', '85', '95'] as const,
  encargos: [
    { componente: 'encargo.inss', nome: 'INSS', percentual: '38', conta: '4.1.1.2.001', provisorio: false },
    { componente: 'encargo.fgts', nome: 'FGTS', percentual: '8', conta: '4.1.1.2.005', provisorio: false },
    { componente: 'encargo.pis', nome: 'PIS/PASEP', percentual: '1', conta: '4.1.1.2.008', provisorio: false },
    { componente: 'encargo.obrigacoes', nome: 'Obrigações Trabalhistas', percentual: '3.8', conta: '4.1.1.8.003', provisorio: true },
    { componente: 'encargo.riscos', nome: 'Riscos Trabalhistas', percentual: '0.2', conta: '4.1.1.8.004', provisorio: true },
  ],
  contas: [
    { componente: 'salario', conta: '4.1.1.1.001', provisorio: false },
    { componente: 'adicional', conta: '4.1.1.1.025', provisorio: true },
    { componente: 'ferias', conta: '4.1.1.1.003', provisorio: false },
    { componente: 'decimo_terceiro', conta: '4.1.1.1.005', provisorio: false },
  ],
};

/**
 * US-055: cria os parâmetros do ano copiando o último ano anterior (sem o congelamento), com a
 * Tabela Mestre e os benefícios dos cargos, ou, sem nenhum, os padrões provisórios. Idempotente: o ano que já existe fica como está. Auditado.
 */
export async function criarParametrosDoAno(tx: TxCliente, contexto: ContextoAuditoria, ano: number): Promise<boolean> {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) throw new ErroDominio('cad.ano_invalido', 'O exercício deve ser de 2000 a 2099.');
  // Trava por ano: duas chamadas concorrentes (duplo clique, frente A e seed) não colidem (C2: idempotente).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cad-exercicio'), ${ano}::int)`;
  if (await tx.parametrosExercicio.findUnique({ where: { ano }, select: { ano: true } })) return false;
  // A linha do ano-base fica presa (FOR SHARE) até o fim: parâmetros, Tabela Mestre e benefícios dos
  // cargos saem do mesmo instante. Toda escrita no ano-base começa pelo UPDATE dessa linha
  // (tocarVersaoExercicio) e espera; a ordem é a trava do ano novo e depois a linha do ano-base.
  await tx.$queryRaw`SELECT "ano" FROM "parametros_exercicio" WHERE "ano" < ${ano} ORDER BY "ano" DESC LIMIT 1 FOR SHARE`;
  const base = await tx.parametrosExercicio.findFirst({ where: { ano: { lt: ano } }, orderBy: { ano: 'desc' }, include: { encargos: true, contas: true } });
  if (base) {
    await tx.parametrosExercicio.create({
      data: {
        ano,
        reajuste: base.reajuste,
        mesDataBase: base.mesDataBase,
        ipca: base.ipca,
        salarioMinimo: base.salarioMinimo,
        diasUteisMes: base.diasUteisMes,
        semaforoVerdeAte: base.semaforoVerdeAte,
        semaforoAmareloAte: base.semaforoAmareloAte,
        semaforoLaranjaAte: base.semaforoLaranjaAte,
        provisorio: base.provisorio,
      },
    });
    await tx.encargoExercicio.createMany({
      data: base.encargos.map((e) => ({ ano, componente: e.componente, nome: e.nome, percentual: e.percentual, conta: e.conta, provisorio: e.provisorio })),
    });
    await tx.contaComponenteExercicio.createMany({ data: base.contas.map((c) => ({ ano, componente: c.componente, conta: c.conta, provisorio: c.provisorio })) });
    await criarTabelaMestreDoAno(tx, ano, base.ano);
    await copiarBeneficiosCargoDoAno(tx, contexto, ano, base.ano);
  } else {
    await tx.parametrosExercicio.create({
      data: {
        ano,
        reajuste: PADRAO.reajuste,
        mesDataBase: PADRAO.mesDataBase,
        ipca: PADRAO.ipca,
        diasUteisMes: PADRAO.diasUteisMes,
        semaforoVerdeAte: PADRAO.semaforo[0],
        semaforoAmareloAte: PADRAO.semaforo[1],
        semaforoLaranjaAte: PADRAO.semaforo[2],
        provisorio: true,
      },
    });
    await tx.encargoExercicio.createMany({ data: PADRAO.encargos.map((e) => ({ ano, ...e })) });
    await tx.contaComponenteExercicio.createMany({ data: PADRAO.contas.map((c) => ({ ano, ...c })) });
    await criarTabelaMestreDoAno(tx, ano, null);
  }
  const criados = await lerParametrosExercicio(tx, ano);
  await auditar(tx, {
    contexto,
    origem: contexto.usuarioId === null ? 'SISTEMA' : 'USUARIO',
    funcionalidade: 'cad.parametros',
    tipo: 'INSERCAO',
    registroId: String(ano),
    descricao: base ? `Parâmetros de ${ano} criados a partir de ${base.ano}` : `Parâmetros de ${ano} criados com os padrões provisórios`,
    depois: criados,
  });
  return true;
}
