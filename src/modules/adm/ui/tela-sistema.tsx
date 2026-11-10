import { AcaoConfirmada, GradeArvore, type AcaoFormulario, type ColunaGrade, type NoGrade } from '@/modules/ger';
import { desativacaoAgendada, desativacaoFoiAgendada, MENSAGENS_SISTEMA } from '../domain/sistema';
import { DesativarSistema } from './desativar-sistema';

// Ativação e Desativação do Sistema (US-036, UC02.01): o status, um só botão habilitado (RN0064) e
// a tabela das ativações e desativações, da mais recente para a mais antiga, sem paginação (REQ0053).
// Durante a contagem, o status continua ATIVO, com o aviso do agendamento, e só o Ativar fica
// habilitado: ele cancela a desativação (D-P9-10).
type Estado = { ativo: boolean; desativacaoEm: Date | null };
type Ativacao = { tipo: string; motivo: string | null; em: Date; usuario: string };

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

type Campo = 'tipo' | 'motivo' | 'em' | 'usuario';
const COLUNAS: readonly ColunaGrade<Campo>[] = [
  { campo: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 140 },
  { campo: 'motivo', titulo: 'Motivo', tipo: 'texto' },
  { campo: 'em', titulo: 'Data/Hora', tipo: 'texto', largura: 160 },
  { campo: 'usuario', titulo: 'Usuário', tipo: 'texto', largura: 220 },
];

// A URL leva só o código do aviso: texto livre na query seria um vetor de conteúdo forjado.
function textoDoAviso(aviso: string | undefined, estado: Estado): string | undefined {
  if (aviso === 'ativado') return MENSAGENS_SISTEMA.ATIVADO;
  if (aviso === 'desativado') return MENSAGENS_SISTEMA.DESATIVADO;
  if (aviso === 'agendado' && estado.ativo && estado.desativacaoEm) return desativacaoFoiAgendada(estado.desativacaoEm);
  return undefined;
}

export function TelaSistema({
  estado,
  ativacoes,
  podeAlterar,
  aviso,
  ativar,
  desativar,
}: {
  estado: Estado;
  ativacoes: readonly Ativacao[];
  podeAlterar: boolean;
  aviso?: string | undefined;
  ativar: AcaoFormulario;
  desativar: AcaoFormulario;
}) {
  const agendada = estado.ativo && estado.desativacaoEm !== null;
  const podeAtivar = podeAlterar && (!estado.ativo || agendada);
  const podeDesativar = podeAlterar && estado.ativo && !agendada;
  const textoAviso = textoDoAviso(aviso, estado);
  const nos: NoGrade<Campo>[] = ativacoes.map((a, i) => ({
    id: String(i),
    linha: { tipo: a.tipo, motivo: a.motivo ?? '—', em: dataHora.format(a.em), usuario: a.usuario },
  }));
  return (
    <div>
      <h1>Ativação e Desativação do Sistema</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      <p>{estado.ativo ? MENSAGENS_SISTEMA.STATUS_ATIVO : MENSAGENS_SISTEMA.STATUS_INATIVO}</p>
      {agendada && estado.desativacaoEm && <p>{desativacaoAgendada(estado.desativacaoEm)}</p>}
      {podeAtivar ? (
        <AcaoConfirmada rotulo="Ativar" pergunta={MENSAGENS_SISTEMA.CONFIRMAR_ATIVAR} acao={ativar} campos={{}} />
      ) : (
        <button type="button" disabled>
          Ativar
        </button>
      )}
      <DesativarSistema acao={desativar} habilitado={podeDesativar} />
      {/* Texto vazio [PROVISÓRIO]. */}
      <GradeArvore
        idGrade="adm.sistema"
        rotulo="Histórico de ativações e desativações"
        nos={nos}
        colunas={COLUNAS}
        textoVazio="Nenhuma ativação ou desativação registrada."
      />
    </div>
  );
}
