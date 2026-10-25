'use server';

// Fixture do teste de arquitetura da guarda (P5): ação pública, só permitida em acoes-login.ts.
declare const definirAcaoPublica: (...args: unknown[]) => unknown;

export const entrar = definirAcaoPublica({ nome: 'login' }, async () => 1);
