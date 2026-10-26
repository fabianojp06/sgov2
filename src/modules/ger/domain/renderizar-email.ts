import { ErroDominio } from '@/shared/kernel';
import type { EmailRenderizado, MensagemEmail, ModeloEmail } from './modelos-email';
import type { LinhaCorpo, VersaoModelo } from './modelos/tipos';
import { usuarioSenhaInicialV1 } from './modelos/usuario-senha-inicial.v1';
import { usuarioSenhaRedefinidaV1 } from './modelos/usuario-senha-redefinida.v1';
import { temCaractereDeControle } from './texto';

// Todas as versões publicadas, inclusive as antigas: uma mensagem na fila renderiza a versão que
// gravou (plano do P4, R8).
export const VERSOES_MODELO: { readonly [M in ModeloEmail]: Readonly<Record<number, VersaoModelo<M>>> } = {
  'usuario.senha_inicial': { 1: usuarioSenhaInicialV1 },
  'usuario.senha_redefinida': { 1: usuarioSenhaRedefinidaV1 },
};

const SISTEMA = 'SGO 2.0 – Sistema de Gestão Orçamentária';
const RODAPE = 'Este é um e-mail automático. Não responda.';
const TAMANHO_NOME_EXIBICAO = 120;

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function linhaTexto(l: LinhaCorpo): string {
  if (l.tipo === 'texto') return l.texto;
  if (l.tipo === 'campo') return `${l.rotulo}: ${l.valor}`;
  return `${l.texto}: ${l.url}`;
}

function linhaHtml(l: LinhaCorpo): string {
  if (l.tipo === 'texto') return `<p>${escaparHtml(l.texto)}</p>`;
  if (l.tipo === 'campo') return `<p>${escaparHtml(l.rotulo)}: <strong>${escaparHtml(l.valor)}</strong></p>`;
  return `<p><a href="${escaparHtml(l.url)}">${escaparHtml(l.texto)}</a></p>`;
}

/**
 * Renderiza a mensagem com o layout comum (EP083, RF_EML_002): cabeçalho com o nome do sistema e,
 * se preenchido, o nome de exibição da instituição (spec §6.7, vazio por padrão), o corpo da
 * versão gravada e o rodapé de e-mail automático. No HTML, todo dado é escapado, inclusive o nome
 * de exibição e os atributos. Os dados chegam já validados (validarDadosModelo).
 * @throws ErroDominio('email.modelo_desconhecido') | ErroDominio('email.nome_exibicao_invalido')
 */
export function renderizarEmail(m: MensagemEmail, contexto: { nomeExibicao: string }): EmailRenderizado {
  // Object.hasOwn nos dois níveis: um modelo ou versão vindo do job como "constructor" ou
  // "__proto__" não pode resolver para algo do protótipo.
  const versoes = Object.hasOwn(VERSOES_MODELO, m.modelo) ? VERSOES_MODELO[m.modelo] : undefined;
  const versao =
    versoes && Number.isInteger(m.versao) && Object.hasOwn(versoes, m.versao)
      ? (versoes[m.versao] as VersaoModelo<typeof m.modelo>)
      : undefined;
  if (!versao) {
    throw new ErroDominio('email.modelo_desconhecido', 'Modelo de e-mail desconhecido.', {
      modelo: String(m.modelo),
      versao: m.versao,
    });
  }
  const nomeExibicao = contexto.nomeExibicao.trim();
  if (nomeExibicao.length > TAMANHO_NOME_EXIBICAO || temCaractereDeControle(nomeExibicao)) {
    throw new ErroDominio('email.nome_exibicao_invalido', 'Nome de exibição da instituição inválido.');
  }
  const cabecalho = nomeExibicao ? `${SISTEMA} · ${nomeExibicao}` : SISTEMA;
  const corpo = versao.corpo(m.dados as never);

  const texto = [cabecalho, '', ...corpo.map(linhaTexto), '', RODAPE].join('\n');
  const html = [
    '<!doctype html><html lang="pt-BR"><body>',
    `<p><strong>${escaparHtml(cabecalho)}</strong></p>`,
    ...corpo.map(linhaHtml),
    `<p><small>${escaparHtml(RODAPE)}</small></p>`,
    '</body></html>',
  ].join('\n');
  return { assunto: versao.assunto(), texto, html };
}
