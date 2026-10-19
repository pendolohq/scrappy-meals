# pg_dump must match the server's major version, so build on the same image.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli age curl tar gzip
COPY --chmod=0755 ops.sh /usr/local/bin/ops
ENTRYPOINT ["ops"]
CMD ["backup"]
