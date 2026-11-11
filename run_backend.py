"""One local entry point: web service plus a separate test worker."""
import argparse
import os
import subprocess
import sys
import threading
import uvicorn
from backend.app import create_app


def supervise_worker(directory, stopped):
    """Keep the queue consumer alive without retrying interrupted jobs."""
    command = [sys.executable, "-X", "utf8", "-u", "-m", "backend.worker", "--data-dir", str(directory)]
    while not stopped.is_set():
        worker = None
        try:
            worker = subprocess.Popen(command, cwd=os.path.dirname(os.path.abspath(__file__)))
            while not stopped.is_set():
                try:
                    code = worker.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    continue
                print(f"检测进程已退出（{code}），3 秒后自动恢复；中断任务仍需手动重试。", flush=True)
                break
        except OSError as exc:
            print(f"检测进程启动失败（{type(exc).__name__}），3 秒后重试。", flush=True)
        finally:
            if worker and worker.poll() is None:
                worker.terminate()
                try:
                    worker.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    worker.kill()
                    worker.wait()
        if stopped.wait(3):
            break


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
    stopped = threading.Event()
    try:
        if not args.no_worker:
            worker = threading.Thread(target=supervise_worker, args=(directory, stopped), name="worker-supervisor")
            worker.start()
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")
    finally:
        stopped.set()
        if worker:
            worker.join()


if __name__ == "__main__":
    main()
