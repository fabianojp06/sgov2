// API pública do cad (spec §4.1). Código só de servidor sem guarda também sai pelo servidor.ts (R22).
export * from './contrato';

// Tabela Mestre de Benefícios (US-050): ações e tela.
export { alterarBeneficio, incluirBeneficio } from './application/acoes-beneficios';
export { TabelaMestre, type ItemTela } from './ui/tabela-mestre';
export { listarAnosBeneficios, listarBeneficiosMestre } from './application/beneficios';
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

// Parâmetros do exercício e salário mínimo (US-053 parte 2): ações, dados das telas e formulários.
export { acaoAlterarParametros, acaoAlterarSalarioMinimo } from './application/acoes-parametros';
export { obterTelaParametros, obterTelaSalarioMinimo } from './application/tela-parametros';
export { FormParametros } from './ui/form-parametros';
export { FormSalarioMinimo } from './ui/form-salario-minimo';
export { SeletorAno } from './ui/seletor-ano';

// Cargos e salários (US-049 parte 2): ações, casos de uso de leitura e telas.
export { acaoAlterarCargo, acaoConsultarCargaCargos, acaoImportarCargos, acaoRegravarSalarios } from './application/acoes-cargos';
export { listarCargos, obterCargo } from './application/cargos';
export { FormCargo } from './ui/form-cargo';
export { ListaCargos } from './ui/lista-cargos';

// Tabela salarial e senioridades (US-049 parte 3): ações, leitura e tela.
export {
  acaoAlterarFaixa,
  acaoCopiarFaixaParaCargo,
  acaoIncluirFaixa,
  acaoIncluirSenioridade,
  acaoInativarFaixa,
  acaoInativarSenioridade,
} from './application/acoes-tabela-salarial';
export { listarOpcoesCargos, listarTabelaSalarial } from './application/tabela-salarial';
export { TabelaSalarial } from './ui/tabela-salarial';

// Benefícios do cargo (US-050 parte 2): ação e leitura.
export { acaoAlterarBeneficiosCargo } from './application/acoes-beneficios-cargo';
export { listarBeneficiosCargo } from './application/beneficios-cargo';
