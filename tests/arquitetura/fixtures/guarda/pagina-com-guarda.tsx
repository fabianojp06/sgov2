// Fixture do teste de arquitetura da guarda (P5): página do sistema com exigirPagina no início.
declare const exigirPagina: (...args: unknown[]) => Promise<unknown>;

export default async function Pagina() {
  const ctx = await exigirPagina('adm.usuarios', 'consultar');
  return <main>{String(ctx)}</main>;
}
