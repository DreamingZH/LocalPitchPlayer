import http.server
import socketserver
import webbrowser
import os
import posixpath
import urllib.parse

PORT = 18089

# 只允许本机访问。SimpleHTTPRequestHandler 以项目根为 web 根目录，
# 里面包含 .git（完整提交历史）、server.py 源码、dist/ 里的打包产物，
# 绑定到所有网卡等于把这些内容对整个局域网开放。
BIND_HOST = "127.0.0.1"

# 不对外暴露的目录：即便有人改成对外监听，也不会被下载
BLOCKED = (".git", "dist", "node_modules", "__pycache__", ".idea")


def is_blocked(raw_path):
    """判断请求路径是否指向敏感目录。

    必须先规范化再做判断：直接对原始字符串做前缀匹配会被
    /.git%2fconfig、/./.git/config、/../.git/config 等写法绕过。
    """
    path = urllib.parse.urlsplit(raw_path).path
    # %2f 等编码先解码，否则 /.git%2fconfig 规范化后仍不以 /.git/ 开头
    path = urllib.parse.unquote(path)
    # 统一分隔符、解析 . 与 ..、去掉重复斜杠
    path = posixpath.normpath(path)
    parts = [p for p in path.split("/") if p and p != "."]
    return any(p in BLOCKED for p in parts)


class Handler(http.server.SimpleHTTPRequestHandler):
    """在默认静态文件服务基础上屏蔽敏感目录。"""

    def send_head(self):
        if is_blocked(self.path):
            self.send_error(404, "Not Found")
            return None
        return super().send_head()

    def list_directory(self, path):
        # 目录列表同样屏蔽
        if is_blocked(path):
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
