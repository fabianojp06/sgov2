import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSAO_ATUAL, type MensagemEmail, type ModeloEmail } from './domain/modelos-email';
import { renderizarEmail, VERSOES_MODELO } from './domain/renderizar-email';

// Versões publicadas de modelo são imutáveis (plano do P4, R8): uma mensagem na fila renderiza a
// versão que gravou. Mudar o arquivo de uma versão reprova este teste; o caminho é criar a v<n+1>,
// registrá-la em VERSOES_MODELO, apontar VERSAO_ATUAL e acrescentar o hash aqui.
// Fica fora de domain/ porque lê arquivo (o lint proíbe I/O no domínio). Dois hashes por versão:
// o do arquivo do modelo e o da saída renderizada de um exemplo fixo, que pega também mudança no
// layout comum (renderizar-email.ts).
const HASHES: Record<string, string> = {
  'usuario.senha_inicial@1': 'a952a93ccf955ac9fa715f3678123abda5d2b2d51a4fe5ef2697153927af95fa',
  'usuario.senha_redefinida@1': '8b32a27bed6d0b3e3204fa84a9f5ca827d300bd7ab3e26b5695821ba8f09b43a',
  'usuario.recuperacao_senha@1': 'e42080579dd0475aa7468a0800933a4a2823f561025059346a862ea031482dfc',
  'exportacao.concluida@1': '00d0e1d52a62f2ebcfb097d6519db1fed12a0f3b2f7203981f49e266ff18c9ca',
  'usuario.alerta_tentativas@1': 'fe79866ce943491c5badc8f695dca3cc4d0344152a4e436ef2e5245925c07d30',
};

const ARQUIVO: Record<ModeloEmail, string> = {
  'usuario.senha_inicial': 'usuario-senha-inicial',
  'usuario.senha_redefinida': 'usuario-senha-redefinida',
  'usuario.recuperacao_senha': 'usuario-recuperacao-senha',
  'exportacao.concluida': 'exportacao-concluida',
  'usuario.alerta_tentativas': 'usuario-alerta-tentativas',
};

const SAIDAS: Record<string, string> = {
  'usuario.senha_inicial@1': 'e3230555188a3d2bf60c0edcc090c6046e62f6abf411d635ff785da35db2bafc',
  'usuario.senha_redefinida@1': '8bf6e08a9718ea9e3ddfa15df7504d863555cc18b117e4e0393d503048fd90f2',
  'usuario.recuperacao_senha@1': '89a4bc357318e46aeb3f0af1fa822cd865eac370edb8578434e870bbbaabf1bf',
  'exportacao.concluida@1': 'bc2af74f8edd8d4af0752a4ba6c3f0e1b0c42c4b9e22d3d6284a59096d61e8d9',
  'usuario.alerta_tentativas@1': '5c565b15055abd3e03af9902cd9a77e919c5fc26d2449c76f4ed6e96fd443553',
};

// Fim de linha normalizado: um checkout com CRLF não muda o hash.
const sha256 = (texto: string) => createHash('sha256').update(texto.replaceAll('\r\n', '\n')).digest('hex');
const ACESSO = { nome: 'Maria', login: 'maria.silva', senhaTemporaria: 'Tmp-123456', urlAcesso: 'https://sgo.exemplo/login' };
const EXEMPLO: Record<ModeloEmail, object> = {
  'usuario.senha_inicial': ACESSO,
  'usuario.senha_redefinida': ACESSO,
  'usuario.recuperacao_senha': ACESSO,
  'exportacao.concluida': { nome: 'Maria', titulo: 'Plano de contas', resultado: 'pronta', urlAcesso: 'https://sgo.exemplo/rel/exportacoes' },
  'usuario.alerta_tentativas': {
    nomeAdministrador: 'Maria',
    nomeUsuario: 'João Souza',
    login: 'joao.souza',
    tentativas: 5,
    bloqueado: true,
    dataHora: '10/11/2026 18:30',
    urlAcesso: 'https://sgo.exemplo/adm/usuarios',
  },
};

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
    const caminho = join(import.meta.dirname, 'domain/modelos', `${ARQUIVO[modelo]}.v${versao}.ts`);
    expect(sha256(readFileSync(caminho, 'utf8'))).toBe(hash);
  });

  it.each(Object.entries(SAIDAS))('%s renderiza igual (layout comum incluído)', (chave, hash) => {
    const [modelo, versao] = chave.split('@') as [ModeloEmail, string];
    const m = { modelo, versao: Number(versao), destinatario: { email: 'a@b.org' }, dados: EXEMPLO[modelo], criadoEm: '' } as MensagemEmail;
    const r = renderizarEmail(m, { nomeExibicao: 'Instituição Exemplo' });
    expect(sha256(`${r.assunto}\n${r.texto}\n${r.html}`)).toBe(hash);
  });

  it('toda versão registrada tem hash da saída', () => {
    expect(registradas.sort()).toEqual(Object.keys(SAIDAS).sort());
  });
});
