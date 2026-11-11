import { describe, expect, it } from 'vitest';
import { criarProvedorIAFalso, ErroIA, type CodigoErroIA, type ServicoIA } from '@/shared/ia';
import { RAIZES_CONTAS_PESSOAL } from '../../domain/planilha';
import { avaliarSugestaoConta, type CasoAvaliacaoConta } from './avaliar';
import casosJson from './sugestao-conta.casos.json';

// Avaliação da sugestão de conta (D-P14-9) com o provedor falso: o cálculo do acerto no top-3 e a
// conferência das listas, sem banco. O serviço só repassa ao provedor (a governança tem testes próprios).
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

const resposta = (...contas: string[]) => ({ contas: contas.map((conta) => ({ conta, motivo: 'Motivo de teste.' })), cc: { cc: '4.3.0', motivo: 'Motivo de teste.' } });

/** Serviço que responde por caso: o roteiro do falso muda conforme a descrição na mensagem. */
function servico(porDescricao: Record<string, unknown>, erros: Record<string, CodigoErroIA> = {}) {
  const falso = criarProvedorIAFalso();
  const s = {
    async gerarEstruturado(_quem, caso, mensagem, schema, sinal) {
      const chave = Object.keys(porDescricao).find((d) => mensagem.includes(d)) ?? Object.keys(erros).find((d) => mensagem.includes(d));
      falso.roteiro.estruturado = chave === undefined ? undefined : porDescricao[chave];
      if (chave !== undefined && erros[chave]) falso.roteiro.erro = erros[chave];
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
    expect(await avaliarSugestaoConta(s, QUEM, casos, LISTAS)).toEqual({ total: 4, acertosTop3: 3, taxa: 0.75 });
    expect(falso.chamadas).toHaveLength(4);
    // A mesma mensagem do caso de uso: a descrição e as listas.
    expect(falso.chamadas[0]!.mensagem).toContain('Resmas de papel para o setor');
    expect(falso.chamadas[0]!.mensagem).toContain('4.1.1.5.028 – Material de Informática');
  });

  it('conta esperada fora da lista nunca acerta, mesmo que a IA a devolva', async () => {
    const { s } = servico({ 'Salários da equipe': resposta('4.1.1.1.001') });
    expect(await avaliarSugestaoConta(s, QUEM, [{ descricao: 'Salários da equipe toda', contaEsperada: '4.1.1.1.001' }], LISTAS)).toEqual({ total: 1, acertosTop3: 0, taxa: 0 });
  });

  it('resposta fora do formato ou IA fora do ar num caso: erro daquele caso; IA desligada invalida a medição', async () => {
    const casos = [
      { descricao: 'Resmas de papel para o setor', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Resposta quebrada da IA aqui', contaEsperada: '4.1.1.5.005' },
      { descricao: 'Fora do ar neste momento', contaEsperada: '4.1.1.5.005' },
    ];
    const { s } = servico({ 'Resmas de papel': resposta('4.1.1.5.005'), 'Resposta quebrada': { contas: [] } }, { 'Fora do ar': 'ia.indisponivel' });
    expect(await avaliarSugestaoConta(s, QUEM, casos, LISTAS)).toEqual({ total: 3, acertosTop3: 1, taxa: 1 / 3 });
    const desligada = servico({}, { 'Resmas de papel': 'ia.desligada' });
    await expect(avaliarSugestaoConta(desligada.s, QUEM, casos.slice(0, 1), LISTAS)).rejects.toBeInstanceOf(ErroIA);
  });

  it('sem casos: taxa zero', async () => {
    expect(await avaliarSugestaoConta(servico({}).s, QUEM, [], LISTAS)).toEqual({ total: 0, acertosTop3: 0, taxa: 0 });
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
});
