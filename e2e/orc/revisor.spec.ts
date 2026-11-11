import { expect, test } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Revisor antes do envio (US-064; plano do P14, Task 3, Step 4). O E2E não sobe o worker (o
// global-setup só sobe o `next start`): cobre o pedido e a tela. O processamento fica nos testes de
// integração (revisor.int.test.ts). O exercício nasce e some por SQL, e o banco fica como foi encontrado.
const ANO = 2033;

async function comBanco<T>(f: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await cliente.connect();
  try {
    return await f(cliente);
  } finally {
    await cliente.end();
  }
}

test.describe.serial(`revisor antes do envio ${ANO}`, () => {
  let exercicioId = '';
  let pacoteId = '';

  test.beforeAll(async () => {
    await comBanco(async (c) => {
      const { rows } = await c.query<{ id: string }>('INSERT INTO orc_exercicio (ano) VALUES ($1) RETURNING id', [ANO]);
      exercicioId = rows[0]!.id;
      await c.query(`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = $1`, [exercicioId]);
      const p = await c.query<{ id: string }>(
        `INSERT INTO orc_pacote (exercicio_id, cc, conta, justificativa, prioridade, quantidade, valor_unitario, corrigir_ipca, distribuicao, origem)
         VALUES ($1, '4.3.0', '4.1.1.5.005', 'Reposição de material de escritório', 'ESSENCIAL', 1, 1200, false, 'MENSAL', 'TELA') RETURNING id`,
        [exercicioId],
      );
      pacoteId = p.rows[0]!.id;
    });
  });

  test.afterAll(async () => {
    await comBanco(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`DELETE FROM outbox_mensagem WHERE tipo = 'orc.revisar' AND dados->>'revisaoId' IN (SELECT id::text FROM orc_revisao WHERE exercicio_id = $1)`, [exercicioId]);
        await c.query('DELETE FROM orc_revisao WHERE exercicio_id = $1', [exercicioId]);
        await c.query('DELETE FROM orc_linha WHERE exercicio_id = $1', [exercicioId]);
        await c.query('DELETE FROM orc_pacote WHERE exercicio_id = $1', [exercicioId]);
        await c.query('DELETE FROM orc_exercicio WHERE id = $1', [exercicioId]);
        await c.query('COMMIT');
      } catch (erro) {
        await c.query('ROLLBACK');
        throw erro;
      }
    });
  });

  test('1. GFIN pede a revisão e vê "Revisão em andamento…"; a DIREX não vê o revisor', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await page.goto(`/orc/aprovacao?ano=${ANO}`);
    const painel = page.getByRole('region', { name: 'Revisão antes do envio' });
    await expect(painel.getByText('Nenhuma revisão pedida para este exercício.')).toBeVisible();
    await painel.getByRole('button', { name: 'Revisar antes de enviar' }).click();
    await expect(page).toHaveURL(new RegExp(`/orc/aprovacao\\?ano=${ANO}&aviso=revisao$`));
    await expect(page.getByText('Revisão pedida. Os achados aparecem aqui quando ela terminar.')).toBeVisible();
    await expect(painel.getByText('Revisão em andamento…')).toBeVisible();
    // Enquanto está PENDENTE, não há como pedir outra.
    await expect(painel.getByRole('button', { name: 'Revisar antes de enviar' })).toHaveCount(0);
    const pendentes = await comBanco(async (c) => (await c.query(`SELECT count(*)::int AS n FROM orc_revisao WHERE exercicio_id = $1 AND situacao = 'PENDENTE'`, [exercicioId])).rows[0].n);
    expect(pendentes).toBe(1);

    await page.context().clearCookies();
    await entrarNaTelaPrincipal(page, USUARIOS.direx.login);
    await page.goto(`/orc/aprovacao?ano=${ANO}`);
    await expect(page.getByRole('heading', { name: `Envio e aprovação (${ANO})` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Revisão antes do envio' })).toHaveCount(0);
  });

  test('2. A revisão concluída (como o worker grava) aparece com o achado e o link para a linha', async ({ page }) => {
    const href = `/orc/pacotes?ano=${ANO}&cc=4.3.0&editar=${pacoteId}`;
    const achados = [
      { origem: 'REGRA', tipo: 'DUPLICADO', texto: '2 pacotes iguais no CC 4.3.0, conta 4.1.1.5.005.', links: [{ rotulo: 'Pacote 4.3.0 · 4.1.1.5.005', href }] },
      { origem: 'IA', tipo: 'JUSTIFICATIVA_FRACA', texto: 'A justificativa não diz a quantidade.', links: [{ rotulo: 'Pacote 4.3.0 · 4.1.1.5.005', href }] },
    ];
    await comBanco((c) =>
      c.query(`UPDATE orc_revisao SET situacao = 'CONCLUIDA', achados = $2::jsonb, avisos = $3, concluido_em = now() WHERE exercicio_id = $1 AND situacao = 'PENDENTE'`, [
        exercicioId,
        JSON.stringify(achados),
        ['Não há orçamento oficializado de 2032; a comparação com o ano anterior não foi feita.'],
      ]),
    );
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await page.goto(`/orc/aprovacao?ano=${ANO}`);
    const painel = page.getByRole('region', { name: 'Revisão antes do envio' });
    await expect(painel.getByText(/^Revisão concluída em /)).toBeVisible();
    await expect(painel.getByRole('list', { name: 'Avisos da revisão' })).toContainText('Não há orçamento oficializado de 2032');
    const lista = painel.getByRole('list', { name: 'Achados da revisão' });
    const regra = lista.getByRole('listitem').filter({ hasText: 'Pacotes duplicados' }).first();
    await expect(regra).toContainText('2 pacotes iguais no CC 4.3.0, conta 4.1.1.5.005.');
    await expect(regra).not.toContainText('Gerado com IA – revisar');
    await expect(regra.getByRole('link', { name: 'Pacote 4.3.0 · 4.1.1.5.005' })).toHaveAttribute('href', href);
    const ia = lista.getByRole('listitem').filter({ hasText: 'Justificativa fraca' }).first();
    await expect(ia).toContainText('Gerado com IA – revisar');
    // Pode pedir de novo; o revisor não bloqueia o envio.
    await expect(painel.getByRole('button', { name: 'Revisar antes de enviar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar para aprovação' })).toBeVisible();
  });
});
