import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AcoesCiclo } from './acoes-ciclo';
import { FormRejeicao } from './form-rejeicao';

// Tela de envio e aprovação (US-061; plano do P6, Task 8).
const acao = async () => ({ ok: true as const, valor: undefined });
const ex = (situacao: string, rotulo: string) => ({ id: 'e1', ano: 2027, situacao, rotuloSituacao: rotulo, versao: 4 });
const html = (p: Partial<Parameters<typeof AcoesCiclo>[0]>) =>
  renderToString(createElement(AcoesCiclo, { exercicio: ex('EM_ELABORACAO', 'Em Elaboração'), tramites: [], podeEnviar: true, podeAprovar: true, enviar: acao, aprovar: acao, rejeitar: acao, ...p }));

describe('AcoesCiclo', () => {
  it('Em Elaboração: Enviar só com executar; sem Aprovar', () => {
    expect(html({})).toContain('Enviar para aprovação');
    expect(html({})).not.toContain('>Aprovar<');
    expect(html({ podeEnviar: false })).not.toContain('Enviar para aprovação');
  });

  it('Em Aprovação: Aprovar e o formulário de rejeição só com aprovar', () => {
    const h = html({ exercicio: ex('EM_APROVACAO', 'Em Aprovação') });
    expect(h).toContain('>Aprovar</button>');
    expect(h).toContain('Justificativa da rejeição');
    expect(h).not.toContain('Enviar para aprovação');
    expect(html({ exercicio: ex('EM_APROVACAO', 'Em Aprovação'), podeAprovar: false })).not.toContain('Justificativa da rejeição');
  });

  it('Oficializado: a data e nenhum botão; trâmites em tabela', () => {
    const h = html({
      exercicio: ex('OFICIALIZADO', 'Oficializado'),
      tramites: [
        { de: 'Em Elaboração', para: 'Em Aprovação', usuario: 'Gestora GFIN', justificativa: null, em: new Date('2026-11-27T13:00:00Z') },
        { de: 'Em Aprovação', para: 'Oficializado', usuario: 'Diretor', justificativa: null, em: new Date('2026-11-30T15:30:00Z') },
      ],
    });
    expect(h).toContain('Oficializado em 30/11/2026, 12:30');
    expect(h).not.toContain('<button');
    expect(h).toMatch(/<th scope="col">Justificativa<\/th>/);
    expect(h).toContain('Gestora GFIN');
  });
});

describe('FormRejeicao', () => {
  it('justificativa obrigatória com a regra dos 15 caracteres ligada ao campo', () => {
    const h = renderToString(createElement(FormRejeicao, { id: 'e1', versao: 4, rejeitar: acao }));
    expect(h).toContain('aria-describedby="rejeicao-regra erro-justificativa"');
    expect(h).toContain('Pelo menos 15 caracteres.');
    expect(h).toContain('name="versao" value="4"');
  });
});
