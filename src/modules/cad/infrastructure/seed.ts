import type { DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import { instalarFuncionalidades } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';
import { criarTabelaMestreDoAno } from './beneficios-mestre';
import { auditar } from '@/shared/audit';
import { CHAVES_PARAMETRO_SISTEMA, criarParametrosDoAno, tocarVersaoExercicio } from './parametro-sistema';

// Seed do cad em todos os ambientes (plano do P4, R15): as funcionalidades do módulo (contrato C6),
// os parâmetros provisórios de 2027 e o parametro_sistema vazio. A Tabela Mestre entra na Task 10.
// R22/E-N4: sem
// @/shared/authz nem next/, porque o prisma/seed.ts a importa pelo servidor.ts.
export const FUNCIONALIDADES_CAD: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'cad.plano_contas',
    modulo: 'CADASTROS',
    grupo: 'Plano de Contas',
    nome: 'Plano de Contas',
    rota: '/cad/plano-contas',
    ordem: 1,
    nivelLog: 'SIMPLES',
    ajuda:
      'Consulte o plano de contas de 5 níveis. A estrutura só muda pela importação da planilha .xlsx (não há inclusão nem ' +
      'alteração manual): o arquivo é validado inteiro, e qualquer erro o reprova sem gravar nada. Em "Parâmetros locais", a ' +
      'GFIN define a natureza (OPEX/CAPEX) e, se quiser, faixas do semáforo próprias de cada conta analítica.',
    acoes: ['consultar', 'exportar', 'executar'],
    perfisPadrao: {
      GFIN: ['consultar', 'exportar', 'executar'],
      ORCAMENTISTA: ['consultar', 'exportar'],
      ANALISTA_GRH: ['consultar'],
      OPERADOR_VIAGENS: ['consultar'],
      AUDITOR: ['consultar', 'exportar'],
      GESTOR_DIRETORIA: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    codigo: 'cad.centros_custo',
    modulo: 'CADASTROS',
    grupo: 'Plano de Contas',
    nome: 'Centros de Custo',
    rota: '/cad/centros-custo',
    ordem: 2,
    nivelLog: 'SIMPLES',
    ajuda:
      'Consulte os centros de custo de 5 níveis, com o reduzido e os selos de gestão e de provisório. A estrutura só muda pela ' +
      'importação da planilha .xlsx, e a carga só entra com a data e o documento da aprovação da DIREX.',
    acoes: ['consultar', 'exportar', 'executar'],
    perfisPadrao: {
      GFIN: ['consultar', 'exportar', 'executar'],
      ORCAMENTISTA: ['consultar', 'exportar'],
      ANALISTA_GRH: ['consultar'],
      OPERADOR_VIAGENS: ['consultar'],
      AUDITOR: ['consultar', 'exportar'],
      GESTOR_DIRETORIA: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // US-048 (UC03.18): a árvore de unidades e o vínculo 1:1 do cargo (RN_CAR_08, C2).
    codigo: 'cad.estrutura_funcional',
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: 'Estrutura funcional',
    rota: '/cad/estrutura-funcional',
    ordem: 1,
    nivelLog: 'SIMPLES',
    ajuda:
      'Mantenha a árvore de unidades: Diretoria e Gerência consolidam; Assessoria, Coordenadoria e Setor recebem os cargos. Uma ' +
      'unidade com cargo ativo vinculado ou com unidade ativa abaixo não pode ser inativada.',
    acoes: ['consultar', 'incluir', 'alterar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'incluir', 'alterar'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    codigo: 'cad.cargos',
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: 'Cargos e Salários',
    rota: '/cad/cargos',
    ordem: 2,
    nivelLog: 'SIMPLES',
    ajuda:
      'Consulte os cargos e mantenha os dados manuais (mercado, fonte ativa, adicional). Os dados do Rubi entram pela importação da ' +
      'planilha. Os salários aparecem só para quem tem a permissão de ver salários; para os outros, ficam mascarados.',
    acoes: ['consultar', 'alterar', 'exportar', 'executar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'alterar', 'exportar', 'executar'],
      GFIN: ['consultar', 'exportar'],
      ORCAMENTISTA: ['consultar', 'exportar'],
      AUDITOR: ['consultar', 'exportar'],
      DIREX: ['consultar'],
    },
  },
  {
    codigo: 'cad.tabela_salarial',
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: 'Tabela Salarial',
    rota: '/cad/tabela-salarial',
    ordem: 4,
    nivelLog: 'SIMPLES',
    ajuda:
      'Faixas salariais de mercado por cargo e senioridade (pesquisa externa, sem vínculo com o Rubi). No cargo, escolher uma faixa ' +
      'preenche o mínimo e o máximo. Júnior, Pleno e Sênior são padrão; outras senioridades podem ser incluídas.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar'],
    },
  },
  // R24: ver salário sem máscara é permissão própria, auditada, fora do menu (C6 exibirNoMenu). Pendência P5.
  {
    codigo: 'cad.salarios',
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: 'Salários sem máscara',
    rota: '/cad/cargos',
    ordem: 3,
    nivelLog: 'AVANCADO',
    exibirNoMenu: false,
    acoes: ['consultar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar'],
      GFIN: ['consultar'],
    },
  },
  {
    codigo: 'cad.beneficios',
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: 'Tabela Mestre de Benefícios',
    rota: '/cad/beneficios',
    ordem: 5,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'incluir', 'alterar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'incluir', 'alterar'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    codigo: 'cad.parametros',
    modulo: 'CADASTROS',
    grupo: 'Central de Cálculos',
    nome: 'Parâmetros do exercício',
    rota: '/cad/parametros',
    ordem: 1,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: {
      GFIN: ['consultar', 'alterar'],
      ORCAMENTISTA: ['consultar'],
      ANALISTA_GRH: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // US-052 (UC03.01, REQ_TAX_001): impostos e alíquotas por vigência; a GFIN mantém (§11.3).
    codigo: 'cad.impostos',
    modulo: 'CADASTROS',
    grupo: 'Central de Cálculos',
    nome: 'Impostos e alíquotas',
    rota: '/cad/impostos',
    ordem: 4,
    nivelLog: 'SIMPLES',
    ajuda:
      'Cadastre os impostos (PIS, COFINS, ISS e outros) e as alíquotas por competência. Não há alíquota retroativa, e a que já ' +
      'começou a valer não muda: para trocar, inclua uma nova vigência.',
    acoes: ['consultar', 'incluir', 'alterar'],
    perfisPadrao: {
      GFIN: ['consultar', 'incluir', 'alterar'],
      ORCAMENTISTA: ['consultar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    codigo: 'cad.salario_minimo',
    modulo: 'CADASTROS',
    grupo: 'Central de Cálculos',
    nome: 'Salário mínimo nacional',
    rota: '/cad/salario-minimo',
    ordem: 2,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'alterar'],
      GFIN: ['consultar', 'alterar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    // #434 (spec §6.7): o nome que as telas e os e-mails mostram; nunca fixo no código.
    codigo: 'cad.instituicao',
    modulo: 'CADASTROS',
    // No grupo dos parâmetros, sem cabeçalho novo no menu.
    grupo: 'Central de Cálculos',
    nome: 'Instituição',
    rota: '/cad/instituicao',
    ordem: 3,
    nivelLog: 'SIMPLES',
    ajuda: 'Nome de exibição da instituição, usado nas telas e no cabeçalho dos e-mails. Em branco, o sistema mostra só "SGO".',
    acoes: ['consultar', 'alterar'],
    // A GFIN, que já mantém os parâmetros e os cadastros. O Administrador fica de fora: o menu dele
    // ganharia o grupo Cadastros só por este item e passaria de 1280×720 sem rolagem (RNF0008).
    perfisPadrao: {
      GFIN: ['consultar', 'alterar'],
      AUDITOR: ['consultar'],
    },
  },
];

const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

export const seedCad: Seed = {
  nome: 'cad',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_CAD);
    // Os parâmetros de 2027 nascem provisórios (GAP-ORC-003); um ano que já existe fica como está.
    await criarParametrosDoAno(tx, SISTEMA, 2027);
    // Um 2027 criado antes da Tabela Mestre (dev e hml) ganha os itens padrão, se ainda aberto.
    const ano2027 = await tx.parametrosExercicio.findUnique({ where: { ano: 2027 }, select: { congeladoEm: true } });
    if (ano2027 && !ano2027.congeladoEm && (await tx.beneficioMestre.count({ where: { ano: 2027 } })) === 0) {
      // Escrita numa tabela do ano: versão única (R10) e Histórico, como qualquer outra.
      await tocarVersaoExercicio(tx, 2027);
      await criarTabelaMestreDoAno(tx, 2027, null);
      await auditar(tx, {
        contexto: SISTEMA,
        origem: 'SISTEMA',
        funcionalidade: 'cad.beneficios',
        tipo: 'SISTEMA',
        registroId: '2027',
        descricao: 'Seed: Tabela Mestre de 2027 criada com os itens provisórios',
      });
    }
    // Os três impostos da UC03.01, sem alíquota (RN_TAX_01: o percentual é parâmetro da GFIN). PIS e
    // COFINS incidem só em contrato (RN_PRO_010: imunidade do TP); o ISS, nos dois. Só com a tabela vazia:
    // um imposto renomeado ou inativado pela GFIN não volta no deploy seguinte.
    if ((await tx.imposto.count()) === 0) {
      for (const [nome, incidencia] of [['PIS', 'CONTRATO'], ['COFINS', 'CONTRATO'], ['ISS', 'AMBOS']] as const) {
        const [criado] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "imposto" ("nome", "incidencia")
          VALUES (${nome}, ${incidencia}::"IncidenciaImposto") RETURNING "id"`;
        await auditar(tx, {
          contexto: SISTEMA,
          origem: 'SISTEMA',
          funcionalidade: 'cad.impostos',
          tipo: 'SISTEMA',
          registroId: criado!.id,
          descricao: `Seed: imposto ${nome} incluído, sem alíquota`,
          depois: { nome, incidencia },
        });
      }
    }
    for (const chave of CHAVES_PARAMETRO_SISTEMA) {
      await tx.parametroSistema.upsert({ where: { chave }, create: { chave, valor: '' }, update: {} });
    }
  },
};
