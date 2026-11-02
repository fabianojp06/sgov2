import { exigirPagina } from '@/shared/authz';

// Área de trabalho inicial (UC01.03).
export default async function Inicio() {
  const ctx = await exigirPagina('aut.tela_principal', 'consultar');
  return <h1>Bem-vindo, {ctx.usuarioRotulo}</h1>;
}
