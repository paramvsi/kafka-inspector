package dev.kafkainspector.agent.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Every API body is small JSON (search, compatibility, filters, rules, sign-in): anything over 1 MB is refused before
 * Jackson buffers it, including on the open sign-in endpoint. A body without a length is refused too, so the cap
 * can't be dodged with chunked encoding.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BodySizeLimit extends OncePerRequestFilter {
    static final long MAX = 1024 * 1024;

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        boolean hasBody = !"GET".equals(req.getMethod()) && !"HEAD".equals(req.getMethod()) && !"OPTIONS".equals(req.getMethod());
        long len = req.getContentLengthLong();
        if (hasBody && req.getRequestURI().startsWith("/api/") && (len > MAX || (len < 0 && req.getHeader("Transfer-Encoding") != null))) {
            res.setStatus(413);
            res.setContentType("application/json");
            res.getWriter().write("{\"error\":{\"code\":\"PAYLOAD_TOO_LARGE\",\"message\":\"Request bodies are limited to 1 MB.\",\"details\":{}}}");
            return;
        }
        chain.doFilter(req, res);
    }
}
