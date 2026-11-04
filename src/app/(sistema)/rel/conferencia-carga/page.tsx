import { formatarCelula } from '@/modules/ger';
import { obterConferenciaCarga } from '@/modules/rel';
import { SeletorAno } from '@/modules/cad';
import { exigirPagina } from '@/shared/authz';

// Conferência da carga inicial (plano do P7, Task 2; US-115). O exercício vem da URL (?ano=2027).
export default async function ConferenciaCarga({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const ctx = await exigirPagina('rel.conferencia_carga', 'consultar');
  const { ano: anoTexto } = await searchParams;
  const tela = await obterConferenciaCarga(ctx, /^\d{4}$/.test(anoTexto ?? '') ? Number(anoTexto) : null);
  const podeExportar = ctx.permissoes.has('rel.conferencia_carga:exportar');
  return (
    <main>
      <h1>Conferência da carga {tela.ano ?? ''}</h1>
      <p>Contagens e totais dos cadastros, para conferir contra as planilhas de origem.</p>
      <SeletorAno acao="/rel/conferencia-carga" anos={tela.anos} ano={tela.ano} />
      {podeExportar && tela.ano !== null && (
        <p>
          Exportar: <a href={`/rel/conferencia-carga/exportar?ano=${tela.ano}&formato=xlsx`}>XLSX</a> ·{' '}
          <a href={`/rel/conferencia-carga/exportar?ano=${tela.ano}&formato=csv`}>CSV</a>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th scope="col">Seção</th>
            <th scope="col">Item</th>
            <th scope="col">Quantidade</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {tela.linhas.map((l) => (
            <tr key={`${l.secao}|${l.item}`}>
              <td>{l.secao}</td>
              <td>{l.item}</td>
              <td>{l.quantidade ?? ''}</td>
              <td>{l.oculto ? 'oculto' : formatarCelula('dinheiro', l.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
