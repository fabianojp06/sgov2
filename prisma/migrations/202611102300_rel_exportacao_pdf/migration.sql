-- US-024: a exportação em segundo plano também gera PDF.
ALTER TABLE "exportacao_pedido" DROP CONSTRAINT "exportacao_pedido_formato_check";
ALTER TABLE "exportacao_pedido" ADD CONSTRAINT "exportacao_pedido_formato_check" CHECK ("formato" IN ('xlsx', 'csv', 'pdf'));
