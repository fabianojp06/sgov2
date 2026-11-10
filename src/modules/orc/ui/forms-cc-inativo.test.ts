// Revisão 12.12 do #365: ao alterar um lançamento cujo CC saiu da estrutura ativa (fora das opções), o
// seletor começa vazio, para o lançamento não mudar de CC sem o usuário escolher.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormPacote } from './form-pacote';
import { FormPosicao } from './form-posicao';

const ccs = [{ classificacao: '4.1.1', descricao: 'Ativo' }];
const salvar = async () => ({ ok: true as const });
const comum = { ano: 2032, exercicioId: 'e1', ccAtual: '4.1.1', ccs, quantidadeMaxima: 9999, salvar: salvar as never, cancelarPara: '/x' };
const vazioSelecionado = /<option value="" disabled="" selected="">Escolha o centro de custo<\/option>/;

const posicao = (cc: string) =>
  renderToStaticMarkup(
    createElement(FormPosicao, {
      ...comum,
      previa: (async () => ({ ok: false, erros: [] })) as never,
      posicao: { id: 'p1', cc, cargo: 'Analista', quantidade: '1', salarioMensal: '1000.00', mesInicio: '1', mesSaida: '12', observacao: '', versao: 0 },
    }),
  );
const pacote = (cc: string) =>
  renderToStaticMarkup(
    createElement(FormPacote, {
      ...comum,
      contas: [{ classificacao: '4.2.1.1.001', descricao: 'Conta' }],
      ipca: null,
      pacote: { id: 'k1', cc, conta: '4.2.1.1.001', justificativa: 'Justificativa longa', prioridade: 'ESSENCIAL', quantidade: '1', valorUnitario: '10.00', corrigirIpca: false, distribuicao: 'MENSAL', mesOcorrencia: '', versao: 0 },
    }),
  );

describe('formulários com CC fora das opções', () => {
  it('posição: CC inativo começa vazio; CC ativo continua selecionado', () => {
    expect(posicao('4.9.9')).toMatch(vazioSelecionado);
    expect(posicao('4.1.1')).not.toContain('Escolha o centro de custo');
  });
  it('pacote: CC inativo começa vazio; CC ativo continua selecionado', () => {
    expect(pacote('4.9.9')).toMatch(vazioSelecionado);
    expect(pacote('4.1.1')).not.toContain('Escolha o centro de custo');
  });
  it('posição: cargo, quantidade e salário sinalizados como obrigatórios', () => {
    const html = posicao('4.1.1');
    for (const nome of ['cargo', 'quantidade', 'salarioMensal']) expect(html).toMatch(new RegExp(`<input[^>]*aria-required="true"[^>]*name="${nome}"`));
  });
});
