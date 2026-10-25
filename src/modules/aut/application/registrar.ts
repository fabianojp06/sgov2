import { configurarProvedorContexto } from '@/shared/authz/configuracao';
import { criarProvedorContexto } from './provedor-contexto';

// Chamado uma vez pelo src/instrumentation.ts: liga a guarda do P1 às sessões do aut.
export function registrarAutenticacao(): void {
  configurarProvedorContexto(criarProvedorContexto());
}
