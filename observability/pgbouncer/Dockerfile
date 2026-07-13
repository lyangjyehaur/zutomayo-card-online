# Custom PgBouncer image with baked-in config.
# Alternative to using the edoburu/pgbouncer image directly with env vars.
# Build:
#   docker build -t zutomayo-pgbouncer ./observability/pgbouncer
# Remember to replace ${PG_USER}/${PG_PASSWORD} in pgbouncer.ini and the
# placeholder in userlist.txt before building, or mount overridden files.
FROM edoburu/pgbouncer:1.22.1-p1
COPY pgbouncer.ini /pgbouncer/pgbouncer.ini
COPY userlist.txt /pgbouncer/userlist.txt
