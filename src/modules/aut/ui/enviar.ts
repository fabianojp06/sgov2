import { unstable_rethrow } from 'next/navigation';
import type { ErroCampo } from '@/shared/kernel';

export type RespostaAcaoTela = { ok: true } | { ok: false; erros: readonly ErroCampo[] };

// Chama uma Server Action pela tela. O redirect do Next (sucesso) segue adiante; erro de rede vira
// 'rede' para a tela mostrar a mensagem certa.
export async function chamarAcao<D>(acao: (d: D) => Promise<RespostaAcaoTela>, dados: D): Promise<RespostaAcaoTela | 'rede'> {
  try {
    return await acao(dados);
  } catch (erro) {
    unstable_rethrow(erro);
    return 'rede';
  }
}
