import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ situacao: 'RASCUNHO' as 'RASCUNHO' | 'EM_APROVACAO', origem: 'IMPORTACAO', conta: '4.1.1.5.005', iaLigada: false }));
vi.mock('@/modules/orc', async (original) => {
  const editavel = () => caso.situacao === 'RASCUNHO';
  const k = () => ({
    id: 'p1', cc: '4.3.0', conta: caso.conta, justificativa: 'Reposição de material de escritório', prioridade: 'IMPORTANTE', quantidade: 3,
    valorUnitario: Dinheiro.de('100.00'), corrigirIpca: false, distribuicao: 'MENSAL', mesOcorrencia: null, origem: caso.origem, versao: 2,
    valorAnual: Dinheiro.de('300.00'), meses: Array.from({ length: 12 }, () => Dinheiro.de('25.00')),
  });
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    // servicoIA.disponivel (#390): permissão do caso e IA ligada (chave geral, caso ativo e tetos).
    iaLiberada: async (c: ContextoRequisicao, nome: string) => caso.iaLigada && nome === 'justificativa' && c.permissoes.has(['orc.ia_justificativa', 'executar'].join(':')),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', versao: 0 }],
    listarPacotes: async () => ({ pacotes: [k()], editavel: editavel() }),
    opcoesPacote: async () => ({
      ccs: [{ classificacao: '4.3.0', descricao: 'Gabinete' }], contas: [{ classificacao: '4.1.1.5.005', descricao: 'Material de escritório' }],
      ipca: '4.5000', quantidadeMaxima: 9999, situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', editavel: editavel(),
    }),
  };
});

const { default: Pacotes } = await import('../../../app/(sistema)/orc/pacotes/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const TUDO = ['orc.pacotes:consultar', 'orc.pacotes:incluir', 'orc.pacotes:alterar', 'orc.pacotes:excluir'];
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.situacao = 'RASCUNHO';
  caso.origem = 'IMPORTACAO';
  caso.conta = '4.1.1.5.005';
  caso.iaLigada = false;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Pacotes({ searchParams: Promise.resolve(busca) }));

describe('página de pacotes base zero', () => {
  it('sem orc.pacotes:consultar: 404 com a negação auditada', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await digest(Pacotes({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.pacotes']);
  });

  it('DIREX/Auditor (só consultar): lista sem ações e sem formulário', async () => {
    contexto = ctx(['orc.pacotes:consultar']);
    const h = await html();
    expect(h).toContain('Pacotes do CC 4.3.0');
    expect(h).toContain('300,00');
    expect(h).not.toContain('Excluir pacote 1: 4.1.1.5.005, Reposição de material de escritório');
    expect(h).not.toContain('Novo pacote');
  });

  it('Gestor/GFIN: formulário de inclusão com prévia; com ?editar=, a linha destacada e o aviso da planilha', async () => {
    contexto = ctx(TUDO);
    const nova = await html();
    expect(nova).toContain('Novo pacote');
    expect(nova).toContain('Excluir pacote 1: 4.1.1.5.005, Reposição de material de escritório');
    const edicao = await html({ editar: 'p1' });
    expect(edicao).toContain('Alterar pacote');
    expect(edicao).toContain('aria-current="true"');
    expect(edicao).toContain('Este pacote veio da planilha: uma nova importação deste CC o substitui.');
    expect(edicao).toContain('Valor anual: R$ 300,00');
  });

  it('aviso de origem: cópia do exercício anterior tem texto próprio; o da tela não tem aviso', async () => {
    contexto = ctx(TUDO);
    caso.origem = 'COPIA';
    expect(await html({ editar: 'p1' })).toContain('Este pacote veio da cópia do exercício anterior: uma nova importação deste CC o substitui.');
    caso.origem = 'TELA';
    const h = await html({ editar: 'p1' });
    expect(h).not.toContain('uma nova importação deste CC o substitui');
    expect(h).not.toContain('não é mais permitida');
  });

  it('alteração de pacote cuja conta saiu das opções: a nota pede outra conta', async () => {
    contexto = ctx(TUDO);
    caso.conta = '4.1.1.1.001';
    expect(await html({ editar: 'p1' })).toContain('A conta 4.1.1.1.001 não é mais permitida em pacote; escolha outra.');
  });

  it('ajuda da IA na justificativa (D-P14-5): o painel aparece só com a IA disponível para a pessoa, na inclusão e na alteração', async () => {
    caso.iaLigada = true;
    contexto = ctx(TUDO);
    expect(await html()).not.toContain('Pedir ajuda da IA na justificativa');
    contexto = ctx([...TUDO, ['orc.ia_justificativa', 'executar'].join(':')]);
    // Com a permissão, mas a IA desligada: o botão some.
    caso.iaLigada = false;
    expect(await html()).not.toContain('Pedir ajuda da IA na justificativa');
    caso.iaLigada = true;
    for (const busca of [{}, { editar: 'p1' }]) {
      const h = await html(busca);
      expect(h).toContain('Pedir ajuda da IA na justificativa');
      expect(h).toContain('Não escreva nomes de pessoas no texto enviado à IA.');
      // O selo só aparece com uma resposta; a marca da sugestão só depois de um "Usar …".
      expect(h).not.toContain('Gerado com IA – revisar');
      expect(h).not.toContain('name="sugestaoIa"');
    }
  });

  it('exercício fechado: só leitura, com a mensagem da situação', async () => {
    contexto = ctx(TUDO);
    caso.situacao = 'EM_APROVACAO';
    const h = await html({ editar: 'p1' });
    expect(h).toContain('Este exercício não pode ser alterado na situação Em Aprovação.');
    expect(h).not.toContain('Novo pacote');
    expect(h).not.toContain('Alterar pacote');
    expect(h).not.toContain('Excluir pacote 1: 4.1.1.5.005, Reposição de material de escritório');
  });
});
