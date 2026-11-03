import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { lerAmbiente } from '@/modules/ger/servidor';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { CHAVE_TESTE_CIFRA } from './cifra-teste';

// Cifra por coluna dos salários do cargo (plano do P4, R7; pendência P1). AES-256-GCM com IV de 12
// bytes aleatório por cifra e tag de 16 bytes obrigatória; AAD com o código do cargo, o campo e o id
// da chave, para o valor não poder trocar de linha, de campo nem de chave. Envelope:
// v1:<idChave>:<iv>:<tag>:<cifra>, em base64url. As chaves só existem no app (nunca no worker).
// I9: nenhuma mensagem ou log cita o valor nem a chave.

export type CampoCifrado = 'salario_real' | 'salario_definido' | 'funcao_gratificada';

export interface CifraSalarios {
  cifrar(valor: Dinheiro, contexto: { codigoCargo: string; campo: CampoCifrado }): string;
  decifrar(envelope: string, contexto: { codigoCargo: string; campo: CampoCifrado }): Dinheiro;
  idChaveAtual(): string;
}

const VERSAO = 'v1';
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const FORMATO_ID = /^[A-Za-z0-9_-]{1,20}$/;
const MSG_INVALIDO = 'Não foi possível decifrar um salário do cargo.';
// O texto vai completado com zeros até um tamanho fixo: a cifra não revela quantos dígitos tem o salário.
const TAMANHO_TEXTO = 16;

const b64url = (b: Buffer) => b.toString('base64url');
const aad = (codigoCargo: string, campo: CampoCifrado, idChave: string) => Buffer.from(`cad.cargo:${codigoCargo}:${campo}:${idChave}`, 'utf8');

function chaveDe(base64: string, variavel: string): Buffer {
  const b = Buffer.from(base64.trim(), 'base64');
  if (b.length !== 32 || b.toString('base64') !== base64.trim()) {
    throw new Error(`[CIFRA_SALARIOS_INVALIDA] ${variavel} deve ter 32 bytes em base64.`);
  }
  return b;
}

type Configuracao = { atual: { id: string; chave: Buffer }; chaves: Map<string, Buffer> };

function lerConfiguracao(fonte: Readonly<Record<string, string | undefined>>): Configuracao | null {
  const base64 = fonte.CHAVE_CIFRA_SALARIOS?.trim() ?? '';
  if (base64 === '') return null;
  const id = fonte.CHAVE_CIFRA_SALARIOS_ID?.trim() ?? '';
  if (!FORMATO_ID.test(id)) throw new Error('[CIFRA_SALARIOS_INVALIDA] CHAVE_CIFRA_SALARIOS_ID deve ter até 20 letras, números, hífen ou sublinhado.');
  const chave = chaveDe(base64, 'CHAVE_CIFRA_SALARIOS');
  const teste = Buffer.from(CHAVE_TESTE_CIFRA, 'base64');
  const producao = lerAmbiente(fonte) === 'producao';
  const recusarTeste = (b: Buffer) => {
    if (producao && timingSafeEqual(b, teste)) {
      throw new Error('[CIFRA_SALARIOS_CHAVE_DE_TESTE] A chave de teste da cifra não vale em produção, nem como anterior: cadastre a chave real.');
    }
  };
  recusarTeste(chave);
  const chaves = new Map<string, Buffer>([[id, chave]]);
  for (const item of (fonte.CHAVE_CIFRA_SALARIOS_ANTERIORES ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [idAnterior, b64, ...resto] = item.split(':');
    if (!idAnterior || !b64 || resto.length > 0 || !FORMATO_ID.test(idAnterior) || chaves.has(idAnterior)) {
      throw new Error('[CIFRA_SALARIOS_INVALIDA] CHAVE_CIFRA_SALARIOS_ANTERIORES deve ser id:base64;id:base64, com ids distintos.');
    }
    const anterior = chaveDe(b64, 'CHAVE_CIFRA_SALARIOS_ANTERIORES');
    recusarTeste(anterior);
    chaves.set(idAnterior, anterior);
  }
  return { atual: { id, chave }, chaves };
}

/**
 * Cifra a partir das variáveis do app. Sem a chave, só as funções de cargo falham, com
 * cad.cifra_indisponivel e o log [CIFRA_SALARIOS_AUSENTE]; chave malformada ou a de teste em
 * produção falham na criação (configuração errada, não indisponibilidade).
 */
export function criarCifraSalarios(fonte: Readonly<Record<string, string | undefined>> = process.env): CifraSalarios {
  const config = lerConfiguracao(fonte);
  const exigirConfig = (): Configuracao => {
    if (config) return config;
    console.error('[CIFRA_SALARIOS_AUSENTE] CHAVE_CIFRA_SALARIOS não definida: as funções de cargo com salário ficam indisponíveis.');
    throw new ErroDominio('cad.cifra_indisponivel', 'Os salários dos cargos estão indisponíveis: a chave de cifra não está configurada.');
  };
  return {
    idChaveAtual: () => exigirConfig().atual.id,
    cifrar(valor, { codigoCargo, campo }) {
      const { atual } = exigirConfig();
      const texto = valor.paraString();
      // Negativo ou longo demais viraria um envelope que não volta (o tamanho fixo pressupõe isso). I9: sem o valor.
      if (valor.ehNegativo() || texto.length > TAMANHO_TEXTO) throw new ErroDominio('cad.salario_invalido', 'Salário inválido para cifrar: negativo ou grande demais.');
      const iv = randomBytes(TAMANHO_IV);
      const c = createCipheriv('aes-256-gcm', atual.chave, iv, { authTagLength: TAMANHO_TAG });
      c.setAAD(aad(codigoCargo, campo, atual.id));
      const cifra = Buffer.concat([c.update(texto.padStart(TAMANHO_TEXTO, '0'), 'utf8'), c.final()]);
      return [VERSAO, atual.id, b64url(iv), b64url(c.getAuthTag()), b64url(cifra)].join(':');
    },
    decifrar(envelope, { codigoCargo, campo }) {
      const { chaves } = exigirConfig();
      const partes = envelope.split(':');
      if (partes.length !== 5 || partes[0] !== VERSAO) throw new ErroDominio('cad.cifra_invalida', MSG_INVALIDO);
      const [, id, ivTxt, tagTxt, cifraTxt] = partes as [string, string, string, string, string];
      const chave = chaves.get(id);
      if (!chave) throw new ErroDominio('cad.cifra_invalida', MSG_INVALIDO, { motivo: 'chave desconhecida', idChave: id });
      const iv = Buffer.from(ivTxt, 'base64url');
      const tag = Buffer.from(tagTxt, 'base64url');
      // Tag curta é recusada antes do Node (que aceitaria tags menores sem o authTagLength).
      if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) throw new ErroDominio('cad.cifra_invalida', MSG_INVALIDO);
      try {
        const d = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: TAMANHO_TAG });
        d.setAAD(aad(codigoCargo, campo, id));
        d.setAuthTag(tag);
        const texto = Buffer.concat([d.update(Buffer.from(cifraTxt, 'base64url')), d.final()]).toString('utf8');
        return Dinheiro.de(texto);
      } catch {
        throw new ErroDominio('cad.cifra_invalida', MSG_INVALIDO);
      }
    },
  };
}
