import {
  alterarQtdeAcao,
  excluirQtdeAcao,
  incluirQtdeAcao,
  listarQtdes,
  naoEncontradoSeNegado,
  TelaQtdeEmpregados,
  textoAvisoQtde,
  type FormularioPessoalAberto,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Quantitativos de pessoal por período da proposta de TP (US-070): o período e o documento de respaldo, com as
// quantidades contadas dos empregados (RN0457). Mesma matriz da tela de empregados; RLS por TP.
// ?nova=<proposta> e ?editar=<quantitativo> abrem o formulário (plano do P20, Task 2).
type Busca = Partial<Record<'aviso' | 'd' | 'tipo' | 'proposta' | 'meta' | 'nova' | 'editar', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function QtdeEmpregados({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.qtde_empregados', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.qtde_empregados:incluir'),
    podeAlterar: ctx.permissoes.has('orc.qtde_empregados:alterar'),
    podeExcluir: ctx.permissoes.has('orc.qtde_empregados:excluir'),
  };
  const busca = await searchParams;
  const filtros = { tipo: um(busca.tipo), proposta: um(busca.proposta), meta: um(busca.meta) };
  const nova = um(busca.nova);
  const editar = um(busca.editar);
  const formulario: FormularioPessoalAberto | null =
    nova !== undefined && permissoes.podeIncluir
      ? { modo: 'incluir', propostaId: nova }
      : editar !== undefined && permissoes.podeAlterar
        ? { modo: 'alterar', id: editar }
        : null;
  const blocos = await listarQtdes(ctx, formulario ? {} : filtros).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Qtde. Empregados</h1>
      <TelaQtdeEmpregados
        blocos={blocos}
        filtros={filtros}
        permissoes={permissoes}
        acoes={{ incluir: incluirQtdeAcao, alterar: alterarQtdeAcao, excluir: excluirQtdeAcao }}
        aviso={textoAvisoQtde(um(busca.aviso), um(busca.d))}
        formulario={formulario}
      />
    </div>
  );
}
