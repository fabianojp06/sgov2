import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Tela de login com o aviso da RN0519 (US-028): só com ?motivo=novo-acesso.
const { default: Login } = await import('../../../app/login/page');
const html = async (motivo?: string | string[]) =>
  renderToString((await Login({ searchParams: Promise.resolve(motivo === undefined ? {} : { motivo }) })) as Parameters<typeof renderToString>[0]);
const AVISO = 'Sua sessão foi encerrada porque um novo acesso foi realizado com suas credenciais.';

describe('página de login', () => {
  it('com motivo=novo-acesso: o aviso em role="alert"', async () => {
    expect(await html('novo-acesso')).toContain(`<p role="alert">${AVISO}</p>`);
  });

  it('sem motivo, com outro valor ou repetido: sem aviso', async () => {
    for (const m of [undefined, 'outro', ['novo-acesso', 'novo-acesso']]) expect(await html(m)).not.toContain(AVISO);
  });
});
