import http.server
import socketserver
import webbrowser
import os

PORT = 18089

# 只允许本机访问。SimpleHTTPRequestHandler 以项目根为 web 根目录，
# 里面包含 .git（完整提交历史）、server.py 源码、dist/ 里的打包产物，
# 绑定到所有网卡等于把这些内容对整个局域网开放。
BIND_HOST = "127.0.0.1"

# 不对外暴露的目录：即便有人改成对外监听，也不会被下载
BLOCKED_PREFIXES = ("/.git/", "/dist/", "/node_modules/", "/__pycache__/")


class Handler(http.server.SimpleHTTPRequestHandler):
    """在默认静态文件服务基础上屏蔽敏感目录。"""

    def send_head(self):
        # 先判断路径（含查询串之外的纯路径，大小写与 .// 归一化交给父类）
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if any(path.startswith(p) for p in BLOCKED_PREFIXES):
            self.send_error(404, "Not Found")
            return None
        return super().send_head()

    def list_directory(self, path):
        # 目录列表同样屏蔽
        if any(path.startswith(p) for p in BLOCKED_PREFIXES):
            self.send_error(404, "Not Found")
            return None
        return super().list_directory(path)

    def log_message(self, fmt, *args):
        # 默认实现会把每条请求打到 stderr，这里保持安静，只在出错时提示
        pass


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    httpd = socketserver.TCPServer((BIND_HOST, PORT), Handler)
    print(f"Serving at port {PORT} (localhost only)")
    print(f"http://localhost:{PORT}/index.html")
    print("Press Ctrl+C to stop the server.")
    try:
        webbrowser.open(f"http://localhost:{PORT}/index.html")
    except Exception:
        pass  # 无图形环境时忽略
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        httpd.server_close()
