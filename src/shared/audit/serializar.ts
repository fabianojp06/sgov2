import Decimal from 'decimal.js';
import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';
import { iguais } from './delta';
import { ErroAuditoria } from './erros';

// Converte o valor para algo que JSON.stringify grava sem erro e sem perder precisão
// (Review Focus 5): Decimal e os tipos do kernel viram texto exato, Date vira ISO 8601,
// BigInt vira texto. Campos undefined somem; referência circular vira "[circular]", com aviso no log.
// Só objetos simples e listas são percorridos: Map, Set, instâncias de classe, Buffer,
// funções, symbol e números não finitos são recusados, para nada sumir em silêncio.
// Credenciais são omitidas em qualquer nível (LGPD): a tabela é imutável.
//
// Convenção: audite valores monetários como Dinheiro/Percentual. Um Decimal cru vem com a
// escala de origem ("1234.5" do banco × "1234.50" do Dinheiro) e geraria delta falso.
// Credencial pelo nome inteiro (#172), não por pedaço, e na dúvida omitida (o Histórico é imutável).
// O nome é quebrado em palavras (camelCase, siglas, `_`, `-` ou `.`). É credencial quando alguma
// palavra é uma credencial (senhaHash, tokenRecuperacao, SMTPSenha) ou quando uma chave vem com um
// qualificador de segredo (privateKey, chaveAcesso, apiKey). A exceção é fechada: a última palavra
// é um sufixo de negócio que nunca caberia num segredo (senhaMinimo, senhaExpiraEm) ou o nome inteiro
// está em NOMES_NEGOCIO (hashArquivo, trocaSenhaPendente). Campo de negócio novo que caia na regra
// entra numa das duas listas; credencial nova, em CREDENCIAIS.
const CREDENCIAIS = new Set([
  ...['senha', 'password', 'passwd', 'passphrase', 'hash', 'token', 'segredo', 'secret', 'credencial', 'credential', 'jwt', 'salt', 'digest', 'apikey', 'bearer'].flatMap((p) => [p, `${p}s`]),
  'credenciais',
  'hashes',
  'totp',
  'otp',
  'pin',
  'mfa',
]);
const CHAVES = new Set(['key', 'keys', 'chave', 'chaves']);
const SEGREDO_DA_CHAVE = new Set(['privada', 'private', 'secreta', 'secret', 'acesso', 'access', 'api', 'cifra', 'assinatura', 'signing']);
const SUFIXOS_NEGOCIO = new Set([
  'minimo', 'maximo', 'exige', 'letra', 'digito', 'maiuscula', 'minuscula', 'simbolo', 'em', 'horas', 'dias', 'minutos',
  'obrigatoria', 'obrigatorio', 'tentativas',
]);
// Nomes inteiros de negócio cujo sufixo também caberia num segredo (tokenArquivo, novaSenhaPendente).
const NOMES_NEGOCIO = new Set(['hash arquivo', 'troca senha pendente']);
// Duas palavras que, juntas, são credencial, mas separadas não (dataVerificacao, codigoCc).
const PARES = [
  ['codigo', 'verificacao'],
  ['codigos', 'verificacao'],
  ['codigo', 'recuperacao'],
  ['codigos', 'recuperacao'],
  ['recovery', 'code'],
  ['recovery', 'codes'],
] as const;

export function chaveSensivel(chave: string): boolean {
  const palavras = chave
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean);
  const credencial =
    palavras.some((p) => CREDENCIAIS.has(p)) ||
    (palavras.some((p) => CHAVES.has(p)) && palavras.some((p) => SEGREDO_DA_CHAVE.has(p))) ||
    PARES.some((par) => par.every((p) => palavras.includes(p)));
  return credencial && !SUFIXOS_NEGOCIO.has(palavras.at(-1) ?? '') && !NOMES_NEGOCIO.has(palavras.join(' '));
}

export const OMITIDO = '[omitido]';
export const OMITIDO_ALTERADO = '[omitido: alterado]';

export function serializarParaAuditoria(v: unknown): unknown {
  return serializar(v, '$', new WeakSet(), 0, true);
}

function recusar(caminho: string, motivo: string): never {
  throw new ErroAuditoria('AUDITORIA_NAO_SERIALIZAVEL', `Valor não serializável para auditoria em ${caminho}: ${motivo}`, {
    caminho,
  });
}

// Saltos de toJSON seguidos no mesmo caminho: um toJSON que devolve algo com outro toJSON, em ciclo
// (uma classe, duas classes ou objeto simples), giraria sem fim. Acima do limite, recusa com o caminho.
const MAXIMO_SALTOS_TOJSON = 8;

// omitir = false só para comparar credenciais em memória (marcarCredenciaisAlteradas): nunca é gravado.
function serializar(v: unknown, caminho: string, vistos: WeakSet<object>, saltos: number, omitir: boolean): unknown {
  if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : recusar(caminho, 'número não finito');
  if (typeof v === 'bigint') return v.toString();
  if (typeof v !== 'object') return recusar(caminho, typeof v);
  if (v instanceof Dinheiro || v instanceof Percentual) return v.paraString();
  if (v instanceof Competencia) return v.formatar();
  if (Decimal.isDecimal(v)) return (v as Decimal).toFixed();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? recusar(caminho, 'data inválida') : v.toISOString();
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return recusar(caminho, 'dado binário');
  if (vistos.has(v)) {
    // Gravado como "[circular]" para a operação não falhar por causa da auditoria; o log diz onde
    // (#172). Só na serialização que vai para o banco, não na comparação das credenciais.
    if (omitir) console.warn('[AUDITORIA_CIRCULAR]', { caminho });
    return '[circular]';
  }
  const prototipo = Object.getPrototypeOf(v) as unknown;
  const simples = Array.isArray(v) || prototipo === Object.prototype || prototipo === null;
  if (!simples) {
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return seguirToJSON(toJSON.call(v), caminho, vistos, saltos, omitir);
    return recusar(caminho, `objeto ${(v as object).constructor?.name ?? 'sem tipo'}`);
  }
  vistos.add(v);
  try {
    if (Array.isArray(v)) return v.map((item, i) => serializar(item, `${caminho}[${i}]`, vistos, 0, omitir));
    if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      return seguirToJSON((v as { toJSON(): unknown }).toJSON(), caminho, vistos, saltos, omitir);
    }
    const saida: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(v)) {
      if (valor === undefined) continue;
      saida[chave] = omitir && chaveSensivel(chave) ? OMITIDO : serializar(valor, `${caminho}.${chave}`, vistos, 0, omitir);
    }
    return { ...saida };
  } finally {
    vistos.delete(v);
  }
}

function seguirToJSON(json: unknown, caminho: string, vistos: WeakSet<object>, saltos: number, omitir: boolean): unknown {
  if (saltos >= MAXIMO_SALTOS_TOJSON) return recusar(caminho, 'toJSON recursivo');
  return serializar(json, caminho, vistos, saltos + 1, omitir);
}

// Credencial que mudou: os dois lados viram [omitido] e o delta não mostraria a troca. Os dois lados
// são normalizados pelo próprio serializar, sem omitir (só em memória, nunca gravado), e comparados
// com o iguais do delta (sem depender da ordem das chaves): o depois ganha [omitido: alterado], sem
// valor nenhum. Percorre objetos e listas na mesma forma do serializado. Se a normalização sem omissão
// recusar algum valor (um Map num campo sensível, por exemplo), não marca: o Histórico grava como antes.
export function marcarCredenciaisAlteradas(antesOriginal: unknown, depoisOriginal: unknown, depoisSerializado: unknown): unknown {
  let antes: unknown;
  let depois: unknown;
  try {
    antes = serializar(antesOriginal, '$', new WeakSet(), 0, false);
    depois = serializar(depoisOriginal, '$', new WeakSet(), 0, false);
  } catch {
    return depoisSerializado;
  }
  return marcar(antes, depois, depoisSerializado);
}

function marcar(antes: unknown, depois: unknown, omitido: unknown): unknown {
  if (Array.isArray(omitido) && Array.isArray(antes) && Array.isArray(depois)) {
    return omitido.map((item, i) => (i < antes.length && i < depois.length ? marcar(antes[i], depois[i], item) : item));
  }
  if (!objeto(omitido) || !objeto(antes) || !objeto(depois)) return omitido;
  const saida: Record<string, unknown> = { ...omitido };
  for (const chave of Object.keys(saida)) {
    if (!Object.hasOwn(antes, chave) || !Object.hasOwn(depois, chave)) continue;
    if (saida[chave] === OMITIDO) {
      if (!iguais(antes[chave], depois[chave])) saida[chave] = OMITIDO_ALTERADO;
    } else {
      saida[chave] = marcar(antes[chave], depois[chave], saida[chave]);
    }
  }
  return saida;
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
