// Marca neutra (spec §6.7, US-012): o nome da instituição nunca aparece no sistema.
// O nome exibido vem do parâmetro instituicao.nome_exibicao.
// A sigla é montada em tempo de execução para este arquivo não reprovar a própria varredura.
const SIGLA_VEDADA = ['c', 't', 'c', 'e', 'a'].join('');

/** Retorna as ocorrências da marca vedada no texto, sem diferenciar maiúsculas. */
export function encontrarMarcaVedada(texto: string): string[] {
  const regex = new RegExp(SIGLA_VEDADA, 'gi');
  return texto.match(regex) ?? [];
}
