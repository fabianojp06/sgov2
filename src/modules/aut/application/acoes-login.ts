'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { normalizarLogin } from '@/modules/adm';
import { definirAcaoPublica } from '@/shared/authz';
import { falha, type ErroCampo } from '@/shared/kernel';
import { MENSAGENS } from '../domain/mensagens';
import { nomeCookieSessao, opcoesCookieSessao } from '../infrastructure/cookies';
import { autenticar } from './autenticar';
import { limitadorLogin as limitador } from './limitador';

const MENSAGEM_LIMITE = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

// Entrar (UC01.01): a única ação pública do sistema (R4). O token vai só para o cookie HttpOnly:
// o resultado da ação nunca o carrega.
export const entrar = definirAcaoPublica(
  { nome: 'aut.entrar', entrada: z.object({ login: z.string().max(200, MENSAGENS.CREDENCIAIS), senha: z.string().max(200, MENSAGENS.CREDENCIAIS) }) },
  async (e, ctx) => {
    const chave = normalizarLogin(e.login) ?? e.login.trim().toLowerCase().slice(0, 60);
    if (!limitador.permitir(ctx.ip, chave)) {
      console.warn('[LOGIN_LIMITADO]', { ip: ctx.ip, motivo: 'taxa' });
      return falha([{ campo: '_', mensagem: MENSAGEM_LIMITE }]);
    }
    const r = await limitador.executar(() => autenticar({ login: e.login, senha: e.senha, ip: ctx.ip }));
    if (r === 'OCUPADO') {
      console.warn('[LOGIN_LIMITADO]', { ip: ctx.ip, motivo: 'concorrencia' });
      return falha([{ campo: '_', mensagem: MENSAGEM_LIMITE }]);
    }
    if (!r.ok) {
      const erros: ErroCampo[] = [{ campo: '_', mensagem: r.mensagem }];
      if (r.avisoUltimaTentativa) erros.push({ campo: 'aviso', mensagem: MENSAGENS.ULTIMA_TENTATIVA });
      return falha(erros);
    }
    (await cookies()).set(nomeCookieSessao(), r.token, opcoesCookieSessao(r.expiraEm));
    redirect(r.trocaSenhaObrigatoria ? '/troca-senha' : '/inicio');
  },
);
