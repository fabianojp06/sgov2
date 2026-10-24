import { describe, expect, it } from 'vitest';
import { avaliarComando } from './regras.mjs';

// Travas das sessões (spec §11.5, §12.5 e D12): casos da Tarefa 2 do plano P1.
const DEV_LOCAL = { DATABASE_URL: 'postgresql://sgo_migrator:x@127.0.0.1:55432/sgo_dev' };
const VAZIO = {};

describe('avaliarComando', () => {
  it.each([
    ['npx prisma migrate reset --force', { DATABASE_URL: 'postgresql://sgo_migrator:x@127.0.0.1:55432/sgo_dev' }, false],
    ['npx prisma migrate reset --force', { DATABASE_URL: 'postgresql://u:x@sgo-prod_db:5432/sgo' }, true],
    ['DATABASE_URL=postgresql://u:x@sgo-prod_db:5432/sgo npx prisma migrate reset --force', DEV_LOCAL, true],
    ['cd app && npx prisma db push', VAZIO, true],
    ['npx prisma db push', { DATABASE_URL: 'postgresql://u:x@127.0.0.1:56432/sgo_dev' }, false],
    ['npx prisma migrate diff --from-url postgresql://u:x@10.0.1.5:5432/sgo --to-schema prisma/schema', DEV_LOCAL, true],
    ['npx prisma migrate deploy', DEV_LOCAL, false],
    ['docker exec -it sgo-prod_db.1.abc psql -U postgres', VAZIO, true],
    ['docker compose -p sgo-hml down -v', VAZIO, true],
    ['docker cp sgo-prod_app.1:/app/.env .', VAZIO, true],
    ['cat /etc/easypanel/projects/sgo-prod/env', VAZIO, true],
    ['docker compose up -d db', VAZIO, false],
    ['psql -h 127.0.0.1 -p 55432 -U sgo_app sgo_dev', VAZIO, false],
    ['psql -h sgo-prod_db -U postgres', VAZIO, true],
    ['git push origin HEAD:main', VAZIO, true],
    ['git push -u origin us-001-repositorio', VAZIO, false],
    // Casos complementares: variações de disfarce e de destino.
    ['export DATABASE_URL=postgresql://u:x@sgo-prod_db:5432/sgo; npx prisma db push', DEV_LOCAL, true],
    ['npx prisma migrate reset --force', { DATABASE_URL: 'postgresql://u:x@127.0.0.1:5432/sgo' }, true],
    ['npx prisma migrate reset --force', { ...DEV_LOCAL, SHADOW_DATABASE_URL: 'postgresql://u:x@sgo-prod_db:5432/s' }, true],
    ['SHADOW_DATABASE_URL=postgresql://u:x@10.0.1.5:5432/s npx prisma migrate dev', DEV_LOCAL, true],
    ["bash -c 'npx prisma db push'", VAZIO, true],
    ['sudo docker volume rm sgo-hml_db', VAZIO, true],
    ['ls /var/lib/docker/volumes/sgo-prod_db/_data', VAZIO, true],
    ['psql postgresql://u:x@sgo-prod_db:5432/sgo', VAZIO, true],
    ['psql -h 127.0.0.1 -U postgres', VAZIO, true],
    ['git push origin main', VAZIO, true],
    ['git push --force origin +HEAD:refs/heads/main', VAZIO, true],
    ['git push --mirror origin', VAZIO, true],
    ['git push origin us-002-claude-md-hooks', VAZIO, false],
    ['git commit -m "bloqueia acesso a sgo-prod"', VAZIO, false],
  ])('%s (env %j) → bloquear=%s', (comando, env, bloquear) => {
    const r = avaliarComando(comando, env);
    expect(r.bloquear).toBe(bloquear);
    if (bloquear) expect(r.motivo).toMatch(/spec §11\.5|spec §12\.5|D12/);
  });
});
