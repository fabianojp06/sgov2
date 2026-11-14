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
  ipc?: string;
  userns_mode?: string;
  devices?: unknown[];
  security_opt?: unknown[];
  extra_hosts?: unknown;
  mem_reservation?: string;
  deploy?: unknown;
};
type Recurso = { external?: boolean; name?: string } | null;
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
    // #163 (R3): nada que compartilhe recursos do host ou escape do isolamento.
    expect([servico.ipc, servico.userns_mode, servico.devices, servico.security_opt, servico.extra_hosts]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  // #163 (R6): o limite de memória é o mem_limit; reserva acima dele ou deploy.resources o contornariam.
  it.each(servicos)('%s não tem deploy nem reserva de memória acima do limite', (_nome, servico) => {
    expect(servico.deploy).toBeUndefined();
    if (servico.mem_reservation) expect(megabytes(servico.mem_reservation)).toBeLessThanOrEqual(megabytes(servico.mem_limit ?? '0m'));
  });

  it('não usa volumes nem redes externos', () => {
    const recursos = [...Object.values(compose.volumes ?? {}), ...Object.values(compose.networks ?? {})];
    expect(recursos.filter((r) => r?.external)).toEqual([]);
    // driver_opts (bind/device) aponta o volume para um caminho do host.
    expect(recursos.filter((r) => r && 'driver_opts' in r)).toEqual([]);
    // #163 (R2): `name` fixo ligaria o volume ou a rede a um recurso global do host (de outra frente ou de hml e
    // prod), fora do prefixo do COMPOSE_PROJECT_NAME.
    expect(recursos.filter((r) => r && 'name' in r)).toEqual([]);
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

  it('o app limita o heap do Node a 1280 MB, abaixo do mem_limit de 1536 MB (#163)', () => {
    expect(ambiente(compose.services.app!).NODE_OPTIONS).toMatch(/--max-old-space-size=1280(\s|$)/);
  });

  // #163: o heap fica até 85% do mem_limit (o Node usa memória fora do heap), e a opção aparece uma vez só (a
  // última valeria, e o teste leria a primeira).
  it.each(['app', 'worker'])('%s tem heap do Node que cabe no mem_limit, com folga, e uma opção só', (nome) => {
    const servico = compose.services[nome]!;
    const opcoes = [...(ambiente(servico).NODE_OPTIONS ?? '').matchAll(/--max-old-space-size=(\d+)(\s|$)/g)];
    expect(opcoes, 'NODE_OPTIONS deve ter um único --max-old-space-size').toHaveLength(1);
    expect(Number(opcoes[0]![1])).toBeLessThanOrEqual(Math.floor(megabytes(servico.mem_limit ?? '0m') * 0.85));
  });

  // P4 (US-025 e cargas): o worker envia pelo Mailpit e faz o merge das cargas como sgo_sync.
  it('o worker envia e-mail pelo Mailpit, sem TLS só porque é a rede interna do compose', () => {
    const env = ambiente(compose.services.worker!);
    expect(env.SMTP_HOST).toBe('mailpit');
    expect(env.SMTP_PORTA).toBe('1025');
    expect(env.SMTP_SEGURANCA).toBe('nenhuma');
    expect(env.EMAIL_REMETENTE).toMatch(/<nao-responda@sgo\.local>$/);
    expect(env.URL_PUBLICA).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(env.AMBIENTE).toBe('dev');
  });

  it('só o worker tem a SYNC_DATABASE_URL, com o papel sgo_sync no banco de dev', () => {
    expect(ambiente(compose.services.worker!).SYNC_DATABASE_URL).toBe('postgresql://sgo_sync:sgo_sync@db:5432/sgo_dev');
    expect(ambiente(compose.services.app!).SYNC_DATABASE_URL).toBeUndefined();
  });

  it('o Mailpit não publica a porta SMTP (1025)', () => {
    const portas = (compose.services.mailpit!.ports ?? []).map((p) => (typeof p === 'object' ? String(p.target) : String(p)));
    expect(portas.some((p) => /(^|:)1025$/.test(p))).toBe(false);
  });
});
