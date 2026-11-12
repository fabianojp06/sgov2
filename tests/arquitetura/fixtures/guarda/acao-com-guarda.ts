'use server';

// Fixture do teste de arquitetura da guarda (US-008): só o texto importa.
import { definirAcao } from '@/shared/authz';

export const salvar = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir' } as never, async () => ({ ok: true as const, valor: 1 }));
