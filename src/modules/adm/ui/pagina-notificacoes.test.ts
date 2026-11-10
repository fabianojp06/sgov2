import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Guarda e montagem da página das notificações de desempenho (US-041), sem banco: os casos de uso
// vêm do mock.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const chamadas = vi.hoisted(() => ({ opcoes: 0 }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  listarNotificacoes: async () => [
    { id: 'n1', conta: null, contaRotulo: 'Todas', contaAviso: null, limite: '80,50%', frequenciaDias: 7, usuario: { id: 'u1', nome: 'Ana Maria', ativo: true }, versao: 1 },
    {
      id: 'n2',
      conta: '9.9',
      contaRotulo: '9.9',
      contaAviso: 'Conta inexistente ou inativa',
      limite: '10,00%',
      frequenciaDias: 30,
      usuario: { id: 'u2', nome: 'Bruno Lima', ativo: false },
      versao: 3,
    },
  ],
  listarOpcoesNotificacao: async () => {
    chamadas.opcoes += 1;
    return { contas: [{ classificacao: '4.1', rotulo: '4.1 – DESPESAS OPERACIONAIS' }], usuarios: [{ id: 'u1', nome: 'Ana Maria' }] };
  },
}));

const { default: Pagina } = await import('../../../app/(sistema)/adm/notificacoes/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u0', usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  negacoes = [];
  chamadas.opcoes = 0;
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (aviso?: string) =>
  renderToString((await Pagina({ searchParams: Promise.resolve(aviso ? { aviso } : {}) })) as Parameters<typeof renderToString>[0]);

describe('página das notificações de desempenho', () => {
  it('sem permissão → 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Pagina({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.notificacoes']);
  });

  it('Administrador: formulário com "Todas" e as sintéticas, grade com Excluir e o aviso da conta inexistente', async () => {
    contexto = ctx(['adm.notificacoes:consultar', 'adm.notificacoes:incluir', 'adm.notificacoes:excluir']);
    const h = await html('incluida');
    expect(h).toContain('Destinatário da notificação adicionado com sucesso.');
    expect(h).toMatch(/<option value="\*">Todas<\/option>/);
    expect(h).toContain('4.1 – DESPESAS OPERACIONAIS');
    expect(h).toContain('(Conta inexistente ou inativa)');
    expect(h).toContain('Bruno Lima (inativo)');
    expect(h.match(/>Excluir</g)).toHaveLength(2);
    expect(h).toContain('<th scope="col">Limite</th>');
  });

  it('só consultar: sem formulário, sem Excluir e sem carregar as opções; aviso desconhecido é ignorado', async () => {
    contexto = ctx(['adm.notificacoes:consultar']);
    const h = await html('<script>');
    expect(h).not.toContain('Adicionar');
    expect(h).not.toContain('>Excluir<');
    expect(h).not.toContain('&lt;script');
    expect(chamadas.opcoes).toBe(0);
  });
});
