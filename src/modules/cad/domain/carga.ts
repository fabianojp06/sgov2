import type { ErroLinha } from './plano-contas';

// Planejamento da recarga de uma estrutura (plano de contas ou CC) contra o que já está no banco
// (plano do P4, R5 e Task 4a). Puro. A classificação é a chave e NUNCA muda de estrutura: a
// recarga só atualiza a descrição e a situação. O reduzido e o tipo de uma classificação
// existente não mudam; reduzido que vai para outra classificação inativa a antiga e cria a nova.

/** `linha` só nas novas (linha da planilha, para o erro voltar à tela). */
export type Atual = { classificacao: string; codigoReduzido: string | null; tipo: string; descricao: string; ativo: boolean; linha?: number };

export type PlanoCarga = {
  incluir: readonly Atual[];
  /** Ativas que só mudam a descrição. */
  alterarDescricao: readonly Atual[];
  /** Inativas que voltam, com a descrição da planilha. */
  reativar: readonly Atual[];
  /** Classificações ativas que não vieram na planilha. */
  inativar: readonly string[];
  inalteradas: number;
  avisos: readonly ErroLinha[];
  erros: readonly ErroLinha[];
};

export function planejarCarga(atuais: readonly Atual[], novas: readonly Atual[]): PlanoCarga {
  const porClassificacao = new Map(atuais.map((a) => [a.classificacao, a]));
  const ativasPorReduzido = new Map(atuais.filter((a) => a.ativo && a.codigoReduzido !== null).map((a) => [a.codigoReduzido!, a]));
  const vieram = new Set(novas.map((n) => n.classificacao));

  const incluir: Atual[] = [];
  const alterarDescricao: Atual[] = [];
  const reativar: Atual[] = [];
  const avisos: ErroLinha[] = [];
  const erros: ErroLinha[] = [];
  let inalteradas = 0;

  for (const nova of novas) {
    const linha = nova.linha ?? 0;
    const atual = porClassificacao.get(nova.classificacao);
    if (!atual) {
      const anterior = nova.codigoReduzido === null ? undefined : ativasPorReduzido.get(nova.codigoReduzido);
      if (anterior && vieram.has(anterior.classificacao)) {
        // O reduzido continua na classificação antiga no mesmo arquivo: seria repetido entre as ativas.
        erros.push({
          linha,
          coluna: 'Conta Reduzida',
          mensagem: `O reduzido ${nova.codigoReduzido} já pertence a ${anterior.classificacao}, que continua no arquivo.`,
        });
        continue;
      }
      if (anterior) {
        avisos.push({
          linha,
          coluna: 'Classificação',
          mensagem: `O reduzido ${nova.codigoReduzido} passou de ${anterior.classificacao} para ${nova.classificacao}: a antiga foi inativada.`,
        });
      }
      incluir.push({ ...nova, ativo: true });
      continue;
    }
    if (atual.codigoReduzido !== nova.codigoReduzido || atual.tipo !== nova.tipo) {
      const coluna = atual.codigoReduzido !== nova.codigoReduzido ? 'Conta Reduzida' : 'Tipo';
      // Texto da R5 (D7).
      erros.push({
        linha,
        coluna,
        mensagem: `A carga não muda a estrutura de um registro existente (D7): ${atual.classificacao} já existe com o reduzido ${atual.codigoReduzido ?? '(nenhum)'}/tipo ${atual.tipo}.`,
      });
      continue;
    }
    if (!atual.ativo) reativar.push({ ...atual, descricao: nova.descricao, ativo: true });
    else if (atual.descricao !== nova.descricao) alterarDescricao.push({ ...atual, descricao: nova.descricao });
    else inalteradas++;
  }

  const inativar = atuais.filter((a) => a.ativo && !vieram.has(a.classificacao)).map((a) => a.classificacao);
  return { incluir, alterarDescricao, reativar, inativar, inalteradas, avisos, erros };
}
