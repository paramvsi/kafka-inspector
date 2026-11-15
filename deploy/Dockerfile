# syntax=docker/dockerfile:1.7
# Kafka Inspector: one image — the Spring Boot agent serves the static web app at /app and the API at /api.

# 1. Web app (static export)
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "web..."
RUN pnpm --filter web build

# 2. Agent (Spring Boot, Java 21)
FROM eclipse-temurin:21-jdk AS agent
WORKDIR /src/apps/agent
COPY apps/agent/gradle ./gradle
COPY apps/agent/gradlew apps/agent/settings.gradle.kts apps/agent/build.gradle.kts ./
RUN ./gradlew --no-daemon -q dependencies > /dev/null
COPY apps/agent/src ./src
COPY --from=web /src/apps/web/out /src/web-out
ARG VERSION=0.1.0
RUN ./gradlew --no-daemon -q bootJar -PwebOut=/src/web-out -Pversion=${VERSION} -x test && cp build/libs/*-${VERSION}.jar /agent.jar

# 3. Runtime: slim JRE, non-root, writable /data only
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S -g 10001 ki && adduser -S -u 10001 -G ki -h /home/ki ki && mkdir -p /data /config && chown ki:ki /data
COPY --from=agent /agent.jar /app/agent.jar
USER 10001
VOLUME /data
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Djava.io.tmpdir=/tmp"
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["java", "-jar", "/app/agent.jar"]
