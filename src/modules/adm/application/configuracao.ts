import type { TxCliente } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import type { PoliticaSenha } from '../domain/politica-senha';

// Parâmetros de acesso (GAP-AUT-002, spec §11.2a), lidos da linha única de configuracao_acesso.
export type ConfiguracaoAcesso = {
  limiteTentativas: number;
  limiarAlerta: number;
  inatividadeMin: number;
  sessaoMaximaHoras: number;
  senhaTemporariaHoras: number;
  politica: PoliticaSenha;
  manutencao: boolean;
  // Desativação do sistema pela tela (US-036, D-P9-2): instante em que vale, motivo e autor; a
  // espera entre o aviso e a desconexão (REQ0089).
  manutencaoAPartir: Date | null;
  manutencaoMotivo: string | null;
  manutencaoPor: string | null;
  desconexaoEsperaMin: number;
};

// O sistema está efetivamente inativo (D-P9-2): o indicador ligado e o instante já alcançado. Nulo
// no instante é a manutenção ligada direto no banco, que vale na hora.
export function manutencaoEfetiva(c: Pick<ConfiguracaoAcesso, 'manutencao' | 'manutencaoAPartir'>, agora: Date): boolean {
  return c.manutencao && (c.manutencaoAPartir === null || c.manutencaoAPartir.getTime() <= agora.getTime());
}

export async function obterConfiguracaoAcesso(tx: TxCliente): Promise<ConfiguracaoAcesso> {
  const c = await tx.configuracaoAcesso.findUnique({ where: { id: 1 } });
  // Sem a linha, a seed não rodou: é defeito de instalação, não um valor padrão silencioso.
  if (!c) throw new ErroDominio('acesso.configuracao_ausente', 'Configuração de acesso não instalada (rode a seed)');
  return {
    limiteTentativas: c.limiteTentativas,
    limiarAlerta: c.limiarAlerta,
    inatividadeMin: c.inatividadeMin,
    sessaoMaximaHoras: c.sessaoMaximaHoras,
    senhaTemporariaHoras: c.senhaTemporariaHoras,
    politica: { minimo: c.senhaMinimo, exigeLetra: c.senhaExigeLetra, exigeDigito: c.senhaExigeDigito },
    manutencao: c.manutencao,
    manutencaoAPartir: c.manutencaoAPartir,
    manutencaoMotivo: c.manutencaoMotivo,
    manutencaoPor: c.manutencaoPorId,
    desconexaoEsperaMin: c.desconexaoEsperaMin,
  };
}
