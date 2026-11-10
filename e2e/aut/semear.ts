import { hashSenha, normalizarLogin, seedAdm, seedAdministradorInicial } from '@/modules/adm';
import { seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import { seedOrc } from '@/modules/orc';
import { seedRel } from '@/modules/rel/servidor';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { PERFIL_SEM_PERMISSAO, SENHA, USUARIOS } from './apoio';

// Semeia o banco efêmero do E2E (chamado pelo global-setup com tsx): as seeds reais na ordem do
// prisma/seed.ts (adm, administrador inicial com as variáveis ADMIN_INICIAL_*, cad, dados de
// referência do cad e orc) e um usuário por cenário, sem troca obrigatória. Os dados de referência
// (plano de contas oficial e minuta de CC, o C1 real do E2E do orc) exigem CARGA_DADOS_REFERENCIA=1,
// que o global-setup passa.
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL não definida');
// Só o banco efêmero do teste: o global-setup força AMBIENTE=dev e CARGA_DADOS_REFERENCIA=1, e uma
// execução manual com a URL do dev (55432/56432) ou de outro host gravaria lá (regra 3 do CLAUDE.md).
{
  const { hostname, port, pathname } = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(hostname) || ['55432', '56432'].includes(port) || pathname !== '/sgo_teste') {
    throw new Error('MIGRATE_DATABASE_URL não é o banco efêmero do teste');
  }
}
if (process.env.CARGA_DADOS_REFERENCIA !== '1') throw new Error('CARGA_DADOS_REFERENCIA=1 ausente: o E2E do orc precisa do C1 real');

const cliente = criarPrisma(url);
try {
  await executarSeeds(cliente, [seedAdm, seedAdministradorInicial, seedCad, seedDadosReferenciaCad, seedOrc, seedRel]);
  await cliente.perfil.create({
    data: { codigo: PERFIL_SEM_PERMISSAO, nome: 'E2E Sem Permissão', descricao: 'Perfil do teste, sem funcionalidade nenhuma' },
  });
  const senhaHash = await hashSenha(SENHA);
  for (const u of Object.values(USUARIOS)) {
    const perfil = await cliente.perfil.findUniqueOrThrow({ where: { codigo: u.perfil } });
    await cliente.usuario.create({
      data: {
        nome: u.nome,
        email: `${u.login}@example.org`,
        login: u.login,
        loginNormalizado: normalizarLogin(u.login) ?? u.login,
        senhaHash,
        trocaSenhaObrigatoria: false,
        ccEscopo: 'ccEscopo' in u ? u.ccEscopo : null,
        perfis: { create: { perfilId: perfil.id } },
      },
    });
  }
} finally {
  await cliente.$disconnect();
}
