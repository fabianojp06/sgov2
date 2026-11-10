import { z } from 'zod';
import { falha, MENSAGEM_CONFLITO, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { chaveExcecao, MENSAGENS_EXCECAO } from './excecao-usuario';
import { normalizarLogin } from './login';
import { CODIGOS_PERFIL } from './perfis';

// Mensagens do cadastro de usuários (UC02.12, UC02.13). O EP085 não fixa o texto: todas são
// [PROVISÓRIAS]; as que o plano do P5 já lista (Global Constraints) usam o texto de lá.
export const MENSAGENS_USUARIO = {
  NOME: 'Informe o nome completo (até 120 caracteres, sem < > , ; " nem quebras de linha)',
  EMAIL: 'E-mail inválido',
  LOGIN: 'Login fora do formato: letras minúsculas sem acento, dígitos, ponto, hífen e sublinhado; de 3 a 60 caracteres, começando por letra ou dígito',
  LOGIN_DUPLICADO: 'Login já cadastrado',
  PERFIL_OBRIGATORIO: 'Selecione pelo menos um perfil de acesso',
  PERFIL_INVALIDO: 'Perfil de acesso inexistente ou inativo',
  UNIDADE_INVALIDA: 'Termo de Parceria inexistente ou inativo',
  CC_OBRIGATORIO: 'Informe o centro de custo de escopo do Gestor de Diretoria',
  CC_INVALIDO: 'Centro de custo de escopo inválido (até 60 caracteres, sem caracteres de controle)',
  CC_FORA_ESTRUTURA: 'CC de escopo sem centro de custo analítico ativo.',
  CC_SEM_PERFIL: 'O centro de custo de escopo só se aplica ao perfil Gestor de Diretoria',
  ULTIMO_ADMINISTRADOR: 'O sistema precisa de pelo menos um Administrador ativo',
  ALTERADO: MENSAGEM_CONFLITO,
  DESBLOQUEIO_INATIVO: 'O desbloqueio só é possível para usuário bloqueado e ativo',
  RESET_INATIVO: 'Só é possível gerar nova senha para um usuário ativo',
  RESET_BLOQUEADO: 'Desbloqueie o usuário antes de gerar nova senha',
  RESET_PROPRIO: 'Para trocar a sua própria senha, use Alterar senha',
  INEXISTENTE: 'Usuário não encontrado',
  UNIDADES_DEMAIS: 'Selecione no máximo 200 Termos de Parceria',
} as const;

// Limites do destinatário do e-mail da senha (contrato C4), para o cadastro e o reset não falharem
// no envio: e-mail num conjunto seguro de caracteres, com domínio de dois rótulos ou mais; nome sem
// < > , ; " nem caracteres de controle ou de formatação (C0, C1, bidi, largura zero, separadores de
// linha e parágrafo), um conjunto que contém o do C4. Os invisíveis também disfarçariam o nome no
// Histórico.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const CONTROLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const NOME_PROIBIDO = /[<>,;"]/;

const texto = (max: number, mensagem: string) =>
  z
    .string()
    .trim()
    .transform((t) => t.normalize('NFC'))
    .pipe(
      z
        .string()
        .max(max, mensagem)
        .refine((t) => !CONTROLE.test(t), mensagem),
    );

// Entrada do formulário: sem nenhuma chave de senha (RN0059, o Administrador nunca digita senha).
export const esquemaUsuario = z.object({
  nome: texto(120, MENSAGENS_USUARIO.NOME).pipe(
    z
      .string()
      .min(1, MENSAGENS_USUARIO.NOME)
      .refine((n) => !NOME_PROIBIDO.test(n), MENSAGENS_USUARIO.NOME),
  ),
  email: z.string().trim().max(254, MENSAGENS_USUARIO.EMAIL).regex(EMAIL, MENSAGENS_USUARIO.EMAIL),
  login: z.string().trim(),
  ativo: z.boolean(),
  perfis: z
    .array(z.enum(CODIGOS_PERFIL, { error: MENSAGENS_USUARIO.PERFIL_INVALIDO }))
    .min(1, MENSAGENS_USUARIO.PERFIL_OBRIGATORIO)
    .transform((p) => [...new Set(p)]),
  unidades: z
    .array(z.uuid(MENSAGENS_USUARIO.UNIDADE_INVALIDA))
    .max(200, MENSAGENS_USUARIO.UNIDADES_DEMAIS)
    .transform((u) => [...new Set(u)]),
  // Exceções de permissão (US-039, REQ0080): funcionalidades de um perfil retiradas do usuário. As
  // regras que dependem do banco (perfil associado, funcionalidade do perfil, REQ0081) ficam no caso
  // de uso (aplicarExcecoes). Ausente: nenhuma exceção.
  excecoes: z
    .array(
      z.object({
        perfil: z.enum(CODIGOS_PERFIL, { error: MENSAGENS_EXCECAO.PERFIL_NAO_ASSOCIADO }),
        funcionalidade: z.string().trim().min(1, MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL).max(100, MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL),
      }),
    )
    .max(1000, MENSAGENS_EXCECAO.DEMAIS)
    .default([])
    .transform((lista) => [...new Map(lista.map((e) => [chaveExcecao(e), e])).values()]),
  // Classificação do CC raiz, validada contra o cadastro de CC no P6 (R8 do plano).
  ccEscopo: texto(60, MENSAGENS_USUARIO.CC_INVALIDO)
    .nullable()
    .transform((c) => (c ? c : null)),
});

// Campo ausente ou de tipo errado também recebe mensagem em português (o padrão do Zod é inglês).
const PORTUGUES = z.locales.ptBR().localeError;

export type EntradaUsuario = z.input<typeof esquemaUsuario>;
export type UsuarioValidado = z.output<typeof esquemaUsuario> & { loginNormalizado: string };

export function validarUsuario(entrada: unknown): Resultado<UsuarioValidado> {
  const r = esquemaUsuario.safeParse(entrada, { error: PORTUGUES });
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
