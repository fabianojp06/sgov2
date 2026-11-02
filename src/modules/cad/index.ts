// API pública do cad (spec §4.1). Código só de servidor sem guarda também sai pelo servidor.ts (R22).
export * from './contrato';

// Tabela Mestre de Benefícios (US-050): ações e tela.
export { alterarBeneficio, incluirBeneficio } from './application/acoes-beneficios';
export { TabelaMestre, type ItemTela } from './ui/tabela-mestre';
export { listarBeneficiosMestre } from './application/beneficios';
export { FORMAS_BENEFICIO, valorMensalPorPessoa, type BeneficioMestre, type EntradaBeneficio, type FormaBeneficio } from './domain/beneficios';
