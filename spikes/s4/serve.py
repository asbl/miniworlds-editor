"""HTTP/1.1 static server for the spikes (Firefox dislikes http.server's HTTP/1.0 close-delimited responses)."""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass

port, directory = int(sys.argv[1]), sys.argv[2]
ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=directory)).serve_forever()
