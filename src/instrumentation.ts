// Registro do provedor de contexto do aut na guarda do P1 (plano do P5, Task 2b). Só no runtime
// Node: o provedor usa o banco.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    (await import('@/modules/aut')).registrarAutenticacao();
  }
}
