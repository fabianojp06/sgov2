import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import { MENSAGENS_MODULOS, podeDesativarModulo } from '../domain/modulos';

// Módulos e Funcionalidades (US-035; EP085 UC02.05 e UC02.06). A lista mostra os módulos; ao abrir
// um, o detalhamento traz o botão Ativar ou Desativar conforme o status e, num módulo ativo, as
// funcionalidades dele (RN0047), cada uma com o botão do status (RN0075). O módulo de Administração
// e as funcionalidades dele não têm Desativar (D-P9-7; o servidor também recusa).
type Funcionalidade = { codigo: string; nome: string; grupo: string; ativo: boolean };
type Modulo = { codigo: string; nome: string; ativo: boolean; funcionalidades: readonly Funcionalidade[] };

// A URL leva só o código do aviso: texto livre na query seria um vetor de conteúdo forjado.
// [PROVISÓRIO] o UC02.05 e o UC02.06 pedem a mensagem de confirmação, sem dar o texto.
const AVISOS: Readonly<Record<string, string>> = {
  'modulo-ativado': 'Módulo ativado com sucesso.',
  'modulo-desativado': 'Módulo desativado com sucesso.',
  'funcionalidade-ativada': 'Funcionalidade ativada com sucesso.',
  'funcionalidade-desativada': 'Funcionalidade desativada com sucesso.',
};

const situacao = (ativo: boolean) => (ativo ? 'Ativo' : 'Inativo');
const situacaoFuncionalidade = (ativo: boolean) => (ativo ? 'Ativa' : 'Inativa');

export type PropsTelaModulos = {
  modulos: readonly Modulo[];
  selecionado?: string | undefined;
  podeAlterar: boolean;
  aviso?: string | undefined;
  alternarModulo: AcaoFormulario;
  alternarFuncionalidade: AcaoFormulario;
};

function BotaoModulo({ modulo, acao }: { modulo: Modulo; acao: AcaoFormulario }) {
  if (modulo.ativo && !podeDesativarModulo(modulo.codigo)) return null;
  return modulo.ativo ? (
    <AcaoConfirmada rotulo="Desativar" pergunta={MENSAGENS_MODULOS.CONFIRMAR_DESATIVAR_MODULO} acao={acao} campos={{ codigo: modulo.codigo, ativo: 'false' }} />
  ) : (
    <AcaoConfirmada rotulo="Ativar" pergunta={MENSAGENS_MODULOS.CONFIRMAR_ATIVAR_MODULO} acao={acao} campos={{ codigo: modulo.codigo, ativo: 'true' }} />
  );
}

function BotaoFuncionalidade({ modulo, funcionalidade: f, acao }: { modulo: Modulo; funcionalidade: Funcionalidade; acao: AcaoFormulario }) {
  if (f.ativo && !podeDesativarModulo(modulo.codigo)) return null;
  const campos = { codigo: f.codigo, modulo: modulo.codigo };
  return f.ativo ? (
    <AcaoConfirmada rotulo="Desativar" pergunta={MENSAGENS_MODULOS.CONFIRMAR_DESATIVAR_FUNCIONALIDADE} acao={acao} campos={{ ...campos, ativo: 'false' }} />
  ) : (
    <AcaoConfirmada rotulo="Ativar" pergunta={MENSAGENS_MODULOS.CONFIRMAR_ATIVAR_FUNCIONALIDADE} acao={acao} campos={{ ...campos, ativo: 'true' }} />
  );
}

function Detalhe({ modulo, podeAlterar, alternarModulo, alternarFuncionalidade }: { modulo: Modulo } & Omit<PropsTelaModulos, 'modulos' | 'selecionado' | 'aviso'>) {
  return (
    <section aria-labelledby="modulo-detalhe">
      <h2 id="modulo-detalhe">{`Módulo ${modulo.nome}`}</h2>
      <p>{`Situação: ${situacao(modulo.ativo)}`}</p>
      {podeAlterar && <BotaoModulo modulo={modulo} acao={alternarModulo} />}
      <h3>Funcionalidades</h3>
      {modulo.ativo ? (
        <table aria-label={`Funcionalidades do módulo ${modulo.nome}`}>
          <thead>
            <tr>
              <th scope="col">Funcionalidade</th>
              <th scope="col">Grupo</th>
              <th scope="col">Situação</th>
              {podeAlterar && <th scope="col">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {modulo.funcionalidades.map((f) => (
              <tr key={f.codigo}>
                <td>{f.nome}</td>
                <td>{f.grupo}</td>
                <td>{situacaoFuncionalidade(f.ativo)}</td>
                {podeAlterar && (
                  <td>
                    <BotaoFuncionalidade modulo={modulo} funcionalidade={f} acao={alternarFuncionalidade} />
                  </td>
                )}
              </tr>
            ))}
            {/* Texto vazio [PROVISÓRIO]. */}
            {modulo.funcionalidades.length === 0 && (
              <tr>
                <td colSpan={podeAlterar ? 4 : 3}>Nenhuma funcionalidade instalada neste módulo.</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        // [PROVISÓRIO] pré-condição do UC02.06: módulo ativo.
        <p>Ative o módulo para gerenciar as funcionalidades dele.</p>
      )}
    </section>
  );
}

export function TelaModulos({ modulos, selecionado, podeAlterar, aviso, alternarModulo, alternarFuncionalidade }: PropsTelaModulos) {
  const textoAviso = aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const aberto = modulos.find((m) => m.codigo === selecionado);
  return (
    <div>
      <h1>Módulos e Funcionalidades</h1>
      {textoAviso && <p role="status">{textoAviso}</p>}
      <table aria-label="Módulos">
        <thead>
          <tr>
            <th scope="col">Módulo</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {modulos.map((m) => (
            <tr key={m.codigo} aria-current={m.codigo === aberto?.codigo ? 'true' : undefined}>
              <td>
                <a href={`/adm/modulos?modulo=${encodeURIComponent(m.codigo)}`}>{m.nome}</a>
              </td>
              <td>{situacao(m.ativo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {aberto && <Detalhe modulo={aberto} podeAlterar={podeAlterar} alternarModulo={alternarModulo} alternarFuncionalidade={alternarFuncionalidade} />}
    </div>
  );
}
