import { avancar, ListaExercicios, listarExercicios, textoAviso } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Exercícios do orçamento da Adm. Central (US-055).
export default async function Exercicios({ searchParams }: { searchParams: Promise<{ aviso?: string | string[]; puladas?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.exercicios', 'consultar');
  const [exercicios, { aviso, puladas }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const n = typeof puladas === 'string' && /^\d{1,6}$/.test(puladas) ? Number(puladas) : 0;
  return (
    <ListaExercicios
      exercicios={exercicios}
      podeIncluir={ctx.permissoes.has('orc.exercicios:incluir')}
      podeAlterar={ctx.permissoes.has('orc.exercicios:alterar')}
      avancar={avancar}
      aviso={textoAviso(typeof aviso === 'string' ? aviso : undefined, n)}
    />
  );
}
