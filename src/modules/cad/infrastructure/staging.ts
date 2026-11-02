import type { LinhaLida, LinhaPlanoValidada } from '../domain/plano-contas';

// Conversão de uma linha do staging para o formato da planilha, para o worker revalidar com o
// mesmo domínio do app (R6, S-N3).
export function paraLinhaLida(l: LinhaPlanoValidada): LinhaLida {
  return {
    numero: l.linha,
    celulas: {
      Nível: String(l.nivel),
      Classificação: l.classificacao,
      'Conta Superior': l.classificacaoPai,
      Descrição: l.descricao,
      Tipo: l.tipo === 'ANALITICA' ? 'A' : 'S',
      'Conta Reduzida': l.codigoReduzido,
    },
  };
}
