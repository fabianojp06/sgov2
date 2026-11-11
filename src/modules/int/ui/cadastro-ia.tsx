'use client';

import { ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { CasoUsoTela, TelaIA } from '../application/ia';

// Cadastro da IA (US-019 parte 2): a configuração geral e um formulário por caso de uso, com o
// consumo do mês e o aviso de teto atingido. Sem a permissão de alterar, só leitura.

const ESFORCOS: Readonly<Record<string, string>> = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };
const numero = new Intl.NumberFormat('pt-BR');

/** "1234.56" → "US$ 1.234,56" (texto canônico do servidor; sem number para o valor em si). */
export function formatarDolar(texto: string): string {
  const [inteiro = '0', fracao = '00'] = texto.split('.');
  return `US$ ${numero.format(BigInt(inteiro))},${fracao.padEnd(2, '0').slice(0, 2)}`;
}

/** O valor no campo de edição: "1234.56" → "1234,56". */
const paraCampo = (texto: string) => texto.replace('.', ',');

export function mensagemTeto(mes: string, escopo: 'global' | string): string {
  return escopo === 'global'
    ? `O teto mensal global de custo foi atingido em ${mes}: todas as funções de IA estão desligadas até o próximo mês. O resto do sistema segue normal.`
    : `O teto mensal do caso de uso "${escopo}" foi atingido em ${mes}: ele fica desligado até o próximo mês.`;
}

function Consumo({ c, mes }: { c: { gastoMesUsd: string; chamadasMes: number; errosMes: number }; mes: string }) {
  return (
    <p>
      Consumo em {mes}: {formatarDolar(c.gastoMesUsd)} em {numero.format(c.chamadasMes)} {c.chamadasMes === 1 ? 'chamada' : 'chamadas'}
      {c.errosMes > 0 ? ` (${numero.format(c.errosMes)} com erro)` : ''}.
    </p>
  );
}

function Caso({ c, tela, podeAlterar, alterar }: { c: CasoUsoTela; tela: TelaIA; podeAlterar: boolean; alterar: AcaoFormulario }) {
  const id = (campo: string) => `${c.codigo.replace('.', '-')}-${campo}`;
  return (
    <section aria-labelledby={id('titulo')}>
      <h3 id={id('titulo')}>
        {c.nome} <small>({c.codigo})</small>
      </h3>
      <p>
        Permissão: {c.funcionalidade} (executar). Instrução na versão {c.versaoInstrucao}.{' '}
        {c.guardarTexto ? 'Guarda o texto das chamadas por 90 dias.' : 'Não guarda o texto das chamadas (só o resumo).'}
      </p>
      <Consumo c={c} mes={tela.mes} />
      {c.tetoAtingido && <p role="note">{mensagemTeto(tela.mes, c.nome)}</p>}
      {podeAlterar ? (
        <Formulario acao={alterar} textoEnviar="Salvar caso de uso" mensagemSucesso={`Caso de uso "${c.nome}" salvo.`}>
          <input type="hidden" name="codigo" value={c.codigo} />
          <input type="hidden" name="versao" value={c.versao} />
          <p>
            <input id={id('ativo')} type="checkbox" name="ativo" value="sim" defaultChecked={c.ativo} />{' '}
            <label htmlFor={id('ativo')}>Ligado</label>
          </p>
          <p>
            <label htmlFor={id('modelo')}>Modelo</label>{' '}
            <select id={id('modelo')} name="modelo" defaultValue={c.modelo} aria-describedby="erro-modelo">
              {(tela.modelos.includes(c.modelo) ? tela.modelos : [c.modelo, ...tela.modelos]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="modelo" />
          </p>
          <p>
            <label htmlFor={id('esforco')}>Esforço</label>{' '}
            <select id={id('esforco')} name="esforco" defaultValue={c.esforco} aria-describedby="erro-esforco">
              {tela.esforcos.map((e) => (
                <option key={e} value={e}>
                  {ESFORCOS[e] ?? e}
                </option>
              ))}
            </select>
            <ErroDoCampo campo="esforco" />
          </p>
          <p>
            <label htmlFor={id('max')}>Tamanho máximo da resposta (tokens)</label>{' '}
            <input id={id('max')} name="maxTokens" inputMode="numeric" defaultValue={c.maxTokens} aria-describedby="erro-maxTokens" />
            <ErroDoCampo campo="maxTokens" />
          </p>
          <p>
            <label htmlFor={id('teto')}>Teto mensal (US$)</label>{' '}
            <input id={id('teto')} name="tetoMensalUsd" inputMode="decimal" defaultValue={paraCampo(c.tetoMensalUsd)} aria-describedby="erro-tetoMensalUsd" />
            <ErroDoCampo campo="tetoMensalUsd" />
          </p>
          <p>Com teto zero, o caso fica desligado mesmo marcado como ligado.</p>
        </Formulario>
      ) : (
        <ul>
          <li>{c.ativo ? 'Ligado' : 'Desligado'}</li>
          <li>Modelo: {c.modelo}</li>
          <li>Esforço: {ESFORCOS[c.esforco] ?? c.esforco}</li>
          <li>Tamanho máximo da resposta: {numero.format(c.maxTokens)} tokens</li>
          <li>Teto mensal: {formatarDolar(c.tetoMensalUsd)}</li>
        </ul>
      )}
    </section>
  );
}

export function CadastroIA({
  tela,
  podeAlterar,
  alterarConfiguracao,
  alterarCaso,
}: {
  tela: TelaIA;
  podeAlterar: boolean;
  alterarConfiguracao: AcaoFormulario;
  alterarCaso: AcaoFormulario;
}) {
  const g = tela.configuracao;
  return (
    <div>
      <h1>Inteligência artificial</h1>
      {g.tetoAtingido && <p role="alert">{mensagemTeto(tela.mes, 'global')}</p>}
      {!g.habilitada && <p role="note">A IA está desligada pela chave geral: nenhuma função de IA responde.</p>}
      <section aria-labelledby="ia-geral">
        <h2 id="ia-geral">Configuração geral</h2>
        <Consumo c={g} mes={tela.mes} />
        {podeAlterar ? (
          <Formulario acao={alterarConfiguracao} textoEnviar="Salvar configuração" mensagemSucesso="Configuração da IA salva.">
            <input type="hidden" name="versao" value={g.versao} />
            <p>
              <input id="ia-habilitada" type="checkbox" name="habilitada" value="sim" defaultChecked={g.habilitada} />{' '}
              <label htmlFor="ia-habilitada">IA ligada (chave geral)</label>
            </p>
            <p>
              <label htmlFor="ia-limite">Pedidos por minuto de cada pessoa</label>{' '}
              <input id="ia-limite" name="limitePorMinuto" inputMode="numeric" defaultValue={g.limitePorMinuto} aria-describedby="erro-limitePorMinuto" />
              <ErroDoCampo campo="limitePorMinuto" />
            </p>
            <p>
              <label htmlFor="ia-teto">Teto mensal global (US$)</label>{' '}
              <input id="ia-teto" name="tetoMensalUsd" inputMode="decimal" defaultValue={paraCampo(g.tetoMensalUsd)} aria-describedby="erro-tetoMensalUsd" />
              <ErroDoCampo campo="tetoMensalUsd" />
            </p>
            <p>Com teto zero, toda a IA fica desligada. O custo é estimado pelo preço de lista da API.</p>
          </Formulario>
        ) : (
          <ul>
            <li>{g.habilitada ? 'IA ligada (chave geral)' : 'IA desligada (chave geral)'}</li>
            <li>Pedidos por minuto de cada pessoa: {numero.format(g.limitePorMinuto)}</li>
            <li>Teto mensal global: {formatarDolar(g.tetoMensalUsd)}</li>
          </ul>
        )}
      </section>
      <section aria-labelledby="ia-casos">
        <h2 id="ia-casos">Casos de uso</h2>
        {tela.casos.length === 0 ? (
          <p>Nenhum caso de uso instalado. Cada função com IA instala o seu caso desligado, para ser ligado aqui.</p>
        ) : (
          tela.casos.map((c) => <Caso key={c.codigo} c={c} tela={tela} podeAlterar={podeAlterar} alterar={alterarCaso} />)
        )}
      </section>
    </div>
  );
}
