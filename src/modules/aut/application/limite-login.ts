// Limite de taxa e de concorrência do login (D-P5-1, spec §11.2a). Em memória, por processo: com
// mais de uma instância o limite multiplica (risco aceito). O rateLimit do Traefik é outra camada.
type Janela = { inicio: number; total: number };

export type OpcoesLimitador = {
  porIp?: number;
  porLogin?: number;
  janelaMs?: number;
  concorrencia?: number; // Argon2 simultâneos no processo
  esperaMs?: number; // quanto o excedente espera por uma vaga
  teto?: number; // chaves por mapa (descarta a mais antiga)
  maxFila?: number; // pedidos em espera; o excedente recebe OCUPADO na hora
  agora?: () => number;
};

export type LimitadorLogin = {
  permitir(ip: string | null, login: string): boolean;
  executar<T>(f: () => Promise<T>): Promise<T | 'OCUPADO'>;
  tamanho(): { porIp: number; porLogin: number };
};

export function criarLimitadorLogin(o: OpcoesLimitador = {}): LimitadorLogin {
  const porIp = o.porIp ?? 10;
  const porLogin = o.porLogin ?? 20;
  const janelaMs = o.janelaMs ?? 5 * 60 * 1000;
  const concorrencia = o.concorrencia ?? 2;
  const esperaMs = o.esperaMs ?? 2000;
  const teto = o.teto ?? 10_000;
  const maxFila = o.maxFila ?? 50;
  const agora = o.agora ?? Date.now;
  const ips = new Map<string, Janela>();
  const logins = new Map<string, Janela>();

  // Conta a tentativa na janela da chave e diz se ela ainda cabe no limite.
  function contar(mapa: Map<string, Janela>, chave: string, limite: number): boolean {
    const t = agora();
    let j = mapa.get(chave);
    if (!j || t - j.inicio > janelaMs) {
      mapa.delete(chave);
      j = { inicio: t, total: 0 };
      mapa.set(chave, j);
      // Teto contra logins aleatórios: o Map guarda a ordem de inserção.
      if (mapa.size > teto) {
        const maisAntiga = mapa.keys().next().value;
        if (maisAntiga !== undefined) mapa.delete(maisAntiga);
      }
    }
    j.total++;
    return j.total <= limite;
  }

  let ativos = 0;
  const fila: (() => void)[] = [];

  async function vaga(): Promise<boolean> {
    if (ativos < concorrencia) {
      ativos++;
      return true;
    }
    // Numa enxurrada, a fila não cresce sem limite: o pior caso de memória e de timers é previsível.
    if (fila.length >= maxFila) return false;
    return new Promise<boolean>((resolver) => {
      const liberar = () => {
        clearTimeout(timer);
        ativos++;
        resolver(true);
      };
      const timer = setTimeout(() => {
        const i = fila.indexOf(liberar);
        if (i >= 0) fila.splice(i, 1);
        resolver(false);
      }, esperaMs);
      fila.push(liberar);
    });
  }

  function soltar(): void {
    ativos--;
    fila.shift()?.();
  }

  return {
    permitir(ip, login) {
      // Sem IP (sem CONFIAR_PROXY), todos cairiam no mesmo balde: vale só o limite por login.
      const okIp = ip === null ? true : contar(ips, ip, porIp);
      const okLogin = contar(logins, login, porLogin);
      return okIp && okLogin;
    },
    async executar(f) {
      if (!(await vaga())) return 'OCUPADO';
      try {
        return await f();
      } finally {
        soltar();
      }
    },
    tamanho: () => ({ porIp: ips.size, porLogin: logins.size }),
  };
}
