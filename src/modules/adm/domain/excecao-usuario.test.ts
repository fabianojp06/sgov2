import { describe, expect, it } from 'vitest';
import { aplicarExcecoes, chaveExcecao, MENSAGENS_EXCECAO, type FuncionalidadesDoPerfil } from './excecao-usuario';

// Funcionalidades de cada perfil (perfil_permissao), como o caso de uso as carrega do banco.
const doPerfil: Record<string, FuncionalidadesDoPerfil> = {
  ORCAMENTISTA: { retiraveis: ['cad.plano_contas', 'cad.centros_custo'], fixas: [] },
  GFIN: { retiraveis: ['cad.plano_contas', 'orc.orcamento'], fixas: [] },
  ADMINISTRADOR: { retiraveis: ['cad.plano_contas'], fixas: ['adm.usuarios'] },
  E2E: { retiraveis: [], fixas: [] },
};
const funcionalidades = (perfil: string) => doPerfil[perfil] ?? { retiraveis: [], fixas: [] };
const ehAdm = (f: string) => f.startsWith('adm.');
const aplicar = (perfis: string[], excecoes: { perfil: string; funcionalidade: string }[]) => aplicarExcecoes(perfis, excecoes, funcionalidades, ehAdm);
const ex = (perfil: string, funcionalidade: string) => ({ perfil, funcionalidade });
const erro = (mensagem: string) => ({ ok: false, erros: [{ campo: 'excecoes', mensagem }] });

describe('aplicarExcecoes (REQ0080, REQ0081)', () => {
  it('exceções válidas passam, sem mexer nos perfis', () => {
    const excecoes = [{ perfil: 'ORCAMENTISTA', funcionalidade: 'cad.centros_custo' }];
    expect(aplicar(['ORCAMENTISTA', 'GFIN'], excecoes)).toEqual({
      ok: true,
      valor: { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes, perfisDesmarcados: [] },
    });
  });

  it('perfil não associado ao usuário: recusada', () => {
    expect(aplicar(['GFIN'], [{ perfil: 'ORCAMENTISTA', funcionalidade: 'cad.centros_custo' }])).toEqual(erro(MENSAGENS_EXCECAO.PERFIL_NAO_ASSOCIADO));
  });

  it('funcionalidade que o perfil não tem (ou inativa, fora das retiráveis): recusada', () => {
    expect(aplicar(['GFIN'], [{ perfil: 'GFIN', funcionalidade: 'cad.centros_custo' }])).toEqual(erro(MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL));
  });

  it('funcionalidade da Administração: recusada para qualquer perfil, mesmo não associado (A1)', () => {
    expect(aplicar(['ADMINISTRADOR'], [{ perfil: 'ADMINISTRADOR', funcionalidade: 'adm.usuarios' }])).toEqual(erro(MENSAGENS_EXCECAO.ADMINISTRACAO));
    expect(aplicar(['GFIN'], [{ perfil: 'ORCAMENTISTA', funcionalidade: 'adm.historico' }])).toEqual(erro(MENSAGENS_EXCECAO.ADMINISTRACAO));
  });

  it('todas as funcionalidades de um perfil excetuadas: o perfil sai, com as exceções dele (REQ0081)', () => {
    const r = aplicar(
      ['ORCAMENTISTA', 'GFIN'],
      [
        { perfil: 'ORCAMENTISTA', funcionalidade: 'cad.plano_contas' },
        { perfil: 'ORCAMENTISTA', funcionalidade: 'cad.centros_custo' },
        { perfil: 'GFIN', funcionalidade: 'orc.orcamento' },
      ],
    );
    expect(r).toEqual({
      ok: true,
      valor: { perfis: ['GFIN'], excecoes: [{ perfil: 'GFIN', funcionalidade: 'orc.orcamento' }], perfisDesmarcados: ['ORCAMENTISTA'] },
    });
  });

  it('perfil com funcionalidade fixa (Administração) não é desmarcado, nem perfil sem funcionalidade', () => {
    const r = aplicar(['ADMINISTRADOR', 'E2E'], [{ perfil: 'ADMINISTRADOR', funcionalidade: 'cad.plano_contas' }]);
    expect(r.ok && r.valor.perfis).toEqual(['ADMINISTRADOR', 'E2E']);
  });

  it('exceção atual não exibida fica; exibida e não pedida sai; sem exibidas, nenhuma sai (M1 e B3 da revisão 12.12)', () => {
    const atuais = [ex('ORCAMENTISTA', 'cad.centros_custo'), ex('GFIN', 'orc.orcamento')];
    const com = (exibidas?: string[]) => aplicarExcecoes(['ORCAMENTISTA', 'GFIN'], [], funcionalidades, ehAdm, { atuais, exibidas });
    const naoExibida = com(['ORCAMENTISTA:cad.plano_contas']);
    expect(naoExibida.ok && naoExibida.valor.excecoes).toEqual(atuais);
    const r = com(['ORCAMENTISTA:cad.centros_custo']);
    expect(r.ok && r.valor.excecoes).toEqual([ex('GFIN', 'orc.orcamento')]);
    const sem = com(undefined);
    expect(sem.ok && sem.valor.excecoes).toEqual(atuais);
  });

  it('exceção atual pedida de novo não é conferida (a funcionalidade pode ter ficado inativa); a de perfil retirado cai', () => {
    const atuais = [ex('ORCAMENTISTA', 'cad.inativa'), ex('GFIN', 'orc.orcamento')];
    const r = aplicarExcecoes(['ORCAMENTISTA'], [ex('ORCAMENTISTA', 'cad.inativa')], funcionalidades, ehAdm, { atuais, exibidas: [] });
    expect(r).toEqual({ ok: true, valor: { perfis: ['ORCAMENTISTA'], excecoes: [ex('ORCAMENTISTA', 'cad.inativa')], perfisDesmarcados: [] } });
  });

  it('REQ0081 conta as exceções mantidas: a última retirada desmarca o perfil', () => {
    const r = aplicarExcecoes(['ORCAMENTISTA', 'GFIN'], [ex('ORCAMENTISTA', 'cad.plano_contas')], funcionalidades, ehAdm, {
      atuais: [ex('ORCAMENTISTA', 'cad.centros_custo')],
      exibidas: ['ORCAMENTISTA:cad.plano_contas'],
    });
    expect(r.ok && r.valor).toEqual({ perfis: ['GFIN'], excecoes: [], perfisDesmarcados: ['ORCAMENTISTA'] });
  });

  it('chave estável da exceção', () => expect(chaveExcecao({ perfil: 'GFIN', funcionalidade: 'orc.orcamento' })).toBe('GFIN:orc.orcamento'));
});
