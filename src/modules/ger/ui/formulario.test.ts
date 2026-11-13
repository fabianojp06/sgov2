import { redirect } from 'next/navigation';
import { describe, expect, it } from 'vitest';
import { ok } from '@/shared/kernel';
import { MENSAGEM_FALHA_ACAO } from './acao-confirmada';
import { executarFormulario } from './formulario';

// US-022: o formulário não perde o que foi digitado. A falha da ação (rede, exceção) vira erro no
// resumo, sem derrubar a tela; redirect segue para o Next.
const dados = () => {
  const d = new FormData();
  d.set('nome', 'Fulano');
  return d;
};

describe('executarFormulario (US-022)', () => {
  it('devolve o Resultado da ação, com sucesso ou com os erros por campo', async () => {
    expect(await executarFormulario(async (d) => ok(d.get('nome')), dados())).toEqual({ ok: true, valor: 'Fulano' });
    const erros = [{ campo: 'nome', mensagem: 'Informe o nome.' }];
    expect(await executarFormulario(async () => ({ ok: false as const, erros }), dados())).toEqual({ ok: false, erros });
  });

  it('falha de rede ou exceção vira a mensagem geral, sem lançar', async () => {
    const r = await executarFormulario(async () => {
      throw new TypeError('Failed to fetch');
    }, dados());
    expect(r).toEqual({ ok: false, erros: [{ campo: '', mensagem: MENSAGEM_FALHA_ACAO }] });
  });

  it('redirect da Server Action segue para o Next', async () => {
    await expect(executarFormulario(async () => redirect('/inicio'), dados())).rejects.toThrow();
  });
});
