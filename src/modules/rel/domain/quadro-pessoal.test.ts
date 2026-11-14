import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import {
  agregarQuadro,
  anosDaVigencia,
  conferirAnalise,
  DEMAIS_CARGOS,
  MAXIMO_CARGOS,
  MAXIMO_ITENS,
  MAXIMO_PROPOSTAS,
  mensagemQuadro,
  totalDePostos,
  type EmpregadoEntrada,
  type PropostaEntrada,
} from './quadro-pessoal';

// Agregados do quadro de pessoal (US-107): a regra "nunca nomes nem salários individuais" é provada aqui.
const emp = (cargo: string, custo: string | null, extra: Partial<EmpregadoEntrada> = {}): EmpregadoEntrada => ({
  categoria: 'EMPREGADO',
  avisos: [],
  nome: 'Pessoa Nominal',
  cargo,
  inicio: '2027-01',
  fim: '2028-12',
  custoPeriodo: custo === null ? null : Dinheiro.de(custo),
  ...extra,
});
const proposta = (numero: string, empregados: EmpregadoEntrada[], extra: Partial<PropostaEntrada> = {}): PropostaEntrada => ({
  numero,
  tipo: 'TERMO_PARCERIA',
  situacao: 'RASCUNHO',
  vigencia: { inicio: '2027-01', fim: '2028-06' },
  veCusto: true,
  grupos: [{ empregados }],
  ...extra,
});

describe('anosDaVigencia', () => {
  it('dezembro de cada ano e o fim da vigência no último', () => {
    expect(anosDaVigencia({ inicio: '2027-03', fim: '2029-05' })).toEqual([
      { ano: 2027, referencia: '2027-12' },
      { ano: 2028, referencia: '2028-12' },
      { ano: 2029, referencia: '2029-05' },
    ]);
    expect(anosDaVigencia({ inicio: '2027-01', fim: '2027-12' })).toEqual([{ ano: 2027, referencia: '2027-12' }]);
    expect(anosDaVigencia({ inicio: '2028-01', fim: '2027-12' })).toEqual([]);
  });
});

describe('agregarQuadro', () => {
  it('postos por categoria, vagas A CONTRATAR e a evolução por ano com a variação', () => {
    const q = agregarQuadro([
      proposta('TP-01', [
        emp('C1', '100.00'),
        emp('C1', '100.00', { nome: null, inicio: '2028-01' }),
        emp('C1', '100.00', { categoria: 'ESTAGIARIO', fim: '2027-12' }),
        emp('C2', '100.00', { categoria: 'JOVEM_APRENDIZ', inicio: '2028-03' }),
      ]),
    ]);
    const p = q.propostas[0]!;
    expect(p.postos).toEqual({ EMPREGADO: 2, ESTAGIARIO: 1, JOVEM_APRENDIZ: 1 });
    expect(p.aContratar).toBe(1);
    expect(p.anos).toEqual([
      { ano: 2027, referencia: '2027-12', postos: 2, aContratar: 0, variacao: null, postosNoAno: 2 },
      { ano: 2028, referencia: '2028-06', postos: 3, aContratar: 1, variacao: 1, postosNoAno: 3 },
    ]);
    expect(totalDePostos(q)).toBe(4);
  });

  it('nenhum custo por cargo: só contagens; cargos pequenos vão para "Demais cargos"', () => {
    const tres = [emp('Analista', '1000.00'), emp('Analista', '2000.00'), emp('Analista', '3000.00')];
    const p = agregarQuadro([proposta('TP-01', [...tres, emp('Diretor', '9000.00', { nome: null })])]).propostas[0]!;
    expect(p.custoPeriodo).toBe('15000.00');
    expect(p.cargos).toEqual([
      { cargo: 'Analista', postos: 3, aContratar: 0 },
      { cargo: DEMAIS_CARGOS, postos: 1, aContratar: 1 },
    ]);
  });

  it('proposta com menos de 3 postos, sem permissão de custo, custo faltando, zerado ou com aviso, ou todos iguais: custo omitido, com o motivo', () => {
    const q = agregarQuadro([
      proposta('TP-01', [emp('C1', '5000.00'), emp('C1', '6000.00')]),
      proposta('TP-02', [emp('C1', '1.00'), emp('C1', '2.00'), emp('C1', '3.00')], { veCusto: false }),
      proposta('TP-03', [emp('C1', '1.00'), emp('C1', null), emp('C1', '2.00')]),
      // Revisão 12.12: ano sem premissas dá custo zero com aviso; 1 pessoa + 2 vagas zeradas não pode virar "3 postos".
      proposta('TP-04', [emp('C1', '60000.00'), emp('C1', '0.00', { nome: null, avisos: ['Sem parâmetros de 2028.'] }), emp('C1', '0.00', { nome: null })]),
      proposta('TP-05', [emp('C1', '9.00'), emp('C1', '9.00'), emp('C1', '1.00', { avisos: ['Benefício sem valor.'] })]),
      // Homogeneidade: total ÷ postos = o custo de cada um.
      proposta('TP-06', [emp('C1', '60000.00'), emp('C1', '60000.00', { nome: null }), emp('C1', '60000.00', { nome: null })]),
      proposta('TP-07', [emp('C1', '10.00'), emp('C1', '20.00'), emp('C1', '30.00')]),
    ]);
    expect(q.propostas.map((p) => [p.numero, p.custoPeriodo, p.semCusto])).toEqual([
      ['TP-01', null, 'POUCOS_POSTOS'],
      ['TP-02', null, 'SEM_PERMISSAO'],
      ['TP-03', null, 'CUSTO_INCOMPLETO'],
      ['TP-04', null, 'CUSTO_INCOMPLETO'],
      ['TP-05', null, 'CUSTO_INCOMPLETO'],
      ['TP-06', null, 'CUSTOS_IGUAIS'],
      ['TP-07', '60.00', null],
    ]);
    // O total geral soma só os custos exibidos: nunca deixa deduzir o das outras.
    expect(q.total.custoPeriodoExibido).toBe('60.00');
    expect(q.total.postos.EMPREGADO).toBe(20);
  });

  it('propriedade: nenhum custo exibido ou enviado é igual ao custo de um só posto, nem múltiplo dele num grupo homogêneo', () => {
    const custos = ['1000.00', '2000.00', '0.00', '3500.50'];
    for (let n = 1; n <= 5; n++)
      for (let k = 0; k < custos.length; k++) {
        const es = Array.from({ length: n }, (_, i) => emp(`C${i % 2}`, custos[(i + k) % custos.length]!, { nome: i % 2 ? null : 'X' }));
        const m = mensagemQuadro(agregarQuadro([proposta('TP', es)]));
        for (const e of es) if (!e.custoPeriodo!.ehZero()) expect(m).not.toContain(`"${e.custoPeriodo!.paraString()}"`);
      }
  });

  it('categoria desconhecida fica fora de tudo; proposta só com ela não entra', () => {
    const q = agregarQuadro([
      proposta('TP-01', [emp('C1', '1.00'), emp('C1', '2.00', { categoria: 'OUTRA' })]),
      proposta('TP-02', [emp('C1', '1.00', { categoria: 'OUTRA' })]),
    ]);
    expect(q.propostas.map((p) => p.numero)).toEqual(['TP-01']);
    const p = q.propostas[0]!;
    expect([totalDePostos(q), p.anos[0]!.postos, p.cargos[0]!.postos]).toEqual([1, 1, 1]);
  });

  it('postosNoAno pega o contrato temporário que não está ativo em dezembro', () => {
    const p = agregarQuadro([
      proposta('TP', [emp('C1', '1.00'), emp('C1', '1.00', { inicio: '2028-01', fim: '2028-03' })], { vigencia: { inicio: '2027-01', fim: '2028-12' } }),
    ]).propostas[0]!;
    expect(p.anos.map((a) => [a.ano, a.postos, a.postosNoAno])).toEqual([
      [2027, 1, 1],
      [2028, 1, 2],
    ]);
  });

  it('a mensagem para a IA nunca leva nomes nem custos individuais', () => {
    const q = agregarQuadro([proposta('TP-01', [emp('C1', '4321.09', { nome: 'Maria Sigilosa' }), emp('C2', '1234.56', { nome: 'João Reservado' }), emp('C3', '1111.11')])]);
    const m = mensagemQuadro(q);
    for (const proibido of ['Maria Sigilosa', 'João Reservado', 'Pessoa Nominal', '4321.09', '1234.56', '1111.11']) expect(m).not.toContain(proibido);
    expect(m).toContain('6666.76');
  });

  it('só propostas com empregado, no máximo MAXIMO_PROPOSTAS; e no máximo MAXIMO_CARGOS cargos', () => {
    const muitas = Array.from({ length: MAXIMO_PROPOSTAS + 2 }, (_, i) => proposta(`TP-${i}`, [emp('C1', '1.00')]));
    const q = agregarQuadro([proposta('VAZIA', []), ...muitas]);
    expect(q.propostas).toHaveLength(MAXIMO_PROPOSTAS);
    expect(q.propostas[0]!.numero).toBe('TP-0');
    expect(q.propostasOmitidas).toBe(2);
    const cargos = Array.from({ length: MAXIMO_CARGOS + 1 }, (_, i) => [0, 1, 2].map(() => emp(`Cargo ${String(i).padStart(2, '0')}`, '1.00'))).flat();
    const p = agregarQuadro([proposta('TP', cargos)]).propostas[0]!;
    expect(p.cargos).toHaveLength(MAXIMO_CARGOS + 1);
    expect(p.cargos.at(-1)).toMatchObject({ cargo: DEMAIS_CARGOS, postos: 3 });
  });
});

describe('conferirAnalise', () => {
  it('tira itens vazios e corta as listas', () => {
    const r = conferirAnalise({ resumo: '  Quadro estável. ', destaques: ['a', ' ', ...Array(10).fill('b')], alertas: [] });
    expect(r.resumo).toBe('Quadro estável.');
    expect(r.destaques).toHaveLength(MAXIMO_ITENS);
    expect(r.destaques[0]).toBe('a');
    expect(r.alertas).toEqual([]);
  });
});
