import { GradeArvore, type ColunaGrade, type NoGrade } from '@/modules/ger';

// Alçadas de Aprovação (US-042, §11.4): Fluxo, Titular, Substituto e Situação. Ativas primeiro; as
// inativas ficam na lista como registro de quem aprovava em cada período. Para quem pode alterar,
// o fluxo da alçada ativa leva ao formulário.
type ItemLista = {
  id: string;
  fluxo: string;
  rotuloFluxo: string;
  titular: { nome: string; ativo: boolean };
  substituto: { nome: string; ativo: boolean };
  ativa: boolean;
  inativadaEm: Date | null;
};

// A URL leva só o código do aviso: texto livre na query seria um vetor de conteúdo forjado. [PROVISÓRIOS]
const AVISOS: Readonly<Record<string, string>> = {
  cadastrada: 'Alçada cadastrada com sucesso',
  alterada: 'Aprovadores da alçada alterados com sucesso',
  excluida: 'Alçada excluída com sucesso',
};

const pessoa = (u: { nome: string; ativo: boolean }) => (u.ativo ? u.nome : `${u.nome} (inativo)`);
const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });
export const situacaoAlcada = (a: { ativa: boolean; inativadaEm: Date | null }) => (a.ativa ? 'Ativa' : `Inativa desde ${a.inativadaEm ? data.format(a.inativadaEm) : '—'}`);

type Campo = 'fluxo' | 'titular' | 'substituto' | 'situacao';
const COLUNAS: readonly ColunaGrade<Campo>[] = [
  { campo: 'fluxo', titulo: 'Fluxo', tipo: 'texto' },
  { campo: 'titular', titulo: 'Titular', tipo: 'texto' },
  { campo: 'substituto', titulo: 'Substituto', tipo: 'texto' },
  { campo: 'situacao', titulo: 'Situação', tipo: 'texto', largura: 200 },
];

export function ListaAlcadas({
  alcadas,
  podeIncluir,
  podeAlterar,
  aviso,
}: {
  alcadas: readonly ItemLista[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  aviso?: string | undefined;
}) {
  const textoAviso = aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const nos: NoGrade<Campo>[] = alcadas.map((a) => ({
    id: a.id,
    linha: { fluxo: `${a.fluxo} – ${a.rotuloFluxo}`, titular: pessoa(a.titular), substituto: pessoa(a.substituto), situacao: situacaoAlcada(a) },
    ...(podeAlterar && a.ativa ? { href: `/adm/alcadas/${a.id}` } : {}),
  }));
  return (
    <div>
      <h1>Alçadas de Aprovação</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      {podeIncluir && <a href="/adm/alcadas/novo">Novo</a>}
      <GradeArvore idGrade="adm.alcadas" rotulo="Alçadas de Aprovação" nos={nos} colunas={COLUNAS} textoVazio="Nenhuma alçada cadastrada." />
    </div>
  );
}
