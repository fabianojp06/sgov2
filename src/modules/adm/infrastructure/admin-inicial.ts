import { travarRecurso, type Seed, type TxCliente } from '@/shared/db';
import { auditarSeed } from '../application/auditar-seed';
import { obterConfiguracaoAcesso } from '../application/configuracao';
import { normalizarLogin } from '../domain/login';
import { validarSenha } from '../domain/politica-senha';
import { hashSenha } from './senha-argon2';

// Administrador inicial e break-glass (R6 do plano do P5, spec §11.2a). Só age quando não existe
// nenhum Administrador ativo e desbloqueado. As variáveis ficam só no serviço de migração do
// Easypanel; nenhuma mensagem mostra os valores delas.
const VARIAVEIS = ['ADMIN_INICIAL_LOGIN', 'ADMIN_INICIAL_EMAIL', 'ADMIN_INICIAL_SENHA'] as const;
const SENHA_MINIMO = 16;
const VALIDADE_DIAS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Env = Readonly<Record<string, string | undefined>>;

async function existeAdministradorAtivo(tx: TxCliente): Promise<boolean> {
  const total = await tx.usuario.count({
    where: { ativo: true, bloqueado: false, perfis: { some: { perfil: { codigo: 'ADMINISTRADOR', ativo: true } } } },
  });
  return total > 0;
}

export function criarSeedAdministradorInicial(env: Env = process.env, agora: () => Date = () => new Date()): Seed {
  return {
    nome: 'adm.administrador-inicial',
    executar: async (tx) => {
      // Duas seeds ao mesmo tempo (dois deploys): a segunda espera e vê o administrador criado.
      await travarRecurso(tx, 'adm:administrador-inicial');
      if (await existeAdministradorAtivo(tx)) return;

      const faltando = VARIAVEIS.filter((v) => !env[v]?.trim());
      if (faltando.length > 0) {
        if ((await tx.usuario.count()) === 0) {
          throw new Error(`Administrador inicial: defina ${faltando.join(', ')} (veja o .env.example)`);
        }
        // Com usuários, faltar a variável não pode derrubar o deploy: só avisa.
        console.error(
          `[ADMIN_INICIAL_AUSENTE] nenhum Administrador ativo; defina ${VARIAVEIS.join(', ')} no serviço de migração para criar um`,
        );
        return;
      }

      const loginBruto = (env.ADMIN_INICIAL_LOGIN ?? '').trim();
      const email = (env.ADMIN_INICIAL_EMAIL ?? '').trim();
      const senha = env.ADMIN_INICIAL_SENHA ?? '';
      const loginNormalizado = normalizarLogin(loginBruto);
      if (!loginNormalizado) throw new Error('ADMIN_INICIAL_LOGIN fora do formato (letras, dígitos, ponto, hífen e sublinhado; 3 a 60)');
      if (!EMAIL.test(email)) throw new Error('ADMIN_INICIAL_EMAIL inválido');
      const { politica } = await obterConfiguracaoAcesso(tx);
      const erros = validarSenha(senha, { ...politica, minimo: Math.max(SENHA_MINIMO, politica.minimo) }, 'ADMIN_INICIAL_SENHA');
      if (erros.length > 0) {
        throw new Error(`ADMIN_INICIAL_SENHA não atende à política: ${erros.map((e) => e.mensagem).join('; ')}`);
      }

      // Login já usado (ex.: o administrador inicial bloqueado por terceiros): não cria nem falha,
      // para um ataque externo não travar os deploys.
      if (await tx.usuario.findUnique({ where: { loginNormalizado } })) {
        console.error(
          `[ADMIN_INICIAL_CONFLITO] o login de ADMIN_INICIAL_LOGIN já existe e nenhum Administrador está ativo; use outro login para o break-glass`,
        );
        return;
      }
      const perfil = await tx.perfil.findUnique({ where: { codigo: 'ADMINISTRADOR' } });
      if (!perfil) throw new Error('Perfil ADMINISTRADOR ausente: rode a seed do adm antes');
      if (!perfil.ativo) throw new Error('perfil ADMINISTRADOR inativo: reative o perfil antes do break-glass');

      const expira = new Date(agora().getTime() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);
      const usuario = await tx.usuario.create({
        data: {
          nome: 'Administrador',
          email,
          login: loginBruto,
          loginNormalizado,
          senhaHash: await hashSenha(senha),
          trocaSenhaObrigatoria: true,
          senhaExpiraEm: expira,
          perfis: { create: { perfilId: perfil.id } },
        },
      });
      await auditarSeed(tx, `Seed: administrador inicial ${loginNormalizado} criado`, usuario.id);
    },
  };
}

export const seedAdministradorInicial: Seed = criarSeedAdministradorInicial();
