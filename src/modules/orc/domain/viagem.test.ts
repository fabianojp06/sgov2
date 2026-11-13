import { describe, expect, it } from "vitest";
import { Dinheiro } from "@/shared/kernel";
import { MENSAGENS_ORC as M } from "./mensagens";
import {
  contaSob,
  custoDaViagem,
  indicadores,
  sinteticasAninhadas,
  validarTeto,
  validarViagem,
} from "./viagem";

const bom = {
  localidade: "Brasil",
  pessoas: "2",
  dias: "3",
  valorPassagem: "1.000,00",
  valorDiaria: "250,00",
  valorTransporte: "",
  contaPassagem: "3.1.1.1.001",
  contaDiaria: "3.1.1.1.002",
  contaTransporte: "",
};
const campos = (r: {
  ok: boolean;
  erros?: readonly { campo: string; mensagem: string }[];
}) => (r.ok ? [] : r.erros!.map((e) => e.campo));
const din = (s: string) => Dinheiro.de(s);
const dados = (
  pessoas: number,
  dias: number,
  passagem: string,
  diaria: string,
  transporte = "0.00",
) => ({
  pessoas,
  dias,
  valorPassagem: din(passagem),
  valorDiaria: din(diaria),
  valorTransporte: din(transporte),
});

describe("custoDaViagem (RN_VIA_03, C19)", () => {
  it("custo = pessoas × passagem + pessoas × dias × diária; o transporte fica fora do estimado", () => {
    const c = custoDaViagem(dados(2, 3, "1000.00", "250.00", "80.00"));
    expect(c.passagem.paraString()).toBe("2000.00");
    expect(c.diaria.paraString()).toBe("1500.00");
    expect(c.estimado.paraString()).toBe("3500.00");
    expect(c.transporte.paraString()).toBe("160.00");
  });
});

describe("validarViagem (Viagens V3, D-P21-4)", () => {
  it("aceita a viagem completa; transporte vazio é zero e sem conta", () => {
    const r = validarViagem(bom);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.localidade).toBe("Brasil");
    expect(r.valor.valorPassagem.paraString()).toBe("1000.00");
    expect(r.valor.valorTransporte.ehZero()).toBe(true);
    expect(r.valor.contaTransporte).toBeNull();
  });

  it("recusa os obrigatórios vazios com a mensagem geral e cada campo (E2 do V3, E4)", () => {
    const r = validarViagem({});
    expect(!r.ok && r.erros[0]).toEqual({
      campo: "_",
      mensagem: M.VIAGEM_OBRIGATORIOS,
    });
    expect(campos(r)).toEqual([
      "_",
      "localidade",
      "pessoas",
      "dias",
      "valorPassagem",
      "valorDiaria",
      "contaPassagem",
      "contaDiaria",
    ]);
  });

  it("pessoas e dias são inteiros de 1 a 9999", () => {
    expect(campos(validarViagem({ ...bom, pessoas: "0" }))).toEqual([
      "pessoas",
    ]);
    expect(campos(validarViagem({ ...bom, pessoas: "10000" }))).toEqual([
      "pessoas",
    ]);
    expect(campos(validarViagem({ ...bom, dias: "1,5" }))).toEqual(["dias"]);
    expect(
      campos(validarViagem({ ...bom, pessoas: "9999", dias: "1" })),
    ).toEqual([]);
  });

  it("valores ≥ 0 com até duas casas, no formato da tela (RN_VIA_06)", () => {
    expect(campos(validarViagem({ ...bom, valorPassagem: "-1,00" }))).toEqual([
      "valorPassagem",
    ]);
    expect(campos(validarViagem({ ...bom, valorDiaria: "10,001" }))).toEqual([
      "valorDiaria",
    ]);
    expect(campos(validarViagem({ ...bom, valorDiaria: "1.5" }))).toEqual([
      "valorDiaria",
    ]);
    expect(campos(validarViagem({ ...bom, valorPassagem: "0" }))).toEqual([]);
  });

  it("localidade até 100 caracteres", () => {
    expect(
      campos(validarViagem({ ...bom, localidade: "x".repeat(101) })),
    ).toEqual(["localidade"]);
    expect(
      campos(validarViagem({ ...bom, localidade: "x".repeat(100) })),
    ).toEqual([]);
  });

  it("com custo de transporte, a conta de transporte é obrigatória", () => {
    expect(campos(validarViagem({ ...bom, valorTransporte: "50,00" }))).toEqual(
      ["contaTransporte"],
    );
    const r = validarViagem({
      ...bom,
      valorTransporte: "50,00",
      contaTransporte: "3.1.1.1.003",
    });
    expect(r.ok && r.valor.contaTransporte).toBe("3.1.1.1.003");
  });

  it("recusa o custo que passa do limite de NUMERIC(15,2)", () => {
    const r = validarViagem({
      ...bom,
      pessoas: "9999",
      dias: "9999",
      valorDiaria: "999.999.999,99",
    });
    expect(!r.ok && r.erros).toEqual([
      { campo: "_", mensagem: M.VIAGEM_CUSTO_FORA_DO_LIMITE },
    ]);
  });
});

describe("validarTeto (C6, E5)", () => {
  it("aceita conta e valor; no alterar, só o valor", () => {
    expect(
      validarTeto({ contaSintetica: "3.1", valor: "10.000,00" }, true).ok,
    ).toBe(true);
    expect(validarTeto({ valor: "10.000,00" }, false).ok).toBe(true);
  });

  it("recusa teto zero com o texto do E5 e vazios com a mensagem geral", () => {
    expect(
      !validarTeto({ contaSintetica: "3.1", valor: "0,00" }, true).ok &&
        validarTeto({ contaSintetica: "3.1", valor: "0,00" }, true),
    ).toMatchObject({
      erros: [{ campo: "valor", mensagem: M.TETO_SEM_SALDO }],
    });
    expect(campos(validarTeto({}, true))).toEqual([
      "_",
      "contaSintetica",
      "valor",
    ]);
    expect(
      campos(validarTeto({ contaSintetica: "3.1", valor: "-5,00" }, true)),
    ).toEqual(["valor"]);
  });
});

describe("contaSob e sinteticasAninhadas (D-P21-5)", () => {
  it("vale pelos segmentos, não pelo prefixo do texto", () => {
    expect(contaSob("4.1", "4.1.2.001")).toBe(true);
    expect(contaSob("4.1", "4.10.1")).toBe(false);
    expect(sinteticasAninhadas("4.1", "4.1.2")).toBe(true);
    expect(sinteticasAninhadas("4.1.2", "4.1")).toBe(true);
    expect(sinteticasAninhadas("4.1", "4.10")).toBe(false);
    expect(sinteticasAninhadas("4.1", "4.1")).toBe(true);
  });
});

describe("indicadores (RN_VIA_08, REQ_VIA_004 a 006)", () => {
  it("cartões, composição e ranking por localidade, decrescente", () => {
    const i = indicadores([
      { ...dados(2, 3, "1000.00", "250.00", "10.00"), localidade: "Brasil" }, // 3.500,00
      { ...dados(1, 1, "5000.00", "100.00"), localidade: "Chile" }, // 5.100,00
      { ...dados(1, 2, "100.00", "50.00"), localidade: "BRASIL" }, // 200,00
    ]);
    expect(i.quantidade).toBe(3);
    expect(i.pessoas).toBe(4);
    expect(i.custoTotal.paraString()).toBe("8800.00");
    expect(i.custoMedio?.paraString()).toBe("2933.33");
    expect(i.passagens.paraString()).toBe("7100.00");
    expect(i.diarias.paraString()).toBe("1700.00");
    expect(i.transportes.paraString()).toBe("20.00");
    expect(i.totalGeral.paraString()).toBe("8820.00");
    expect(i.ranking.map((r) => [r.localidade, r.custo.paraString()])).toEqual([
      ["Chile", "5100.00"],
      ["Brasil", "3700.00"],
    ]);
  });

  it("custo médio Half-Even e nulo sem viagens", () => {
    const tres = indicadores(
      [1, 2, 3]
        .map(() => ({ ...dados(1, 1, "0.00", "3.33"), localidade: "X" }))
        .concat([{ ...dados(1, 1, "0.00", "0.01"), localidade: "X" }]),
    );
    expect(tres.custoTotal.paraString()).toBe("10.00");
    expect(tres.custoMedio?.paraString()).toBe("2.50");
    expect(
      indicadores([
        { ...dados(1, 1, "10.00", "0.00"), localidade: "X" },
        ...[1, 2].map(() => ({
          ...dados(1, 1, "0.00", "0.00"),
          localidade: "X",
        })),
      ]).custoMedio?.paraString(),
    ).toBe("3.33");
    expect(indicadores([]).custoMedio).toBeNull();
  });
});
