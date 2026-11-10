"""One local entry point: web service plus a separate test worker."""
import argparse
import os
import subprocess
import sys
import uvicorn
from backend.app import create_app


def main():
    parser = argparse.ArgumentParser(description="ModelTool 本地后台（不会部署或推送）")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--data-dir", help="数据目录，必须位于项目之外")
    parser.add_argument("--no-worker", action="store_true")
    args = parser.parse_args()
    app = create_app(args.data_dir)
    directory = app.state.db.directory
    print(f"前台：http://127.0.0.1:{args.port}/", flush=True)
    print(f"后台：http://127.0.0.1:{args.port}/admin/", flush=True)
    print(f"数据目录：{directory}", flush=True)
    token_file = directory / "setup.token"
    if token_file.exists() and not app.state.db.has_admin():
        print(f"首次初始化（仅本机保管）：http://127.0.0.1:{args.port}/admin/#setup={token_file.read_text().strip()}", flush=True)
    worker = None
    try:
        if not args.no_worker:
            worker = subprocess.Popen([sys.executable, "-m", "backend.worker", "--data-dir", str(directory)], cwd=os.path.dirname(os.path.abspath(__file__)))
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")
    finally:
        if worker and worker.poll() is None:
            worker.terminate()
            try:
                worker.wait(timeout=5)
            except subprocess.TimeoutExpired:
                worker.kill()


if __name__ == "__main__":
    main()
