import { auditar } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';

// Registro da seed no Histórico (UC02.27, passo 5): tipo e ator "Sistema".
export function auditarSeed(tx: TxCliente, descricao: string, registroId?: string): Promise<void> {
  return auditar(tx, {
    contexto: { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null },
    funcionalidade: 'adm.seed',
    tipo: 'SISTEMA',
    origem: 'SISTEMA',
    descricao,
    ...(registroId === undefined ? {} : { registroId }),
  });
}
