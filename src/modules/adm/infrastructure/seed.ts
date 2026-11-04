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

// Perfis padrão (§11.3): perfil existente não é tocado (RN_SEED_002).
async function instalarPerfis(tx: TxCliente): Promise<void> {
  for (const codigo of CODIGOS_PERFIL) {
    if (await tx.perfil.findUnique({ where: { codigo } })) continue;
    const perfil = await tx.perfil.create({ data: { codigo, ...PERFIS_PADRAO[codigo] } });
    await auditarSeed(tx, `Seed: perfil ${codigo} instalado`, perfil.id);
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
