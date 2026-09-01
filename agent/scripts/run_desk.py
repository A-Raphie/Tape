"""Run the desk loop against the account in .env (the competition account
once flipped). Ctrl-C stops; the journal persists everything."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tape import load_env  # noqa: E402
from tape.analyst import Analyst  # noqa: E402
from tape.cycle import Desk  # noqa: E402
from tape.executor import Executor  # noqa: E402
from tape.journal import Journal  # noqa: E402
from tape.llm import Llm  # noqa: E402
from tape.mcp_client import AlpacaMcp  # noqa: E402


def main() -> None:
    load_env()
    journal = Journal()
    mcp = AlpacaMcp(journal)
    mcp.start()
    try:
        executor = Executor(mcp)
        analyst = None
        import os

        if os.environ.get("GROQ_API_KEY"):
            analyst = Analyst(Llm(journal))
        else:
            print("GROQ_API_KEY missing: running with empty analyst (gates + execution only)")
        desk = Desk(journal, executor, analyst)
        print("Desk armed. Polling; journal at", journal.db_path)
        desk.run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mcp.stop()


if __name__ == "__main__":
    main()
