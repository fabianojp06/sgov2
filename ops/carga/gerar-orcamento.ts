// Grava os 5 exercícios sintéticos da Adm. Central (2027 a 2031) no layout ADMC-ORC v1.0, um .xlsx
// por ano, para importar pela tela do orc em cada exercício criado (plano do P7, Task 3, Step 1,
// D-P7-3). Só gera os arquivos: não toca banco nenhum.
// Uso: npx tsx ops/carga/gerar-orcamento.ts <pasta> [primeiro-ano=2027] [anos=5]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gerarOrcamentoSintetico, montarArquivo } from './orcamento-sintetico';

// Limite do leitor seguro do ger (LIMITES_PADRAO, confirmado pela frente A na #138).
const MAX_BYTES = 1024 * 1024;

const [pasta, primeiroTexto = '2027', anosTexto = '5'] = process.argv.slice(2);
if (!pasta || !/^\d{4}$/.test(primeiroTexto) || !/^[1-9]$/.test(anosTexto)) {
  console.error('Uso: npx tsx ops/carga/gerar-orcamento.ts <pasta> [primeiro-ano=2027] [anos=5]');
  process.exit(2);
}

mkdirSync(pasta, { recursive: true });
for (let ano = Number(primeiroTexto); ano < Number(primeiroTexto) + Number(anosTexto); ano++) {
  const o = gerarOrcamentoSintetico(ano);
  const arquivo = await montarArquivo(o);
  if (arquivo.byteLength > MAX_BYTES) {
    console.error(`${ano}: ${arquivo.byteLength} bytes, acima do limite de 1 MiB da importação`);
    process.exit(1);
  }
  const caminho = join(pasta, `orcamento-adm-central-${ano}.xlsx`);
  writeFileSync(caminho, arquivo);
  console.log(`${caminho}: ${o.pessoal.length} posições, ${o.pacotes.length} pacotes, ${o.receitas.length} receitas, ${Math.ceil(arquivo.byteLength / 1024)} KiB`);
}
