// Fixture do teste de arquitetura da guarda (US-008): só o texto importa.
import { definirRota } from '@/shared/authz';

export const GET = definirRota({ funcionalidade: 'usuarios', acao: 'exportar' }, async () => new Response('ok'));
