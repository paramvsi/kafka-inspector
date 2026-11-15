package dev.kafkainspector.agent.api;

import dev.kafkainspector.agent.security.LoginRateLimiter;
import dev.kafkainspector.agent.security.SecurityConfig.AdminCredentials;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AdminCredentials admin;
    private final PasswordEncoder encoder;
    private final LoginRateLimiter limiter;
    private final SecurityContextRepository repo;

    public AuthController(AdminCredentials admin, PasswordEncoder encoder, LoginRateLimiter limiter, SecurityContextRepository repo) {
        this.admin = admin;
        this.encoder = encoder;
        this.limiter = limiter;
        this.repo = repo;
    }

    public record Login(String username, String password) {}

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Login body, HttpServletRequest req, HttpServletResponse res) {
        String ip = req.getRemoteAddr();
        long wait = limiter.acquire(ip);
        if (wait > 0) return ResponseEntity.status(429).body(Dto.ApiError.of("RATE_LIMITED", "Too many sign-in attempts. Try again in " + wait + " s."));
        boolean ok = body != null && admin.username().equals(body.username()) && body.password() != null && encoder.matches(body.password(), admin.hash());
        if (!ok) return ResponseEntity.status(401).body(Dto.ApiError.of("BAD_CREDENTIALS", "Wrong username or password. The username is admin; the password is KI_ADMIN_PASSWORD."));
        limiter.succeeded(ip);
        HttpSession old = req.getSession(false);
        if (old != null) old.invalidate(); // new session id on sign-in
        req.getSession(true);
        SecurityContext ctx = SecurityContextHolder.createEmptyContext();
        ctx.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(admin.username(), null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
        SecurityContextHolder.setContext(ctx);
        repo.saveContext(ctx, req, res);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletRequest req) {
        HttpSession s = req.getSession(false);
        if (s != null) s.invalidate();
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }
}
