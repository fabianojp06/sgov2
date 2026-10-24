import { redirect } from 'next/navigation';

// C32: a raiz sempre leva à tela de login.
export default function Inicio(): never {
  redirect('/login');
}
