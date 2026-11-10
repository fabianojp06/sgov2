import type { Seed, TxCliente } from '@/shared/db';
import { auditarSeed } from '../application/auditar-seed';
import { MODULOS_MENU, type DeclaracaoFuncionalidade } from '../application/catalogo';
import { instalarFuncionalidades } from '../application/instalar-funcionalidades';
import { CODIGOS_PERFIL, PERFIS_PADRAO } from '../domain/perfis';

// Funcionalidades do próprio adm (contrato C6). Só o Administrador (RN_SEED_003).
export const FUNCIONALIDADES_ADM: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'adm.usuarios',
    modulo: 'ADMINISTRACAO',
    grupo: 'Operadores e Permissões',
    nome: 'Usuários',
    rota: '/adm/usuarios',
    ordem: 1,
    ajuda:
      'Cadastre e altere os usuários do sistema: dados, status, perfis de acesso e Termos de Parceria. ' +
      'A senha é gerada pelo sistema e enviada por e-mail; na alteração, gere nova senha ou desbloqueie a conta.',
    acoes: ['consultar', 'incluir', 'alterar'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'incluir', 'alterar'] },
  },
  {
    // US-042 (§11.4, §6.4: Administração › Parâmetros › Alçadas de Aprovação), exclusivo do Administrador.
    codigo: 'adm.alcadas',
    modulo: 'ADMINISTRACAO',
    grupo: 'Parâmetros',
    nome: 'Alçadas de Aprovação',
    rota: '/adm/alcadas',
    ordem: 2,
    ajuda:
      'Cadastre o titular e o substituto de cada fluxo de aprovação. O substituto assume quando o titular está inativo; ' +
      'trocar um aprovador ou excluir mantém o registro de quem aprovava em cada período.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'incluir', 'alterar', 'excluir'] },
  },
  {
    // US-040 (UC02.24; spec §6.4: Administração › Histórico). Nível Avançado: a consulta é registrada.
    // O Auditor também consulta (§11.3), na única exceção da RN_SEED_003 (D-P8-8).
    codigo: 'adm.historico',
    modulo: 'ADMINISTRACAO',
    grupo: 'Histórico',
    nome: 'Histórico de Operações',
    rota: '/adm/historico',
    ordem: 3,
    nivelLog: 'AVANCADO',
    ajuda:
      'Consulte as operações registradas no sistema, por usuário, funcionalidade, tipo e período. ' +
      'A consulta é só de leitura; dá para imprimir e exportar o resultado.',
    acoes: ['consultar', 'exportar', 'imprimir'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'exportar', 'imprimir'], AUDITOR: ['consultar', 'exportar', 'imprimir'] },
  },
  {
    // US-035 (EP085 UC02.05 e UC02.06): ativar e desativar módulos e funcionalidades do catálogo,
    // que só nasce pela seed (C14). Exclusivo do Administrador.
    codigo: 'adm.modulos',
    modulo: 'ADMINISTRACAO',
    grupo: 'Operadores e Permissões',
    nome: 'Módulos e Funcionalidades',
    rota: '/adm/modulos',
    ordem: 5,
    // Texto de ajuda [PROVISÓRIO]: sem fonte no EP085.
    ajuda:
      'Ative ou desative os módulos do sistema e, num módulo ativo, as funcionalidades dele. ' +
      'Desativar um módulo desativa as funcionalidades dele e desconecta os usuários; ativar o módulo não reativa as funcionalidades.',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'alterar'] },
  },
  {
    // US-036 (UC02.01: menu Ativar/Desativar Sistema em Administração › Operadores e Permissões).
    codigo: 'adm.sistema',
    modulo: 'ADMINISTRACAO',
    grupo: 'Operadores e Permissões',
    nome: 'Ativar/Desativar Sistema',
    rota: '/adm/sistema',
    ordem: 4,
    ajuda:
      'Ative o sistema ou desative-o informando o motivo. Os usuários conectados são avisados e desconectados ' +
      'depois do tempo de espera; com o sistema inativo, só os Administradores entram, e só na Administração.',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'alterar'] },
  },
  {
    // US-041 (EP085 UC02.20, grupo "Desempenho"; plano do P10, D-P10-6/7): só a configuração; o envio
    // vem com o realizado (US-085). Exclusivo do Administrador (RN_SEED_003, D-P10-7 [PO valida]).
    // Nome [PROVISÓRIO]: o EP chama o menu de "Notificações e Aprovações", que pela spec ficou só com
    // as notificações (as aprovações são as alçadas, §6.5).
    codigo: 'adm.notificacoes',
    modulo: 'ADMINISTRACAO',
    grupo: 'Parâmetros',
    nome: 'Notificações de Desempenho',
    rota: '/adm/notificacoes',
    ordem: 6,
    // Texto de ajuda [PROVISÓRIO]: sem fonte no EP085.
    ajuda:
      'Cadastre quem recebe o alerta de desempenho de cada conta sintética (ou de todas), com o limite em % do orçado ' +
      'e a frequência de envio em dias. Excluir retira o destinatário da lista.',
    acoes: ['consultar', 'incluir', 'excluir'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'incluir', 'excluir'] },
  },
  {
    // US-037 (EP085 UC02.07–10, UC02.25/26; REQ0048: Administração › Operadores e Permissões › Perfis
    // de Usuário; plano do P13, D-P13-1). Exclusivo do Administrador (RN_SEED_003).
    codigo: 'adm.perfis',
    modulo: 'ADMINISTRACAO',
    grupo: 'Operadores e Permissões',
    nome: 'Perfis de Usuário',
    rota: '/adm/perfis',
    ordem: 7,
    // Texto de ajuda [PROVISÓRIO]: sem fonte no EP085.
    ajuda:
      'Cadastre e altere os perfis de acesso e defina as permissões de cada um por módulo, funcionalidade e ação. ' +
      'Inative o perfil que não for mais usado; só um perfil criado aqui e sem usuários pode ser excluído.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'incluir', 'alterar', 'excluir'] },
  },
];

async function instalarConfiguracao(tx: TxCliente): Promise<void> {
  if (await tx.configuracaoAcesso.findUnique({ where: { id: 1 } })) return;
  await tx.configuracaoAcesso.create({ data: { id: 1 } });
  await auditarSeed(tx, 'Seed: configuração de acesso instalada com os valores provisórios (GAP-AUT-002)');
}

// Módulos de menu: o nome e a ordem seguem o código; o `ativo` é do Administrador (REQ0055).
async function instalarModulos(tx: TxCliente): Promise<void> {
  for (const m of MODULOS_MENU) {
    const atual = await tx.modulo.findUnique({ where: { codigo: m.codigo } });
    if (!atual) {
      await tx.modulo.create({ data: m });
      await auditarSeed(tx, `Seed: módulo ${m.codigo} instalado`, m.codigo);
    } else if (atual.nome !== m.nome || atual.ordem !== m.ordem) {
      await tx.modulo.update({ where: { codigo: m.codigo }, data: { nome: m.nome, ordem: m.ordem } });
      await auditarSeed(tx, `Seed: módulo ${m.codigo} atualizado`, m.codigo);
    }
  }
}

// Nome livre para um perfil padrão novo (D-P13-11, ajuste A8 da revisão do plano do P13): o nome é
// único sem diferenciar maiúsculas, e um perfil criado pela tela pode já usar o do padrão. Tenta o nome,
// depois "<nome> (padrão)", "<nome> (padrão 2)" e assim por diante, sempre dentro dos 100 caracteres.
async function nomeLivre(tx: TxCliente, nome: string): Promise<string> {
  for (let n = 1; ; n++) {
    const sufixo = n === 1 ? '' : n === 2 ? ' (padrão)' : ` (padrão ${n - 1})`;
    const candidato = `${nome.slice(0, 100 - sufixo.length).trimEnd()}${sufixo}`;
    const [uso] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM perfil WHERE lower(nome) = lower(${candidato})`;
    if (uso?.n === 0) return candidato;
  }
}

// Perfis padrão (§11.3): perfil existente não é tocado (RN_SEED_002); a idempotência é pelo código.
async function instalarPerfis(tx: TxCliente): Promise<void> {
  for (const codigo of CODIGOS_PERFIL) {
    if (await tx.perfil.findUnique({ where: { codigo } })) continue;
    const padrao = PERFIS_PADRAO[codigo];
    const nome = await nomeLivre(tx, padrao.nome);
    const perfil = await tx.perfil.create({ data: { codigo, nome, descricao: padrao.descricao } });
    await auditarSeed(
      tx,
      nome === padrao.nome ? `Seed: perfil ${codigo} instalado` : `Seed: perfil ${codigo} instalado com o nome "${nome}" (o nome "${padrao.nome}" já estava em uso)`,
      perfil.id,
    );
  }
}

export const seedAdm: Seed = {
  nome: 'adm',
  executar: async (tx) => {
    await instalarConfiguracao(tx);
    await instalarModulos(tx);
    await instalarPerfis(tx);
    await instalarFuncionalidades(tx, FUNCIONALIDADES_ADM);
  },
};
