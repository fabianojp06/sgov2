// Regra do arquivo de carga (US-043; plano do P4, Task 7a), a mesma na ação e na tela (spec §5: Zod
// no servidor e validação no cliente). O conteúdo (assinatura PK, zip, limites da R4) é do leitor seguro.
export const LIMITE_ARQUIVO_CARGA = 1024 * 1024;

export const MSG_ARQUIVO = {
  ausente: 'Escolha o arquivo .xlsx.',
  vazio: 'O arquivo está vazio.',
  extensao: 'O arquivo deve ser .xlsx.',
  tamanho: 'O arquivo deve ter até 1 MB.',
} as const;

/** O problema do arquivo escolhido, ou null se ele pode seguir para o leitor. */
export function problemaArquivoCarga(arquivo: { nome: string; tamanho: number } | null): string | null {
  if (arquivo === null || arquivo.nome === '') return MSG_ARQUIVO.ausente;
  if (arquivo.tamanho === 0) return MSG_ARQUIVO.vazio;
  if (!/\.xlsx$/i.test(arquivo.nome)) return MSG_ARQUIVO.extensao;
  if (arquivo.tamanho > LIMITE_ARQUIVO_CARGA) return MSG_ARQUIVO.tamanho;
  return null;
}
