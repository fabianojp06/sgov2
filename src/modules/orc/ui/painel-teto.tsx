import { Dinheiro, type Percentual } from '@/shared/kernel';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';

// Teto, semáforo e resultado do exercício (US-059, §6.6). Só para quem vê a Adm. Central inteira.
// O semáforo vai sempre com texto, nunca só cor. Server Component.
export type DadosPainel = {
  receitaConfirmadaMes: readonly Dinheiro[];
  receitaPrevistaMes: readonly Dinheiro[];
  despesasMes: readonly Dinheiro[];
  resultadoMes: readonly Dinheiro[];
  resultadoAno: Dinheiro;
  tetoPadrao: Dinheiro;
  tetoManual: Dinheiro | null;
  tetoEfetivo: Dinheiro;
  orcado: Dinheiro;
  uso: Percentual | null;
  saldo: Dinheiro;
  semaforo: 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO' | null;
  justificativaTeto: string | null;
};

const SEMAFORO = { VERDE: 'Verde', AMARELO: 'Amarelo', LARANJA: 'Laranja', VERMELHO: 'Vermelho' } as const;
const soma = (xs: readonly Dinheiro[]) => Dinheiro.somarTodos(xs);
const rotuloResultado = (v: Dinheiro) => (v.ehZero() ? '(equilíbrio)' : v.ehNegativo() ? '(déficit)' : '(superávit)');
// Valor com o sinal "−" (menos) quando negativo, e a classe de alerta.
const comSinal = (v: Dinheiro) => (v.ehNegativo() ? `− R$ ${valorParaTela(v).replace('-', '')}` : `R$ ${valorParaTela(v)}`);

export function PainelTeto({ painel }: { painel: DadosPainel }) {
  return (
    <section aria-labelledby="painel-teto">
      <h2 id="painel-teto">Teto e resultado</h2>
      <dl>
        <dt>Receita confirmada (rateio líquido)</dt>
        <dd>{`R$ ${valorParaTela(soma(painel.receitaConfirmadaMes))}`}</dd>
        <dt>Receita prevista (fora do saldo e do teto)</dt>
        <dd>{`R$ ${valorParaTela(soma(painel.receitaPrevistaMes))}`}</dd>
        <dt>Despesas (orçado)</dt>
        <dd>{`R$ ${valorParaTela(painel.orcado)}`}</dd>
        <dt>Resultado do ano</dt>
        <dd className={painel.resultadoAno.ehNegativo() ? 'negativo' : undefined}>
          {`${comSinal(painel.resultadoAno)} ${rotuloResultado(painel.resultadoAno)}`}
        </dd>
        <dt>Teto</dt>
        <dd>
          {painel.tetoManual
            ? `R$ ${valorParaTela(painel.tetoEfetivo)} (manual${painel.justificativaTeto ? `: ${painel.justificativaTeto}` : ''}; padrão: R$ ${valorParaTela(painel.tetoPadrao)})`
            : `R$ ${valorParaTela(painel.tetoEfetivo)} (padrão: rateio líquido confirmado)`}
        </dd>
        <dt>% do teto</dt>
        <dd>{painel.uso ? painel.uso.formatar() : MENSAGENS_ORC.SEM_TETO}</dd>
        <dt>Saldo</dt>
        <dd className={painel.saldo.ehNegativo() ? 'negativo' : undefined}>{`${comSinal(painel.saldo)}${painel.saldo.ehNegativo() ? ' (acima do teto)' : ''}`}</dd>
        <dt>Semáforo</dt>
        {/* Texto, não traço: o leitor de tela lê "Indisponível" [PROVISÓRIO]. */}
        <dd>{painel.semaforo ? SEMAFORO[painel.semaforo] : 'Indisponível'}</dd>
      </dl>
    </section>
  );
}
