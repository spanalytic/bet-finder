"""Preview the static export locally, including its GitHub Pages base path."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path == "/bet-finder":
            path = "/"
        elif path.startswith("/bet-finder/"):
            path = path[len("/bet-finder"):]
        return super().translate_path(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=3002)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / "out"
    print(f"Preview: http://127.0.0.1:{args.port}/bet-finder/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(directory))).serve_forever()
