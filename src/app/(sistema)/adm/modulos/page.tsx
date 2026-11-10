import { alternarFuncionalidade, alternarModulo, listarModulos, TelaModulos } from '@/modules/adm';
import { exigirPagina } from '@/shared/authz';

// Módulos e Funcionalidades (US-035; EP085 UC02.05 e UC02.06): a lista e, com ?modulo=, o detalhamento.
const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Modulos({ searchParams }: { searchParams: Promise<{ modulo?: string | string[]; aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('adm.modulos', 'consultar');
  const [modulos, { modulo, aviso }] = await Promise.all([listarModulos(ctx), searchParams]);
  return (
    <TelaModulos
      modulos={modulos}
      selecionado={texto(modulo)}
      podeAlterar={ctx.permissoes.has('adm.modulos:alterar')}
      aviso={texto(aviso)}
      alternarModulo={alternarModulo}
      alternarFuncionalidade={alternarFuncionalidade}
    />
  );
}
