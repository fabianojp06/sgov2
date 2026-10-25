import { criarLimitadorLogin } from './limite-login';

// Instância única por processo: o login e a conferência da senha atual na troca voluntária (Task 3)
// passam pelo mesmo limitador (D-P5-1). Com várias instâncias do app, o limite multiplica (risco
// aceito).
export const limitadorLogin = criarLimitadorLogin();
