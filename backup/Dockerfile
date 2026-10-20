# pg_dump must match the server's major version, so build on the same image.
FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
RUN apk add --no-cache aws-cli age curl tar gzip
COPY --chmod=0755 ops.sh /usr/local/bin/ops
ENTRYPOINT ["ops"]
CMD ["backup"]
