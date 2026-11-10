'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErroDoCampo, Formulario } from '@/modules/ger';
import type { AcaoFormulario } from '@/modules/ger';
import { Dinheiro, type ErroCampo } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';

// Formulário da posição de pessoal (US-056; plano do P12, Task 2), com a prévia do custo calculada no
// servidor (D-P12-6): a Server Action só de leitura roda o motor do cad com as premissas do exercício,
// 400 ms depois da última mudança. Assim as premissas (encargos, benefícios) não vêm para o cliente.
// Componente cliente: ações, opções e limite da quantidade chegam por props da página.
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const;
const ESPERA_PREVIA_MS = 400;

export type OpcaoPosicao = { classificacao: string; descricao: string };
export type PosicaoEmEdicao = {
  id: string;
  cc: string;
  cargo: string;
  quantidade: string;
  salarioMensal: string;
  mesInicio: string;
  mesSaida: string;
  observacao: string;
  versao: number;
};
// Valores da prévia como texto canônico ("1234.56"): Dinheiro não atravessa a Server Action.
export type PreviaTexto = { massa: string; feriasDecimo: string; encargos: string; beneficios: string; anual: string; aviso: string | null };
export type AcaoPrevia = (entrada: Record<string, string>) => Promise<{ ok: true; valor: PreviaTexto } | { ok: false; erros: readonly ErroCampo[] }>;

type Campos = { cc: string; quantidade: string; salarioMensal: string; mesInicio: string; mesSaida: string };
type EstadoPrevia = { tipo: 'MOTIVO'; texto: string } | { tipo: 'CALCULANDO' } | { tipo: 'PRONTA'; previa: PreviaTexto };

const camposIniciais = (ccAtual: string, p?: PosicaoEmEdicao): Campos => ({
  cc: p?.cc ?? ccAtual,
  quantidade: p?.quantidade ?? '',
  salarioMensal: p?.salarioMensal ?? '',
  mesInicio: p?.mesInicio ?? '1',
  mesSaida: p?.mesSaida ?? '12',
});
const completos = (c: Campos) => [c.quantidade, c.salarioMensal, c.mesInicio, c.mesSaida].every((v) => v.trim() !== '');
const reais = (v: string) => `R$ ${valorParaTela(Dinheiro.de(v))}`;

export function FormPosicao({
  ano,
  exercicioId,
  ccAtual,
  ccs,
  quantidadeMaxima,
  posicao,
  avisoOrigem,
  salvar,
  previa,
  cancelarPara,
}: {
  ano: number;
  exercicioId: string;
  ccAtual: string;
  ccs: readonly OpcaoPosicao[];
  quantidadeMaxima: number;
  posicao?: PosicaoEmEdicao;
  avisoOrigem?: string | undefined;
  salvar: AcaoFormulario;
  previa: AcaoPrevia;
  cancelarPara: string;
}) {
  const [campos, setCampos] = useState<Campos>(() => camposIniciais(ccAtual, posicao));
  const [estado, setEstado] = useState<EstadoPrevia>({ tipo: 'MOTIVO', texto: MENSAGENS_ORC.PREVIA_POSICAO_INCOMPLETA });
  // Só a resposta do último pedido vale: uma resposta atrasada de um pedido anterior é descartada.
  const ultimo = useRef(0);
  const aoMudar = (e: FormEvent<HTMLDivElement>) => {
    const form = e.currentTarget.closest('form');
    if (!form) return;
    const d = new FormData(form);
    const t = (k: string) => (typeof d.get(k) === 'string' ? (d.get(k) as string) : '');
    setCampos({ cc: t('cc'), quantidade: t('quantidade'), salarioMensal: t('salarioMensal'), mesInicio: t('mesInicio'), mesSaida: t('mesSaida') });
  };
  useEffect(() => {
    const pedido = ++ultimo.current;
    if (!completos(campos)) {
      setEstado({ tipo: 'MOTIVO', texto: MENSAGENS_ORC.PREVIA_POSICAO_INCOMPLETA });
      return;
    }
    const espera = setTimeout(() => {
      setEstado({ tipo: 'CALCULANDO' });
      previa({ exercicioId, ...campos })
        .then((r) => {
          if (pedido !== ultimo.current) return;
          setEstado(r.ok ? { tipo: 'PRONTA', previa: r.valor } : { tipo: 'MOTIVO', texto: r.erros.map((x) => x.mensagem).join(' ') });
        })
        .catch(() => {
          // [PROVISÓRIO] Falha de rede: a gravação continua possível; só a prévia falta.
          if (pedido === ultimo.current) setEstado({ tipo: 'MOTIVO', texto: 'Não foi possível calcular a prévia agora.' });
        });
    }, ESPERA_PREVIA_MS);
    return () => clearTimeout(espera);
  }, [campos, exercicioId, previa]);
  const prefixo = posicao ? 'alterar-posicao' : 'nova-posicao';
  return (
    <section aria-labelledby={`${prefixo}-titulo`}>
      <h2 id={`${prefixo}-titulo`}>{posicao ? 'Alterar posição' : 'Nova posição'}</h2>
      {avisoOrigem && <p role="note">{avisoOrigem}</p>}
      {posicao && !ccs.some((c) => c.classificacao === posicao.cc) && <p role="note">{MENSAGENS_ORC.CC_POSICAO_FORA_DAS_OPCOES(posicao.cc)}</p>}
      <Formulario acao={salvar} textoEnviar={posicao ? 'Salvar alteração' : 'Incluir posição'}>
        {posicao ? (
          <>
            <input type="hidden" name="id" value={posicao.id} />
            <input type="hidden" name="versao" value={posicao.versao} />
          </>
        ) : (
          <input type="hidden" name="exercicioId" value={exercicioId} />
        )}
        <div onChange={aoMudar}>
          <p>
            <label htmlFor={`${prefixo}-cc`}>Centro de custo</label>
            <select id={`${prefixo}-cc`} name="cc" defaultValue={posicao?.cc ?? ccAtual} aria-describedby="erro-cc">
              {ccs.map((c) => (
                <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
              ))}
            </select>
            <ErroDoCampo campo="cc" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-cargo`}>Cargo</label>
            <input id={`${prefixo}-cargo`} name="cargo" maxLength={120} defaultValue={posicao?.cargo ?? ''} aria-describedby="erro-cargo" />
            <ErroDoCampo campo="cargo" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-quantidade`}>{`Quantidade (1 a ${new Intl.NumberFormat('pt-BR').format(quantidadeMaxima)})`}</label>
            <input id={`${prefixo}-quantidade`} name="quantidade" inputMode="numeric" defaultValue={posicao?.quantidade ?? ''} aria-describedby="erro-quantidade" />
            <ErroDoCampo campo="quantidade" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-salario`}>Salário mensal (R$)</label>
            <input id={`${prefixo}-salario`} name="salarioMensal" inputMode="decimal" placeholder="0,00" defaultValue={posicao?.salarioMensal ?? ''} aria-describedby="erro-salarioMensal" />
            <ErroDoCampo campo="salarioMensal" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-inicio`}>Mês de início</label>
            <select id={`${prefixo}-inicio`} name="mesInicio" defaultValue={campos.mesInicio} aria-describedby="erro-mesInicio">
              {MESES.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="mesInicio" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-saida`}>Mês de saída</label>
            <select id={`${prefixo}-saida`} name="mesSaida" defaultValue={campos.mesSaida} aria-describedby="erro-mesSaida">
              {MESES.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="mesSaida" />
          </p>
          <p>
            <label htmlFor={`${prefixo}-observacao`}>Observação (opcional)</label>
            <textarea id={`${prefixo}-observacao`} name="observacao" maxLength={500} defaultValue={posicao?.observacao ?? ''} aria-describedby="erro-observacao" />
            <ErroDoCampo campo="observacao" />
          </p>
        </div>
        <section aria-labelledby={`${prefixo}-previa`}>
          <h3 id={`${prefixo}-previa`}>{`Prévia do custo (${ano})`}</h3>
          {/* Só o resumo é anunciado ao digitar; o detalhe por componente não (seria verborrágico). */}
          <p aria-live="polite">
            {estado.tipo === 'MOTIVO' ? estado.texto : estado.tipo === 'CALCULANDO' ? 'Calculando a prévia…' : `Custo anual: ${reais(estado.previa.anual)}.`}
          </p>
          {estado.tipo === 'PRONTA' && (
            <>
              {estado.previa.aviso && <p role="note">{estado.previa.aviso}</p>}
              <dl>
                <dt>Massa salarial</dt>
                <dd>{reais(estado.previa.massa)}</dd>
                <dt>Férias + 1/3 e 13º</dt>
                <dd>{reais(estado.previa.feriasDecimo)}</dd>
                <dt>Encargos</dt>
                <dd>{reais(estado.previa.encargos)}</dd>
                <dt>Benefícios</dt>
                <dd>{reais(estado.previa.beneficios)}</dd>
                <dt>Custo anual</dt>
                <dd>{reais(estado.previa.anual)}</dd>
              </dl>
              <p>O valor gravado é recalculado pelo sistema ao salvar.</p>
            </>
          )}
        </section>
        <a href={cancelarPara}>Cancelar</a>
      </Formulario>
    </section>
  );
}
