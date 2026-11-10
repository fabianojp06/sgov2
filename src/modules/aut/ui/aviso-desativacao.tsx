'use client';

import { useEffect, useState } from 'react';
import { avisoDesativacao } from '../domain/aviso';

// Aviso da desativação do sistema na casca da área logada (D-P9-4; UC02.01 2.7, UC02.16). Começa com
// os segundos calculados no servidor, conta no navegador e consulta a rota do aviso a cada 30 s, para
// quem não navega ver um aviso novo (ou cancelado). No fim da contagem, recarrega a página: o servidor
// desconecta e leva ao login com "Sistema está em manutenção". A consulta não renova a sessão (o
// proxy marca a rota), e uma resposta que não é JSON (o proxy redirecionou sem cookie) ou um 401
// também recarregam.
export const ROTA_AVISO = '/aut/aviso';
export const INTERVALO_CONSULTA_MS = 30_000;

const recarregar = () => window.location.reload();

export async function consultarAviso(buscar: typeof fetch = fetch): Promise<{ segundos: number | null } | 'recarregar' | 'ignorar'> {
  try {
    const r = await buscar(ROTA_AVISO, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (r.status === 401) return 'recarregar';
    if (!(r.headers.get('content-type') ?? '').includes('application/json')) return r.redirected ? 'recarregar' : 'ignorar';
    if (!r.ok) return 'ignorar';
    const corpo = (await r.json()) as { segundos?: unknown };
    return { segundos: typeof corpo.segundos === 'number' && Number.isFinite(corpo.segundos) ? corpo.segundos : null };
  } catch {
    // Rede fora: tenta de novo na próxima consulta.
    return 'ignorar';
  }
}

export function AvisoDesativacao({ segundos }: { segundos: number | null }) {
  // fim: instante (relógio do navegador) em que a contagem acaba; restante em segundos.
  const [fim, setFim] = useState<number | null>(null);
  const [restante, setRestante] = useState<number | null>(segundos);

  useEffect(() => {
    setFim(segundos === null ? null : Date.now() + segundos * 1000);
  }, [segundos]);

  useEffect(() => {
    const id = window.setInterval(async () => {
      const r = await consultarAviso();
      if (r === 'recarregar') recarregar();
      else if (r !== 'ignorar') setFim(r.segundos === null ? null : Date.now() + r.segundos * 1000);
    }, INTERVALO_CONSULTA_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (fim === null) {
      setRestante(null);
      return;
    }
    const atualizar = () => {
      const s = Math.max(0, Math.ceil((fim - Date.now()) / 1000));
      setRestante(s);
      if (s === 0) recarregar();
    };
    atualizar();
    const id = window.setInterval(atualizar, 1000);
    return () => window.clearInterval(id);
  }, [fim]);

  return <div aria-live="assertive">{restante !== null && <p role="alert">{avisoDesativacao(restante)}</p>}</div>;
}
