import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Compose de dev na VPS de produção (D12, spec §4.3 e §12.4): portas só em 127.0.0.1,
// limite de memória e prioridade de OOM em todo contêiner, nada que lembre hml ou prod,
// nenhum acesso ao host (rede, docker.sock, Traefik).
type Porta = string | number | { host_ip?: string; published?: string | number; target?: number };
type Servico = {
  image?: string;
  mem_limit?: string;
  memswap_limit?: string;
  oom_score_adj?: number;
  ports?: Porta[];
  environment?: Record<string, string> | string[];
  volumes?: (string | { source?: string })[];
  labels?: Record<string, string> | string[];
  network_mode?: string;
  pid?: string;
  privileged?: boolean;
  cap_add?: string[];
};
type Recurso = { external?: boolean } | null;
type Compose = {
  name?: string;
  services: Record<string, Servico>;
  volumes?: Record<string, Recurso>;
  networks?: Record<string, Recurso>;
};

const compose = parse(readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')) as Compose;
const servicos = Object.entries(compose.services);

const LIMITES: Record<string, string> = { db: '768m', app: '1536m', worker: '512m', mailpit: '64m' };

function ambiente(servico: Servico): Record<string, string> {
  const env = servico.environment ?? {};
  if (!Array.isArray(env)) return env;
  return Object.fromEntries(env.map((par) => [par.split('=')[0], par.slice(par.indexOf('=') + 1)]));
}

function megabytes(limite: string): number {
  const [, valor, unidade] = /^(\d+)([mg])$/.exec(limite) ?? [];
  return Number(valor) * (unidade === 'g' ? 1024 : 1);
}

// Porta curta: "127.0.0.1:${DB_PORT:?...}:5432"; longa: { host_ip, published, target }.
function hostDaPorta(porta: Porta): string | undefined {
  if (typeof porta === 'object') return porta.host_ip;
  const partes = String(porta).replace(/\$\{[^}]*\}/g, 'VAR').split(':');
  return partes.length === 3 ? partes[0] : undefined;
}

describe('docker-compose.yml de dev (D12)', () => {
  it('tem os serviços db, mailpit, app e worker', () => {
    expect(Object.keys(compose.services).sort()).toEqual(['app', 'db', 'mailpit', 'worker']);
  });

  it('o nome do projeto vem obrigatoriamente de COMPOSE_PROJECT_NAME (sem padrão)', () => {
    expect(compose.name).toMatch(/^\$\{COMPOSE_PROJECT_NAME:\?[^}]*\}$/);
  });

  it.each(servicos)('%s tem o mem_limit fixado, sem swap extra, e oom_score_adj >= 500', (nome, servico) => {
    expect(servico.mem_limit).toBe(LIMITES[nome]);
    expect(servico.memswap_limit).toBe(servico.mem_limit);
    expect(servico.oom_score_adj).toBeGreaterThanOrEqual(500);
  });

  it.each(servicos)('%s só publica portas em 127.0.0.1, com a porta do host obrigatória', (_nome, servico) => {
    for (const porta of servico.ports ?? []) {
      expect(hostDaPorta(porta), `porta exposta: ${JSON.stringify(porta)}`).toBe('127.0.0.1');
      if (typeof porta === 'string') expect(porta).toMatch(/^127\.0\.0\.1:\$\{[A-Z_]+_PORT:\?[^}]*\}:\d+$/);
    }
  });

  it.each(servicos)('%s não acessa o host (rede, pid, privilégios, docker.sock, Traefik)', (_nome, servico) => {
    expect(servico.network_mode).toBeUndefined();
    expect(servico.pid).toBeUndefined();
    expect(servico.privileged).toBeFalsy();
    expect(servico.cap_add).toBeUndefined();
    const volumes = (servico.volumes ?? []).map((v) => (typeof v === 'string' ? v : (v.source ?? '')));
    expect(volumes.filter((v) => v.includes('docker.sock'))).toEqual([]);
    // Bind só do próprio repositório (.) ou de volumes nomeados; caminho absoluto ou ../ alcança o host.
    expect(volumes.filter((v) => /^(\/|~|\.\.)/.test(v) || v.includes('${'))).toEqual([]);
    expect(JSON.stringify(servico.labels ?? {})).not.toMatch(/traefik/i);
  });

  it('não usa volumes nem redes externos', () => {
    const recursos = [...Object.values(compose.volumes ?? {}), ...Object.values(compose.networks ?? {})];
    expect(recursos.filter((r) => r?.external)).toEqual([]);
    // driver_opts (bind/device) aponta o volume para um caminho do host.
    expect(recursos.filter((r) => r && 'driver_opts' in r)).toEqual([]);
  });

  it('nada no compose (nomes, valores, volumes, URLs) cita prod ou hml', () => {
    expect(JSON.stringify(compose)).not.toMatch(/prod|hml/i);
  });

  it('a senha do Postgres vem do .env, nunca fixa no compose', () => {
    expect(ambiente(compose.services.db!).POSTGRES_PASSWORD).toBe('${POSTGRES_PASSWORD}');
  });

  it('o db usa pgvector/pgvector:pg16', () => {
    expect(compose.services.db?.image).toBe('pgvector/pgvector:pg16');
  });

  it('o app limita o heap do Node a 1536 MB', () => {
    expect(ambiente(compose.services.app!).NODE_OPTIONS).toMatch(/--max-old-space-size=1536(\s|$)/);
  });

  it.each(['app', 'worker'])('%s tem heap do Node que cabe no mem_limit', (nome) => {
    const servico = compose.services[nome]!;
    const [, heap] = /--max-old-space-size=(\d+)(\s|$)/.exec(ambiente(servico).NODE_OPTIONS ?? '') ?? [];
    expect(heap, 'NODE_OPTIONS sem --max-old-space-size').toBeDefined();
    expect(Number(heap)).toBeLessThanOrEqual(Math.min(1536, megabytes(servico.mem_limit ?? '0m')));
  });
});
