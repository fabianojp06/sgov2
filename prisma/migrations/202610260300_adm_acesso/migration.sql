-- CreateEnum
CREATE TYPE "NivelLog" AS ENUM ('SIMPLES', 'AVANCADO');

-- CreateTable
CREATE TABLE "modulo" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "modulo_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "funcionalidade" (
    "codigo" TEXT NOT NULL,
    "modulo_codigo" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "ajuda" TEXT,
    "acoes" TEXT[],
    "nivel_log" "NivelLog" NOT NULL DEFAULT 'SIMPLES',
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "funcionalidade_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "perfil" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfil_permissao" (
    "perfil_id" UUID NOT NULL,
    "funcionalidade_codigo" TEXT NOT NULL,
    "acao" TEXT NOT NULL,

    CONSTRAINT "perfil_permissao_pkey" PRIMARY KEY ("perfil_id","funcionalidade_codigo","acao")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "login_normalizado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "senha_hash" TEXT NOT NULL,
    "troca_senha_obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "senha_expira_em" TIMESTAMPTZ(6),
    "cc_escopo" TEXT,
    "acesso_versao" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_perfil" (
    "usuario_id" UUID NOT NULL,
    "perfil_id" UUID NOT NULL,

    CONSTRAINT "usuario_perfil_pkey" PRIMARY KEY ("usuario_id","perfil_id")
);

-- CreateTable
CREATE TABLE "configuracao_acesso" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "limite_tentativas" INTEGER NOT NULL DEFAULT 5,
    "limiar_alerta" INTEGER NOT NULL DEFAULT 3,
    "inatividade_min" INTEGER NOT NULL DEFAULT 30,
    "sessao_maxima_horas" INTEGER NOT NULL DEFAULT 12,
    "senha_temporaria_horas" INTEGER NOT NULL DEFAULT 24,
    "senha_minimo" INTEGER NOT NULL DEFAULT 10,
    "senha_exige_letra" BOOLEAN NOT NULL DEFAULT true,
    "senha_exige_digito" BOOLEAN NOT NULL DEFAULT true,
    "manutencao" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "configuracao_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perfil_codigo_key" ON "perfil"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_normalizado_key" ON "usuario"("login_normalizado");

-- AddForeignKey
ALTER TABLE "funcionalidade" ADD CONSTRAINT "funcionalidade_modulo_codigo_fkey" FOREIGN KEY ("modulo_codigo") REFERENCES "modulo"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_funcionalidade_codigo_fkey" FOREIGN KEY ("funcionalidade_codigo") REFERENCES "funcionalidade"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_perfil" ADD CONSTRAINT "usuario_perfil_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "permissao_padrao_aplicada" (
    "perfil_codigo" TEXT NOT NULL,
    "funcionalidade_codigo" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "aplicada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "permissao_padrao_aplicada_pkey" PRIMARY KEY ("perfil_codigo","funcionalidade_codigo","acao")
);

-- Regras que o schema do Prisma não expressa (plano do P5, Task 1).
-- Ações do C5 (Acao em @/shared/authz) e linha única da configuração de acesso.
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_acao_check"
  CHECK ("acao" IN ('consultar', 'incluir', 'alterar', 'excluir', 'exportar', 'imprimir', 'aprovar', 'executar'));
ALTER TABLE "configuracao_acesso" ADD CONSTRAINT "configuracao_acesso_linha_unica_check" CHECK ("id" = 1);
-- Faixas dos parâmetros: um valor absurdo desligaria o bloqueio ou a sessão, ou travaria a geração
-- de senha (o teto de 128 é o SENHA_MAXIMO da política).
ALTER TABLE "configuracao_acesso" ADD CONSTRAINT "configuracao_acesso_faixas_check" CHECK (
  "limite_tentativas" BETWEEN 1 AND 100
  AND "limiar_alerta" BETWEEN 1 AND "limite_tentativas" - 1
  AND "inatividade_min" BETWEEN 1 AND 1440
  AND "sessao_maxima_horas" BETWEEN 1 AND 168
  AND "senha_temporaria_horas" BETWEEN 1 AND 720
  AND "senha_minimo" BETWEEN 8 AND 128
);
ALTER TABLE "funcionalidade" ADD CONSTRAINT "funcionalidade_acoes_check"
  CHECK ("acoes" <@ ARRAY['consultar', 'incluir', 'alterar', 'excluir', 'exportar', 'imprimir', 'aprovar', 'executar']::text[]);

-- Privilégios (spec §5 e §11.5): o sincronismo do ERP não toca em identidade; a aplicação não
-- apaga cadastros (inativação por status), não cria nem apaga a configuração e não altera o login
-- depois do cadastro (RN0066).
REVOKE ALL ON "modulo", "funcionalidade", "perfil", "perfil_permissao", "usuario", "usuario_perfil", "configuracao_acesso",
  "permissao_padrao_aplicada" FROM sgo_sync;
-- Só a seed (migrator) registra os padrões aplicados.
REVOKE ALL ON "permissao_padrao_aplicada" FROM sgo_app;
REVOKE DELETE ON "modulo", "funcionalidade", "perfil", "usuario" FROM sgo_app;
-- Módulos e funcionalidades vêm só da seed (C14, REQ0055): a aplicação só ativa e desativa.
REVOKE INSERT, UPDATE ON "modulo", "funcionalidade" FROM sgo_app;
GRANT UPDATE ("ativo") ON "modulo", "funcionalidade" TO sgo_app;
-- O código do perfil é a chave da seed e do break-glass: não é renomeado.
REVOKE UPDATE ON "perfil" FROM sgo_app;
GRANT UPDATE ("nome", "descricao", "ativo") ON "perfil" TO sgo_app;
REVOKE INSERT, DELETE ON "configuracao_acesso" FROM sgo_app;
REVOKE UPDATE ON "usuario" FROM sgo_app;
GRANT UPDATE ("nome", "email", "ativo", "bloqueado", "tentativas_falhas", "senha_hash", "troca_senha_obrigatoria",
  "senha_expira_em", "cc_escopo", "acesso_versao", "versao", "atualizado_em") ON "usuario" TO sgo_app;
