import { acaoRegravarSalarios, escopoDaSessao, ListaCargos, listarCargos } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Cargos e salários (US-049 parte 2). Sem a permissão de ver salários, eles vêm mascarados (R24).
export default async function Cargos() {
  const ctx = await exigirPagina('cad.cargos', 'consultar');
  const cargos = await listarCargos(ctx);
  const executar = ctx.permissoes.has('cad.cargos:executar');
  return (
    <main>
      <h1>Cargos e Salários</h1>
      {executar && <a href="/cad/cargos/importar">Importar arquivo do Rubi</a>}
      <ListaCargos cargos={cargos} escopoSessao={escopoDaSessao(ctx)} podeRegravar={executar} regravar={acaoRegravarSalarios} />
    </main>
  );
}
