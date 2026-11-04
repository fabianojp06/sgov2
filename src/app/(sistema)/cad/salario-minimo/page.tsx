import { acaoAlterarSalarioMinimo, FormSalarioMinimo, obterTelaSalarioMinimo, SeletorAno } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Salário mínimo nacional por exercício (US-053 parte 2; RN_CAR_11). O exercício vem da URL (?ano=2027).
export default async function SalarioMinimo({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const ctx = await exigirPagina('cad.salario_minimo', 'consultar');
  const { ano: anoTexto } = await searchParams;
  const tela = await obterTelaSalarioMinimo(ctx, /^\d{4}$/.test(anoTexto ?? '') ? Number(anoTexto) : null);
  const d = tela.dados;
  return (
    <div>
      <h1>Salário mínimo nacional {tela.ano ?? ''}</h1>
      <SeletorAno acao="/cad/salario-minimo" anos={tela.anos} ano={tela.ano} />
      {d ? (
        <FormSalarioMinimo
          key={d.ano}
          ano={d.ano}
          versao={d.versao}
          valor={d.valor}
          congelado={d.congelado}
          podeAlterar={ctx.permissoes.has('cad.salario_minimo:alterar')}
          alterar={acaoAlterarSalarioMinimo}
        />
      ) : (
        <p>{tela.ano === null ? 'Nenhum exercício tem parâmetros ainda.' : `O exercício ${tela.ano} não tem parâmetros.`}</p>
      )}
    </div>
  );
}
