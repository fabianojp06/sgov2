import {
  AcoesCiclo,
  aprovarAcao,
  enviarAcao,
  exercicioDoAno,
  listarExercicios,
  listarTramites,
  MENSAGENS_ORC,
  naoEncontradoSeNegado,
  PainelRevisao,
  pedirRevisaoAcao,
  rejeitarAcao,
  SeletorExercicio,
  ultimaRevisao,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Envio e aprovação do orçamento da Adm. Central (US-061; C36).
const AVISOS: Readonly<Record<string, string>> = {
  enviado: 'Orçamento enviado para aprovação.',
  aprovado: 'Orçamento aprovado e oficializado.',
  rejeitado: 'Orçamento rejeitado; voltou para Em Elaboração.',
  revisao: MENSAGENS_ORC.REVISAO_PEDIDA,
};

export default async function Aprovacao({ searchParams }: { searchParams: Promise<{ ano?: string | string[]; aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.aprovacao', 'consultar');
  const [exercicios, { ano, aviso }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, ano);
  if (!atual) {
    return (
      <div>
        <h1>Envio e aprovação</h1>
        <p>Nenhum exercício cadastrado.</p>
      </div>
    );
  }
  // Revisor antes do envio (US-064): quem envia vê e pede a revisão; os outros perfis, não.
  const podeEnviar = ctx.permissoes.has('orc.aprovacao:executar');
  const [tramites, revisao] = await Promise.all([
    listarTramites(ctx, atual.id).catch(naoEncontradoSeNegado(ctx)),
    podeEnviar ? ultimaRevisao(ctx, atual.id) : null,
  ]);
  return (
    <div>
      <h1>{`Envio e aprovação (${atual.ano})`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual.ano} rota="/orc/aprovacao" />
      <AcoesCiclo
        exercicio={atual}
        tramites={tramites}
        podeEnviar={podeEnviar}
        podeAprovar={ctx.permissoes.has('orc.aprovacao:aprovar')}
        enviar={enviarAcao}
        aprovar={aprovarAcao}
        rejeitar={rejeitarAcao}
        aviso={typeof aviso === 'string' && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined}
      />
      {podeEnviar && <PainelRevisao exercicio={{ id: atual.id, versao: atual.versao, situacao: atual.situacao }} revisao={revisao} pedir={pedirRevisaoAcao} />}
    </div>
  );
}
