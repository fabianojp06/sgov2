import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O vitest não usa a condição react-server: aqui o cache do React só repassa a chamada, e nenhum teste
// de comportamento enxerga a memorização por render (#293, medida no E2E: 9 → 5 chamadas do provedor).
// Este teste só impede que o obterContexto deixe de passar pelo cache sem ninguém notar.
describe('obterContexto memorizado por render (ressalva 4 do P5)', () => {
  it('é exportado pelo cache do React', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./contexto.ts', import.meta.url)), 'utf8');
    expect(fonte).toMatch(/^import \{ cache \} from 'react';$/m);
    expect(fonte).toMatch(/^export const obterContexto = cache\(obterContextoSemCache\);$/m);
  });
});
