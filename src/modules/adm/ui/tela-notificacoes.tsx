'use client';

import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import { CONTA_TODAS, MENSAGENS_NOTIFICACAO, ROTULO_TODAS } from '../domain/notificacao-textos';

// Notificações de Desempenho (US-041; EP085 UC02.20, grupo "Desempenho", REQ0091 e REQ0098). O
// formulário (Conta Sintética com "Todas", Limite, Frequência e Usuário) adiciona o destinatário, e
// cada linha da grade tem o Excluir com confirmação Sim/Não (RN0076, A4, A5). Adicionar e Excluir
// gravam na hora (D-P10-9 [PO valida]). Componente cliente: dados e ações chegam por props.
export type LinhaTelaNotificacao = {
  id: string;
  contaRotulo: string;
  contaAviso: string | null;
  limite: string;
  frequenciaDias: number;
  usuario: { nome: string; ativo: boolean };
  versao: number;
};

export type PropsTelaNotificacoes = {
  linhas: readonly LinhaTelaNotificacao[];
  contas: readonly { classificacao: string; rotulo: string }[];
  usuarios: readonly { id: string; nome: string }[];
  podeIncluir: boolean;
  podeExcluir: boolean;
  aviso?: string | undefined;
  adicionar: AcaoFormulario;
  excluir: AcaoFormulario;
};

// A URL leva só o código do aviso. [PROVISÓRIOS]: o UC02.20 pede a confirmação sem dar o texto.
const AVISOS: Readonly<Record<string, string>> = {
  incluida: 'Destinatário da notificação adicionado com sucesso.',
  excluida: 'Destinatário da notificação excluído com sucesso.',
};

const descrito = (campo: string) => ({ 'aria-describedby': `erro-${campo}` });
const pessoa = (u: { nome: string; ativo: boolean }) => (u.ativo ? u.nome : `${u.nome} (inativo)`);

function Selecao({ campo, rotulo, opcoes }: { campo: string; rotulo: string; opcoes: readonly { valor: string; texto: string }[] }) {
  return (
    <p>
      <label htmlFor={`notificacao-${campo}`}>{rotulo}</label>
      <select id={`notificacao-${campo}`} name={campo} defaultValue="" required {...descrito(campo)}>
        <option value="" disabled>
          Selecione
        </option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      <ErroDoCampo campo={campo} />
    </p>
  );
}

function FormNotificacao({ contas, usuarios, adicionar }: Pick<PropsTelaNotificacoes, 'contas' | 'usuarios' | 'adicionar'>) {
  return (
    <Formulario acao={adicionar} textoEnviar="Adicionar">
      <Selecao
        campo="conta"
        rotulo="Conta Sintética"
        opcoes={[{ valor: CONTA_TODAS, texto: ROTULO_TODAS }, ...contas.map((c) => ({ valor: c.classificacao, texto: c.rotulo }))]}
      />
      <p>
        <label htmlFor="notificacao-limite">Limite de Despesa (% do orçado)</label>
        <input id="notificacao-limite" name="limite" inputMode="decimal" autoComplete="off" required {...descrito('limite')} />
        <ErroDoCampo campo="limite" />
      </p>
      <p>
        <label htmlFor="notificacao-frequenciaDias">Frequência de Envio (dias)</label>
        <input id="notificacao-frequenciaDias" name="frequenciaDias" inputMode="numeric" autoComplete="off" required {...descrito('frequenciaDias')} />
        <ErroDoCampo campo="frequenciaDias" />
      </p>
      <Selecao campo="usuarioId" rotulo="Usuário" opcoes={usuarios.map((u) => ({ valor: u.id, texto: u.nome }))} />
    </Formulario>
  );
}

export function TelaNotificacoes({ linhas, contas, usuarios, podeIncluir, podeExcluir, aviso, adicionar, excluir }: PropsTelaNotificacoes) {
  const textoAviso = aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  return (
    <div>
      <h1>Notificações de Desempenho</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      <section aria-labelledby="notificacoes-desempenho">
        <h2 id="notificacoes-desempenho">Desempenho</h2>
        {podeIncluir && <FormNotificacao contas={contas} usuarios={usuarios} adicionar={adicionar} />}
        {linhas.length === 0 ? (
          // Texto vazio [PROVISÓRIO].
          <p>Nenhum destinatário cadastrado.</p>
        ) : (
          <table>
            <caption>Destinatários das notificações de desempenho</caption>
            <thead>
              <tr>
                <th scope="col">Conta Sintética</th>
                <th scope="col">Limite</th>
                <th scope="col">Frequência (dias)</th>
                <th scope="col">Usuário</th>
                {podeExcluir && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.contaRotulo}
                    {l.contaAviso && <strong>{` (${l.contaAviso})`}</strong>}
                  </td>
                  <td>{l.limite}</td>
                  <td>{l.frequenciaDias}</td>
                  <td>{pessoa(l.usuario)}</td>
                  {podeExcluir && (
                    <td>
                      <AcaoConfirmada rotulo="Excluir" contexto={`${l.contaRotulo} de ${pessoa(l.usuario)}`} pergunta={MENSAGENS_NOTIFICACAO.CONFIRMAR_EXCLUSAO} acao={excluir} campos={{ id: l.id, versao: String(l.versao) }} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
