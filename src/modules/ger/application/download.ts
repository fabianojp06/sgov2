// Download dos arquivos exportados pelas rotas GET das telas (US-024). A exportação grava no
// Histórico: o definirRota não confere a origem em GET, e o cookie Lax vai numa navegação vinda de
// outro site. Por isso só o próprio sistema (same-origin) ou o endereço digitado (none) exportam.
export function origemDeExportacaoValida(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

export const TIPOS_ARQUIVO = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;
export type FormatoArquivo = keyof typeof TIPOS_ARQUIVO;

export const ehFormatoArquivo = (f: string | null): f is FormatoArquivo => f === 'xlsx' || f === 'csv';

/** Resposta de download. O nome vem do sistema (nunca do usuário): só letras, números, ponto e hífen. */
export function respostaDeArquivo(nome: string, formato: FormatoArquivo, bytes: Uint8Array): Response {
  if (!/^[a-z0-9.-]+$/i.test(nome)) throw new Error('Nome de arquivo inválido');
  return new Response(bytes as BodyInit, {
    headers: { 'Content-Type': TIPOS_ARQUIVO[formato], 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' },
  });
}

export const respostaDeErro = (status: number, campo: string, mensagem: string): Response => Response.json({ erros: [{ campo, mensagem }] }, { status });
