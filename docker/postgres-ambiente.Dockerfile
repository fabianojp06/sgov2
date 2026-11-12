# Banco de hml e prod com o pgBackRest (US-015; plano do P3, Tarefa 7). A base é a mesma pgvector do
# CI, fixada pelo digest. Publicada pelo imagem.yml como ghcr.io/fabianojp06/sgov2-postgres e usada
# pelo serviço db do Easypanel no lugar da pgvector/pgvector:pg16.
FROM pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a

# O repositório PGDG já vem configurado na imagem oficial do Postgres.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 750 /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest

COPY docker/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY docker/postgres/entrypoint-backup.sh /usr/local/bin/entrypoint-backup.sh
# O pacote cria /etc/pgbackrest restrito ao root; o pgbackrest roda como postgres. A configuração não
# tem segredo (eles vêm das variáveis do Easypanel).
RUN chmod 755 /etc/pgbackrest /usr/local/bin/entrypoint-backup.sh \
 && chown root:postgres /etc/pgbackrest/pgbackrest.conf && chmod 640 /etc/pgbackrest/pgbackrest.conf

ENTRYPOINT ["/usr/local/bin/entrypoint-backup.sh"]
CMD ["postgres"]
