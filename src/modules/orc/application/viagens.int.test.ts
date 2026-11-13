import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CENTROS_CUSTO_EXEMPLO,
  estruturaFinanceiraFalsa,
  type NoCentroCusto,
  type NoConta,
} from "@/modules/cad/servidor";
import type { ContextoRequisicao } from "@/shared/authz";
import { criarPrisma } from "@/shared/db";
import { ErroDominio } from "@/shared/kernel";
import { iniciarBancoTeste } from "../../../../tests/integracao/banco";
import { MENSAGENS_ORC as M } from "../domain/mensagens";
import type { DepsOrc } from "./deps";
import { incluirMeta } from "./metas";
import {
  criarProposta,
  duplicarProposta,
  novaVersaoProposta,
} from "./propostas";
import {
  alterarTeto,
  alterarViagem,
  excluirTeto,
  excluirViagem,
  incluirTeto,
  incluirViagem,
  listarViagens,
  opcoesViagem,
} from "./viagens";

// Viagens da proposta de TP (US-071; plano do P21, Task 1). Como sgo_app (RLS real). O C1 é o falso do cad,
// com um trecho de contas de viagem: a sintética 4.2.1 (passagens e diárias nacionais) e a 4.2.2 (exterior).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (
  classificacao: string,
  descricao: string,
  analitico: boolean,
  filhos: NoCentroCusto[] = [],
): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `90.${classificacao}`,
  descricao,
  nivel: classificacao.split(".").length as NoCentroCusto["nivel"],
  tipo: analitico ? "ANALITICO" : "SINTETICO",
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
const conta = (
  classificacao: string,
  descricao: string,
  filhos: NoConta[] = [],
  ativa = true,
): NoConta => {
  const nivel = classificacao.split(".").length as NoConta["nivel"];
  return {
    classificacao,
    codigoReduzido: nivel === 5 ? `7${classificacao.replace(/\./g, "")}` : null,
    descricao,
    nivel,
    tipo: nivel === 5 ? "ANALITICA" : "SINTETICA",
    ativa,
    filhos,
  };
};
const contas = (diariaAtiva = true): NoConta[] => [
  conta("4", "DESPESAS", [
    conta("4.2", "VIAGENS", [
      conta("4.2.1", "VIAGENS NACIONAIS", [
        conta("4.2.1.1", "PASSAGENS E DIÁRIAS", [
          conta("4.2.1.1.001", "Passagens aéreas"),
          conta("4.2.1.1.002", "Diárias", [], diariaAtiva),
          conta("4.2.1.1.003", "Transporte local"),
        ]),
      ]),
      conta("4.2.2", "VIAGENS AO EXTERIOR", [
        conta("4.2.2.1", "PASSAGENS E DIÁRIAS", [
          conta("4.2.2.1.001", "Passagens internacionais"),
          conta("4.2.2.1.002", "Diárias internacionais"),
        ]),
      ]),
    ]),
  ]),
];
const RAIZ_TPS = cc("9", "Termos de Parceria", false, [
  cc("9.1", "TP de exemplo 1", true),
  cc("9.2", "TP de exemplo 2", true),
]);
const estruturaCom = (diariaAtiva = true) =>
  estruturaFinanceiraFalsa({
    contas: contas(diariaAtiva),
    centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS],
  });
const comDeps = (diariaAtiva = true): Partial<DepsOrc> => ({
  cliente: app,
  estrutura: estruturaCom(diariaAtiva),
});

const LANCA = ["consultar", "incluir", "alterar", "excluir"];
const TODAS = [
  "orc.propostas:consultar",
  "orc.propostas:incluir",
  "orc.propostas:excluir",
  ...LANCA.map((a) => `orc.metas:${a}`),
  ...LANCA.map((a) => `orc.viagens:${a}`),
];
let seq = 0;
let orcamentista: string;

async function usuario(): Promise<string> {
  const login = `via${++seq}`;
  return (
    await migrator.usuario.create({
      data: {
        nome: `Pessoa ${login}`,
        email: `${login}@exemplo.org`,
        login,
        loginNormalizado: login,
        senhaHash: "x",
      },
    })
  ).id;
}
const unidadesDe = async (usuarioId: string) =>
  (
    await migrator.usuarioUnidade.findMany({
      where: { usuarioId, unidade: { ativo: true } },
      select: { unidadeId: true },
    })
  ).map((u) => u.unidadeId);
async function ctx(
  usuarioId = orcamentista,
  permissoes: string[] = TODAS,
): Promise<ContextoRequisicao> {
  return {
    usuarioId,
    usuarioRotulo: "orcamentista",
    sessaoUid: "s1",
    ip: null,
    permissoes: new Set(permissoes),
    unidades: await unidadesDe(usuarioId),
    unidadeId: null,
  };
}

async function proposta(extra: Record<string, unknown> = {}) {
  const numero = `TP-${String(++seq).padStart(3, "0")}/2027`;
  const r = await criarProposta(
    await ctx(),
    {
      tipo: "TERMO_PARCERIA",
      numero,
      objeto: `Objeto ${numero}`,
      parceiro: "",
      inicio: "2027-01-01",
      fim: "2027-12-31",
      categoria: "META",
      cc: "9.1",
      ...extra,
    },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
const versaoCapa = async (id: string) =>
  (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
async function meta(propostaId: string, numero = "M1") {
  const r = await incluirMeta(
    await ctx(),
    {
      propostaId,
      versaoCapa: await versaoCapa(propostaId),
      numero,
      nome: `Meta ${numero}`,
      valor: "0",
      status: "ATIVO",
    },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.metaProposta.findFirstOrThrow({
    where: { versaoProposta: { propostaId }, numero },
    orderBy: { criadoEm: "desc" },
  });
}
async function teto(
  propostaId: string,
  contaSintetica = "4.2.1",
  valor = "10.000,00",
) {
  const r = await incluirTeto(
    await ctx(),
    {
      propostaId,
      versaoCapa: await versaoCapa(propostaId),
      contaSintetica,
      valor,
    },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.tetoViagemProposta.findFirstOrThrow({
    where: { versaoProposta: { propostaId }, contaSintetica },
    orderBy: { criadoEm: "desc" },
  });
}
// 2 × 1.000,00 + 2 × 3 × 250,00 = 3.500,00 (RN_VIA_03).
const viagem = (extra: Record<string, unknown> = {}) => ({
  localidade: "Brasil",
  pessoas: "2",
  dias: "3",
  valorPassagem: "1.000,00",
  valorDiaria: "250,00",
  valorTransporte: "",
  contaPassagem: "4.2.1.1.001",
  contaDiaria: "4.2.1.1.002",
  contaTransporte: "",
  ...extra,
});
async function incluir(
  propostaId: string,
  metaId: string | undefined,
  extra: Record<string, unknown> = {},
) {
  const r = await incluirViagem(
    await ctx(),
    {
      propostaId,
      versaoCapa: await versaoCapa(propostaId),
      ...(metaId ? { metaId } : {}),
      ...viagem(extra),
    },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.viagemProposta.findFirstOrThrow({
    where: { versaoProposta: { propostaId } },
    orderBy: { criadoEm: "desc" },
  });
}
// No alterar, a meta e as contas de passagem e de diária não vão (RN_VIA_07).
const camposEditaveis = (extra: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries(viagem(extra)).filter(
      ([k]) => k !== "contaPassagem" && k !== "contaDiaria",
    ),
  );
const erroGeral = (mensagem: string) => ({
  ok: false,
  erros: [{ campo: "_", mensagem }],
});
const erroCampo = (campo: string, mensagem: string) => ({
  ok: false,
  erros: [{ campo, mensagem }],
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

// Cada teste começa com os CCs de TP livres (9.1 e 9.2).
beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe("tetos (Camada 1, C6, D-P21-5)", () => {
  it("inclui o teto da sintética, sobe a capa e grava o Histórico", async () => {
    const p = await proposta();
    const antes = await versaoCapa(p.id);
    const r = await incluirTeto(
      await ctx(),
      {
        propostaId: p.id,
        versaoCapa: antes,
        contaSintetica: "4.2.1",
        valor: "10.000,00",
      },
      comDeps(),
    );
    expect(r).toEqual({ ok: true, valor: { conta: "4.2.1" } });
    const t = await migrator.tetoViagemProposta.findFirstOrThrow({
      where: { versaoProposta: { propostaId: p.id } },
    });
    expect(t.valor.toString()).toBe("10000");
    expect(await versaoCapa(p.id)).toBe(antes + 1);
    const [h] = await migrator.historicoOperacao.findMany({
      where: { funcionalidade: "orc.viagens", registroId: t.id },
    });
    expect(h).toMatchObject({
      tipoOperacao: "INSERCAO",
      depois: {
        numeroTp: p.numero,
        versaoProposta: 1,
        contaSintetica: "4.2.1",
        valor: "10000.00",
      },
    });
  });

  it("recusa analítica, conta fora do plano, zero (E5), repetida e aninhada nos dois sentidos (Review Focus 4)", async () => {
    const p = await proposta();
    const tentar = async (contaSintetica: string, valor = "100,00") =>
      incluirTeto(
        await ctx(),
        {
          propostaId: p.id,
          versaoCapa: await versaoCapa(p.id),
          contaSintetica,
          valor,
        },
        comDeps(),
      );
    expect(await tentar("4.2.1.1.001")).toEqual(
      erroCampo("contaSintetica", M.TETO_CONTA_SINTETICA),
    );
    expect(await tentar("8.8")).toEqual(
      erroCampo("contaSintetica", M.TETO_CONTA_SINTETICA),
    );
    expect(await tentar("4.2.1", "0,00")).toEqual(
      erroCampo("valor", M.TETO_SEM_SALDO),
    );
    await teto(p.id, "4.2.1");
    expect(await tentar("4.2.1")).toEqual(
      erroCampo("contaSintetica", M.TETO_REPETIDO("4.2.1")),
    );
    expect(await tentar("4.2.1.1")).toEqual(
      erroCampo("contaSintetica", M.TETO_ANINHADO("4.2.1")),
    );
    expect(await tentar("4.2")).toEqual(
      erroCampo("contaSintetica", M.TETO_ANINHADO("4.2.1")),
    );
    expect((await tentar("4.2.2")).ok).toBe(true);
  });

  it("o teto não fica abaixo do consumido nem sai com viagem sob ele", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const t = await teto(p.id);
    await incluir(p.id, m.id);
    const alterar = async (valor: string) =>
      alterarTeto(
        await ctx(),
        {
          id: t.id,
          versao: (
            await migrator.tetoViagemProposta.findUniqueOrThrow({
              where: { id: t.id },
            })
          ).versao,
          versaoCapa: await versaoCapa(p.id),
          valor,
        },
        comDeps(),
      );
    expect(await alterar("3.499,99")).toEqual(
      erroCampo("valor", M.TETO_ABAIXO_CONSUMIDO("R$ 3.500,00")),
    );
    expect(await alterar("3.500,00")).toEqual({
      ok: true,
      valor: { conta: "4.2.1" },
    });
    const excluir = async () =>
      excluirTeto(
        await ctx(),
        { id: t.id, versao: 1, versaoCapa: await versaoCapa(p.id) },
        comDeps(),
      );
    expect(await excluir()).toEqual(erroGeral(M.TETO_COM_VIAGENS));
    await expect(
      alterarTeto(
        await ctx(),
        {
          id: t.id,
          versao: 1,
          versaoCapa: await versaoCapa(p.id),
          valor: "1,00",
          contaSintetica: "4.2.2",
        },
        comDeps(),
      ),
    ).rejects.toBeInstanceOf(ErroDominio);
  });
});

describe("incluirViagem (UC03.31, Viagens V3)", () => {
  it("grava na meta com o custo da RN_VIA_03 no Histórico e sobe a capa", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const antes = await versaoCapa(p.id);
    const r = await incluirViagem(
      await ctx(),
      { propostaId: p.id, versaoCapa: antes, metaId: m.id, ...viagem() },
      comDeps(),
    );
    expect(r).toEqual({ ok: true, valor: { localidade: "Brasil" } });
    const v = await migrator.viagemProposta.findFirstOrThrow({
      where: { versaoProposta: { propostaId: p.id } },
    });
    expect(v).toMatchObject({
      metaId: m.id,
      localidade: "Brasil",
      pessoas: 2,
      dias: 3,
      contaPassagem: "4.2.1.1.001",
      contaDiaria: "4.2.1.1.002",
      contaTransporte: null,
      criadoPor: orcamentista,
    });
    expect(await versaoCapa(p.id)).toBe(antes + 1);
    const [h] = await migrator.historicoOperacao.findMany({
      where: { funcionalidade: "orc.viagens", registroId: v.id },
    });
    expect(h).toMatchObject({
      tipoOperacao: "INSERCAO",
      descricao: `Viagem para Brasil incluída na versão 1 da proposta do TP ${p.numero}`,
      depois: {
        meta: "M1",
        localidade: "Brasil",
        valorPassagem: "1000.00",
        valorDiaria: "250.00",
        custoEstimado: "3500.00",
      },
    });
  });

  it("na Consolidada, sem meta; meta informada é recusada", async () => {
    const p = await proposta({ categoria: "CONSOLIDADA" });
    await teto(p.id);
    const base = { propostaId: p.id, ...viagem() };
    expect(
      (
        await incluirViagem(
          await ctx(),
          {
            ...base,
            versaoCapa: await versaoCapa(p.id),
            metaId: "00000000-0000-4000-8000-000000000000",
          },
          comDeps(),
        )
      ).ok,
    ).toBe(false);
    expect(
      await incluirViagem(
        await ctx(),
        { ...base, versaoCapa: await versaoCapa(p.id) },
        comDeps(),
      ),
    ).toEqual({ ok: true, valor: { localidade: "Brasil" } });
  });

  it("E2: na categoria Meta, a meta é obrigatória", async () => {
    const p = await proposta();
    await teto(p.id);
    expect(
      await incluirViagem(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), ...viagem() },
        comDeps(),
      ),
    ).toEqual(erroCampo("metaId", M.EMPREGADO_META_OBRIGATORIA));
  });

  it("E1: conta sintética ou fora do plano é recusada (RN_VIA_02)", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const r = await incluirViagem(
      await ctx(),
      {
        propostaId: p.id,
        versaoCapa: await versaoCapa(p.id),
        metaId: m.id,
        ...viagem({ contaPassagem: "4.2.1.1", contaDiaria: "4.2.1.1.999" }),
      },
      comDeps(),
    );
    expect(r).toEqual({
      ok: false,
      erros: [
        { campo: "contaPassagem", mensagem: M.VIAGEM_CONTA_ANALITICA },
        { campo: "contaDiaria", mensagem: M.VIAGEM_CONTA_ANALITICA },
      ],
    });
  });

  it("sem teto sobre a conta, a viagem é recusada", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id, "4.2.2");
    const r = await incluirViagem(
      await ctx(),
      {
        propostaId: p.id,
        versaoCapa: await versaoCapa(p.id),
        metaId: m.id,
        ...viagem({ contaDiaria: "4.2.2.1.002" }),
      },
      comDeps(),
    );
    expect(r).toEqual(
      erroCampo("contaPassagem", M.VIAGEM_SEM_TETO("4.2.1.1.001")),
    );
  });

  it("E3: passa do teto é recusada; o transporte não conta (Review Focus 1)", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id, "4.2.1", "3.500,00");
    const versao = await versaoCapa(p.id);
    const r = await incluirViagem(
      await ctx(),
      {
        propostaId: p.id,
        versaoCapa: versao,
        metaId: m.id,
        ...viagem({ valorDiaria: "250,01" }),
      },
      comDeps(),
    );
    expect(r).toEqual(erroGeral(M.VIAGEM_ESTOURO_TETO("4.2.1")));
    expect(await versaoCapa(p.id)).toBe(versao);
    await incluir(p.id, m.id, {
      valorTransporte: "9.999,00",
      contaTransporte: "4.2.1.1.003",
    });
    expect(
      await migrator.viagemProposta.count({
        where: { versaoProposta: { propostaId: p.id } },
      }),
    ).toBe(1);
  });

  it("componentes em tetos diferentes: cada um vai ao seu", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id, "4.2.1", "2.000,00");
    await teto(p.id, "4.2.2", "1.500,00");
    await incluir(p.id, m.id, { contaDiaria: "4.2.2.1.002" });
    const [b] = await listarViagens(
      await ctx(),
      { proposta: p.numero },
      comDeps(),
    );
    expect(
      b!.tetos.map((t) => [
        t.contaSintetica,
        t.consumido.paraString(),
        t.saldo.paraString(),
      ]),
    ).toEqual([
      ["4.2.1", "2000.00", "0.00"],
      ["4.2.2", "1500.00", "0.00"],
    ]);
  });

  it("versão imutável e corrida pela mesma versão da capa (Review Focus 5)", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const versao = await versaoCapa(p.id);
    const corpo = {
      propostaId: p.id,
      versaoCapa: versao,
      metaId: m.id,
      ...viagem(),
    };
    const [a, b] = await Promise.all([
      incluirViagem(await ctx(), corpo, comDeps()),
      incluirViagem(await ctx(), corpo, comDeps()),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    await migrator.versaoProposta.updateMany({
      where: { propostaId: p.id },
      data: { situacao: "EM_APROVACAO" },
    });
    expect(
      await incluirViagem(
        await ctx(),
        { ...corpo, versaoCapa: await versaoCapa(p.id) },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.VIAGEM_VERSAO_IMUTAVEL));
  });

  it("quem só consulta não inclui; o custo e as ações ficam na lista", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    await incluir(p.id, m.id);
    const consulta = await ctx(orcamentista, ["orc.viagens:consultar"]);
    await expect(
      incluirViagem(
        consulta,
        {
          propostaId: p.id,
          versaoCapa: await versaoCapa(p.id),
          metaId: m.id,
          ...viagem(),
        },
        comDeps(),
      ),
    ).rejects.toThrow();
    const [b] = await listarViagens(
      consulta,
      { proposta: p.numero },
      comDeps(),
    );
    expect(b!.grupos[0]!.viagens[0]!.custo.estimado.paraString()).toBe(
      "3500.00",
    );
  });
});

describe("alterarViagem e excluirViagem (UC03.32, UC03.33)", () => {
  it("alterar até o teto passa; um centavo a mais é recusado (a própria viagem não conta duas vezes, RF 2)", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id, "4.2.1", "4.000,00");
    const v = await incluir(p.id, m.id);
    const alterar = async (extra: Record<string, unknown>, versao: number) =>
      alterarViagem(
        await ctx(),
        {
          id: v.id,
          versao,
          versaoCapa: await versaoCapa(p.id),
          ...camposEditaveis(extra),
        },
        comDeps(),
      );
    expect(await alterar({ valorPassagem: "1.250,01" }, 0)).toEqual(
      erroGeral(M.VIAGEM_ESTOURO_TETO("4.2.1")),
    );
    expect(
      await alterar({ valorPassagem: "1.250,00", localidade: "Argentina" }, 0),
    ).toEqual({ ok: true, valor: { localidade: "Argentina" } });
    const [h] = await migrator.historicoOperacao.findMany({
      where: {
        funcionalidade: "orc.viagens",
        registroId: v.id,
        tipoOperacao: "ALTERACAO",
      },
    });
    expect(h).toMatchObject({
      antes: { localidade: "Brasil", custoEstimado: "3500.00" },
      depois: { localidade: "Argentina", custoEstimado: "4000.00" },
    });
  });

  it("meta e contas são só leitura (RN_VIA_07); a de transporte entra se não havia", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const v = await incluir(p.id, m.id);
    await expect(
      alterarViagem(
        await ctx(),
        {
          id: v.id,
          versao: 0,
          versaoCapa: await versaoCapa(p.id),
          ...viagem(),
        },
        comDeps(),
      ),
    ).rejects.toBeInstanceOf(ErroDominio);
    const r = await alterarViagem(
      await ctx(),
      {
        id: v.id,
        versao: 0,
        versaoCapa: await versaoCapa(p.id),
        ...camposEditaveis({
          valorTransporte: "30,00",
          contaTransporte: "4.2.1.1.003",
        }),
      },
      comDeps(),
    );
    expect(r.ok).toBe(true);
    expect(
      (await migrator.viagemProposta.findUniqueOrThrow({ where: { id: v.id } }))
        .contaTransporte,
    ).toBe("4.2.1.1.003");
  });

  it("conta gravada que deixou de ser analítica ativa: a lista mostra; o alterar recusa (RF 3)", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const v = await incluir(p.id, m.id);
    const [b] = await listarViagens(
      await ctx(),
      { proposta: p.numero },
      comDeps(false),
    );
    expect(b!.grupos[0]!.viagens).toHaveLength(1);
    const r = await alterarViagem(
      await ctx(),
      {
        id: v.id,
        versao: 0,
        versaoCapa: await versaoCapa(p.id),
        ...camposEditaveis(),
      },
      comDeps(false),
    );
    expect(r).toEqual(erroCampo("contaDiaria", M.VIAGEM_CONTA_ANALITICA));
  });

  it("exclui (físico) com o Histórico; versão antiga da viagem é ALTERADO", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    const v = await incluir(p.id, m.id);
    expect(
      await excluirViagem(
        await ctx(),
        { id: v.id, versao: 7, versaoCapa: await versaoCapa(p.id) },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    expect(
      await excluirViagem(
        await ctx(),
        { id: v.id, versao: 0, versaoCapa: await versaoCapa(p.id) },
        comDeps(),
      ),
    ).toEqual({ ok: true, valor: { localidade: "Brasil" } });
    expect(await migrator.viagemProposta.count({ where: { id: v.id } })).toBe(
      0,
    );
    const [h] = await migrator.historicoOperacao.findMany({
      where: {
        funcionalidade: "orc.viagens",
        registroId: v.id,
        tipoOperacao: "EXCLUSAO",
      },
    });
    expect(h).toMatchObject({
      antes: { localidade: "Brasil", custoEstimado: "3500.00" },
    });
  });
});

describe("listarViagens e opções (REQ_VIA_001, REQ_VIA_004 a 006)", () => {
  it("painel, grupos por meta e filtro de localidade", async () => {
    const p = await proposta();
    const m1 = await meta(p.id, "M1");
    const m2 = await meta(p.id, "M2");
    await teto(p.id, "4.2.1", "50.000,00");
    await incluir(p.id, m1.id);
    await incluir(p.id, m2.id, {
      localidade: "Chile",
      pessoas: "1",
      dias: "1",
      valorPassagem: "5.000,00",
      valorDiaria: "100,00",
    });
    const [b] = await listarViagens(
      await ctx(),
      { proposta: p.numero },
      comDeps(),
    );
    expect(
      b!.grupos.map((g) => [g.metaNumero, g.viagens.map((v) => v.localidade)]),
    ).toEqual([
      ["M1", ["Brasil"]],
      ["M2", ["Chile"]],
    ]);
    expect(b!.indicadores).toMatchObject({ quantidade: 2, pessoas: 3 });
    expect(b!.indicadores.custoTotal.paraString()).toBe("8600.00");
    expect(b!.indicadores.ranking.map((r) => r.localidade)).toEqual([
      "Chile",
      "Brasil",
    ]);
    expect(b!.tetos[0]).toMatchObject({
      contaSintetica: "4.2.1",
      descricao: "VIAGENS NACIONAIS",
    });
    const [f] = await listarViagens(
      await ctx(),
      { proposta: p.numero, localidade: "chi" },
      comDeps(),
    );
    expect(
      f!.grupos.flatMap((g) => g.viagens.map((v) => v.localidade)),
    ).toEqual(["Chile"]);
    expect(f!.tetos[0]!.consumido.paraString()).toBe("8600.00");
  });

  it("as opções trazem as analíticas ativas e as sintéticas ativas", async () => {
    const o = await opcoesViagem(await ctx(), comDeps(false));
    expect(o.analiticas.map((c) => c.classificacao)).toEqual([
      "4.2.1.1.001",
      "4.2.1.1.003",
      "4.2.2.1.001",
      "4.2.2.1.002",
    ]);
    expect(o.sinteticas.map((c) => c.classificacao)).toEqual([
      "4",
      "4.2",
      "4.2.1",
      "4.2.1.1",
      "4.2.2",
      "4.2.2.1",
    ]);
  });
});

describe("cópia nas versões (RN_DUP_003, D-P21-8)", () => {
  it("a nova versão copia tetos e viagens, com a meta de mesmo número", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    await incluir(p.id, m.id);
    const r = await novaVersaoProposta(
      await ctx(),
      { id: p.id, versao: await versaoCapa(p.id) },
      comDeps(),
    );
    expect(r.ok).toBe(true);
    const v2 = await migrator.versaoProposta.findFirstOrThrow({
      where: { propostaId: p.id, numero: 2 },
      include: { metas: true, viagens: true, tetosViagem: true },
    });
    expect(v2.tetosViagem.map((t) => t.contaSintetica)).toEqual(["4.2.1"]);
    expect(v2.viagens).toHaveLength(1);
    expect(v2.viagens[0]!.metaId).toBe(v2.metas[0]!.id);
  });

  it("a duplicação com outra categoria leva os tetos e não as viagens", async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await teto(p.id);
    await incluir(p.id, m.id);
    const r = await duplicarProposta(
      await ctx(),
      {
        origemId: p.id,
        versaoOrigem: await versaoCapa(p.id),
        numero: `TP-D${++seq}`,
        cc: "9.2",
        categoria: "CONSOLIDADA",
      },
      comDeps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = await migrator.versaoProposta.findFirstOrThrow({
      where: { propostaId: r.valor.id },
      include: { viagens: true, tetosViagem: true },
    });
    expect(v.tetosViagem).toHaveLength(1);
    expect(v.viagens).toHaveLength(0);
  });
});
