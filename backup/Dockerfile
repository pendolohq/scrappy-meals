# pg_dump must match the server's major version, so build on the same image.
FROM postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
RUN apk add --no-cache aws-cli age curl tar gzip
COPY --chmod=0755 ops.sh /usr/local/bin/ops
ENTRYPOINT ["ops"]
CMD ["backup"]
