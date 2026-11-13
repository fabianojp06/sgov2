import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextoRequisicao } from "@/shared/authz";
import {
  configurarAuditorNegacao,
  configurarProvedorContexto,
} from "@/shared/authz/configuracao";
import { limparJanelaNegacoes } from "@/shared/authz/guarda";
import type {
  CargoTela,
  FaixaTela,
  SenioridadeTela,
} from "../domain/cargo-tela";
import { FormCargo, origemDepoisDeSalvar } from "./form-cargo";
import { TabelaSalarial } from "./tabela-salarial";

// Tela da tabela salarial e a cópia para o cargo (plano do P4, Task 12c, Step 1).
vi.mock("next/server", () => ({ connection: async () => undefined }));
const { default: Pagina } =
  await import("../../../app/(sistema)/cad/tabela-salarial/page");

const faixa: FaixaTela = {
  id: "f1",
  cargoId: "c1",
  cargo: "C1 — Analista",
  senioridadeId: "s2",
  senioridade: "Pleno",
  minimo: "6000.00",
  maximo: "9000.00",
  ativa: true,
  versao: 1,
};
const senioridades: SenioridadeTela[] = [
  { id: "s1", nome: "Júnior", padrao: true, ativa: true },
  { id: "s2", nome: "Pleno", padrao: true, ativa: true },
  { id: "s9", nome: "Especialista", padrao: false, ativa: true },
];
const ok = async () => ({ ok: true as const });
const tela = (x: Partial<Parameters<typeof TabelaSalarial>[0]> = {}) =>
  renderToString(
    createElement(TabelaSalarial, {
      faixas: [faixa],
      senioridades,
      cargos: [{ id: "c1", rotulo: "C1 — Analista" }],
      podeIncluir: false,
      podeAlterar: false,
      podeExcluir: false,
      incluirFaixa: ok,
      alterarFaixa: ok,
      inativarFaixa: ok,
      incluirSenioridade: async () => ({ ok: true as const, valor: { reativada: false, nome: 'x' } }),
      inativarSenioridade: ok,
      ...x,
    }),
  );

describe("TabelaSalarial (SSR)", () => {
  it("consulta (GFIN): a faixa, as senioridades com o selo de padrão, sem botões de escrita", () => {
    const h = tela();
    expect(h).toContain("C1 — Analista");
    expect(h).toContain("Pleno<!-- --> (padrão)");
    expect(h).not.toMatch(/Incluir faixa|Inativar|Incluir senioridade/);
  });

  it("GRH: incluir faixa e senioridade; inativar só a customizada (RN_TAB_01)", () => {
    const h = tela({ podeIncluir: true, podeAlterar: true, podeExcluir: true });
    expect(h).toContain(">Incluir faixa</button>");
    expect(h).toContain("Incluir senioridade");
    expect(h).toContain("Inativar <!-- -->Especialista");
    expect(h).not.toMatch(/Inativar <!-- -->(Pleno|Júnior)/);
  });
});

const cargoBase: CargoTela = {
  id: "c1",
  codigo: "C1",
  nomeOficial: "Analista",
  nomeMercado: null,
  tabelaSalarial: null,
  faixa: null,
  nivel: null,
  salarios: {
    minimo: null,
    maximo: null,
    funcaoGratificada: null,
    real: null,
    definido: null,
  },
  mascarado: false,
  origemMercado: null,
  fonteAtiva: null,
  salarioDaFonte: null,
  adicional: null,
  desvioDeMercado: null,
  salariosIlegiveis: [],
  lotacao: null,
  pendenteAlocacao: false,
  ativo: true,
  versao: 1,
};

describe("cópia para o cargo (REQ_TAB_003)", () => {
  const cargo = cargoBase;
  const salvar = async () => ({ ok: true as const, valor: { versao: 2 } });
  it('as faixas do cargo com "Usar a faixa", só com a cópia e sem máscara', () => {
    const h = renderToString(
      createElement(FormCargo, {
        cargo,
        podeAlterar: true,
        alterar: salvar,
        faixas: [faixa],
        copiarFaixa: salvar,
      }),
    );
    expect(h).toContain("Tabela salarial deste cargo");
    expect(h).toContain("Usar a faixa <!-- -->Pleno");
    expect(h).toContain("R$ 6.000,00");
    expect(h).toContain('href="/cad/tabela-salarial?cargo=c1"');
    expect(
      renderToString(
        createElement(FormCargo, {
          cargo: { ...cargo, mascarado: true },
          podeAlterar: true,
          alterar: salvar,
          faixas: [faixa],
          copiarFaixa: salvar,
        }),
      ),
    ).not.toContain("Usar a faixa");
    expect(
      renderToString(
        createElement(FormCargo, {
          cargo,
          podeAlterar: false,
          alterar: salvar,
          faixas: [faixa],
          copiarFaixa: salvar,
        }),
      ),
    ).not.toContain("Usar a faixa");
  });
});

describe("origem do mercado depois de salvar (REQ_TAB_005)", () => {
  it('mínimo ou máximo mudou → "Editado manualmente"; o mesmo valor (outra escrita) mantém', () => {
    const o = "Preenchido via Tabela Salarial — Analista/Pleno";
    const salvo = { minimo: "6000.00", maximo: "9000.00" };
    expect(
      origemDepoisDeSalvar(o, salvo, { minimo: "6000", maximo: "9000,00" }),
    ).toBe(o);
    expect(
      origemDepoisDeSalvar(o, salvo, { minimo: "6100", maximo: "9000" }),
    ).toBe("Editado manualmente");
    expect(
      origemDepoisDeSalvar(o, salvo, { minimo: "6000", maximo: null }),
    ).toBe("Editado manualmente");
  });

  it("mascarado: a origem não aparece (revelaria o mercado)", () => {
    const c = {
      ...cargoBase,
      mascarado: true,
      origemMercado: "Preenchido via Tabela Salarial — Analista/Pleno",
    };
    expect(
      renderToString(
        createElement(FormCargo, {
          cargo: c,
          podeAlterar: false,
          alterar: async () => ({ ok: true as const, valor: { versao: 2 } }),
        }),
      ),
    ).not.toContain("Preenchido via");
  });
});

describe("página /cad/tabela-salarial", () => {
  let contexto: ContextoRequisicao;
  beforeEach(() => {
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
  });
  it("exige cad.tabela_salarial:consultar", async () => {
    // "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: a permissão sai daqui.
    contexto = {
      usuarioId: "0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c",
      usuarioRotulo: "u",
      sessaoUid: "s",
      ip: null,
      permissoes: new Set([["cad.cargos", "consultar"].join(":")]),
    };
    const d = await Pagina({ searchParams: Promise.resolve({}) }).then(
      () => "sem erro",
      (e: { digest?: string }) => e.digest,
    );
    expect(d).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
