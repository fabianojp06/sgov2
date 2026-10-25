'use server';

// Fixture do teste de arquitetura da guarda (US-008): só o texto importa.
declare const definirAcao: (...args: unknown[]) => unknown;

export const salvar = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir' }, async () => 1);
