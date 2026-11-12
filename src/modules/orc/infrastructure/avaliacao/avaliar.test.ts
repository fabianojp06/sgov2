import { describe, expect, it } from 'vitest';
import { criarProvedorIAFalso, ErroIA, type CodigoErroIA, type ServicoIA } from '@/shared/ia';
import { RAIZES_CONTAS_PESSOAL } from '../../domain/planilha';
import { avaliarSugestaoConta, ESPERA_LIMITE_USUARIO_MS, type CasoAvaliacaoConta } from './avaliar';
import casosJson from './sugestao-conta.casos.json';

// Avaliação da sugestão de conta (D-P14-9) com o provedor falso: o cálculo do acerto no top-3, os
// erros da IA e a repetição no limite por minuto, sem banco. O serviço só repassa ao provedor (a
// governança tem testes próprios).
const LISTAS = {
  contas: [
    { classificacao: '4.1.1.5.005', descricao: 'Material de escritório' },
    { classificacao: '4.1.1.5.028', descricao: 'Material de Informática' },
    { classificacao: '4.1.1.3.001', descricao: 'Passagem aérea' },
    { classificacao: '4.1.1.6.011', descricao: 'Treinamento de pessoal' },
  ],
  ccs: [{ classificacao: '4.3.0', descricao: 'Gabinete da Diretoria Administrativa Financeira' }],
};
const QUEM = { usuarioId: '00000000-0000-0000-0000-000000000001', permissoes: new Set<string>() };
const semEspera = { esperar: async () => undefined };

const resposta = (...contas: string[]) => ({ contas: contas.map((conta) => ({ conta, motivo: 'Motivo de teste.' })), cc: { cc: '4.3.0', motivo: 'Motivo de teste.' } });

/**
 * Serviço que responde por caso: o roteiro do falso muda conforme a descrição na mensagem. Em erros,
 * cada código da lista vale para uma chamada daquele caso, na ordem; depois vem a resposta.
 */
function servico(porDescricao: Record<string, unknown>, erros: Record<string, CodigoErroIA[]> = {}) {
  const falso = criarProvedorIAFalso();
  const pendentes = Object.fromEntries(Object.entries(erros).map(([k, v]) => [k, [...v]]));
  const s = {
    async gerarEstruturado(_quem, caso, mensagem, schema, sinal) {
      const chave = [...Object.keys(porDescricao), ...Object.keys(pendentes)].find((d) => mensagem.includes(d));
      falso.roteiro.estruturado = chave === undefined ? undefined : porDescricao[chave];
      const erro = chave === undefined ? undefined : pendentes[chave]?.shift();
      if (erro) falso.roteiro.erro = erro;
      else delete falso.roteiro.erro;
      return falso.gerarEstruturado({ instrucaoSistema: caso.instrucaoSistema, mensagem, ...(sinal ? { sinal } : {}) }, schema);
    },
  } as Pick<ServicoIA, 'gerarEstruturado'> as ServicoIA;
  return { s, falso };
}

describe('avaliarSugestaoConta', () => {
  it('acerto no top-3: a conta esperada em qualquer das 3 posições conta; fora delas, ou fora da lista, não', async () => {
    const casos: CasoAvaliacaoConta[] = [
      { descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Toners e cabos de rede para os computadores', contaEsperada: '4.1.1.5.028' },
      { descricao: 'Curso de capacitação em licitações', contaEsperada: '4.1.1.6.011' },
      { descricao: 'Passagens aéreas para reunião técnica', contaEsperada: '4.1.1.3.001' },
    ];
    const { s, falso } = servico({
      'Resmas de papel': resposta('4.1.1.5.005'),
      'Toners e cabos': resposta('4.1.1.5.005', '4.1.1.3.001', '4.1.1.5.028'),
      // Errou: a esperada não veio.
      'Curso de capacitação': resposta('4.1.1.5.005', '4.1.1.5.028'),
      // A esperada veio, mas a vetada no topo é descartada pela conferência e não atrapalha.
      'Passagens aéreas': resposta('4.1.1.1.001', '4.1.1.3.001'),
    });
    expect(await avaliarSugestaoConta(s, QUEM, casos, { ...LISTAS, ...semEspera })).toEqual({ total: 4, acertosTop3: 3, errosIa: 0, taxa: 0.75 });
    expect(falso.chamadas).toHaveLength(4);
    // A mesma mensagem do caso de uso: a descrição e as listas.
    expect(falso.chamadas[0]!.mensagem).toContain('Resmas de papel para o setor');
    expect(falso.chamadas[0]!.mensagem).toContain('4.1.1.5.028 – Material de Informática');
    // Sinal padrão: o tempo limite de 30 s, um por caso.
    expect(falso.chamadas.every((p) => p.sinal instanceof AbortSignal && !p.sinal.aborted)).toBe(true);
    expect(new Set(falso.chamadas.map((p) => p.sinal)).size).toBe(4);
  });

  it('conta esperada fora da lista nunca acerta, mesmo que a IA a devolva', async () => {
    const { s } = servico({ 'Salários da equipe': resposta('4.1.1.1.001') });
    expect(await avaliarSugestaoConta(s, QUEM, [{ descricao: 'Salários da equipe toda', contaEsperada: '4.1.1.1.001' }], LISTAS)).toEqual({
      total: 1,
      acertosTop3: 0,
      errosIa: 0,
      taxa: 0,
    });
  });

  it('resposta fora do formato ou IA fora do ar num caso: erro daquele caso; IA desligada invalida a medição', async () => {
    const casos = [
      { descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Resposta quebrada da IA aqui', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Fora do ar neste momento', contaEsperada: '4.1.1.5.005' },
    ];
    const { s } = servico({ 'Resmas de papel': resposta('4.1.1.5.005'), 'Resposta quebrada': { contas: [] } }, { 'Fora do ar': ['ia.indisponivel'] });
    expect(await avaliarSugestaoConta(s, QUEM, casos, { ...LISTAS, ...semEspera })).toEqual({ total: 3, acertosTop3: 1, errosIa: 2, taxa: 1 / 3 });
    const desligada = servico({}, { 'Resmas de papel': ['ia.desligada'] });
    await expect(avaliarSugestaoConta(desligada.s, QUEM, casos.slice(0, 1), LISTAS)).rejects.toBeInstanceOf(ErroIA);
  });

  it('limite por minuto: espera e repete o mesmo caso; esgotadas as tentativas, erro daquele caso', async () => {
    const esperas: number[] = [];
    const esperar = async (ms: number) => {
      esperas.push(ms);
    };
    const casos = [
      { descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Curso de capacitação em licitações', contaEsperada: '4.1.1.6.011' },
    ];
    const { s, falso } = servico(
      { 'Resmas de papel': resposta('4.1.1.5.005'), 'Curso de capacitação': resposta('4.1.1.6.011') },
      { 'Resmas de papel': ['ia.limite_usuario', 'ia.limite_usuario'], 'Curso de capacitação': ['ia.limite_usuario', 'ia.limite_usuario', 'ia.limite_usuario'] },
    );
    expect(await avaliarSugestaoConta(s, QUEM, casos, { ...LISTAS, esperar, tentativas: 3 })).toEqual({ total: 2, acertosTop3: 1, errosIa: 1, taxa: 0.5 });
    // 1º caso: duas recusas e o acerto na 3ª tentativa; 2º caso: três recusas, duas esperas e o erro.
    expect(esperas).toEqual([ESPERA_LIMITE_USUARIO_MS, ESPERA_LIMITE_USUARIO_MS, ESPERA_LIMITE_USUARIO_MS, ESPERA_LIMITE_USUARIO_MS]);
    expect(falso.chamadas).toHaveLength(6);
  });

  it('cancelamento pelo tempo limite do caso: erro daquele caso; outro cancelamento invalida a medição', async () => {
    const caso = [{ descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' }];
    const { s } = servico({ 'Resmas de papel': resposta('4.1.1.5.005') });
    const esgotado = () => AbortSignal.abort(new DOMException('tempo esgotado', 'TimeoutError'));
    expect(await avaliarSugestaoConta(s, QUEM, caso, { ...LISTAS, sinal: esgotado })).toEqual({ total: 1, acertosTop3: 0, errosIa: 1, taxa: 0 });
    await expect(avaliarSugestaoConta(s, QUEM, caso, { ...LISTAS, sinal: () => AbortSignal.abort() })).rejects.toMatchObject({ codigo: 'ia.cancelada' });
  });

  describe('sinal da avaliação inteira (sinalGeral)', () => {
    const casos = [
      { descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Toners e cabos de rede para os computadores', contaEsperada: '4.1.1.5.028' },
      { descricao: 'Curso de capacitação em licitações', contaEsperada: '4.1.1.6.011' },
    ];
    const respostas = { 'Resmas de papel': resposta('4.1.1.5.005'), 'Toners e cabos': resposta('4.1.1.5.028'), 'Curso de capacitação': resposta('4.1.1.6.011') };

    it('abortado no meio da segunda chamada: ErroIA ia.cancelada, sem contar como erro da IA nem seguir para o terceiro caso', async () => {
      const geral = new AbortController();
      const { s } = servico(respostas);
      let n = 0;
      const comAborto = {
        gerarEstruturado: (...a: Parameters<ServicoIA['gerarEstruturado']>) => {
          if (++n === 2) geral.abort(new DOMException('tempo da avaliação esgotado', 'TimeoutError'));
          return s.gerarEstruturado(...a);
        },
      } as Pick<ServicoIA, 'gerarEstruturado'> as ServicoIA;
      const r = avaliarSugestaoConta(comAborto, QUEM, casos, { ...LISTAS, ...semEspera, sinalGeral: geral.signal });
      await expect(r).rejects.toBeInstanceOf(ErroIA);
      await expect(r).rejects.toMatchObject({ codigo: 'ia.cancelada' });
      expect(n).toBe(2);
    });

    it('com o sinal geral presente, o tempo esgotado de um caso conta como erro da IA e a avaliação continua', async () => {
      const { s, falso } = servico(respostas);
      let n = 0;
      const sinal = () => (++n === 1 ? AbortSignal.abort(new DOMException('tempo esgotado', 'TimeoutError')) : AbortSignal.timeout(30_000));
      const r = await avaliarSugestaoConta(s, QUEM, casos, { ...LISTAS, ...semEspera, sinal, sinalGeral: new AbortController().signal });
      expect(r).toEqual({ total: 3, acertosTop3: 2, errosIa: 1, taxa: 2 / 3 });
      expect(falso.chamadas).toHaveLength(3);
    });

    it('abortado durante a espera do limite por minuto: ErroIA ia.cancelada, sem nova tentativa', async () => {
      const geral = new AbortController();
      const { s, falso } = servico(respostas, { 'Resmas de papel': ['ia.limite_usuario'] });
      const esperar = async () => {
        geral.abort();
      };
      await expect(avaliarSugestaoConta(s, QUEM, casos, { ...LISTAS, esperar, sinalGeral: geral.signal })).rejects.toMatchObject({ codigo: 'ia.cancelada' });
      expect(falso.chamadas).toHaveLength(1);
    });
  });

  it('sem casos: taxa zero', async () => {
    expect(await avaliarSugestaoConta(servico({}).s, QUEM, [], LISTAS)).toEqual({ total: 0, acertosTop3: 0, errosIa: 0, taxa: 0 });
  });
});

describe('casos sintéticos da avaliação (sugestao-conta.casos.json)', () => {
  const casos = casosJson as CasoAvaliacaoConta[];
  it('30 casos, descrições de 10 a 1000 caracteres, contas analíticas de 5 níveis fora das raízes de pessoal e dos encargos 4.1.1.8', () => {
    expect(casos).toHaveLength(30);
    expect(new Set(casos.map((c) => c.descricao)).size).toBe(30);
    for (const c of casos) {
      expect(Object.keys(c).sort()).toEqual(['contaEsperada', 'descricao']);
      expect([...c.descricao].length).toBeGreaterThanOrEqual(10);
      expect([...c.descricao].length).toBeLessThanOrEqual(1000);
      expect(c.contaEsperada).toMatch(/^4\.1\.1\.\d\.\d{3}$/);
      expect(RAIZES_CONTAS_PESSOAL.some((r) => c.contaEsperada.startsWith(`${r}.`))).toBe(false);
      expect(c.contaEsperada.startsWith('4.1.1.8.')).toBe(false);
    }
  });

  it('pares que confundem: aluguel de carro em viagem × administrativo e contas Extra TP', () => {
    const esperadas = new Set(casos.map((c) => c.contaEsperada));
    for (const conta of ['4.1.1.3.011', '4.1.1.5.025', '4.1.1.3.005', '4.1.1.5.036', '4.1.1.6.027']) expect(esperadas.has(conta)).toBe(true);
    expect(casos.some((c) => /software de BI/i.test(c.descricao))).toBe(true);
  });
});
