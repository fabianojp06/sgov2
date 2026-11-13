import type { ErroCampo } from '@/shared/kernel';

// Impeditivos de exclusão (US-023; UC0.04, RF_EXC_001/003, RN0022): o caso de uso de exclusão confere
// as dependências ativas do registro (verificarDependencias do agregado) e, se houver alguma, recusa
// a operação devolvendo um erro por vínculo, com o campo CAMPO_IMPEDITIVO. A AcaoConfirmada do C3
// mostra esses erros como a lista dos vínculos que impedem a exclusão.

export const CAMPO_IMPEDITIVO = 'impeditivo';

/** Um vínculo que impede a exclusão: o que é e quantos registros (0 é ignorado). */
export type Impeditivo = Readonly<{ descricao: string; quantidade: number }>;

/** Os erros do Resultado para os vínculos com quantidade, na ordem recebida; vazio se não há nenhum. */
export function impeditivos(itens: readonly Impeditivo[]): ErroCampo[] {
  return itens
    .filter((i) => i.quantidade > 0)
    .map((i) => ({ campo: CAMPO_IMPEDITIVO, mensagem: `${i.descricao}: ${i.quantidade.toLocaleString('pt-BR')}` }));
}

/** Separa os impeditivos dos demais erros (a tela mostra cada grupo sob o seu título). */
export function separarImpeditivos(erros: readonly ErroCampo[]): { impeditivos: string[]; outros: ErroCampo[] } {
  return {
    impeditivos: erros.filter((e) => e.campo === CAMPO_IMPEDITIVO).map((e) => e.mensagem),
    outros: erros.filter((e) => e.campo !== CAMPO_IMPEDITIVO),
  };
}
