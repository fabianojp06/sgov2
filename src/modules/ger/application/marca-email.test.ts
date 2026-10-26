import { describe, expect, it } from 'vitest';
import { encontrarMarcaVedada } from '@/shared/config';
import { MODELOS_SENSIVEIS, type MensagemEmail, type ModeloEmail } from '../domain/modelos-email';
import { renderizarEmail, VERSOES_MODELO } from '../domain/renderizar-email';

// Marca neutra (spec §6.7): nenhuma saída de nenhuma versão de modelo traz o nome vedado. Fica em
// application/ porque o domain/ não importa o @/shared/config (lint, spec §4.1).
const dados = { nome: 'Maria', login: 'maria.silva', senhaTemporaria: 'Tmp-123456', urlAcesso: 'https://sgo.exemplo/login' };

describe('marca neutra nos e-mails', () => {
  const versoes = (Object.keys(VERSOES_MODELO) as ModeloEmail[]).flatMap((modelo) =>
    Object.keys(VERSOES_MODELO[modelo]).map((v) => [modelo, Number(v)] as const),
  );

  it('há versões para todos os modelos', () => {
    expect(new Set(versoes.map(([m]) => m))).toEqual(new Set(MODELOS_SENSIVEIS));
  });

  it.each(versoes)('%s v%i não tem a marca vedada no assunto, no texto nem no HTML', (modelo, versao) => {
    const m = { modelo, versao, destinatario: { email: 'a@b.org' }, dados, criadoEm: '2026-10-26T00:00:00Z' } as MensagemEmail;
    for (const nomeExibicao of ['', 'Instituição Exemplo']) {
      const r = renderizarEmail(m, { nomeExibicao });
      expect(encontrarMarcaVedada(`${r.assunto}\n${r.texto}\n${r.html}`)).toEqual([]);
    }
  });
});
