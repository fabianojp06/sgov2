// Entrada só de servidor do cad (plano do P4, R22): worker, seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/ (o worker/bundle.test.ts reprova).
export * from './contrato';
// C2, acréscimo de C&S: sem a cifra (worker): a Fonte Ativa cifrada sai sem salário.
export { listarCargosSemSalarioCifrado } from './infrastructure/cargos-exercicio';

// Merge das cargas de estrutura (R6): o worker roda o processador; a seed chama o núcleo.
export { aplicarCarga, ErroCargaLinhas, type ResultadoCarga } from './infrastructure/aplicar-carga';
export { iniciarProcessadorCargas } from './infrastructure/processador-cargas';

// Seeds (R15, E-N3): o prisma/seed.ts importa daqui, nunca do index.ts.
export { seedCad, FUNCIONALIDADES_CAD } from './infrastructure/seed';
export { seedDadosReferenciaCad } from './infrastructure/seed-referencia';

// Plano sintético para os testes de desempenho (P7, Task 3, D-P7-3): o ops/carga/gerar-plano.ts grava o .xlsx.
export { gerarPlanoSintetico } from './infrastructure/plano-sintetico';
export { COLUNAS_PLANO_CONTAS } from './domain/plano-contas';

// Parâmetros sem guarda (R10, R22): nome de exibição para o e-mail e a versão única do ano.
export { obterParametroSistema, tocarVersaoExercicio, type ChaveParametroSistema } from './infrastructure/parametro-sistema';

// Geradores da exportação assíncrona (US-024): o worker os entrega ao trabalhador do ger.
export { GERADORES_EXPORTACAO_CAD } from './application/planilha-estrutura';
