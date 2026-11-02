// Entrada só de servidor do ger (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/.

// Leitura segura de .xlsx (R4; acréscimo ao C3 para o cad e para a US-121).
export {
  lerPlanilhaSegura,
  LIMITES_PADRAO,
  type ErroLinha,
  type LimitesPlanilha,
  type LinhaPlanilha,
  type OpcoesLeitura,
  type PlanilhaLida,
} from './infrastructure/ler-xlsx';

// Exportação XLSX real do C3 (R21): só no servidor (Server Actions, relatórios), nunca no navegador.
export { exportarXlsx } from './infrastructure/exportar-xlsx';
