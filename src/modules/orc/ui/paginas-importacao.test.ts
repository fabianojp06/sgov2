import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const situacao = vi.hoisted(() => ({ valor: 'EM_ELABORACAO', rotulo: 'Em Elaboração' }));
vi.mock('@/modules/orc', async (original) => ({
  ...(await original<typeof import('@/modules/orc')>()),
  listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: situacao.valor, rotuloSituacao: situacao.rotulo, versao: 0 }],
}));
const { default: Pagina } = await import('../../../app/(sistema)/orc/importacao/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;

beforeEach(() => {
  situacao.valor = 'EM_ELABORACAO';
  situacao.rotulo = 'Em Elaboração';
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async () => undefined);
});

const searchParams = Promise.resolve({});
const html = async () => renderToString((await Pagina({ searchParams })) as Parameters<typeof renderToString>[0]);

describe('página de importação', () => {
  it('sem orc.importacao:consultar (Gestor de Diretoria): 404', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    await expect(Pagina({ searchParams })).rejects.toEqual(expect.objectContaining({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }));
  });

  it('GFIN: formulário no exercício editável; fora de edição, o aviso da situação', async () => {
    contexto = ctx(['orc.importacao:consultar', 'orc.importacao:executar']);
    const h = await html();
    expect(h).toContain('Planilha (layout ADMC-ORC v1.0)');
    expect(h).toContain('aria-label="Exercício"');
    situacao.valor = 'EM_APROVACAO';
    situacao.rotulo = 'Em Aprovação';
    expect(await html()).toContain('Este exercício não pode ser alterado na situação Em Aprovação.');
  });

  it('só consultar: sem formulário', async () => {
    contexto = ctx(['orc.importacao:consultar']);
    const h = await html();
    expect(h).not.toContain('type="file"');
    expect(h).toContain('não importar');
  });
});
void createElement;
