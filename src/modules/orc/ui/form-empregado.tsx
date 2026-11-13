import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { BlocoEmpregados, EmpregadoTela, OpcaoCargoEmpregado } from '../application/empregados';
import { A_CONTRATAR, CATEGORIAS_EMPREGADO, DEPENDENTES_MAXIMO, LIMITE_NOME_EMPREGADO, ROTULO_CATEGORIA_EMPREGADO } from '../domain/empregado';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_TIPO_PROPOSTA } from '../domain/proposta';

// Formulário do empregado (US-070, UC03.25 e UC03.26; plano do P20, Task 2). Sem estado próprio: o Formulario
// do ger chama a ação e mostra os erros ao lado de cada campo. Proposta, Tipo e Versão vêm da capa e aparecem só
// leitura, sem name (ORIGEM BLINDADA, REQ0189); no alterar, a Meta e a Ordem também (RN0242, RN0245). O
// salário não aparece (D-P20-5): é herdado do cargo ao salvar (RN_EMP_007). Nome vazio é "A CONTRATAR".
export function FormEmpregado({
  bloco,
  empregado,
  cargos,
  salvar,
}: {
  bloco: BlocoEmpregados;
  empregado?: EmpregadoTela | undefined;
  cargos: readonly OpcaoCargoEmpregado[];
  salvar: AcaoFormulario;
}) {
  const prefixo = empregado ? 'alterar-empregado' : 'novo-empregado';
  const id = (campo: string) => `${prefixo}-${campo}`;
  const titulo = empregado ? `Alterar o empregado ${empregado.ordem} da proposta ${bloco.numero}` : `Novo empregado na proposta ${bloco.numero}`;
  const comMeta = bloco.categoria === 'META';
  const metaAtual = empregado ? bloco.grupos.find((g) => g.metaId === empregado.metaId) : undefined;
  // O cargo gravado que saiu da lista (inativo ou sem Fonte Ativa) continua escolhível: mantê-lo é permitido.
  const opcoes = empregado && !cargos.some((c) => c.id === empregado.cargoId) ? [{ id: empregado.cargoId, rotulo: empregado.cargo }, ...cargos.map(rotulo)] : cargos.map(rotulo);
  return (
    <section aria-labelledby={id('titulo')}>
      <h2 id={id('titulo')}>{titulo}</h2>
      <Formulario acao={salvar} textoEnviar={empregado ? 'Salvar empregado' : 'Incluir empregado'}>
        {empregado ? (
          <>
            <input type="hidden" name="id" value={empregado.id} />
            <input type="hidden" name="versao" value={String(empregado.versao)} />
          </>
        ) : (
          <input type="hidden" name="propostaId" value={bloco.propostaId} />
        )}
        <input type="hidden" name="versaoCapa" value={String(bloco.versaoCapa)} />
        <p>
          <label htmlFor={id('proposta')}>Proposta</label>
          <input id={id('proposta')} value={`${bloco.numero} – ${bloco.objeto}`} readOnly />
        </p>
        <p>
          <label htmlFor={id('tipo')}>Tipo</label>
          <input id={id('tipo')} value={`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero}`} readOnly />
        </p>
        {comMeta && (
          <p>
            <label htmlFor={id('meta')}>Meta</label>
            {empregado ? (
              <input id={id('meta')} value={metaAtual ? `${metaAtual.metaNumero} – ${metaAtual.metaNome}` : ''} readOnly />
            ) : (
              <select id={id('meta')} name="metaId" defaultValue="" aria-required="true" aria-describedby="erro-metaId">
                <option value="" disabled>
                  Escolha a meta
                </option>
                {bloco.metas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {`${m.numero} – ${m.nome}`}
                  </option>
                ))}
              </select>
            )}
            <ErroDoCampo campo="metaId" />
          </p>
        )}
        {empregado && (
          <p>
            <label htmlFor={id('ordem')}>Ordem</label>
            <input id={id('ordem')} value={String(empregado.ordem)} readOnly />
          </p>
        )}
        <p>
          <label htmlFor={id('categoria')}>Categoria</label>
          <select id={id('categoria')} name="categoria" defaultValue={empregado?.categoria ?? 'EMPREGADO'} aria-required="true" aria-describedby="erro-categoria">
            {CATEGORIAS_EMPREGADO.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA_EMPREGADO[c]}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="categoria" />
        </p>
        <p>
          <label htmlFor={id('nome')}>{`Nome (vazio: ${A_CONTRATAR})`}</label>
          <input id={id('nome')} name="nome" maxLength={LIMITE_NOME_EMPREGADO} aria-describedby="erro-nome" defaultValue={empregado?.nome ?? undefined} />
          <ErroDoCampo campo="nome" />
        </p>
        <p>
          <label htmlFor={id('cargo')}>Cargo</label>
          <select id={id('cargo')} name="cargoId" defaultValue={empregado?.cargoId ?? ''} aria-required="true" aria-describedby="erro-cargoId">
            <option value="" disabled>
              {MENSAGENS_ORC.CARGO_ESCOLHA}
            </option>
            {opcoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="cargoId" />
        </p>
        <p>
          <label htmlFor={id('inicio')}>Período inicial (mês e ano)</label>
          <input
            id={id('inicio')}
            name="inicio"
            type="month"
            min={bloco.vigencia.inicio}
            max={bloco.vigencia.fim}
            aria-required="true"
            aria-describedby="erro-inicio"
            defaultValue={empregado?.inicio ?? bloco.vigencia.inicio}
          />
          <ErroDoCampo campo="inicio" />
        </p>
        <p>
          <label htmlFor={id('fim')}>Período final (mês e ano)</label>
          <input
            id={id('fim')}
            name="fim"
            type="month"
            min={bloco.vigencia.inicio}
            max={bloco.vigencia.fim}
            aria-required="true"
            aria-describedby="erro-fim"
            defaultValue={empregado?.fim ?? bloco.vigencia.fim}
          />
          <ErroDoCampo campo="fim" />
        </p>
        <p>
          <label htmlFor={id('dependentes')}>Nº de dependentes</label>
          <input
            id={id('dependentes')}
            name="dependentes"
            type="number"
            min={0}
            max={DEPENDENTES_MAXIMO}
            step={1}
            aria-describedby="erro-dependentes"
            defaultValue={String(empregado?.dependentes ?? 0)}
          />
          <ErroDoCampo campo="dependentes" />
        </p>
      </Formulario>
      <p>
        <a href="/orc/empregados">Cancelar</a>
      </p>
    </section>
  );
}

const rotulo = (c: OpcaoCargoEmpregado) => ({ id: c.id, rotulo: `${c.codigo} – ${c.nome}` });
