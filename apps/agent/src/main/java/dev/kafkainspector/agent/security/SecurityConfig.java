package dev.kafkainspector.agent.security;

import dev.kafkainspector.agent.config.KiProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.frameoptions.XFrameOptionsHeaderWriter;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Sign-in (F-91, D-11): one admin, session cookie KI_SESSION (HttpOnly, SameSite=Strict, Secure behind TLS),
 * CSRF double-submit (KI_CSRF cookie + X-KI-CSRF header) on non-GET, 401 JSON for unauthenticated API calls.
 */
@Configuration
public class SecurityConfig {

    /**
     * Kafka group ids, registry subjects and saved-filter names may contain "/", sent as %2F in one path segment.
     * Tomcat rejects %2F by default; pass it through so Spring decodes it into the path variable.
     */
    @Bean
    org.springframework.boot.tomcat.TomcatConnectorCustomizer encodedSlashPassthrough() {
        return c -> c.setEncodedSolidusHandling("passthrough");
    }

    /**
     * The strict firewall, allowing %2F: with passthrough the servlet path keeps a literal "%", so "%" leaves the
     * decoded blocklist too. "%25" is still refused in the raw URI, so double encoding stays blocked.
     */
    @Bean
    org.springframework.security.web.firewall.HttpFirewall httpFirewall() {
        var f = new org.springframework.security.web.firewall.StrictHttpFirewall();
        f.setAllowUrlEncodedSlash(true);
        f.getDecodedUrlBlocklist().remove("%");
        return f;
    }

    /** A request the firewall refuses (e.g. "%25" or ";" in the path) answers in the API's error envelope, not Boot's. */
    @Bean
    org.springframework.security.web.firewall.RequestRejectedHandler requestRejectedHandler() {
        return (request, response, ex) -> {
            dev.kafkainspector.agent.api.Dto.ApiError.write(response, 400, "BAD_REQUEST", "The address has characters the agent refuses (such as an encoded % or ;).");
        };
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    AdminCredentials adminCredentials(KiProperties props, PasswordEncoder encoder) {
        // only a hash is kept in memory; the plain password is never logged
        return new AdminCredentials("admin", encoder.encode(props.adminPassword()));
    }

    /** No username/password users: sign-in is handled by AuthController (also stops Boot's generated-password log line). */
    @Bean
    org.springframework.security.core.userdetails.UserDetailsService noUsers() {
        return username -> {
            throw new org.springframework.security.core.userdetails.UsernameNotFoundException("No users");
        };
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SecurityFilterChain chain(HttpSecurity http, SecurityContextRepository repo) throws Exception {
        CookieCsrfTokenRepository csrfRepo = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepo.setCookieName("KI_CSRF");
        csrfRepo.setHeaderName("X-KI-CSRF");
        csrfRepo.setCookieCustomizer(c -> c.sameSite("Strict").path("/"));
        CsrfTokenRequestAttributeHandler handler = new CsrfTokenRequestAttributeHandler();
        handler.setCsrfRequestAttributeName(null); // plain token: the SPA echoes the cookie value
        http.securityContext(s -> s.securityContextRepository(repo))
                .csrf(c -> c.csrfTokenRepository(csrfRepo).csrfTokenRequestHandler(handler))
                .authorizeHttpRequests(a -> a
                        .requestMatchers("/api/health", "/api/info", "/api/auth/login", "/api/auth/logout").permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> dev.kafkainspector.agent.api.Dto.ApiError.write(res, 401, "UNAUTHENTICATED", "Sign in to use the API."))
                        .accessDeniedHandler((req, res, ex) -> dev.kafkainspector.agent.api.Dto.ApiError.write(res, 403, "FORBIDDEN", "Missing or invalid X-KI-CSRF header. Reload the page and try again.")))
                .headers(h -> h
                        .frameOptions(f -> f.deny())
                        .addHeaderWriter(new XFrameOptionsHeaderWriter(XFrameOptionsHeaderWriter.XFrameOptionsMode.DENY))
                        .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.SAME_ORIGIN))
                        .addHeaderWriter((req, res) -> res.setHeader("Content-Security-Policy", req.getRequestURI().startsWith(WORKER_PREFIX) ? WORKER_CSP : PAGE_CSP)))
                .formLogin(f -> f.disable())
                .httpBasic(b -> b.disable())
                .logout(l -> l.disable())
                .addFilterAfter(new CsrfCookieFilter(), org.springframework.security.web.csrf.CsrfFilter.class);
        return http.build();
    }

    static final String PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'";
    /** Worker scripts get their own policy (CSP3): the message filter compiles the user's expression, and has no network. */
    static final String WORKER_PREFIX = "/_next/static/chunks/turbopack-worker-";
    static final String WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

    public record AdminCredentials(String username, String hash) {}

    /** Materialises the deferred CSRF token so the KI_CSRF cookie is always set. */
    static final class CsrfCookieFilter extends OncePerRequestFilter {
        @Override
        protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
            CsrfToken token = (CsrfToken) req.getAttribute(CsrfToken.class.getName());
            if (token != null) token.getToken();
            chain.doFilter(req, res);
        }
    }
}
