import { expect, test } from '@playwright/test';

// Medição da rolagem fluida da Tree Grid (US-021, I12; plano do P4, Task 6a, Step 5). Fica em
// fixme até existirem a tela de importação (Task 7a) e o usuário GFIN no global-setup (issue para a
// frente A). Roda sozinho, depois do build (D12): npm run test:e2e -- e2e/cad/rolagem-plano.spec.ts
//
// Plano B (PO), em hml, sem este spec: Chrome DevTools › Performance, gravar 5 s rolando o plano de
// 5.000 linhas todo expandido; conferir FPS médio ≥ 55 e nenhuma tarefa longa acima de 50 ms.
test.fixme('rolagem do plano de contas de 5.000 linhas a ≥ 55 FPS, sem tarefa longa acima de 50 ms', async ({ page }) => {
  // 1 e 2: login como GFIN e importação do plano sintético pela tela (Task 7a).
  await page.goto('/cad/plano-contas?expandir=todos');
  await expect(page.getByRole('treegrid')).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __tarefasLongas: number[] };
    w.__tarefasLongas = [];
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) w.__tarefasLongas.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const quadros: number[] = [];
  cdp.on('Tracing.dataCollected', ({ value }: { value: { name?: string; ts?: number }[] }) => {
    for (const e of value) if (e.name === 'DrawFrame' && e.ts !== undefined) quadros.push(e.ts);
  });
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame' });

  const grade = page.getByRole('treegrid');
  await grade.hover();
  const fim = Date.now() + 5000;
  while (Date.now() < fim) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(16);
  }

  const terminou = new Promise<void>((ok) => cdp.once('Tracing.tracingComplete', () => ok()));
  await cdp.send('Tracing.end');
  await terminou;

  const segundos = quadros.length > 1 ? (quadros.at(-1)! - quadros[0]!) / 1e6 : 0;
  const fps = segundos > 0 ? (quadros.length - 1) / segundos : 0;
  const longas = await page.evaluate(() => (window as unknown as { __tarefasLongas: number[] }).__tarefasLongas);
  console.log(`[ROLAGEM] ${fps.toFixed(1)} FPS em ${segundos.toFixed(1)} s; tarefas longas: ${longas.length}`);
  expect(fps).toBeGreaterThanOrEqual(55);
  expect(longas.filter((d) => d > 50)).toEqual([]);
});
