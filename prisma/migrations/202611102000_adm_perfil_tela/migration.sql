-- Perfis e permissões pela tela (US-037; plano do P13, D-P13-9 e ajuste A5 da revisão). SQL à mão,
-- conferido pelos testes de integração (que aplicam as migrations num banco descartável). Antes do
-- deploy em hml/prod: conferir com o papel de leitura que nenhum nome se repete sem diferenciar
-- maiúsculas nem fica fora dos CHECKs; se houver, a migration falha inteira e nada muda.

-- 1) Concorrência otimista na alteração e na exclusão (US-011). Começa em 0, como no usuário.
ALTER TABLE "perfil" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0;

-- 2) Nome aparado, de 1 a 100 caracteres (RN0069, UC02.25); descrição até 500 [PROVISÓRIO]; código no
--    formato dos padrões e dos gerados pela tela (P_ + 12 hexadecimais, D-P13-2).
ALTER TABLE "perfil"
  ADD CONSTRAINT "perfil_versao_check" CHECK ("versao" >= 0),
  ADD CONSTRAINT "perfil_nome_check" CHECK ("nome" = btrim("nome") AND char_length("nome") BETWEEN 1 AND 100),
  ADD CONSTRAINT "perfil_descricao_check" CHECK (char_length("descricao") <= 500),
  ADD CONSTRAINT "perfil_codigo_check" CHECK ("codigo" ~ '^[A-Z][A-Z0-9_]{1,39}$');

-- 3) Nome único sem diferenciar maiúsculas (RN0068): decide a corrida de dois cadastros (P2002).
CREATE UNIQUE INDEX "perfil_nome_ci_key" ON "perfil" (lower("nome"));

-- 4) Só perfil criado pela tela (código P_…) pode ser apagado (ajuste A5): os padrões são a chave da
--    seed, do break-glass e do C25 (D-P13-3). Defesa em profundidade: o caso de uso já recusa antes.
CREATE FUNCTION "perfil_exclusao_so_da_tela"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF left(OLD."codigo", 2) <> 'P_' THEN
    RAISE EXCEPTION 'O perfil padrão % não pode ser excluído', OLD."codigo" USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "perfil_exclusao_so_da_tela" BEFORE DELETE ON "perfil"
  FOR EACH ROW EXECUTE FUNCTION "perfil_exclusao_so_da_tela"();

-- 5) Privilégios (spec §11.5): a aplicação passa a mudar a versão e a apagar perfil (só o da tela e
--    sem usuários, D-P13-10); o código continua sem UPDATE, e o sgo_sync continua sem acesso.
GRANT UPDATE ("versao") ON "perfil" TO sgo_app;
GRANT DELETE ON "perfil" TO sgo_app;
