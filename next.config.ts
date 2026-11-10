import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Sem "X-Powered-By: Next.js": o servidor não revela o framework (achado baixo da US-116, #318).
  poweredByHeader: false,
  // ExcelJS (leitura e escrita de .xlsx, P4) fica fora do bundle do servidor: é CommonJS grande e
  // só roda no Node.
  serverExternalPackages: ['exceljs'],
  experimental: {
    // Upload de planilha (P4, cargas): o arquivo tem teto de 1 MB na aplicação, e o padrão de
    // 1 MB do Next recusaria o FormData antes da validação dar o erro por campo.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
