// Entrada só de servidor do rel (R22 do P4): seed e casos de uso de outros módulos.
// Páginas e componentes usam o index.ts (o lint proíbe app/ e ui/ de importar este arquivo).
// Nada aqui importa @/shared/authz nem next/.

// Seed (C6): o prisma/seed.ts importa daqui, nunca do index.ts.
export { FUNCIONALIDADES_REL, seedRel } from './infrastructure/seed';
