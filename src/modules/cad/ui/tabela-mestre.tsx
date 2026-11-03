'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { GradeArvore, type NoGrade } from '@/modules/ger';
import type { ErroCampo } from '@/shared/kernel';

// Tela da Tabela Mestre de Benefícios (US-050). Lista os itens do exercício na grade do sistema; com
// a permissão de alterar, edita um item por vez, e com a de incluir, inclui um novo. Valores como
// texto (ponto ou vírgula decimal). O código e a forma só se escolhem na inclusão.
export type ItemTela = {
  codigo: string;
  nome: string;
  forma: 'VALOR_MENSAL' | 'VALOR_DIARIO' | 'PERCENTUAL_SALARIO';
  valor: string | null;
  percentual: string | null;
  conta: string;
  padraoPosicao: boolean;
  ativo: boolean;
  provisorio: boolean;
  versao: number;
};
type Resposta = { ok: true } | { ok: false; erros: readonly ErroCampo[] };
type DadosItem = Omit<ItemTela, 'provisorio' | 'versao'> & { ano: number };

/** Item novo da inclusão: código a preencher, valor mensal, ativo e fora da posição sem cargo. */
export const ITEM_NOVO: ItemTela = {
  codigo: 'beneficio.',
  nome: '',
  forma: 'VALOR_MENSAL',
  valor: null,
  percentual: null,
  conta: '',
  padraoPosicao: false,
  ativo: true,
  provisorio: false,
  versao: 0,
};
type Colunas = 'codigo' | 'nome' | 'forma' | 'valor' | 'percentual' | 'conta' | 'situacao';

const ROTULO_FORMA: Record<ItemTela['forma'], string> = {
  VALOR_MENSAL: 'Valor mensal',
  VALOR_DIARIO: 'Valor por dia útil',
  PERCENTUAL_SALARIO: '% do salário',
};

/** O pedido do Salvar: a inclusão vai sem a versão (campo blindado no incluir); a alteração, com ela. */
export function montarEnvio(item: ItemTela, novo: boolean, ano: number): { tipo: 'incluir'; dados: DadosItem } | { tipo: 'alterar'; dados: DadosItem & { versao: number } } {
  const { provisorio: _p, versao, ...dados } = item;
  void _p;
  return novo ? { tipo: 'incluir', dados: { ...dados, ano } } : { tipo: 'alterar', dados: { ...dados, versao, ano } };
}

/** Trocar a forma zera valor e percentual: o que valia para uma forma não vale para a outra. */
export const trocarForma = (item: ItemTela, forma: ItemTela['forma']): ItemTela => ({ ...item, forma, valor: null, percentual: null });

/** Campos com controle no formulário; os erros dos outros vão para o alerta geral, para nenhum sumir. */
const CAMPOS_COM_CONTROLE = ['codigo', 'forma', 'nome', 'valor', 'percentual', 'conta'];
export const errosGerais = (erros: readonly ErroCampo[]) => erros.filter((e) => !CAMPOS_COM_CONTROLE.includes(e.campo)).map((e) => e.mensagem);

export function TabelaMestre({
  ano,
  itens,
  podeAlterar,
  alterar,
  podeIncluir = false,
  incluir,
}: {
  ano: number;
  itens: readonly ItemTela[];
  podeAlterar: boolean;
  alterar: (d: Omit<ItemTela, 'provisorio'> & { ano: number }) => Promise<Resposta>;
  podeIncluir?: boolean;
  incluir?: (d: DadosItem) => Promise<Resposta>;
}) {
  const [editando, setEditando] = useState<ItemTela | null>(null);
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [salvando, iniciar] = useTransition();
  const [escolhido, setEscolhido] = useState('');
  const titulo = useRef<HTMLHeadingElement>(null);
  // O foco vai para o formulário quando ele abre (teclado e leitor de tela). Pelo contador de
  // aberturas, e não pelo código: na inclusão o código é digitado, e o foco não pode pular a cada tecla.
  const [aberturas, setAberturas] = useState(0);
  useEffect(() => {
    if (aberturas > 0) titulo.current?.focus();
  }, [aberturas]);
  const abrir = (codigo: string) => {
    setErros([]);
    setAviso('');
    setNovo(false);
    setEditando(itens.find((i) => i.codigo === codigo) ?? null);
    setAberturas((n) => n + 1);
  };
  const abrirInclusao = () => {
    setErros([]);
    setAviso('');
    setNovo(true);
    setEditando(ITEM_NOVO);
    setAberturas((n) => n + 1);
  };
  // Ao fechar, o foco volta ao botão que abriu o formulário (quem usa teclado não perde o lugar).
  const quemAbriu = useRef<HTMLButtonElement | null>(null);
  const fechar = () => {
    setEditando(null);
    setNovo(false);
    setErros([]);
    quemAbriu.current?.focus();
  };

  const nos: NoGrade<Colunas>[] = itens.map((i) => ({
    id: i.codigo,
    linha: {
      codigo: i.codigo,
      nome: i.nome,
      forma: ROTULO_FORMA[i.forma],
      valor: i.valor,
      percentual: i.percentual,
      conta: i.conta,
      situacao: `${i.ativo ? 'Ativo' : 'Inativo'}${i.padraoPosicao ? ' · padrão da posição' : ''}${i.provisorio ? ' · Provisório' : ''}`,
    },
  }));

  const salvar = () => {
    if (!editando) return;
    const envio = montarEnvio(editando, novo && incluir !== undefined, ano);
    iniciar(async () => {
      try {
        const r = envio.tipo === 'incluir' && incluir ? await incluir(envio.dados) : await alterar(envio.dados as DadosItem & { versao: number });
        if (r.ok) {
          setAviso(envio.tipo === 'incluir' ? `Benefício ${envio.dados.codigo} incluído.` : `Benefício ${envio.dados.codigo} alterado.`);
          fechar();
        } else setErros(r.erros);
      } catch {
        setErros([{ campo: '_', mensagem: 'Não foi possível salvar. Confira a conexão e tente de novo.' }]);
      }
    });
  };
  const erroDe = (campo: string) => erros.filter((e) => e.campo === campo).map((e) => e.mensagem).join(' ');

  return (
    <section>
      <p role="status">{aviso}</p>
      {podeIncluir && incluir && (
        <button
          type="button"
          onClick={(e) => {
            quemAbriu.current = e.currentTarget;
            abrirInclusao();
          }}
        >
          Incluir benefício
        </button>
      )}
      <GradeArvore<Colunas>
        idGrade={`cad.beneficios.${ano}`}
        rotulo={`Tabela Mestre de Benefícios ${ano}`}
        nos={nos}
        colunas={[
          { campo: 'codigo', titulo: 'Código', tipo: 'texto' },
          { campo: 'nome', titulo: 'Nome', tipo: 'texto' },
          { campo: 'forma', titulo: 'Forma', tipo: 'texto' },
          { campo: 'valor', titulo: 'Valor por pessoa', tipo: 'dinheiro' },
          { campo: 'percentual', titulo: '% do salário', tipo: 'percentual' },
          { campo: 'conta', titulo: 'Conta', tipo: 'texto' },
          { campo: 'situacao', titulo: 'Situação', tipo: 'texto' },
        ]}
        {...(podeAlterar ? { acaoSelecionar: async (id: string) => abrir(id) } : {})}
        textoVazio="Nenhum benefício cadastrado neste exercício."
      />
      {podeAlterar && itens.length > 0 && (
        // Caminho pelo teclado para abrir a edição (a seleção pela linha da grade é só pelo mouse).
        // A abertura é pelo botão: em alguns navegadores, cada seta no <select> dispara change.
        <div>
          <label>
            Alterar o benefício{' '}
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
              <option value="">Escolha um item</option>
              {itens.map((i) => (
                <option key={i.codigo} value={i.codigo}>
                  {i.nome}
                </option>
              ))}
            </select>
          </label>{' '}
          <button
            type="button"
            disabled={!escolhido}
            onClick={(e) => {
              quemAbriu.current = e.currentTarget;
              abrir(escolhido);
            }}
          >
            Abrir
          </button>
        </div>
      )}
      {editando && (novo ? podeIncluir : podeAlterar) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
          aria-label={novo ? 'Incluir benefício' : `Alterar ${editando.nome}`}
        >
          <h2 ref={titulo} tabIndex={-1}>
            {novo ? 'Incluir benefício' : `Alterar ${editando.nome} (${editando.codigo})`}
          </h2>
          {errosGerais(erros).length > 0 && <p role="alert">{errosGerais(erros).join(' ')}</p>}
          {novo && (
            <>
              <Campo id="codigo" rotulo="Código" erro={erroDe('codigo')} valor={editando.codigo} mudar={(v) => setEditando({ ...editando, codigo: v })} />
              <div>
                <label htmlFor="beneficio-forma">Forma</label>{' '}
                <select
                  id="beneficio-forma"
                  value={editando.forma}
                  onChange={(e) => setEditando(trocarForma(editando, e.target.value as ItemTela['forma']))}
                  {...(erroDe('forma') ? { 'aria-invalid': true, 'aria-describedby': 'beneficio-forma-erro' } : {})}
                >
                  {(Object.keys(ROTULO_FORMA) as ItemTela['forma'][]).map((f) => (
                    <option key={f} value={f}>
                      {ROTULO_FORMA[f]}
                    </option>
                  ))}
                </select>
                {erroDe('forma') && (
                  <span id="beneficio-forma-erro" role="alert">
                    {erroDe('forma')}
                  </span>
                )}
              </div>
            </>
          )}
          <Campo id="nome" rotulo="Nome" erro={erroDe('nome')} valor={editando.nome} mudar={(v) => setEditando({ ...editando, nome: v })} />
          {editando.forma === 'PERCENTUAL_SALARIO' ? (
            <Campo id="percentual" rotulo="% do salário" erro={erroDe('percentual')} valor={editando.percentual ?? ''} decimal mudar={(v) => setEditando({ ...editando, percentual: v })} />
          ) : (
            <Campo
              id="valor"
              rotulo={editando.forma === 'VALOR_DIARIO' ? 'Valor por dia útil' : 'Valor mensal'}
              erro={erroDe('valor')}
              valor={editando.valor ?? ''}
              decimal
              mudar={(v) => setEditando({ ...editando, valor: v })}
            />
          )}
          <Campo id="conta" rotulo="Conta" erro={erroDe('conta')} valor={editando.conta} mudar={(v) => setEditando({ ...editando, conta: v })} />
          <label>
            <input type="checkbox" checked={editando.padraoPosicao} onChange={(e) => setEditando({ ...editando, padraoPosicao: e.target.checked })} /> Padrão da posição
          </label>
          <label>
            <input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo
          </label>
          <button type="submit" disabled={salvando}>
            Salvar
          </button>
          <button type="button" onClick={fechar}>
            Cancelar
          </button>
        </form>
      )}
    </section>
  );
}

// Campo com rótulo, erro ligado por aria-describedby e role="alert" (padrão do form-troca-senha).
function Campo({ id, rotulo, erro, valor, mudar, decimal }: { id: string; rotulo: string; erro: string; valor: string; mudar: (v: string) => void; decimal?: boolean }) {
  const idCampo = `beneficio-${id}`;
  return (
    <div>
      <label htmlFor={idCampo}>{rotulo}</label>{' '}
      <input
        id={idCampo}
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        {...(decimal ? { inputMode: 'decimal' as const } : {})}
        {...(erro ? { 'aria-invalid': true, 'aria-describedby': `${idCampo}-erro` } : {})}
      />
      {erro && (
        <span id={`${idCampo}-erro`} role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
