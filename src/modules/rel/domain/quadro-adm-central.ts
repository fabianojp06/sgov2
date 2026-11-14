import { Dinheiro } from '@/shared/kernel';
import { MINIMO_GRUPO_CUSTO } from './quadro-pessoal';

// Análise do quadro de pessoal, parte 2 (US-107, IA-07, D-107-2): as posições orçadas da Administração
// Central (US-056, listarPosicoes do orc) agregadas por diretoria, no exercício escolhido e no anterior.
// As mesmas regras de privacidade da parte 1 (domain/quadro-pessoal): nenhum custo por cargo; o custo da
// diretoria só com pelo menos MINIMO_GRUPO_CUSTO pessoas (a soma das quantidades), todas as posições com
// custo calculado (maior que zero) e pelo menos 2 custos por pessoa diferentes (valor anual ÷ quantidade).

/** O que o rel lê de cada posição (o formato do PosicaoTela do orc, só com o necessário; sem o cargo). */
export type PosicaoEntrada = { cc: string; quantidade: number; mesInicio: number; mesSaida: number; valorAnual: Dinheiro | null };
export type ExercicioEntrada = { ano: number; situacao: string; veSalario: boolean; posicoes: readonly PosicaoEntrada[] };

export type DiretoriaQuadro = {
  /** Classificação do CC de nível 2 (ex.: '4.3'); as posições no próprio CC raiz ficam em '4'. */
  diretoria: string;
  nome: string;
  postos: number;
  postosDezembro: number;
  custoAnual: string | null;
  semCusto: 'SEM_PERMISSAO' | 'POUCOS_POSTOS' | 'CUSTO_INCOMPLETO' | 'CUSTOS_IGUAIS' | null;
};
export type ExercicioQuadro = { ano: number; situacao: string; postos: number; postosDezembro: number; diretorias: DiretoriaQuadro[]; custoAnualExibido: string | null };
export type QuadroAdmCentral = { exercicios: ExercicioQuadro[] };

/** O CC de nível 2 de uma classificação ('4.3.2.11' → '4.3'); a raiz fica como está. */
export const diretoriaDoCc = (cc: string) => cc.split('.').slice(0, 2).join('.');

const ativaEmDezembro = (p: PosicaoEntrada) => p.mesInicio <= 12 && p.mesSaida >= 12;
const somar = (valores: readonly Dinheiro[]) => valores.reduce((a, b) => a.somar(b), Dinheiro.zero());
const positivo = (v: Dinheiro | null): v is Dinheiro => v !== null && v.comparar(Dinheiro.zero()) > 0;

function motivoSemCusto(veSalario: boolean, posicoes: readonly PosicaoEntrada[], pessoas: number): DiretoriaQuadro['semCusto'] {
  if (!veSalario) return 'SEM_PERMISSAO';
  if (pessoas < MINIMO_GRUPO_CUSTO) return 'POUCOS_POSTOS';
  if (!posicoes.every((p) => p.quantidade > 0 && positivo(p.valorAnual))) return 'CUSTO_INCOMPLETO';
  const porPessoa = new Set(posicoes.map((p) => p.valorAnual!.dividir(String(p.quantidade)).paraString()));
  if (porPessoa.size < 2) return 'CUSTOS_IGUAIS';
  return null;
}

function agregarExercicio(e: ExercicioEntrada, nomeDoCc: (cc: string) => string): ExercicioQuadro {
  const porDiretoria = new Map<string, PosicaoEntrada[]>();
  for (const p of e.posicoes) {
    const d = diretoriaDoCc(p.cc);
    porDiretoria.set(d, [...(porDiretoria.get(d) ?? []), p]);
  }
  const diretorias = [...porDiretoria.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
    .map(([diretoria, ps]): DiretoriaQuadro => {
      const postos = ps.reduce((a, p) => a + p.quantidade, 0);
      const semCusto = motivoSemCusto(e.veSalario, ps, postos);
      return {
        diretoria,
        nome: nomeDoCc(diretoria),
        postos,
        postosDezembro: ps.filter(ativaEmDezembro).reduce((a, p) => a + p.quantidade, 0),
        custoAnual: semCusto === null ? somar(ps.map((p) => p.valorAnual!)).paraString() : null,
        semCusto,
      };
    });
  const exibidos = diretorias.filter((d) => d.custoAnual !== null).map((d) => Dinheiro.de(d.custoAnual!));
  return {
    ano: e.ano,
    situacao: e.situacao,
    postos: diretorias.reduce((a, d) => a + d.postos, 0),
    postosDezembro: diretorias.reduce((a, d) => a + d.postosDezembro, 0),
    diretorias,
    custoAnualExibido: exibidos.length > 0 ? somar(exibidos).paraString() : null,
  };
}

/** Os exercícios em ordem de ano (o anterior primeiro, para a comparação), com os nomes das diretorias. */
export function agregarAdmCentral(exercicios: readonly ExercicioEntrada[], nomeDoCc: (cc: string) => string): QuadroAdmCentral {
  return { exercicios: [...exercicios].sort((a, b) => a.ano - b.ano).map((e) => agregarExercicio(e, nomeDoCc)) };
}
