import 'server-only';
import { auditar } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { criarCifraSalarios, type CifraSalarios } from '../infrastructure/cifra-salarios';
import { listarAnosExercicio, resumirCadastros, type ResumoCadastros } from '../infrastructure/resumo-cadastros';

// Resumo dos cadastros para a conferência da carga (plano do P7, Task 2), com a transação do
// chamador (o rel, em REPEATABLE READ). A soma dos salários reais só é decifrada com
// cad.salarios:consultar e, como no custo do cargo, a consulta vai para o Histórico (R24). Quem
// chama confere a permissão da própria funcionalidade (rel.conferencia_carga).

type Deps = { cifra?: CifraSalarios };

export async function resumirCadastrosParaConferencia(ctx: ContextoRequisicao, tx: TxCliente, ano: number, deps: Deps = {}): Promise<ResumoCadastros> {
  if (!ctx.permissoes.has('cad.salarios:consultar')) return resumirCadastros(tx, ano, null);
  let cifra: CifraSalarios | null = deps.cifra ?? null;
  const resumo = await resumirCadastros(tx, ano, (codigoCargo, envelope) =>
    (cifra ??= criarCifraSalarios()).decifrar(envelope, { codigoCargo, campo: 'salario_real' }),
  );
  if (resumo.cargos.somaSalarioReal.situacao === 'calculada') {
    await auditar(tx, {
      contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: null },
      funcionalidade: 'cad.salarios',
      tipo: 'CONSULTA',
      registroId: `conferencia-carga-${ano}`,
      descricao: 'Soma dos salários reais dos cargos ativos consultada sem máscara (conferência da carga)',
      depois: { ano, cargos: resumo.cargos.comSalarioReal - resumo.cargos.somaSalarioReal.ilegiveis },
    });
  }
  return resumo;
}

export { listarAnosExercicio };
