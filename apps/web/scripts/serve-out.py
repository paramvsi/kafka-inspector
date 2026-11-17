"""Static server for the e2e run (apps/web/out). `python3 -m http.server` keeps a listen backlog of 5 and speaks
HTTP/1.0, so a burst from parallel Playwright workers got connections reset (BrokenPipe in the log, flaky tests)."""
import functools
import http.server
import sys

port, directory = int(sys.argv[1]), sys.argv[2]


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # the burst of parallel page loads waits instead of being reset
    daemon_threads = True

    def handle_error(self, request, client_address):
        # a page that navigates away mid-download closes its connection: not a server error, don't print a traceback
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive: one connection per page, not one per asset

    def log_message(self, *args):
        pass  # quiet: Playwright shows the server output


Server(("127.0.0.1", port), functools.partial(Handler, directory=directory)).serve_forever()
