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
};

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
  };
}
