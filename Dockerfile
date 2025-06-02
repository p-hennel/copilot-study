# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
  apt-get upgrade -qq -y && \
  apt-get install -qq -y nano htop cifs-utils bash wget bzip2 curl procps cron


# RUN mkdir -p /home/bun/.ssh/config.d
# RUN echo $'Include config.d/*\n\
# \n\
# Host storagebox\n\
#   Hostname \$BACKUP_USER.your-storagebox.de\n\
#   Port 23\n\
#   User \$BACKUP_USER\n\
#   IdentityFile ~/.ssh/storagebox\n' >> /home/bun/.ssh/config && touch /home/bun/.ssh/storagebox && chmod 600 ~/.ssh/storagebox
# RUN echo 'modprobe cifs\necho 0 > /proc/fs/cifs/OplockEnabled' >> /etc/rc.local
# RUN wget -qO - https://raw.githubusercontent.com/cupcakearmy/autorestic/master/install.sh | bash

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
RUN mkdir -p /home/bun/data/logs /home/bun/data/archive /home/bun/data/config /home/bun/.ssh/config.d

COPY drizzle /usr/src/app/drizzle/

# build for production
ARG HOME=/home/bun
ENV NODE_ENV=production
RUN BETTER_AUTH_SECRET=BETTER_AUTH_SECRET_FOR_BUILD_ONLY \
  DATA_ROOT=/home/bun/data \
  SETTINGS_FILE=/home/bun/data/config/settings.yaml \
  bun run build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease \
  /usr/src/app/drizzle \
  /usr/src/app/build \
  /usr/src/app/package.json \
  /usr/src/app/startup.sh \
  /usr/src/app/db-test.ts \
  ./
#  /usr/src/app/dual-server.js \

COPY --from=prerelease \
  /usr/src/app/src/lib/server/db/*schema.ts \
  /usr/src/app/src/lib/types.ts \
  ./schema/

COPY --from=prerelease \
  /usr/src/app/runtime-tsconfig.json \
  /usr/src/app/tsconfig.json
  
COPY drizzle /usr/src/app/

#COPY --from=prerelease \
#  /usr/src/app/config/settings.example.yaml \
#  /home/bun/data/config/settings.yaml

RUN crontab -u bun /usr/src/app/backup.cron
#RUN rm -f /home/bun/data/config/main.db;
RUN mkdir -p /home/bun/data/logs /home/bun/data/archive /home/bun/data/config
RUN chown -R bun:bun /home/bun/data
# /home/bun/.ssh

# run the app
USER bun
EXPOSE 3000/tcp
#ENTRYPOINT [ "/bin/sh", "-c", "while :; do sleep 2073600; done", ";", "/bin/bash" ]
ENTRYPOINT [ "/bin/bash" ]
CMD [ "./startup.sh", "./web/index.js" ]
# ./startup.sh