import { FLUXOS_APROVACAO, FormAlcada, incluirAlcada, listarAprovadoresPossiveis, ROTULO_FLUXO } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Cadastrar Alçada de Aprovação (US-042).
export default async function NovaAlcada() {
  const ctx = await exigirPagina('adm.alcadas', 'incluir');
  const usuarios = await listarAprovadoresPossiveis(ctx);
  return (
    <div>
      <h1>Cadastrar Alçada de Aprovação</h1>
      <FormAlcada fluxos={FLUXOS_APROVACAO.map((codigo) => ({ codigo, rotulo: ROTULO_FLUXO[codigo] }))} usuarios={usuarios} salvar={incluirAlcada} />
    </div>
  );
}
