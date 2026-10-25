// Fixture do teste de arquitetura da guarda (US-008): só o texto importa.
declare const definirRota: (...args: unknown[]) => unknown;

export const GET = definirRota({ funcionalidade: 'usuarios', acao: 'exportar' }, async () => new Response('ok'));
