'use client';

// Falha numa página da área logada (UC01.03 E1). Componente cliente: não importa @/modules/* (o
// index do módulo carrega código de servidor); o texto é o mesmo do ErroCarregamento do aut.
export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert">
      <p>Não foi possível carregar os módulos do sistema. Tente novamente ou contate o Administrador.</p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
      <a href="/login?saiu=1">Sair</a>
    </div>
  );
}
