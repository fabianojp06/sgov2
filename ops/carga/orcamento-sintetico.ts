import ExcelJS from 'exceljs';
import minuta from '../../src/modules/cad/infrastructure/dados/cc-minuta-rev23102026.json';
import oficial from '../../src/modules/cad/infrastructure/dados/plano-contas-oficial.json';

// Orçamento sintético da Adm. Central para a base de referência da D-P7-3 (plano do P7, Task 3,
// Step 1): um .xlsx por exercício no layout ADMC-ORC v1.0, para importar pela tela do orc. As regras
// vêm da resposta da frente A na #138 (10/11): CC analítico da minuta, contas analíticas fora das
// vetadas, limites do leitor seguro (1 MiB, 20.000 linhas por aba) e texto que não começa com
// = + - @. Determinístico: o mesmo ano dá o mesmo arquivo. Não toca banco nenhum.

// Cabeçalhos da linha 4, iguais aos de src/modules/orc/domain/planilha.ts (pedido de contrato do orc
// na #138: quando o servidor.ts do orc exportar as colunas, este arquivo passa a usá-las).
export const LAYOUT = 'ADMC-ORC v1.0';
export const COLUNAS_PESSOAL = [
  'CC analítico',
  'Cargo',
  'Quantidade',
  'Salário mensal (R$)',
  'Mês de início (1–12)',
  'Mês de saída (1–12)',
  'Observação',
] as const;
export const COLUNAS_PACOTES = [
  'CC analítico',
  'Conta analítica',
  'Atividade / justificativa (mín. 10 caracteres)',
  'Prioridade',
  'Quantidade',
  'Valor unitário (R$)',
  'Corrigir pelo IPCA?',
  'Distribuição',
  'Mês (se pontual)',
] as const;
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
export const COLUNAS_RECEITAS = ['TP / versão', 'Descrição', 'Situação', ...MESES] as const;

type Celula = string | number;
export type Linha = Record<string, Celula>;
export type OrcamentoSintetico = { ano: number; pessoal: Linha[]; pacotes: Linha[]; receitas: Linha[] };
export type OpcoesOrcamento = { posicoesPorCc?: number; pacotesPorCc?: number; receitas?: number };

type Registro = { celulas: Record<string, string | null> };

/** CCs analíticos da minuta (a carga de referência do dev e de hml). */
export const CCS_ANALITICOS: readonly string[] = (minuta as Registro[]).filter((r) => r.celulas['Tipo'] === 'Analítico').map((r) => r.celulas['Classificação']!);

// Contas que aceitam pacote: as analíticas do plano oficial fora de pessoal (4.1.1.1), encargos
// (4.1.1.2) e provisões (4.1.1.8), onde ficam as contas das premissas do exercício (vetadas em
// pacote). As dos benefícios são cadastradas pela tela; se usarem outro ramo, ver o README.
const RAMOS_VETADOS = ['4.1.1.1.', '4.1.1.2.', '4.1.1.8.'];
export const CONTAS_PACOTE: readonly string[] = (oficial as Registro[])
  .filter((r) => r.celulas['Tipo'] === 'A')
  .map((r) => r.celulas['Classificação']!)
  .filter((c) => !RAMOS_VETADOS.some((v) => c.startsWith(v)));

const CARGOS = [
  'Analista de orçamento',
  'Assistente administrativo',
  'Coordenador de área',
  'Técnico de suporte',
  'Analista de contratos',
  'Auxiliar de serviços gerais',
  'Especialista em projetos',
  'Secretário executivo',
  'Analista financeiro',
  'Supervisor de operações',
];
const ATIVIDADES = [
  'Reposição de material de consumo da área',
  'Manutenção preventiva de equipamentos',
  'Viagens para reuniões de acompanhamento',
  'Contratação de serviço técnico especializado',
  'Capacitação da equipe em ferramentas de gestão',
  'Assinaturas de serviços e licenças de uso',
  'Locação de espaço para eventos institucionais',
  'Serviços de comunicação e publicidade legal',
];
const PRIORIDADES = ['Essencial', 'Importante', 'Desejável'] as const;

// Gerador pseudoaleatório pequeno e determinístico (mulberry32), semeado pelo ano.
function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Valor em reais com 2 casas, a partir de centavos inteiros (o .xlsx guarda número).
const reais = (centavos: number) => Math.round(centavos) / 100;

export function gerarOrcamentoSintetico(ano: number, o: OpcoesOrcamento = {}): OrcamentoSintetico {
  if (!Number.isInteger(ano) || ano < 2027 || ano > 2099) throw new Error(`ano fora da faixa: ${ano}`);
  const posicoesPorCc = o.posicoesPorCc ?? 8;
  const pacotesPorCc = o.pacotesPorCc ?? 25;
  const sorte = aleatorio(ano * 7919);
  const escolher = <T>(lista: readonly T[]): T => lista[Math.floor(sorte() * lista.length)]!;
  const inteiro = (min: number, max: number) => min + Math.floor(sorte() * (max - min + 1));
  // Os salários e valores sobem com o ano, como num orçamento real (cerca de 5% ao ano).
  const fator = 1.05 ** (ano - 2027);

  const pessoal: Linha[] = [];
  const pacotes: Linha[] = [];
  for (const cc of CCS_ANALITICOS) {
    for (let i = 0; i < posicoesPorCc; i++) {
      const inicio = inteiro(1, 6);
      pessoal.push({
        'CC analítico': cc,
        Cargo: CARGOS[(i + cc.length) % CARGOS.length]!,
        Quantidade: inteiro(1, 6),
        'Salário mensal (R$)': reais(inteiro(250_000, 1_800_000) * fator),
        'Mês de início (1–12)': inicio,
        'Mês de saída (1–12)': inteiro(inicio, 12),
        Observação: `Posição sintética ${i + 1} do CC ${cc} (carga de referência)`,
      });
    }
    for (let i = 0; i < pacotesPorCc; i++) {
      const pontual = sorte() < 0.3;
      pacotes.push({
        'CC analítico': cc,
        'Conta analítica': escolher(CONTAS_PACOTE),
        'Atividade / justificativa (mín. 10 caracteres)': `${escolher(ATIVIDADES)} (item ${i + 1}, ${ano})`,
        Prioridade: escolher(PRIORIDADES),
        Quantidade: inteiro(1, 24),
        'Valor unitário (R$)': reais(inteiro(5_000, 2_500_000) * fator),
        'Corrigir pelo IPCA?': sorte() < 0.5 ? 'Sim' : 'Não',
        Distribuição: pontual ? 'Pontual' : 'Mensal',
        ...(pontual ? { 'Mês (se pontual)': inteiro(1, 12) } : {}),
      });
    }
  }
  const receitas: Linha[] = Array.from({ length: o.receitas ?? 5 }, (_, i) => ({
    'TP / versão': `TP ${String(i + 1).padStart(2, '0')} v${ano}`,
    Descrição: `Receita sintética do termo ${i + 1}`,
    Situação: i % 2 === 0 ? 'Confirmado' : 'Previsto',
    ...Object.fromEntries(MESES.map((m) => [m, reais(inteiro(10_000_000, 90_000_000) * fator)])),
  }));
  return { ano, pessoal, pacotes, receitas };
}

function aba(wb: ExcelJS.Workbook, nome: string, colunas: readonly string[], linhas: readonly Linha[]): void {
  const ws = wb.addWorksheet(nome);
  // Como a planilha-modelo: título e instrução nas linhas 1 e 2, cabeçalho na 4, dados da 5 em diante.
  ws.getCell('A1').value = `${nome} — orçamento sintético`;
  ws.getCell('A2').value = 'Carga de referência gerada por ops/carga/gerar-orcamento.ts.';
  colunas.forEach((c, i) => (ws.getCell(4, i + 1).value = c));
  linhas.forEach((l, j) => colunas.forEach((c, i) => l[c] !== undefined && (ws.getCell(5 + j, i + 1).value = l[c]!)));
}

/** O .xlsx do exercício no layout ADMC-ORC v1.0. */
export async function montarArquivo(o: OrcamentoSintetico): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Instruções').getCell('E1').value = LAYOUT;
  aba(wb, 'Pessoal', COLUNAS_PESSOAL, o.pessoal);
  aba(wb, 'Pacotes base zero', COLUNAS_PACOTES, o.pacotes);
  aba(wb, 'Receitas', COLUNAS_RECEITAS, o.receitas);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
