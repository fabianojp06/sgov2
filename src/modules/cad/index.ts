// API pública do cad (spec §4.1). Código só de servidor sem guarda também sai pelo servidor.ts (R22).
export * from './contrato';

// Tabela Mestre de Benefícios (US-050): ações e tela.
export { alterarBeneficio, incluirBeneficio } from './application/acoes-beneficios';
export { TabelaMestre, type ItemTela } from './ui/tabela-mestre';
export { listarBeneficiosMestre } from './application/beneficios';
export { FORMAS_BENEFICIO, valorMensalPorPessoa, type BeneficioMestre, type EntradaBeneficio, type FormaBeneficio } from './domain/beneficios';

// Importação do plano de contas (US-043 parte 4): ações e tela.
export { acaoConsultarCargaPlano, acaoImportarPlanoContas } from './application/acoes-plano';
export { ImportarEstrutura } from './ui/importar-estrutura';

// Consulta do plano de contas em árvore (US-044): caso de uso e tela.
export { consultarArvoreCentrosCusto, consultarArvoreContas, escopoDaSessao } from './application/consultar-estrutura';
export { ArvoreContas } from './ui/arvore-contas';

// Centros de custo (US-046 parte 2): importação com a trava da DIREX e consulta em árvore.
export { acaoConsultarCargaCc, acaoImportarCentrosCusto } from './application/acoes-cc';
export { cargaProvisoriaPermitida } from './application/importar-estrutura';
export { ArvoreCc } from './ui/arvore-cc';
export { CamposAprovacaoDirex } from './ui/importar-cc';
