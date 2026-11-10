import { obterAvisoDesativacao } from '@/modules/aut';
import { definirRota } from '@/shared/authz';

// Consulta periódica do aviso de desativação do sistema (D-P9-4): devolve { segundos } ou
// { segundos: null }. O proxy põe o cabeçalho interno que impede esta consulta de renovar a sessão.
export const GET = definirRota({ funcionalidade: 'aut.tela_principal', acao: 'consultar' }, async (_req, ctx) =>
  Response.json(await obterAvisoDesativacao(ctx)),
);
