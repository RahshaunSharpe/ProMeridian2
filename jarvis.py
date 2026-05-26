#!/usr/bin/env python3
"""
Pro Meridian — Single entry point
===================================
Usage:
  python meridian.py                  Start dashboard + scheduler + browser
  python meridian.py --no-schedule    Dashboard only (no daily auto-run)
  python meridian.py --no-browser     Skip auto-opening the browser
  python meridian.py --port 9000      Use a custom port (default: 8000)
"""

import argparse
import sys
import threading
import time
import webbrowser

BANNER = r"""
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║   ██████╗ ██████╗  ██████╗                                  ║
  ║   ██╔══██╗██╔══██╗██╔═══██╗                                 ║
  ║   ██████╔╝██████╔╝██║   ██║                                 ║
  ║   ██╔═══╝ ██╔══██╗██║   ██║                                 ║
  ║   ██║     ██║  ██║╚██████╔╝                                 ║
  ║   ╚═╝     ╚═╝  ╚═╝ ╚═════╝                                  ║
  ║                                                              ║
  ║   ███╗   ███╗███████╗██████╗ ██╗██████╗ ██╗ █████╗ ███╗     ║
  ║   ████╗ ████║██╔════╝██╔══██╗██║██╔══██╗██║██╔══██╗████╗    ║
  ║   ██╔████╔██║█████╗  ██████╔╝██║██║  ██║██║███████║██╔██╗   ║
  ║   ██║╚██╔╝██║██╔══╝  ██╔══██╗██║██║  ██║██║██╔══██║██║╚██╗  ║
  ║   ██║ ╚═╝ ██║███████╗██║  ██║██║██████╔╝██║██║  ██║██║ ╚██╗ ║
  ║   ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝╚═╝╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ║
  ║                                                              ║
  ║                Lead Intelligence System  v2.0               ║
  ╚══════════════════════════════════════════════════════════════╝
"""


def _start_server(port: int) -> None:
    """Run uvicorn in a daemon thread so it exits with the process."""
    import uvicorn
    from dashboard import app
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


def _start_scheduler() -> None:
    """Blocking scheduler — runs on main thread after server is up."""
    try:
        from scheduler import start_scheduler
        from main import run_pipeline
        start_scheduler(run_pipeline)
    except Exception as exc:
        print(f"\n  [SCHEDULER] Failed to start: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="meridian",
        description="Pro Meridian — Lead Intelligence unified launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--port",        type=int, default=8000,   help="Dashboard port (default 8000)")
    parser.add_argument("--no-schedule", action="store_true",       help="Disable the daily auto-run scheduler")
    parser.add_argument("--no-browser",  action="store_true",       help="Don't open the browser automatically")
    args = parser.parse_args()

    print(BANNER)
    print(f"  Dashboard   →  http://localhost:{args.port}")
    if not args.no_schedule:
        print("  Scheduler   →  daily auto-run enabled (see .env SCHEDULE_TIME)")
    print("  Logs        →  meridian.log")
    print()

    # ── Start the dashboard server in a background daemon thread ──
    server_thread = threading.Thread(
        target=_start_server,
        args=(args.port,),
        daemon=True,
        name="meridian-server",
    )
    server_thread.start()

    # Give uvicorn time to bind before opening the browser
    time.sleep(1.6)
    print(f"  Server ready on http://localhost:{args.port}")

    if not args.no_browser:
        webbrowser.open(f"http://localhost:{args.port}")

    # ── Scheduler or idle loop on main thread ──────────────────
    if not args.no_schedule:
        print("\n  Scheduler running. Press Ctrl+C to stop Pro Meridian.\n")
        try:
            _start_scheduler()  # blocks here
        except (KeyboardInterrupt, SystemExit):
            pass
    else:
        print("\n  Scheduler disabled. Press Ctrl+C to stop Pro Meridian.\n")
        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            pass

    print("\n  Pro Meridian offline. Goodbye.\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
