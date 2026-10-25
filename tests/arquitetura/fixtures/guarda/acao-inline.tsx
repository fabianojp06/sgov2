// Fixture: Server Action inline num componente escapa da guarda.
export function Tela() {
  async function salvar() {
    'use server';
  }
  return <form action={salvar} />;
}
