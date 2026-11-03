// Ambiente explícito (plano do P4, R25). Só `producao` liga as travas de produção (chave de teste
// da cifra, dados de referência, CC sem aprovação da DIREX). Na imagem (NODE_ENV=production), a
// variável é obrigatória; fora dela, a ausência conta como dev. O código entre colchetes separa
// ausente de inválido no log (usado também pela seed e pelas cargas do cad).
export type Ambiente = 'dev' | 'hml' | 'producao';

const AMBIENTES: readonly string[] = ['dev', 'hml', 'producao'];
const MENSAGEM = 'AMBIENTE ausente ou inválido (use dev, hml ou producao)';

export function lerAmbiente(fonte: Readonly<Record<string, string | undefined>> = process.env): Ambiente {
  const valor = fonte.AMBIENTE?.trim() ?? '';
  if (AMBIENTES.includes(valor)) return valor as Ambiente;
  if (valor !== '') throw new Error(`[AMBIENTE_INVALIDO] ${MENSAGEM}`);
  if (fonte.NODE_ENV !== 'production') return 'dev';
  throw new Error(`[AMBIENTE_AUSENTE] ${MENSAGEM}`);
}
