// Variáveis de acesso (P5, spec §11.2a). Ficam fora do lerEnv porque o proxy.ts também as lê, e
// ele não precisa (nem deve exigir) as URLs de banco.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const URL_DEV = 'http://127.0.0.1:3100';

export type EnvAcesso = {
  urlPublica: string; // origem, sem barra final: os links somam '/login'
  seguro: boolean; // https: cookie com Secure e prefixo __Host-
  confiarProxy: boolean; // atrás do Traefik: o IP vem do último salto do X-Forwarded-For
};

export function lerEnvAcesso(fonte: Readonly<Record<string, string | undefined>> = process.env): EnvAcesso {
  const producao = fonte.NODE_ENV === 'production';
  const bruta = fonte.URL_PUBLICA?.trim() || (producao ? '' : URL_DEV);
  if (!bruta) throw new Error('URL_PUBLICA não definida (obrigatória em produção, veja o .env.example)');
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error('URL_PUBLICA inválida');
  }
  if (url.origin === 'null' || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('URL_PUBLICA deve ser só a origem (esquema, host e porta), sem caminho');
  }
  const seguro = url.protocol === 'https:';
  // Um http por engano desligaria o Secure do cookie em silêncio (P2 da revisão do plano).
  if (producao && !seguro && !LOOPBACK.has(url.hostname)) {
    throw new Error('URL_PUBLICA precisa de https em produção (http só em 127.0.0.1 ou localhost)');
  }
  const confiar = fonte.CONFIAR_PROXY?.trim() ?? '';
  if (confiar !== '' && confiar !== '1') throw new Error('CONFIAR_PROXY deve ser vazio ou 1');
  return { urlPublica: url.origin, seguro, confiarProxy: confiar === '1' };
}
