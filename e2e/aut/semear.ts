import { hashSenha, normalizarLogin, seedAdm, seedAdministradorInicial } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { SENHA, USUARIOS } from './apoio';

// Semeia o banco efêmero do E2E (chamado pelo global-setup com tsx): as seeds reais do adm, o
// administrador inicial (variáveis ADMIN_INICIAL_*) e um usuário por cenário, sem troca obrigatória.
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL não definida');

const cliente = criarPrisma(url);
try {
  await executarSeeds(cliente, [seedAdm, seedAdministradorInicial]);
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
        perfis: { create: { perfilId: perfil.id } },
      },
    });
  }
} finally {
  await cliente.$disconnect();
}
