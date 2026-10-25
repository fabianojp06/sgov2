import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { ErroDominio, type ErroCampo, type Resultado } from '@/shared/kernel';
import { erroGeral, MENSAGEM_INESPERADA, resumirErro } from './guarda';

// Contexto de uma ação sem sessão: só o IP, que o proxy.ts põe em x-sgo-ip depois de descartar o
// valor enviado pelo cliente.
export type ContextoPublico = { ip: string | null };

export const CABECALHO_IP = 'x-sgo-ip';

// Ação pública (R4 do plano do P5): sem sessão nem permissão, mas com a mesma validação e tradução
// de erros de definirAcao. O teste de arquitetura só a aceita em
// src/modules/aut/application/acoes-login.ts, e só para a ação `entrar`.
export function definirAcaoPublica<I, O>(
  cfg: { nome: string; entrada: z.ZodType<I> },
  executar: (entrada: I, ctx: ContextoPublico) => Promise<Resultado<O>>,
): (entradaBruta: unknown) => Promise<Resultado<O>> {
  return async (entradaBruta) => {
    try {
      const validado = await cfg.entrada.safeParseAsync(entradaBruta);
      if (!validado.success) {
        const erros: ErroCampo[] = validado.error.issues.map((i) => ({
          campo: i.path.length > 0 ? i.path.join('.') : '_',
          mensagem: i.message,
        }));
        return { ok: false, erros };
      }
      const ip = (await headers()).get(CABECALHO_IP);
      return await executar(validado.data, { ip: ip || null });
    } catch (erro) {
      unstable_rethrow(erro);
      if (erro instanceof ErroDominio) return { ok: false, erros: erroGeral(erro.message) };
      // A entrada (senha) nunca vai para o log: só o nome da ação e o resumo do erro.
      console.error(`[ERRO_INESPERADO] ação pública ${cfg.nome}`, { erro: resumirErro(erro) });
      return { ok: false, erros: erroGeral(MENSAGEM_INESPERADA) };
    }
  };
}
