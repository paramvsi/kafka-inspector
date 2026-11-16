package dev.kafkainspector.agent.web;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves the web app's static export (D-05, D-06): "/" → "/app/", "/app/topics/view/" → its index.html,
 * unknown paths → 404 with 404.html (ErrorHandler). Query-param detail routes need no server-side rendering.
 */
@Configuration
public class StaticConfig implements WebMvcConfigurer {
    @Override
    public void addViewControllers(ViewControllerRegistry r) {
        r.addRedirectViewController("/", "/app/");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry r) {
        r.addResourceHandler("/_next/static/**").addResourceLocations("classpath:/static/_next/static/").setCachePeriod(31_536_000);
        // pages aren't content-hashed: revalidate them, or a browser can keep an old build's index.html
        r.addResourceHandler("/**").addResourceLocations("classpath:/static/").setCacheControl(org.springframework.http.CacheControl.noCache()).resourceChain(true).addResolver(new PathResourceResolver() {
            @Override
            protected Resource getResource(String path, Resource location) throws IOException {
                Resource direct = location.createRelative(path);
                if (direct.exists() && direct.isReadable() && !path.endsWith("/") && !path.isEmpty()) return direct;
                String dir = path.isEmpty() || path.endsWith("/") ? path : path + "/";
                Resource index = location.createRelative(dir + "index.html");
                if (index.exists() && index.isReadable()) return index;
                // unknown: nothing (so the resource cache never stores one entry per random URL);
                // ErrorHandler answers 404 with the app's 404 page for browsers, JSON for /api
                return null;
            }
        });
    }
}
