import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSAO_ATUAL, type ModeloEmail } from './domain/modelos-email';
import { VERSOES_MODELO } from './domain/renderizar-email';

// Versões publicadas de modelo são imutáveis (plano do P4, R8): uma mensagem na fila renderiza a
// versão que gravou. Mudar o arquivo de uma versão reprova este teste; o caminho é criar a v<n+1>,
// registrá-la em VERSOES_MODELO, apontar VERSAO_ATUAL e acrescentar o hash aqui.
const HASHES: Record<string, string> = {
  'usuario.senha_inicial@1': 'a952a93ccf955ac9fa715f3678123abda5d2b2d51a4fe5ef2697153927af95fa',
  'usuario.senha_redefinida@1': '8b32a27bed6d0b3e3204fa84a9f5ca827d300bd7ab3e26b5695821ba8f09b43a',
};

const ARQUIVO: Record<ModeloEmail, string> = {
  'usuario.senha_inicial': 'usuario-senha-inicial',
  'usuario.senha_redefinida': 'usuario-senha-redefinida',
};

const sha256 = (caminho: string) => createHash('sha256').update(readFileSync(caminho)).digest('hex');

describe('versões dos modelos de e-mail', () => {
  const registradas = (Object.keys(VERSOES_MODELO) as ModeloEmail[]).flatMap((modelo) =>
    Object.keys(VERSOES_MODELO[modelo]).map((v) => `${modelo}@${v}`),
  );

  it('toda versão registrada tem hash, e todo hash é de uma versão registrada', () => {
    expect(registradas.sort()).toEqual(Object.keys(HASHES).sort());
  });

  it('a versão atual de cada modelo está registrada', () => {
    for (const modelo of Object.keys(VERSAO_ATUAL) as ModeloEmail[]) {
      expect(VERSOES_MODELO[modelo][VERSAO_ATUAL[modelo]], modelo).toBeDefined();
    }
  });

  it.each(Object.entries(HASHES))('%s não mudou depois de publicada', (chave, hash) => {
    const [modelo, versao] = chave.split('@') as [ModeloEmail, string];
    const caminho = join(process.cwd(), 'src/modules/ger/domain/modelos', `${ARQUIVO[modelo]}.v${versao}.ts`);
    expect(sha256(caminho)).toBe(hash);
  });
});
