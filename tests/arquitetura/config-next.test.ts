import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

// Limites do Next.js usados pelo P4 (plano do P4, Task 0): upload de planilha até 2 MB pela
// Server Action (o padrão é 1 MB) e o ExcelJS fora do bundle do servidor.
describe('next.config.ts', () => {
  it('as Server Actions aceitam corpo de até 2 MB', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('2mb');
  });

  it('o ExcelJS fica fora do bundle (serverExternalPackages)', () => {
    expect(nextConfig.serverExternalPackages).toContain('exceljs');
  });

  it('continua standalone (imagem de produção)', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});
