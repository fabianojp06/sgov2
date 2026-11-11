import { verificarSaude } from '@/modules/int';

// Endpoint de saúde (US-017): público (o proxy libera, sem sessão), para o monitor externo que alerta
// por e-mail. 200 com tudo ok; 503 com o componente que falhou. Nunca em cache.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const estado = await verificarSaude();
  return Response.json(estado, { status: estado.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
