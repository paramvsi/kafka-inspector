plugins {
    java
    id("org.springframework.boot") version "4.1.2"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "dev.kafkainspector"
version = (findProperty("version") as String?)?.takeIf { it != "unspecified" } ?: "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    implementation("org.apache.kafka:kafka-clients")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("com.h2database:h2")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-starter-security-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-kafka")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
    // shared lag vectors live in the TypeScript core package (rule 9)
    systemProperty("ki.lagVectors", rootDir.resolve("../../packages/core/test/lag-vectors.json").canonicalPath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

// The web app's static export is copied in by the Docker build (or `-PwebOut=../web/out`).
val webOut = (findProperty("webOut") as String?) ?: "../web/out"
tasks.processResources {
    from(webOut) { into("static") }
    // a jar without the export starts fine but serves no UI: say so (tests don't need it)
    doFirst {
        if (!file("$webOut/index.html").exists()) logger.warn("No web export at $webOut: this build will serve no UI. Run `pnpm build` first, or pass -PwebOut=<dir>.")
    }
}
