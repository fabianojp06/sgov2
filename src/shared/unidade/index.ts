// Contexto de unidade (TP) do usuário (spec §4.1, §5) e o isolamento por RLS (US-007).
export { nomeCookieUnidade } from '@/shared/config';
export { aplicarUnidades, emTodasAsUnidades, emUnidade, filtroUnidadeAtiva } from './em-unidade';
export { resolverUnidadeAtiva } from './unidade-ativa';
