import { entrar, FormLogin } from '@/modules/aut';

// C32: o sistema abre no login. A marca é neutra (spec §6.7).
export default function Login() {
  return (
    <main>
      <h1>SGO 2.0 – Sistema de Gestão Orçamentária</h1>
      <FormLogin entrar={entrar} />
    </main>
  );
}
