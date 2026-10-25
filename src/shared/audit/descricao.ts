import type { TipoOperacao } from './tipos';

// Descrição padrão do Histórico de Operações (RN0089 a RN0094).
export function descrever(tipo: TipoOperacao, funcionalidade: string, registroId?: string): string {
  const registro = registroId === undefined ? 'um registro' : `o registro ${registroId}`;
  switch (tipo) {
    case 'INSERCAO':
      return `Inseriu ${registro} referente à ${funcionalidade}`;
    case 'ALTERACAO':
      return `Alterou ${registro} referente à ${funcionalidade}`;
    case 'EXCLUSAO':
      return `Excluiu ${registro} referente à ${funcionalidade}`;
    case 'CONSULTA':
      return `Acessou a funcionalidade ${funcionalidade}`;
    case 'IMPRESSAO':
      return `Imprimiu a listagem referente à ${funcionalidade}`;
    case 'EXPORTACAO':
      return `Exportou a listagem referente à ${funcionalidade}`;
    case 'LOGIN':
      return 'Entrou no sistema';
    case 'LOGOFF':
      return 'Saiu do sistema';
    case 'SISTEMA':
      return `Ação automática do sistema referente à ${funcionalidade}`;
  }
}
