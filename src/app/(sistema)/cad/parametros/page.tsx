import { acaoAlterarParametros, FormParametros, obterTelaParametros, SeletorAno } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Parâmetros do exercício (US-053 parte 2): premissas, semáforo, encargos e contas por componente.
// O exercício vem da URL (?ano=2027); sem ele, o mais recente com parâmetros.
export default async function Parametros({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const ctx = await exigirPagina('cad.parametros', 'consultar');
  const { ano: anoTexto } = await searchParams;
  const tela = await obterTelaParametros(ctx, /^\d{4}$/.test(anoTexto ?? '') ? Number(anoTexto) : null);
  const p = tela.parametros;
  return (
    <div>
      <h1>
        Parâmetros do exercício {tela.ano ?? ''}
        {p?.provisorio && <strong> Provisório</strong>}
      </h1>
      <SeletorAno acao="/cad/parametros" anos={tela.anos} ano={tela.ano} />
      {p ? (
        // A chave remonta o formulário ao trocar de ano. A versão fica no estado dele: gravação de outra
        // pessoa dá o aviso de concorrência do caso de uso ("Recarregue a tela").
        <FormParametros
          key={p.ano}
          tela={p}
          contas={tela.contas}
          podeAlterar={ctx.permissoes.has('cad.parametros:alterar')}
          alterar={acaoAlterarParametros}
        />
      ) : (
        <p>{tela.ano === null ? 'Nenhum exercício tem parâmetros ainda.' : `O exercício ${tela.ano} não tem parâmetros.`}</p>
      )}
    </div>
  );
}
