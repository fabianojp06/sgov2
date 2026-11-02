-- Orçamento da Administração Central (UC04.17, spec §6.6; plano do P6, Task 1).
-- Parte gerada pelo Prisma (prisma migrate diff --from-schema … --to-schema prisma/schema, offline).
-- CreateTable
CREATE TABLE "orc_exercicio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ano" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "teto_manual" DECIMAL(15,2),
    "teto_justificativa" TEXT,
    "versao_premissas" INTEGER,
    "enviado_por" UUID,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "oficializado_em" TIMESTAMPTZ(6),

    CONSTRAINT "orc_exercicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_posicao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "cc" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "salario_mensal" DECIMAL(15,2) NOT NULL,
    "mes_inicio" INTEGER NOT NULL,
    "mes_saida" INTEGER NOT NULL,
    "observacao" TEXT,
    "origem" TEXT NOT NULL,
    "importacao_id" UUID,

    CONSTRAINT "orc_posicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_pacote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "cc" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL,
    "prioridade" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valor_unitario" DECIMAL(15,2) NOT NULL,
    "corrigir_ipca" BOOLEAN NOT NULL,
    "distribuicao" TEXT NOT NULL,
    "mes_ocorrencia" INTEGER,
    "origem" TEXT NOT NULL,
    "importacao_id" UUID,

    CONSTRAINT "orc_pacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_linha" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "cc" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "componente" TEXT,
    "posicao_id" UUID,
    "pacote_id" UUID,
    "meses" DECIMAL(15,2)[],
    "total" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "orc_linha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_receita" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "tp" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL_TRANSICAO',
    "meses" DECIMAL(15,2)[],
    "total" DECIMAL(15,2) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "importacao_id" UUID,

    CONSTRAINT "orc_receita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "arquivo_nome" TEXT NOT NULL,
    "arquivo_sha256" CHAR(64) NOT NULL,
    "resumo" JSONB NOT NULL,
    "criado_por" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_tramite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exercicio_id" UUID NOT NULL,
    "de" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "justificativa" TEXT,
    "em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "orc_tramite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orc_snapshot" (
    "exercicio_id" UUID NOT NULL,
    "gerado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "sha256" CHAR(64) NOT NULL,
    "conteudo" JSONB NOT NULL,

    CONSTRAINT "orc_snapshot_pkey" PRIMARY KEY ("exercicio_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orc_exercicio_ano_key" ON "orc_exercicio"("ano");

-- CreateIndex
CREATE INDEX "orc_posicao_exercicio_id_cc_idx" ON "orc_posicao"("exercicio_id", "cc");

-- CreateIndex
CREATE INDEX "orc_pacote_exercicio_id_cc_idx" ON "orc_pacote"("exercicio_id", "cc");

-- CreateIndex
CREATE INDEX "orc_linha_exercicio_id_cc_idx" ON "orc_linha"("exercicio_id", "cc");

-- CreateIndex
CREATE INDEX "orc_linha_posicao_id_idx" ON "orc_linha"("posicao_id");

-- CreateIndex
CREATE INDEX "orc_linha_pacote_id_idx" ON "orc_linha"("pacote_id");

-- CreateIndex
CREATE UNIQUE INDEX "orc_receita_exercicio_id_tp_key" ON "orc_receita"("exercicio_id", "tp");

-- CreateIndex
CREATE INDEX "orc_tramite_exercicio_id_em_idx" ON "orc_tramite"("exercicio_id", "em");

-- AddForeignKey
ALTER TABLE "orc_posicao" ADD CONSTRAINT "orc_posicao_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_posicao" ADD CONSTRAINT "orc_posicao_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "orc_importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_pacote" ADD CONSTRAINT "orc_pacote_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_pacote" ADD CONSTRAINT "orc_pacote_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "orc_importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_linha" ADD CONSTRAINT "orc_linha_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_linha" ADD CONSTRAINT "orc_linha_posicao_id_fkey" FOREIGN KEY ("posicao_id") REFERENCES "orc_posicao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_linha" ADD CONSTRAINT "orc_linha_pacote_id_fkey" FOREIGN KEY ("pacote_id") REFERENCES "orc_pacote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_receita" ADD CONSTRAINT "orc_receita_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_receita" ADD CONSTRAINT "orc_receita_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "orc_importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_importacao" ADD CONSTRAINT "orc_importacao_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_tramite" ADD CONSTRAINT "orc_tramite_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orc_snapshot" ADD CONSTRAINT "orc_snapshot_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "orc_exercicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Parte à mão: domínios, ciclo de vida, imutabilidade e privilégios (plano do P6, Task 1).
-- As funções usam search_path = public, pg_temp: uma tabela temporária não sombreia as do orc.

ALTER TABLE "orc_exercicio"
  ADD CONSTRAINT "orc_exercicio_ano_check" CHECK ("ano" BETWEEN 2000 AND 2099),
  ADD CONSTRAINT "orc_exercicio_situacao_check" CHECK ("situacao" IN ('RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO')),
  ADD CONSTRAINT "orc_exercicio_teto_check" CHECK ("teto_manual" IS NULL OR "teto_manual" > 0),
  ADD CONSTRAINT "orc_exercicio_versao_check" CHECK ("versao" >= 0),
  ADD CONSTRAINT "orc_exercicio_oficializado_check" CHECK (("situacao" = 'OFICIALIZADO') = ("oficializado_em" IS NOT NULL));

-- Limites alinhados ao C2 (QUANTIDADE_MAXIMA 9.999; salário < 1.000.000,00) e à validação da Task 4a.
ALTER TABLE "orc_posicao"
  ADD CONSTRAINT "orc_posicao_cargo_check" CHECK (char_length(btrim("cargo")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "orc_posicao_quantidade_check" CHECK ("quantidade" BETWEEN 1 AND 9999),
  ADD CONSTRAINT "orc_posicao_salario_check" CHECK ("salario_mensal" > 0 AND "salario_mensal" < 1000000),
  ADD CONSTRAINT "orc_posicao_meses_check" CHECK (1 <= "mes_inicio" AND "mes_inicio" <= "mes_saida" AND "mes_saida" <= 12),
  ADD CONSTRAINT "orc_posicao_observacao_check" CHECK ("observacao" IS NULL OR char_length("observacao") <= 500),
  ADD CONSTRAINT "orc_posicao_origem_check" CHECK ("origem" IN ('IMPORTACAO', 'COPIA'));

ALTER TABLE "orc_pacote"
  ADD CONSTRAINT "orc_pacote_justificativa_check" CHECK (char_length(btrim("justificativa")) BETWEEN 10 AND 1000),
  ADD CONSTRAINT "orc_pacote_prioridade_check" CHECK ("prioridade" IN ('ESSENCIAL', 'IMPORTANTE', 'DESEJAVEL')),
  ADD CONSTRAINT "orc_pacote_quantidade_check" CHECK ("quantidade" BETWEEN 1 AND 9999),
  ADD CONSTRAINT "orc_pacote_valor_check" CHECK ("valor_unitario" > 0),
  ADD CONSTRAINT "orc_pacote_distribuicao_check" CHECK ("distribuicao" IN ('MENSAL', 'PONTUAL')),
  ADD CONSTRAINT "orc_pacote_mes_check" CHECK (
    ("distribuicao" = 'PONTUAL') = ("mes_ocorrencia" IS NOT NULL)
    AND ("mes_ocorrencia" IS NULL OR "mes_ocorrencia" BETWEEN 1 AND 12)),
  ADD CONSTRAINT "orc_pacote_origem_check" CHECK ("origem" IN ('IMPORTACAO', 'COPIA'));

-- Séries de 12 meses sem NULL (o NOT NULL do array fica no CHECK para o Prisma não acusar diferença).
ALTER TABLE "orc_linha"
  ADD CONSTRAINT "orc_linha_meses_check" CHECK (
    "meses" IS NOT NULL AND cardinality("meses") = 12 AND array_position("meses", NULL) IS NULL),
  ADD CONSTRAINT "orc_linha_origem_check" CHECK (
    ("origem" = 'PESSOAL' AND "posicao_id" IS NOT NULL AND "pacote_id" IS NULL AND "componente" IS NOT NULL)
    OR ("origem" = 'BASE_ZERO' AND "pacote_id" IS NOT NULL AND "posicao_id" IS NULL AND "componente" IS NULL));

ALTER TABLE "orc_receita"
  ADD CONSTRAINT "orc_receita_tp_check" CHECK (char_length(btrim("tp")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "orc_receita_descricao_check" CHECK (char_length("descricao") <= 200),
  ADD CONSTRAINT "orc_receita_situacao_check" CHECK ("situacao" IN ('CONFIRMADO', 'PREVISTO')),
  ADD CONSTRAINT "orc_receita_origem_check" CHECK ("origem" IN ('MANUAL_TRANSICAO')),
  ADD CONSTRAINT "orc_receita_meses_check" CHECK (
    "meses" IS NOT NULL AND cardinality("meses") = 12 AND array_position("meses", NULL) IS NULL AND 0 <= ALL ("meses")),
  ADD CONSTRAINT "orc_receita_versao_check" CHECK ("versao" >= 0);

ALTER TABLE "orc_tramite"
  ADD CONSTRAINT "orc_tramite_situacoes_check" CHECK (
    "de" IN ('RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO')
    AND "para" IN ('RASCUNHO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO'));

ALTER TABLE "orc_snapshot" ADD CONSTRAINT "orc_snapshot_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "orc_importacao" ADD CONSTRAINT "orc_importacao_sha256_check" CHECK ("arquivo_sha256" ~ '^[0-9a-f]{64}$');

-- Situação do exercício lida com FOR SHARE: a trava de linha segura a situação até o fim da
-- transação, sem depender só da trava da aplicação.
CREATE FUNCTION orc_situacao_exercicio(p_exercicio uuid) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE s text;
BEGIN
  SELECT situacao INTO s FROM orc_exercicio WHERE id = p_exercicio FOR SHARE;
  RETURN s;
END $$;

-- Lançamentos, linhas, receitas e importações só mudam com o exercício editável (§6.2, RN_ALT_002).
-- No UPDATE, OLD e NEW: mover a linha para outro exercício não escapa da trava.
CREATE FUNCTION orc_exige_editavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND orc_situacao_exercicio(OLD.exercicio_id) IN ('EM_APROVACAO', 'OFICIALIZADO') THEN
    RAISE EXCEPTION 'orc.exercicio_nao_editavel' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND orc_situacao_exercicio(NEW.exercicio_id) IN ('EM_APROVACAO', 'OFICIALIZADO') THEN
    RAISE EXCEPTION 'orc.exercicio_nao_editavel' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER orc_posicao_editavel BEFORE INSERT OR UPDATE OR DELETE ON "orc_posicao"
  FOR EACH ROW EXECUTE FUNCTION orc_exige_editavel();
CREATE TRIGGER orc_pacote_editavel BEFORE INSERT OR UPDATE OR DELETE ON "orc_pacote"
  FOR EACH ROW EXECUTE FUNCTION orc_exige_editavel();
CREATE TRIGGER orc_linha_editavel BEFORE INSERT OR UPDATE OR DELETE ON "orc_linha"
  FOR EACH ROW EXECUTE FUNCTION orc_exige_editavel();
CREATE TRIGGER orc_receita_editavel BEFORE INSERT OR UPDATE OR DELETE ON "orc_receita"
  FOR EACH ROW EXECUTE FUNCTION orc_exige_editavel();
CREATE TRIGGER orc_importacao_editavel BEFORE INSERT ON "orc_importacao"
  FOR EACH ROW EXECUTE FUNCTION orc_exige_editavel();

-- A linha calculada pertence à posição ou ao pacote do mesmo exercício.
CREATE FUNCTION orc_linha_mesmo_exercicio() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.posicao_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM orc_posicao WHERE id = NEW.posicao_id AND exercicio_id = NEW.exercicio_id) THEN
    RAISE EXCEPTION 'orc.linha_de_outro_exercicio' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pacote_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM orc_pacote WHERE id = NEW.pacote_id AND exercicio_id = NEW.exercicio_id) THEN
    RAISE EXCEPTION 'orc.linha_de_outro_exercicio' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_linha_mesmo_exercicio BEFORE INSERT OR UPDATE ON "orc_linha"
  FOR EACH ROW EXECUTE FUNCTION orc_linha_mesmo_exercicio();

-- Ciclo de vida da §6.2: nasce em Rascunho, sem trâmite; só as transições previstas; a versão
-- nunca volta; em Aprovação só mudam a situação, a versão e a data da oficialização (lista do
-- que pode mudar: coluna nova fica travada até entrar na lista); Oficializado não muda mais.
CREATE FUNCTION orc_ciclo_exercicio() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  livres CONSTANT text[] := ARRAY['situacao', 'versao', 'atualizado_em', 'oficializado_em'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.situacao <> 'RASCUNHO' OR NEW.versao <> 0 OR NEW.enviado_por IS NOT NULL THEN
      RAISE EXCEPTION 'orc.transicao_invalida' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.situacao = 'OFICIALIZADO' THEN
    RAISE EXCEPTION 'orc.exercicio_oficializado' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.situacao IS DISTINCT FROM OLD.situacao AND (OLD.situacao, NEW.situacao) NOT IN (
    ('RASCUNHO', 'EM_ELABORACAO'), ('EM_ELABORACAO', 'EM_APROVACAO'),
    ('EM_APROVACAO', 'EM_ELABORACAO'), ('EM_APROVACAO', 'OFICIALIZADO')) THEN
    RAISE EXCEPTION 'orc.transicao_invalida' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.versao < OLD.versao THEN
    RAISE EXCEPTION 'orc.versao_regressiva' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.situacao = 'EM_APROVACAO' AND (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'orc.exercicio_nao_editavel' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_exercicio_ciclo BEFORE INSERT OR UPDATE OR DELETE ON "orc_exercicio"
  FOR EACH ROW EXECUTE FUNCTION orc_ciclo_exercicio();

-- R10: a oficialização grava o snapshot e o trâmite na mesma transação. Conferido no commit.
CREATE FUNCTION orc_oficializacao_completa() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orc_snapshot WHERE exercicio_id = NEW.id)
    OR NOT EXISTS (SELECT 1 FROM orc_tramite WHERE exercicio_id = NEW.id AND para = 'OFICIALIZADO') THEN
    RAISE EXCEPTION 'orc.oficializacao_incompleta' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER orc_oficializacao_completa AFTER UPDATE ON "orc_exercicio"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.situacao = 'OFICIALIZADO' AND OLD.situacao <> 'OFICIALIZADO')
  EXECUTE FUNCTION orc_oficializacao_completa();

-- Trâmite e snapshot só na transação que mudou a situação do exercício: xmin da linha igual à
-- transação atual (a aplicação não usa savepoints nessas transações).
CREATE FUNCTION orc_mudou_nesta_transacao(p_exercicio uuid, OUT situacao text, OUT nesta boolean)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  SELECT e.situacao, e.xmin = pg_current_xact_id()::xid INTO situacao, nesta
  FROM orc_exercicio e WHERE e.id = p_exercicio FOR SHARE;
END $$;

-- O trâmite registra a transição feita agora: o destino é a situação atual, o par está na §6.2 e
-- a oficialização tem um trâmite só.
CREATE FUNCTION orc_tramite_guarda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  r := orc_mudou_nesta_transacao(NEW.exercicio_id);
  IF r.situacao IS DISTINCT FROM NEW.para OR NOT coalesce(r.nesta, false) OR (NEW.de, NEW.para) NOT IN (
    ('RASCUNHO', 'EM_ELABORACAO'), ('EM_ELABORACAO', 'EM_APROVACAO'),
    ('EM_APROVACAO', 'EM_ELABORACAO'), ('EM_APROVACAO', 'OFICIALIZADO')) THEN
    RAISE EXCEPTION 'orc.tramite_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.para = 'OFICIALIZADO'
    AND EXISTS (SELECT 1 FROM orc_tramite WHERE exercicio_id = NEW.exercicio_id AND para = 'OFICIALIZADO') THEN
    RAISE EXCEPTION 'orc.tramite_invalido' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_tramite_guarda BEFORE INSERT ON "orc_tramite"
  FOR EACH ROW EXECUTE FUNCTION orc_tramite_guarda();

-- Snapshot só na transação da oficialização (a chave primária impede o segundo).
CREATE FUNCTION orc_snapshot_unico() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  r := orc_mudou_nesta_transacao(NEW.exercicio_id);
  IF r.situacao IS DISTINCT FROM 'OFICIALIZADO' OR NOT coalesce(r.nesta, false) THEN
    RAISE EXCEPTION 'orc.snapshot_sem_oficializacao' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orc_snapshot_unico BEFORE INSERT ON "orc_snapshot"
  FOR EACH ROW EXECUTE FUNCTION orc_snapshot_unico();

-- Privilégios (B1 do P4, plano do P6): o sincronismo do ERP não toca no orçamento; a aplicação
-- não apaga exercício, não muda o ano e não altera importação, trâmite nem snapshot.
REVOKE ALL ON "orc_exercicio", "orc_posicao", "orc_pacote", "orc_linha", "orc_receita", "orc_importacao",
  "orc_tramite", "orc_snapshot" FROM sgo_sync;
REVOKE DELETE ON "orc_exercicio" FROM sgo_app;
REVOKE UPDATE ON "orc_exercicio" FROM sgo_app;
GRANT UPDATE ("situacao", "teto_manual", "teto_justificativa", "versao_premissas", "enviado_por", "versao",
  "atualizado_em", "oficializado_em") ON "orc_exercicio" TO sgo_app;
REVOKE UPDATE, DELETE ON "orc_importacao", "orc_tramite", "orc_snapshot" FROM sgo_app;
REVOKE EXECUTE ON FUNCTION orc_situacao_exercicio(uuid), orc_mudou_nesta_transacao(uuid), orc_exige_editavel(),
  orc_linha_mesmo_exercicio(), orc_ciclo_exercicio(), orc_oficializacao_completa(), orc_tramite_guarda(),
  orc_snapshot_unico() FROM PUBLIC;
-- As funções de trigger não precisam de EXECUTE para disparar; as consultas da situação são
-- chamadas de dentro delas com o papel de quem escreve.
GRANT EXECUTE ON FUNCTION orc_situacao_exercicio(uuid), orc_mudou_nesta_transacao(uuid) TO sgo_app;
