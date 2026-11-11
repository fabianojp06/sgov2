'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Formulario, type AcaoFormulario } from '@/modules/ger';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_TIPO_ACHADO, type Achado, type RevisaoTela } from '../domain/revisor-regras';

// Revisor de consistência antes do envio (US-064; plano do P14, Task 3). Componente cliente: recebe a
// revisão e a ação por props; nada aqui chama a IA nem grava dado. Enquanto a revisão está PENDENTE, a
// página se atualiza a cada 5 s. Os achados da IA levam o selo da spec §6.8 (princípio 3). O revisor não
// bloqueia o envio.
export const INTERVALO_ATUALIZACAO_MS = 5_000;

const dataHora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
const rotulo = (tipo: string) => (Object.hasOwn(ROTULO_TIPO_ACHADO, tipo) ? ROTULO_TIPO_ACHADO[tipo as keyof typeof ROTULO_TIPO_ACHADO] : tipo);

function AtualizarEnquantoPendente() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/** Um achado: o tipo, o selo (só nos da IA), o texto e os links para as linhas (puro: testável sem DOM). */
export function ItemAchado({ achado }: { achado: Achado }) {
  return (
    <li>
      <strong>{rotulo(achado.tipo)}</strong>
      {achado.origem === 'IA' && (
        <>
          {' '}
          <span className="selo-ia">{MENSAGENS_ORC.SELO_IA}</span>
        </>
      )}
      {`: ${achado.texto}`}
      {achado.links.length > 0 && (
        <ul>
          {achado.links.map((l, i) => (
            <li key={i}>
              <a href={l.href}>{l.rotulo}</a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** O estado da revisão (puro: testável sem DOM). */
export function ConteudoRevisao({ revisao }: { revisao: RevisaoTela | null }) {
  if (!revisao) return <p>{MENSAGENS_ORC.REVISAO_NENHUMA}</p>;
  if (revisao.situacao === 'PENDENTE') return <p role="status">{MENSAGENS_ORC.REVISAO_EM_ANDAMENTO}</p>;
  return (
    <>
      {revisao.situacao === 'CONCLUIDA' && revisao.concluidaEm && <p>{`Revisão concluída em ${dataHora(revisao.concluidaEm)}.`}</p>}
      {revisao.desatualizada && revisao.situacao === 'CONCLUIDA' && <p role="note">{MENSAGENS_ORC.REVISAO_DESATUALIZADA}</p>}
      {revisao.avisos.length > 0 && (
        <ul aria-label="Avisos da revisão">
          {revisao.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {revisao.situacao === 'CONCLUIDA' &&
        (revisao.achados.length === 0 ? (
          <p>{MENSAGENS_ORC.REVISAO_SEM_ACHADOS}</p>
        ) : (
          <ul aria-label="Achados da revisão">
            {revisao.achados.map((a, i) => (
              <ItemAchado key={i} achado={a} />
            ))}
          </ul>
        ))}
    </>
  );
}

export function PainelRevisao({
  exercicio,
  revisao,
  pedir,
}: {
  exercicio: { id: string; versao: number; situacao: string };
  revisao: RevisaoTela | null;
  pedir: AcaoFormulario;
}) {
  const pendente = revisao?.situacao === 'PENDENTE';
  return (
    <section aria-labelledby="revisao-titulo">
      <h2 id="revisao-titulo">Revisão antes do envio</h2>
      {exercicio.situacao === 'EM_ELABORACAO' && !pendente && (
        <Formulario acao={pedir} textoEnviar="Revisar antes de enviar">
          <input type="hidden" name="id" value={exercicio.id} />
          <input type="hidden" name="versao" value={exercicio.versao} />
        </Formulario>
      )}
      <ConteudoRevisao revisao={revisao} />
      {pendente && <AtualizarEnquantoPendente />}
    </section>
  );
}
