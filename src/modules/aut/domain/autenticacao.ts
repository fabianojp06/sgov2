// Regras puras da autenticação (EP084 UC01.02, UC01.05).

export type DecisaoAntesDaSenha = 'MANUTENCAO' | 'INEXISTENTE' | 'INATIVO' | 'BLOQUEADO' | 'CONFERIR';

type UsuarioAvaliado = { ativo: boolean; bloqueado: boolean; ehAdministrador: boolean };

// Ordem do UC01.02: manutenção → existência → status → bloqueio → senha. Em manutenção, quem não é
// administrador (inclusive login inexistente) para aqui, sem senha e sem contador (RN0023); o
// administrador segue o fluxo normal. Bloqueado não confere a senha (RN0018).
export function avaliarAntesDaSenha(e: { manutencao: boolean; usuario: UsuarioAvaliado | null }): DecisaoAntesDaSenha {
  const { manutencao, usuario } = e;
  if (manutencao && !(usuario?.ativo && usuario.ehAdministrador)) return 'MANUTENCAO';
  if (!usuario) return 'INEXISTENTE';
  if (!usuario.ativo) return 'INATIVO';
  if (usuario.bloqueado) return 'BLOQUEADO';
  return 'CONFERIR';
}

// Senha errada (A1): o contador é global e só cresce (RN0017, RN0026). Bloqueia ao atingir o limite
// (RN0024), alerta ao atingir o limiar (RN0520) e avisa quando resta uma tentativa (A5).
export function avaliarFalha(e: { contador: number; limite: number; limiar: number }): {
  novoContador: number;
  bloquear: boolean;
  alertar: boolean;
  ultimaTentativa: boolean;
} {
  const novoContador = e.contador + 1;
  const bloquear = novoContador >= e.limite;
  return {
    novoContador,
    bloquear,
    alertar: novoContador === e.limiar,
    ultimaTentativa: !bloquear && novoContador === e.limite - 1,
  };
}
