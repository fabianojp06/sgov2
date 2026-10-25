// UID da sessão para o Histórico (RN0062): timestamp da conexão, IP e usuário em Base64. Não é o
// token do cookie, que é aleatório e só existe como hash no banco.
export function gerarSessaoUid(agora: Date, ip: string | null, usuarioId: string): string {
  return btoa(`${agora.toISOString()}|${ip ?? '-'}|${usuarioId}`);
}
