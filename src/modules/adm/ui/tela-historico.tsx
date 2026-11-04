import { TIPOS_OPERACAO } from '@/shared/audit';
import type { ValoresFiltro } from '../application/filtro-historico';
import type { PaginaHistorico } from '../application/historico';

// Histórico de Operações (US-040, UC02.24): filtros por GET, tabela com os campos do UC02.24 e
// paginação por links. Sem Novo, Alterar nem Excluir (REQ00103). A impressão esconde o menu e os
// filtros (folha de estilo de impressão).
const ROTULO_TIPO: Readonly<Record<string, string>> = {
  INSERCAO: 'Inserção',
  ALTERACAO: 'Alteração',
  EXCLUSAO: 'Exclusão',
  CONSULTA: 'Consulta',
  IMPRESSAO: 'Impressão',
  EXPORTACAO: 'Exportação',
  LOGIN: 'Login',
  LOGOFF: 'Logoff',
  SISTEMA: 'Sistema',
};
const HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });

export function TelaHistorico({
  pagina,
  valores,
  erro,
  hrefPagina,
  hrefExportar,
  imprimir,
}: {
  pagina: PaginaHistorico | null;
  valores: ValoresFiltro;
  erro?: string | undefined;
  hrefPagina: (n: number) => string;
  hrefExportar?: string | undefined;
  imprimir?: React.ReactNode;
}) {
  const ultima = pagina ? Math.max(1, Math.ceil(pagina.total / pagina.porPagina)) : 1;
  return (
    <div>
      <style>{'@media print { nav, header, footer, .sgo-status, .sem-impressao { display: none !important; } }'}</style>
      <h1>Histórico de Operações</h1>
      <form method="get" className="sem-impressao" aria-label="Filtros do Histórico">
        <label htmlFor="historico-usuario">Usuário</label>
        <input id="historico-usuario" name="usuario" defaultValue={valores.usuario} maxLength={120} />
        <label htmlFor="historico-funcionalidade">Funcionalidade</label>
        <input id="historico-funcionalidade" name="funcionalidade" defaultValue={valores.funcionalidade} maxLength={60} placeholder="ex.: adm.usuarios" />
        <label htmlFor="historico-tipo">Tipo de Operação</label>
        <select id="historico-tipo" name="tipo" defaultValue={valores.tipo}>
          <option value="">Todos</option>
          {TIPOS_OPERACAO.map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]}
            </option>
          ))}
        </select>
        <label htmlFor="historico-de">De</label>
        <input id="historico-de" name="de" type="date" defaultValue={valores.de} required />
        <label htmlFor="historico-ate">Até</label>
        <input id="historico-ate" name="ate" type="date" defaultValue={valores.ate} required />
        <button type="submit">Filtrar</button>
      </form>
      <p className="sem-impressao">
        {hrefExportar && <a href={hrefExportar}>Exportar</a>} {imprimir}
      </p>
      {erro && <p role="alert">{erro}</p>}
      {pagina && (
        <>
          <p role="status">{`${pagina.total} registro(s) · página ${pagina.pagina} de ${ultima}`}</p>
          <table>
            <caption>{`Período de ${valores.de.split('-').reverse().join('/')} a ${valores.ate.split('-').reverse().join('/')}`}</caption>
            <thead>
              <tr>
                <th scope="col">Data da Operação</th>
                <th scope="col">Usuário</th>
                <th scope="col">Funcionalidade</th>
                <th scope="col">Tipo de Operação</th>
                <th scope="col">Descrição</th>
              </tr>
            </thead>
            <tbody>
              {pagina.linhas.map((l) => (
                <tr key={l.id}>
                  <td>{HORA.format(l.ocorridoEm)}</td>
                  <td>{l.usuario}</td>
                  <td>{l.funcionalidade}</td>
                  <td>{ROTULO_TIPO[l.tipo] ?? l.tipo}</td>
                  <td>{l.descricao}</td>
                </tr>
              ))}
              {pagina.linhas.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhuma operação encontrada com esses filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
          <nav aria-label="Páginas do Histórico" className="sem-impressao">
            {pagina.pagina > 1 && <a href={hrefPagina(pagina.pagina - 1)}>Anterior</a>}{' '}
            {pagina.pagina < ultima && <a href={hrefPagina(pagina.pagina + 1)}>Próxima</a>}
          </nav>
        </>
      )}
    </div>
  );
}
