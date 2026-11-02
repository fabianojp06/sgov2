// Ambiente do cad (R25): com NODE_ENV=production, AMBIENTE é obrigatório. Mesma regra do lerAmbiente
// do ger (PR #208); quando ele estiver na main, esta função passa a usá-lo. Usado pela seed (R15) e
// pelo processador de cargas (CC provisório em produção, R16).
const AMBIENTES = ['dev', 'hml', 'producao'] as const;

export function ambienteDoCad(env: NodeJS.ProcessEnv = process.env): (typeof AMBIENTES)[number] {
  const a = (env.AMBIENTE ?? '').trim();
  if ((AMBIENTES as readonly string[]).includes(a)) return a as (typeof AMBIENTES)[number];
  // Mensagem da R25; o código entre colchetes separa ausente de inválido no log.
  if (a !== '') throw new Error('[AMBIENTE_INVALIDO] AMBIENTE ausente ou inválido (use dev, hml ou producao)');
  if (env.NODE_ENV === 'production') throw new Error('[AMBIENTE_AUSENTE] AMBIENTE ausente ou inválido (use dev, hml ou producao)');
  return 'dev';
}

