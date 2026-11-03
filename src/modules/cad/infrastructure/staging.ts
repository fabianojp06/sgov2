import type { LinhaCargoValidada } from '../domain/cargo';
import type { LinhaCentroCustoValidada } from '../domain/centros-custo';
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

export function centroParaLinhaLida(l: LinhaCentroCustoValidada): LinhaLida {
  return {
    numero: l.linha,
    celulas: {
      Classificação: l.classificacao,
      'Código reduzido': l.codigoReduzido,
      'Descrição (original)': l.descricaoOriginal,
      'Descrição sugerida': l.descricao,
      Nível: String(l.nivel),
      'Classificação pai': l.classificacaoPai,
      Tipo: l.tipo === 'ANALITICO' ? 'Analítico' : 'Sintético',
      'Aceita lançamento': l.tipo === 'ANALITICO' ? 'S' : 'N',
    },
  };
}

/** Linha de cargo do staging no formato da planilha, sem o salário (cifrado, o worker não lê). */
export function cargoParaLinhaLida(l: Omit<LinhaCargoValidada, 'salarioReal'>): LinhaLida {
  return {
    numero: l.linha,
    celulas: {
      'Código do Cargo': l.codigo,
      Cargo: l.nomeOficial,
      'Cargo Mercado': l.nomeMercado,
      'Tabela Salarial (código)': l.tabelaSalarialCodigo,
      'Tabela Salarial (descrição)': l.tabelaSalarialDescricao,
      'Faixa (código)': l.faixaCodigo,
      'Faixa (descrição)': l.faixaDescricao,
      'Nível (código)': l.nivelCodigo,
      'Nível (descrição)': l.nivelDescricao,
      'Salário Real': null,
    },
  };
}
