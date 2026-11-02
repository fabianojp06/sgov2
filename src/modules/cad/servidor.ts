// Entrada só de servidor do cad (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
export * from './contrato';

// Merge das cargas de estrutura (R6): o worker roda o processador; a seed chama o núcleo.
export { aplicarCarga, ErroCargaLinhas, type ResultadoCarga } from './infrastructure/aplicar-carga';
export { iniciarProcessadorCargas } from './infrastructure/processador-cargas';

// Seeds (R15, E-N3): o prisma/seed.ts importa daqui, nunca do index.ts.
export { seedCad, FUNCIONALIDADES_CAD } from './infrastructure/seed';
export { seedDadosReferenciaCad } from './infrastructure/seed-referencia';
