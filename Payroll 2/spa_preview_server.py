from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class SpaRequestHandler(SimpleHTTPRequestHandler):
    """Serve compiled assets and return index.html for client-side routes."""

    def do_GET(self) -> None:
        requested_path = urlsplit(self.path).path
        local_path = Path(self.translate_path(requested_path))
        if not local_path.exists() and not Path(requested_path).suffix:
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self) -> None:
        requested_path = urlsplit(self.path).path
        local_path = Path(self.translate_path(requested_path))
        if not local_path.exists() and not Path(requested_path).suffix:
            self.path = "/index.html"
        super().do_HEAD()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("port", type=int, nargs="?", default=3000)
    arguments = parser.parse_args()
    directory = arguments.directory.resolve(strict=True)

    def handler(*args, **kwargs):
        return SpaRequestHandler(*args, directory=str(directory), **kwargs)

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), handler)
    print(f"Serving {directory} at http://127.0.0.1:{arguments.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
