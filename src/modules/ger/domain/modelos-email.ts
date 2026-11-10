import { ErroDominio } from '@/shared/kernel';
import { temCaractereDeControle } from './texto';

// Contrato C4: modelos de e-mail e os dados de cada um. Novo modelo = nova chave em
// DadosModeloEmail e em SENSIBILIDADE_MODELO (sem a classificação, não compila); acrescentar
// chave não quebra os consumidores. O texto dos modelos não leva nome de instituição fixo:
// o nome vem de instituicao.nome_exibicao (spec §6.7).
export type DadosModeloEmail = {
  'usuario.senha_inicial': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  'usuario.senha_redefinida': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  // Recuperação pela tela de login (US-029, frente A).
  'usuario.recuperacao_senha': { nome: string; login: string; senhaTemporaria: string; urlAcesso: string };
  // Aviso de exportação em segundo plano concluída (US-024, frente B): pronta ou com falha.
  'exportacao.concluida': { nome: string; titulo: string; resultado: 'pronta' | 'falhou'; urlAcesso: string };
  // Alerta ao Administrador de tentativas de acesso malsucedidas (US-027, REQ0040, pedido da frente A
  // na #49): no limiar ou no bloqueio. dataHora já vem formatada (pt-BR, America/Sao_Paulo); sem IP,
  // que fica no Histórico.
  'usuario.alerta_tentativas': {
    nomeAdministrador: string;
    nomeUsuario: string;
    login: string;
    tentativas: number;
    bloqueado: boolean;
    dataHora: string;
    urlAcesso: string;
  };
};
export type ModeloEmail = keyof DadosModeloEmail;

// Modelo sensível = os dados levam senha, token ou equivalente. O publicarOutbox (US-010, #181,
// src/shared/filas/outbox.ts) já esvazia os dados da linha ao publicar; para esses modelos, o
// trabalhador de e-mail (US-025) apaga os dados do job depois do envio, na falha definitiva e na
// expiração (VALIDADE_MENSAGEM_SENSIVEL_MS). A linha de outbox abandonada (MAX_TENTATIVAS_OUTBOX)
// só acontece com fila desconhecida ou chave inválida, o que não ocorre com email.enviar (plano do
// P4, R23).
export const SENSIBILIDADE_MODELO = {
  'usuario.senha_inicial': true,
  'usuario.senha_redefinida': true,
  'usuario.recuperacao_senha': true,
  'exportacao.concluida': false,
  'usuario.alerta_tentativas': false,
} as const satisfies Record<ModeloEmail, boolean>;

export const MODELOS_SENSIVEIS: ReadonlySet<ModeloEmail> = new Set(
  (Object.keys(SENSIBILIDADE_MODELO) as ModeloEmail[]).filter((m) => SENSIBILIDADE_MODELO[m]),
);

export type Destinatario = { email: string; nome?: string };

// E-mail num conjunto seguro de caracteres (sem espaço, quebra de linha, vírgula, ponto e vírgula,
// <, >, aspas nem NUL), com domínio de pelo menos dois rótulos, até 254 caracteres (RFC 5321).
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// Nome de exibição sem caracteres de controle nem os que permitiriam montar outro endereço.
const NOME_PROIBIDO = /[<>,;"]/;

// Mascara o endereço para os detalhes do erro, o log e o Histórico.
export const mascararEmail = (email: string) => `${email.slice(0, 2)}***(${email.length})`;

export function validarDestinatario(destinatario: Destinatario): void {
  const { email, nome } = destinatario;
  const emailInvalido = email.length > 254 || !EMAIL.test(email);
  const nomeInvalido = nome !== undefined && (NOME_PROIBIDO.test(nome) || temCaractereDeControle(nome));
  if (emailInvalido || nomeInvalido) {
    throw new ErroDominio('email.destinatario_invalido', 'Destinatário de e-mail inválido.', { email: mascararEmail(email) });
  }
}

// Versão vigente de cada modelo (plano do P4, R8). As versões publicadas são imutáveis: mudar o
// texto exige criar a v<n+1> em domain/modelos/ e apontar para ela aqui. A mensagem guarda a
// versão, para a nova tentativa renderizar igual.
export const VERSAO_ATUAL = {
  'usuario.senha_inicial': 1,
  'usuario.senha_redefinida': 1,
  'usuario.recuperacao_senha': 1,
  'exportacao.concluida': 1,
  'usuario.alerta_tentativas': 1,
} as const satisfies Record<ModeloEmail, number>;

// Os campos de cada modelo: a mensagem leva só estes, nunca chaves a mais do objeto recebido.
const CAMPOS_MODELO = {
  'usuario.senha_inicial': ['nome', 'login', 'senhaTemporaria', 'urlAcesso'],
  'usuario.senha_redefinida': ['nome', 'login', 'senhaTemporaria', 'urlAcesso'],
  'usuario.recuperacao_senha': ['nome', 'login', 'senhaTemporaria', 'urlAcesso'],
  'exportacao.concluida': ['nome', 'titulo', 'resultado', 'urlAcesso'],
  'usuario.alerta_tentativas': ['nomeAdministrador', 'nomeUsuario', 'login', 'tentativas', 'bloqueado', 'dataHora', 'urlAcesso'],
} as const satisfies { [M in ModeloEmail]: readonly (keyof DadosModeloEmail[M])[] };

/** Copia só os campos do modelo (dados já validados por validarDadosModelo). */
export function dadosDoModelo<M extends ModeloEmail>(modelo: M, dados: unknown): DadosModeloEmail[M] {
  const d = dados as Record<string, unknown>;
  return Object.fromEntries(CAMPOS_MODELO[modelo].map((c) => [c, d[c]])) as DadosModeloEmail[M];
}

// O link de cada modelo: exatamente a URL pública mais este caminho.
const CAMINHO_LINK: Record<ModeloEmail, string> = {
  'usuario.senha_inicial': '/login',
  'usuario.senha_redefinida': '/login',
  'usuario.recuperacao_senha': '/login',
  'exportacao.concluida': '/rel/exportacoes',
  'usuario.alerta_tentativas': '/adm/usuarios',
};

// O que vai ao outbox e ao job (payload de email.enviar).
export type MensagemEmail = {
  [M in ModeloEmail]: {
    modelo: M;
    versao: number;
    destinatario: Destinatario;
    dados: DadosModeloEmail[M];
    criadoEm: string; // ISO 8601, do servidor
  };
}[ModeloEmail];

// Mensagem sensível com mais tempo que isto não é enviada (a senha temporária vale 24 h, C21).
export const VALIDADE_MENSAGEM_SENSIVEL_MS = 24 * 60 * 60 * 1000;

export type EmailRenderizado = { assunto: string; texto: string; html: string };

const TAMANHO_MAXIMO = { nome: 120, login: 100, senhaTemporaria: 128, titulo: 120, nomeAdministrador: 120, nomeUsuario: 120, dataHora: 40 } as const;
// Teto de sanidade do número de tentativas no alerta (o limiar real vem da configuração do aut).
const MAXIMO_TENTATIVAS_ALERTA = 1000;

function invalido(campo: string): never {
  throw new ErroDominio('email.dados_invalidos', 'Dados do e-mail inválidos.', { campo });
}

function textoCurto(dados: Record<string, unknown>, campo: keyof typeof TAMANHO_MAXIMO): void {
  const v = dados[campo];
  if (typeof v !== 'string' || v.trim() === '' || v.length > TAMANHO_MAXIMO[campo] || temCaractereDeControle(v)) {
    invalido(campo);
  }
}

/**
 * Valida os dados do modelo antes do outbox e de novo no trabalhador, antes de renderizar.
 * O link é exatamente a URL pública mais o caminho do modelo (`/login` nos de senha): sem query,
 * fragmento, credencial nem outra origem, para o e-mail não levar a senha a outro endereço nem
 * carregar dado na URL.
 * O detalhe do erro tem só o nome do campo, nunca o valor.
 * @throws ErroDominio('email.modelo_desconhecido') | ErroDominio('email.dados_invalidos')
 */
export function validarDadosModelo(modelo: ModeloEmail, dados: unknown, urlPublica: string): void {
  if (!Object.hasOwn(SENSIBILIDADE_MODELO, modelo)) {
    throw new ErroDominio('email.modelo_desconhecido', 'Modelo de e-mail desconhecido.', { modelo: String(modelo) });
  }
  if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) invalido('dados');
  const d = dados as Record<string, unknown>;
  if (modelo === 'exportacao.concluida') {
    textoCurto(d, 'nome');
    textoCurto(d, 'titulo');
    if (d.resultado !== 'pronta' && d.resultado !== 'falhou') invalido('resultado');
  } else if (modelo === 'usuario.alerta_tentativas') {
    textoCurto(d, 'nomeAdministrador');
    textoCurto(d, 'nomeUsuario');
    textoCurto(d, 'login');
    const t = d.tentativas;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > MAXIMO_TENTATIVAS_ALERTA) invalido('tentativas');
    if (typeof d.bloqueado !== 'boolean') invalido('bloqueado');
    textoCurto(d, 'dataHora');
  } else {
    textoCurto(d, 'nome');
    textoCurto(d, 'login');
    textoCurto(d, 'senhaTemporaria');
  }
  if (d.urlAcesso !== `${urlPublica}${CAMINHO_LINK[modelo]}`) invalido('urlAcesso');
}
