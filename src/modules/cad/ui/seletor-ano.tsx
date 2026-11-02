// Seletor de exercício (US-053 parte 2): formulário GET, sem JavaScript, que reabre a página no ano
// escolhido (?ano=2027).
export function SeletorAno({ acao, anos, ano }: { acao: string; anos: readonly number[]; ano: number | null }) {
  if (anos.length === 0) return null;
  // O ano pedido sem parâmetros também aparece, para o seletor bater com a página.
  const opcoes = ano !== null && !anos.includes(ano) ? [ano, ...anos].sort((a, b) => b - a) : anos;
  return (
    <form method="get" action={acao}>
      <label htmlFor="seletor-ano">Exercício</label>{' '}
      <select id="seletor-ano" name="ano" defaultValue={ano ?? undefined}>
        {opcoes.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>{' '}
      <button type="submit">Abrir</button>
    </form>
  );
}
