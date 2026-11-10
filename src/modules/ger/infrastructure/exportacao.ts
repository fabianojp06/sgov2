import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { TipoColuna, ValorCelula } from '../domain/celula';

// Contrato C3: a forma da exportação para XLSX e a sua validação, sem o ExcelJS. Sai pelo index.ts
// (tipos e limite) para as telas; o gerador do arquivo sai só pelo servidor.ts (R22, Review Focus 10).
export type PlanilhaExportacao = {
  nome: string; // nome da aba: 1 a 31 caracteres, sem : \ / ? * [ ], sem apóstrofo nas pontas, único
  colunas: readonly { titulo: string; tipo: TipoColuna; largura?: number }[];
  linhas: readonly (readonly ValorCelula[])[]; // cada linha com um valor por coluna
  // US-024: cabeçalho com os filtros (RN0011) e a marca do operador e do rastreio (RN_WATERMARK).
  // Opcional: sem ele, o arquivo sai como antes. Monte com criarIdentificacao.
  identificacao?: IdentificacaoExportacao;
};

export type FiltroExportacao = { rotulo: string; valor: string };
export type IdentificacaoExportacao = {
  titulo: string;
  filtros: readonly FiltroExportacao[];
  operador: string; // o usuário logado (usuarioRotulo da sessão)
  rastreio: string; // o Traceability ID da exportação, o mesmo gravado no Histórico
  geradoEm: string; // ISO 8601
};

const HORA_BRASILIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Identificação de uma exportação, com um rastreio novo (UUID) e a hora do servidor. Chamar no
 * servidor: no navegador, o crypto.randomUUID só existe em contexto seguro (HTTPS ou localhost).
 */
export function criarIdentificacao(
  d: { titulo: string; filtros: readonly FiltroExportacao[]; operador: string },
  agora: Date = new Date(),
  rastreio: string = globalThis.crypto.randomUUID(),
): IdentificacaoExportacao {
  return { titulo: d.titulo, filtros: d.filtros, operador: d.operador, rastreio, geradoEm: agora.toISOString() };
}

/** O cabeçalho legível, uma linha por item: o mesmo texto no XLSX e no CSV. */
export function linhasIdentificacao(i: IdentificacaoExportacao): string[] {
  const filtros = i.filtros.length > 0 ? i.filtros.map((f) => `${f.rotulo}: ${f.valor}`).join('; ') : 'nenhum';
  return [
    i.titulo,
    `Filtros: ${filtros}`,
    `Exportado por ${i.operador} em ${HORA_BRASILIA.format(new Date(i.geradoEm))} (horário de Brasília)`,
    `Rastreio: ${i.rastreio}`,
  ];
}

const RASTREIO = /^[A-Za-z0-9-]{8,64}$/;
const texto = (t: string, max: number) => t.trim().length > 0 && t.length <= max;

function validarIdentificacao(i: IdentificacaoExportacao, prefixo: string): ErroCampo[] {
  const erros: ErroCampo[] = [];
  const e = (campo: string, mensagem: string) => erros.push({ campo: `${prefixo}.identificacao.${campo}`, mensagem });
  if (!texto(i.titulo, 200)) e('titulo', 'O título da exportação deve ter de 1 a 200 caracteres.');
  if (!texto(i.operador, 200)) e('operador', 'O operador da exportação é obrigatório (até 200 caracteres).');
  if (!RASTREIO.test(i.rastreio)) e('rastreio', 'O rastreio da exportação é inválido.');
  if (Number.isNaN(Date.parse(i.geradoEm))) e('geradoEm', 'A data da exportação é inválida.');
  if (i.filtros.length > 30) e('filtros', 'No máximo 30 filtros no cabeçalho.');
  if (i.filtros.some((f) => !texto(f.rotulo, 200) || f.valor.length > 200)) e('filtros', 'Cada filtro precisa de rótulo e valor com até 200 caracteres.');
  return erros;
}

export const LIMITE_EXPORTACAO_SINCRONA = 5000; // RF_IMP_003, total de linhas somando as abas
// Teto da exportação assíncrona (worker): o arquivo inteiro fica na memória e no banco. [PROVISÓRIO]
// (decisão da frente B, 10/11), sem número na spec.
export const LIMITE_EXPORTACAO_ASSINCRONA = 100_000;
// Teto do PDF, também em segundo plano: 20.000 linhas levam cerca de 8 s e 230 MB no worker; 100.000
// levariam 40 s e 1,5 GB (medido em 10/11). [PROVISÓRIO] (decisão da frente B, 10/11).
export const LIMITE_EXPORTACAO_PDF = 20_000;

/** O teto da exportação em segundo plano para o formato. */
export const tetoAssincrono = (formato: string): number => (formato === 'pdf' ? LIMITE_EXPORTACAO_PDF : LIMITE_EXPORTACAO_ASSINCRONA);

/** Opções dos geradores: o worker passa o limite assíncrono; a tela, nada (limite síncrono). */
export type OpcoesGeracao = { limite?: number };

const PROIBIDOS_NA_ABA = /[:\\/?*[\]]/;

// "History" é reservado pelo Excel (sem diferenciar maiúsculas); caracteres fora do XML 1.0 estragam o arquivo.
const FORA_DO_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
function nomeDeAbaValido(nome: string): boolean {
  return (
    nome.length >= 1 &&
    nome.length <= 31 &&
    !PROIBIDOS_NA_ABA.test(nome) &&
    !/^'|'$/.test(nome) &&
    !FORA_DO_XML.test(nome) &&
    nome.toLowerCase() !== 'history'
  );
}

/** Valida as abas antes de gerar o arquivo (nomes do Excel, uma célula por coluna, limite de linhas). */
export function validarPlanilhas(planilhas: readonly PlanilhaExportacao[], limite: number = LIMITE_EXPORTACAO_SINCRONA): Resultado<void> {
  if (planilhas.length === 0) return falha([{ campo: 'planilhas', mensagem: 'Nada a exportar: nenhuma aba.' }]);
  const erros: ErroCampo[] = [];
  const vistos = new Set<string>();
  planilhas.forEach((p, i) => {
    if (!nomeDeAbaValido(p.nome)) {
      erros.push({
        campo: `planilhas.${i}.nome`,
        mensagem: `Nome de aba inválido: "${p.nome}" (1 a 31 caracteres, sem : \\ / ? * [ ] e sem apóstrofo nas pontas).`,
      });
    }
    const chave = p.nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) erros.push({ campo: `planilhas.${i}.nome`, mensagem: `Aba repetida: "${p.nome}".` });
    vistos.add(chave);
    const linhaErrada = p.linhas.findIndex((l) => l.length !== p.colunas.length);
    if (linhaErrada >= 0) {
      erros.push({
        campo: `planilhas.${i}.linhas`,
        mensagem: `A linha ${linhaErrada + 1} da aba "${p.nome}" não tem um valor por coluna (${p.colunas.length}).`,
      });
    }
  });
  planilhas.forEach((p, i) => {
    if (p.identificacao) erros.push(...validarIdentificacao(p.identificacao, `planilhas.${i}`));
  });
  const total = planilhas.reduce((soma, p) => soma + p.linhas.length, 0);
  if (total > limite) {
    erros.push({
      campo: 'linhas',
      mensagem:
        limite === LIMITE_EXPORTACAO_SINCRONA
          ? `A exportação tem ${total} linhas; acima de ${LIMITE_EXPORTACAO_SINCRONA}, use a exportação assíncrona.`
          : `A exportação tem ${total} linhas; o máximo é ${limite}. Use filtros para reduzir.`,
    });
  }
  return erros.length > 0 ? falha(erros) : ok(undefined);
}
