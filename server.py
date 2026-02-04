import http.server
import socketserver
import webbrowser
import os

PORT = 18089

Handler = http.server.SimpleHTTPRequestHandler
os.chdir(os.path.dirname(os.path.abspath(__file__)))
httpd = socketserver.TCPServer(("", PORT), Handler)
print(f"Serving at port {PORT}")
print(f"http://localhost:{PORT}/index.html")
print("Press Ctrl+C to stop the server.")
webbrowser.open(f"http://localhost:{PORT}/index.html")
httpd.serve_forever()
