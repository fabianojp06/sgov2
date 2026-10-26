import { z } from 'zod';
import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { normalizarLogin } from './login';
import { CODIGOS_PERFIL } from './perfis';

// Mensagens do cadastro de usuários (UC02.12, UC02.13). O EP085 não fixa o texto: [PROVISÓRIAS],
// exceto "Login já cadastrado" (plano do P5).
export const MENSAGENS_USUARIO = {
  NOME: 'Informe o nome completo (até 120 caracteres, sem < > , ; " nem quebras de linha)',
  EMAIL: 'E-mail inválido',
  LOGIN: 'Login fora do formato: letras minúsculas sem acento, dígitos, ponto, hífen e sublinhado; de 3 a 60 caracteres, começando por letra ou dígito',
  LOGIN_DUPLICADO: 'Login já cadastrado',
  PERFIL_OBRIGATORIO: 'Selecione pelo menos um perfil de acesso',
  PERFIL_INVALIDO: 'Perfil de acesso inexistente ou inativo',
  UNIDADE_INVALIDA: 'Termo de Parceria inexistente ou inativo',
  CC_OBRIGATORIO: 'Informe o centro de custo de escopo do Gestor de Diretoria',
  CC_SEM_PERFIL: 'O centro de custo de escopo só se aplica ao perfil Gestor de Diretoria',
  ULTIMO_ADMINISTRADOR: 'O sistema precisa de pelo menos um Administrador ativo. Associe outro Administrador antes.',
  ALTERADO: 'Este registro foi alterado por outro usuário. Recarregue a tela.',
  DESBLOQUEIO_INATIVO: 'Só é possível desbloquear um usuário ativo e bloqueado',
  RESET_INATIVO: 'Só é possível gerar nova senha para um usuário ativo',
} as const;

// Mesmos limites do destinatário do e-mail da senha (contrato C4): o cadastro não pode falhar no
// envio. E-mail num conjunto seguro de caracteres, com domínio de dois rótulos ou mais.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const NOME_PROIBIDO = /[<>,;"\p{Cc}‎‏‪-‮⁦-⁩]/u;

// Entrada do formulário: sem nenhuma chave de senha (RN0059, o Administrador nunca digita senha).
export const esquemaUsuario = z.object({
  nome: z
    .string()
    .trim()
    .min(1, MENSAGENS_USUARIO.NOME)
    .max(120, MENSAGENS_USUARIO.NOME)
    .refine((n) => !NOME_PROIBIDO.test(n), MENSAGENS_USUARIO.NOME),
  email: z.string().trim().max(254, MENSAGENS_USUARIO.EMAIL).regex(EMAIL, MENSAGENS_USUARIO.EMAIL),
  login: z.string().trim(),
  ativo: z.boolean(),
  perfis: z
    .array(z.enum(CODIGOS_PERFIL, { error: MENSAGENS_USUARIO.PERFIL_INVALIDO }))
    .min(1, MENSAGENS_USUARIO.PERFIL_OBRIGATORIO)
    .transform((p) => [...new Set(p)]),
  unidades: z.array(z.uuid(MENSAGENS_USUARIO.UNIDADE_INVALIDA)).transform((u) => [...new Set(u)]),
  ccEscopo: z
    .string()
    .trim()
    .max(60, MENSAGENS_USUARIO.CC_OBRIGATORIO)
    .nullable()
    .transform((c) => (c ? c : null)),
});

export type EntradaUsuario = z.input<typeof esquemaUsuario>;
export type UsuarioValidado = z.output<typeof esquemaUsuario> & { loginNormalizado: string };

export function validarUsuario(entrada: unknown): Resultado<UsuarioValidado> {
  const r = esquemaUsuario.safeParse(entrada);
  if (!r.success) {
    const erros: ErroCampo[] = [];
    for (const issue of r.error.issues) {
      const campo = String(issue.path[0] ?? '_');
      if (!erros.some((e) => e.campo === campo)) erros.push({ campo, mensagem: issue.message });
    }
    return falha(erros);
  }
  const dados = r.data;
  const loginNormalizado = normalizarLogin(dados.login);
  if (!loginNormalizado) return falha([{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN }]);
  // C25 (R8 do plano): o CC de escopo existe só com o perfil Gestor de Diretoria, e é obrigatório nele.
  const gestor = dados.perfis.includes('GESTOR_DIRETORIA');
  if (gestor && !dados.ccEscopo) return falha([{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_OBRIGATORIO }]);
  if (!gestor && dados.ccEscopo) return falha([{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_SEM_PERFIL }]);
  return ok({ ...dados, loginNormalizado });
}

type EstadoAdministrador = { ativo: boolean; perfis: readonly string[] };

// O sistema não pode ficar sem Administrador ativo e desbloqueado (último administrador). Só
// importa quem era um deles; `outrosAtivos` conta os demais, lidos sob a trava de administradores.
export function perdeUltimoAdministrador(
  antes: EstadoAdministrador & { bloqueado: boolean },
  depois: EstadoAdministrador,
  outrosAtivos: number,
): boolean {
  const eraAdministrador = antes.ativo && !antes.bloqueado && antes.perfis.includes('ADMINISTRADOR');
  const continua = depois.ativo && depois.perfis.includes('ADMINISTRADOR');
  return eraAdministrador && !continua && outrosAtivos === 0;
}
