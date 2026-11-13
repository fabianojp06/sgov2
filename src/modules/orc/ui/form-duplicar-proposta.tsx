import { Formulario, type AcaoFormulario } from '@/modules/ger';
import type { CcLivreTp, DadosDuplicar } from '../application/propostas';
import { CamposCapa } from './form-proposta';

// Formulário "Duplicar proposta" (US-066, UC03.08; plano do P18, Task 2, D-P18-3). Abre pelo link
// "Duplicar" da lista (?duplicar=<id>) no lugar do "Nova proposta". Tipo, objeto (com "Cópia de "), parceiro,
// datas e categoria vêm da origem, editáveis; o Número do TP e o CC começam em branco, o CC só com os livres
// (C37, D-P17-2: cada TP tem número e CC próprios). A origem e a versão da capa dela vão escondidas: o caso de
// uso recusa com ALTERADO_POR_OUTRO se a origem mudou depois de aberto o formulário (D-P18-8).
export function FormDuplicarProposta({ origem, ccs, duplicar }: { origem: DadosDuplicar; ccs: readonly CcLivreTp[]; duplicar: AcaoFormulario }) {
  return (
    <section aria-labelledby="duplicar-proposta-titulo">
      <h2 id="duplicar-proposta-titulo">{`Duplicar a proposta do TP ${origem.numeroOrigem}`}</h2>
      <p>A cópia é uma proposta nova, em Rascunho e na Versão 1, com número e centro de custo próprios.</p>
      <Formulario acao={duplicar} textoEnviar="Duplicar proposta">
        <input type="hidden" name="origemId" value={origem.origemId} />
        <input type="hidden" name="versaoOrigem" value={String(origem.versaoOrigem)} />
        <CamposCapa prefixo="duplicar-proposta" ccs={ccs} valores={origem} />
      </Formulario>
      <p>
        <a href="/orc/propostas">Cancelar</a>
      </p>
    </section>
  );
}
