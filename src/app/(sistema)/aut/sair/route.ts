import { responderSair } from '@/modules/aut';
import { definirRota } from '@/shared/authz';

// Logoff (US-032). A checagem de origem do definirRota barra o logoff forçado por outro site.
export const POST = definirRota({ funcionalidade: 'aut.sessao', acao: 'excluir' }, responderSair());
